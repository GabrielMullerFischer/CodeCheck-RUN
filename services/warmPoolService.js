const { k8sApi, k8sExec, namespace } = require('../config/kubernetes');
const stream = require('stream');

const MIN_WARM_PODS = parseInt(process.env.K8S_MIN_WARM_PODS, 10) || 1;
const MAX_WARM_PODS = parseInt(process.env.MAX_CONCURRENT_COMPILATIONS, 10) || 6;
const IDLE_TIMEOUT_MS = parseInt(process.env.K8S_POD_IDLE_TIMEOUT_MS, 10) || (5 * 60 * 1000); // 5 minutos
const TARGET_NS = process.env.K8S_NAMESPACE || namespace || 'default';

const RUNNER_C = `
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/resource.h>

int main(int argc, char *argv[]) {
    if (argc < 3) return 1;
    pid_t pid = fork();
    if (pid < 0) return 1;
    if (pid == 0) {
        execv(argv[1], &argv[1]);
        exit(1);
    } else {
        int status;
        struct rusage usage;
        if (wait4(pid, &status, 0, &usage) < 0) return 1;
        
        double user_time = usage.ru_utime.tv_sec + (usage.ru_utime.tv_usec / 1000000.0);
        double sys_time  = usage.ru_stime.tv_sec + (usage.ru_stime.tv_usec / 1000000.0);
        
        FILE *f = fopen(argv[2], "w");
        if (f) {
            fprintf(f, "%.6f\\n", user_time + sys_time);
            fclose(f);
        }
        
        if (WIFEXITED(status)) return WEXITSTATUS(status);
        if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
        return 1;
    }
}
`;

const B64_RUNNER = Buffer.from(RUNNER_C, 'utf-8').toString('base64');

// Estado interno do pool em memória:
// podMap: podName -> { name, status: 'starting' | 'idle' | 'busy', lastUsedAt, idleTimer, isExtra }
const podMap = new Map();
const filaEsperaExecucao = [];
let loopManutencao = null;
let inicializando = false;

function gerarManifestoWarmPod(podName) {
    const cpuReq = process.env.K8S_CPU_REQUEST || '1000m';
    const cpuLim = process.env.K8S_CPU_LIMIT || '1000m';
    const memReq = process.env.K8S_MEMORY_REQUEST || '512Mi';
    const memLim = process.env.K8S_MEMORY_LIMIT || '512Mi';
    const image = process.env.K8S_IMAGE || 'gcc:latest';

    // Script de inicialização do contêiner:
    // Compila o runner.c uma única vez para /usr/local/bin/runner,
    // sinaliza prontidão em /tmp/runner_ready e entra em sleep infinity.
    const startupScript = `#!/usr/bin/env bash
mkdir -p /tmp/runner_build && cd /tmp/runner_build
echo "${B64_RUNNER}" | base64 -d > runner.c
gcc -O2 runner.c -o /usr/local/bin/runner
chmod 555 /usr/local/bin/runner
cd / && rm -rf /tmp/runner_build
mkdir -p /sandbox && chmod 777 /sandbox
touch /tmp/runner_ready
exec sleep infinity
`;
    const b64Startup = Buffer.from(startupScript, 'utf-8').toString('base64');

    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
            name: podName,
            namespace: TARGET_NS,
            labels: {
                app: 'codecheck-worker',
                role: 'judge-sandbox'
            }
        },
        spec: {
            restartPolicy: 'Always',
            automountServiceAccountToken: false,
            containers: [
                {
                    name: 'runner',
                    image: image,
                    imagePullPolicy: process.env.K8S_IMAGE_PULL_POLICY || 'IfNotPresent',
                    command: ['/bin/bash', '-c'],
                    args: [`echo "${b64Startup}" | base64 -d | /bin/bash`],
                    readinessProbe: {
                        exec: {
                            command: ['cat', '/tmp/runner_ready']
                        },
                        initialDelaySeconds: 1,
                        periodSeconds: 1,
                        failureThreshold: 30
                    },
                    resources: {
                        requests: { cpu: cpuReq, memory: memReq },
                        limits: { cpu: cpuLim, memory: memLim }
                    }
                }
            ]
        }
    };
}

async function apiCreatePod(manifest) {
    try {
        return await k8sApi.createNamespacedPod({
            namespace: TARGET_NS,
            body: manifest
        });
    } catch (err) {
        if (err.message && err.message.includes('Required parameter')) {
            return await k8sApi.createNamespacedPod(TARGET_NS, manifest);
        }
        throw err;
    }
}

async function apiDeletePod(podName) {
    try {
        try {
            await k8sApi.deleteNamespacedPod({
                name: podName,
                namespace: TARGET_NS,
                gracePeriodSeconds: 0
            });
        } catch {
            await k8sApi.deleteNamespacedPod(podName, TARGET_NS, undefined, undefined, 0);
        }
    } catch (err) {
        // Se já não existir (404), ignora silenciosamente
    }
}

async function apiListWorkerPods() {
    try {
        let res;
        try {
            res = await k8sApi.listNamespacedPod({
                namespace: TARGET_NS,
                labelSelector: 'app=codecheck-worker'
            });
        } catch {
            res = await k8sApi.listNamespacedPod(TARGET_NS, undefined, undefined, undefined, undefined, 'app=codecheck-worker');
        }
        const body = res?.body || res;
        return body?.items || [];
    } catch {
        return [];
    }
}

async function apiReadPodStatus(podName) {
    try {
        let res;
        try {
            res = await k8sApi.readNamespacedPodStatus({ name: podName, namespace: TARGET_NS });
        } catch {
            res = await k8sApi.readNamespacedPodStatus(podName, TARGET_NS);
        }
        return res?.body || res;
    } catch {
        return null;
    }
}

function isPodReady(podObj) {
    if (!podObj || !podObj.status) return false;
    if (podObj.status.phase !== 'Running') return false;
    const conditions = podObj.status.conditions || [];
    const readyCond = conditions.find(c => c.type === 'Ready');
    return readyCond && (readyCond.status === 'True' || readyCond.status === true);
}

async function aguardarPodFicarPronto(podName, timeoutMs = 45000) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
        const podObj = await apiReadPodStatus(podName);
        if (isPodReady(podObj)) {
            return true;
        }
        if (podObj?.status?.phase === 'Failed') {
            throw new Error(`Pod ${podName} falhou durante a inicialização.`);
        }
        await new Promise(r => setTimeout(r, 400));
    }
    throw new Error(`Tempo esgotado aguardando prontidão do Pod ${podName} (${timeoutMs}ms).`);
}

async function criarPodWorker(isExtra = false) {
    const sufixo = `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const podName = `codecheck-worker-${sufixo}`;

    const podEntry = {
        name: podName,
        status: 'starting',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        idleTimer: null,
        isExtra: isExtra
    };

    podMap.set(podName, podEntry);

    try {
        const manifest = gerarManifestoWarmPod(podName);
        await apiCreatePod(manifest);
        await aguardarPodFicarPronto(podName);
        podEntry.status = 'idle';
        console.log(`[WarmPool] Pod ${podName} criado e PRONTO para compilações (extra: ${isExtra}).`);
        return podEntry;
    } catch (err) {
        console.error(`[WarmPool] Falha ao criar Pod ${podName}:`, err.message);
        podMap.delete(podName);
        await apiDeletePod(podName);
        throw err;
    }
}

async function destruirPod(podName, motivo = 'ocioso') {
    const entry = podMap.get(podName);
    if (entry && entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
    }
    podMap.delete(podName);
    console.log(`[WarmPool] Destruindo Pod ${podName} (motivo: ${motivo}). Total restante: ${podMap.size}`);
    await apiDeletePod(podName);
}

function programarDesalocacaoSeExtra(entry) {
    if (!entry) return;
    if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
    }

    // Se temos mais pods no pool do que o mínimo configurado (ex: > 2),
    // agendamos a destruição deste pod caso fique 5 minutos ocioso.
    if (podMap.size > MIN_WARM_PODS) {
        entry.idleTimer = setTimeout(async () => {
            // Re-verifica no momento do disparo se ainda está ocioso e se o pool ainda está acima do mínimo
            if (entry.status === 'idle' && podMap.size > MIN_WARM_PODS) {
                console.log(`[WarmPool] Pod extra ${entry.name} permaneceu ocioso por ${IDLE_TIMEOUT_MS / 60000} minutos. Desalocando...`);
                await destruirPod(entry.name, 'timeout_ocioso_5min');
            }
        }, IDLE_TIMEOUT_MS);
    }
}

async function adquirirPod() {
    // 1. Tenta encontrar um pod 'idle' no pool existente
    for (const entry of podMap.values()) {
        if (entry.status === 'idle') {
            if (entry.idleTimer) {
                clearTimeout(entry.idleTimer);
                entry.idleTimer = null;
            }
            entry.status = 'busy';
            entry.lastUsedAt = Date.now();
            return entry.name;
        }
    }

    // 2. Se não há pod idle e ainda estamos abaixo do limite máximo, criamos um pod sob demanda (escala dinâmica)
    if (podMap.size < MAX_WARM_PODS) {
        console.log(`[WarmPool] Todos os ${podMap.size} pods estão ocupados. Criando pod sob demanda (limite: ${MAX_WARM_PODS})...`);
        const novoPod = await criarPodWorker(true);
        novoPod.status = 'busy';
        novoPod.lastUsedAt = Date.now();
        return novoPod.name;
    }

    // 3. Se atingiu o limite máximo de concorrência, aguarda na fila de espera
    return new Promise((resolve) => {
        filaEsperaExecucao.push(resolve);
    });
}

function liberarPod(podName, teveErroGrave = false) {
    const entry = podMap.get(podName);
    if (!entry) return;

    if (teveErroGrave) {
        console.warn(`[WarmPool] Pod ${podName} reportou falha grave/timeout. Reciclando contêiner...`);
        destruirPod(podName, 'erro_execucao').finally(() => {
            // Garante que o pool mantenha pelo menos o mínimo de pods
            if (podMap.size < MIN_WARM_PODS) {
                criarPodWorker(false).catch(err => console.error('[WarmPool] Erro ao repor pod:', err.message));
            }
        });

        // Se houver alguém na fila, cria outro ou atende com o próximo
        if (filaEsperaExecucao.length > 0) {
            adquirirPod().then(pName => {
                const next = filaEsperaExecucao.shift();
                if (next) next(pName);
            }).catch(() => {});
        }
        return;
    }

    // Se há processos na fila de espera, passa o pod diretamente para o próximo
    if (filaEsperaExecucao.length > 0) {
        const next = filaEsperaExecucao.shift();
        entry.status = 'busy';
        entry.lastUsedAt = Date.now();
        next(entry.name);
        return;
    }

    // Marca como ocioso e agenda desalocação caso seja excedente (> 2 pods)
    entry.status = 'idle';
    entry.lastUsedAt = Date.now();
    programarDesalocacaoSeExtra(entry);
}

function executarComandoNoPod(podName, scriptBash, timeoutMs) {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let isDone = false;
        let wsConn = null;

        const outStream = new stream.Writable({
            write(chunk, encoding, callback) {
                stdout += chunk.toString('utf-8');
                callback();
            }
        });

        const errStream = new stream.Writable({
            write(chunk, encoding, callback) {
                stderr += chunk.toString('utf-8');
                callback();
            }
        });

        const timer = setTimeout(() => {
            if (!isDone) {
                isDone = true;
                if (wsConn && typeof wsConn.close === 'function') {
                    try { wsConn.close(); } catch {}
                }
                reject(new Error(`Timeout na execução dentro do Pod (${timeoutMs}ms)`));
            }
        }, timeoutMs);

        const cmd = ['/bin/bash', '-c', scriptBash];

        k8sExec.exec(
            TARGET_NS,
            podName,
            'runner',
            cmd,
            outStream,
            errStream,
            null,
            false,
            (status) => {
                if (isDone) return;
                isDone = true;
                clearTimeout(timer);
                resolve({ stdout, stderr, status });
            }
        ).then(connection => {
            wsConn = connection;
            if (wsConn) {
                wsConn.on('error', (err) => {
                    if (!isDone) {
                        isDone = true;
                        clearTimeout(timer);
                        reject(err);
                    }
                });
                wsConn.on('close', () => {
                    setTimeout(() => {
                        if (!isDone) {
                            isDone = true;
                            clearTimeout(timer);
                            resolve({ stdout, stderr, status: null });
                        }
                    }, 50);
                });
            }
        }).catch(err => {
            if (!isDone) {
                isDone = true;
                clearTimeout(timer);
                reject(err);
            }
        });
    });
}

function montarScriptJob(code, tests, timeoutAlunoMs, jobId) {
    const b64Code = Buffer.from(code, 'utf-8').toString('base64');
    const limitSec = timeoutAlunoMs / 1000;
    const hardTimeoutSec = Math.min(Math.max(1, Math.ceil(limitSec * 3)), 30);

    let scriptTestes = '';
    tests.forEach((t, i) => {
        const b64In = Buffer.from(t.input || '', 'utf-8').toString('base64');
        scriptTestes += `
# Teste ${i}
echo "${b64In}" | base64 -d > in_${i}.txt

echo "---STEP---"
echo "INDEX:${i}"

rm -f time_${i}.txt
timeout -k 1s -s 9 ${hardTimeoutSec}s /usr/local/bin/runner ./prog time_${i}.txt < in_${i}.txt > got_${i}.txt 2> err_${i}.txt
EXIT_CODE=$?

CPUTIME=$(cat time_${i}.txt 2>/dev/null || echo "0.000000")
echo "TIME:$CPUTIME"

if [ $EXIT_CODE -eq 124 ] || [ $EXIT_CODE -eq 137 ]; then
    echo "STATUS:HARD_TIME_LIMIT"
elif [ $EXIT_CODE -ne 0 ]; then
    echo "STATUS:RUNTIME_ERROR"
    echo "ERR_B64:$(base64 -w 0 < err_${i}.txt 2>/dev/null || echo '')"
else
    echo "STATUS:OK"
    echo "GOT_B64:$(base64 -w 0 < got_${i}.txt 2>/dev/null || echo '')"
fi
`;
    });

    return `#!/usr/bin/env bash
JOB_DIR="/sandbox/job_${jobId}"
mkdir -p "$JOB_DIR" && cd "$JOB_DIR"

ulimit -u 50
ulimit -f 50000

# Fallback caso o binário do runner ainda não esteja presente
if [ ! -f /usr/local/bin/runner ]; then
    echo "${B64_RUNNER}" | base64 -d > /tmp/runner.c
    gcc -O2 /tmp/runner.c -o /usr/local/bin/runner
    chmod 555 /usr/local/bin/runner
    rm -f /tmp/runner.c
fi

echo "${b64Code}" | base64 -d > main.c
set +e
COMPILE_ERR=$(gcc main.c -o prog -lm 2>&1)
COMPILE_STATUS=$?

if [ $COMPILE_STATUS -ne 0 ]; then
    echo "STATUS:COMPILATION_ERROR"
    echo "ERR_B64:$(echo -n "$COMPILE_ERR" | base64 -w 0)"
    cd / && rm -rf "$JOB_DIR"
    exit 0
fi

${scriptTestes}

echo "STATUS:ALL_PASSED"
cd / && rm -rf "$JOB_DIR"
`;
}

async function executarJobNoPool(code, tests, timeoutAlunoMs, jobId = Date.now()) {
    const podName = await adquirirPod();
    let teveErroGrave = false;

    try {
        const scriptJob = montarScriptJob(code, tests, timeoutAlunoMs, jobId);
        const b64Script = Buffer.from(scriptJob, 'utf-8').toString('base64');
        const comando = `echo "${b64Script}" | base64 -d | /bin/bash`;

        const totalTestes = Array.isArray(tests) && tests.length > 0 ? tests.length : 1;
        const hardTimeoutSec = Math.min(Math.max(1, Math.ceil((timeoutAlunoMs * 3) / 1000)), 30);
        const timeoutExecMs = (hardTimeoutSec * 1000 * totalTestes) + 20000;

        const resultado = await executarComandoNoPod(podName, comando, timeoutExecMs);
        return (resultado.stdout || resultado.stderr || '').toString();
    } catch (err) {
        teveErroGrave = true;
        throw err;
    } finally {
        liberarPod(podName, teveErroGrave);
    }
}

async function verificarEManterPool() {
    try {
        const podsCluster = await apiListWorkerPods();
        const podsAtivosNoCluster = new Set();

        for (const pod of podsCluster) {
            const name = pod.metadata?.name;
            if (!name) continue;
            podsAtivosNoCluster.add(name);

            // Adota pods saudáveis que já estejam no cluster (ex: após reboot da app)
            if (!podMap.has(name) && isPodReady(pod)) {
                podMap.set(name, {
                    name,
                    status: 'idle',
                    createdAt: Date.now(),
                    lastUsedAt: Date.now(),
                    idleTimer: null,
                    isExtra: podMap.size >= MIN_WARM_PODS
                });
                console.log(`[WarmPool] Pod existente ${name} adotado no pool.`);
            }

            // Remove do cluster pods que falharam
            if (pod.status?.phase === 'Failed') {
                await destruirPod(name, 'fase_failed');
            }
        }

        // Limpa referências locais de pods que sumiram do cluster
        for (const [name, entry] of podMap.entries()) {
            if (!podsAtivosNoCluster.has(name) && entry.status !== 'starting') {
                if (entry.idleTimer) clearTimeout(entry.idleTimer);
                podMap.delete(name);
            }
        }

        // Se estiver abaixo do mínimo de pods (2), sobe os que faltam
        const podsValidos = podMap.size;
        if (podsValidos < MIN_WARM_PODS) {
            const faltam = MIN_WARM_PODS - podsValidos;
            console.log(`[WarmPool] Repondo ${faltam} pod(s) para manter o mínimo de ${MIN_WARM_PODS}...`);
            for (let i = 0; i < faltam; i++) {
                criarPodWorker(false).catch(err => {
                    console.warn('[WarmPool] Aviso ao criar pod de reposição:', err.message);
                });
            }
        }
    } catch (err) {
        // Ignora erros de checagem periódica
    }
}

async function inicializarPool() {
    if (inicializando) return;
    inicializando = true;

    try {
        console.log(`[WarmPool] Inicializando pool de pods quentes (Mínimo: ${MIN_WARM_PODS}, Máximo: ${MAX_WARM_PODS}, IdleTimeout: ${IDLE_TIMEOUT_MS / 60000}min)...`);
        await verificarEManterPool();

        // Inicia manutenção periódica a cada 30 segundos
        if (!loopManutencao) {
            loopManutencao = setInterval(verificarEManterPool, 30000);
        }
    } catch (err) {
        console.warn('[WarmPool] Não foi possível conectar ao Kubernetes na inicialização:', err.message);
    }
}

function obterStatusPool() {
    return {
        totalPods: podMap.size,
        minPods: MIN_WARM_PODS,
        maxPods: MAX_WARM_PODS,
        idleTimeoutMin: IDLE_TIMEOUT_MS / 60000,
        pods: Array.from(podMap.values()).map(p => ({
            name: p.name,
            status: p.status,
            idleTimerAtivo: !!p.idleTimer
        }))
    };
}

module.exports = {
    inicializarPool,
    executarJobNoPool,
    adquirirPod,
    liberarPod,
    obterStatusPool,
    B64_RUNNER
};
