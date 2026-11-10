const { k8sApi, k8sNetworkingApi, k8sExec, namespace } = require('../config/kubernetes');
const stream = require('stream');
const zlib = require('zlib');

const MIN_WARM_PODS = parseInt(process.env.K8S_MIN_WARM_PODS, 10) || 0; // 0: se ninguém usar por 24h, desliga e fica 0 pods
const MAX_WARM_PODS = parseInt(process.env.MAX_CONCURRENT_COMPILATIONS, 10) || 6;
const IDLE_TIMEOUT_MS = parseInt(process.env.K8S_POD_IDLE_TIMEOUT_MS, 10) || (5 * 60 * 1000); // 5 minutos para pods extras
const BASE_POD_MAX_IDLE_MS = parseInt(process.env.K8S_BASE_POD_MAX_IDLE_MS, 10) || (24 * 60 * 60 * 1000); // 24 horas de ociosidade total para o pod principal
const TARGET_NS = process.env.K8S_NAMESPACE || namespace || 'default';

const RUNNER_C = `
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <grp.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <sys/prctl.h>

static pid_t child_pid = 0;

static void sig_handler(int sig) {
    if (child_pid > 0) {
        kill(child_pid, SIGKILL);
    }
    _exit(128 + sig);
}

int main(int argc, char *argv[]) {
    if (argc < 3) return 1;

    signal(SIGTERM, sig_handler);
    signal(SIGINT, sig_handler);
    signal(SIGALRM, sig_handler);
    signal(SIGHUP, sig_handler);

    child_pid = fork();
    if (child_pid < 0) return 1;
    if (child_pid == 0) {
        // Encerra imediatamente o filho caso o processo pai (runner) seja finalizado
        prctl(PR_SET_PDEATHSIG, SIGKILL);
        setgroups(0, NULL);
        if (setgid(65534) != 0 || setuid(65534) != 0) _exit(1);
        execv(argv[1], &argv[1]);
        _exit(1);
    } else {
        int status;
        struct rusage usage;
        if (wait4(child_pid, &status, 0, &usage) < 0) return 1;
        
        double user_time = usage.ru_utime.tv_sec + (usage.ru_utime.tv_usec / 1000000.0);
        double sys_time  = usage.ru_stime.tv_sec + (usage.ru_stime.tv_usec / 1000000.0);
        
        FILE *f = fopen(argv[2], "w");
        if (f) {
            fprintf(f, "%.6f\\n", user_time + sys_time);
            fclose(f);
        }
        
        if (WIFEXITED(status)) return 0;
        if (WIFSIGNALED(status)) {
            int sig = WTERMSIG(status);
            if (sig == SIGSEGV) fprintf(stderr, "Segmentation fault (core dumped) [SIGSEGV]\\n");
            else if (sig == SIGFPE) fprintf(stderr, "Floating point exception (core dumped) [SIGFPE]\\n");
            else if (sig == SIGABRT) fprintf(stderr, "Aborted (core dumped) [SIGABRT]\\n");
            else if (sig == SIGBUS) fprintf(stderr, "Bus error (core dumped) [SIGBUS]\\n");
            else if (sig == SIGILL) fprintf(stderr, "Illegal instruction [SIGILL]\\n");
            else if (sig == SIGXFSZ) fprintf(stderr, "File size limit exceeded [SIGXFSZ]\\n");
            else fprintf(stderr, "Terminated by signal %d\\n", sig);
            fflush(stderr);
            return 128 + sig;
        }
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
mkdir -p /sandbox && chmod 711 /sandbox
touch /tmp/runner_v4_ready /tmp/runner_ready
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
            ...(process.env.K8S_WORKER_NODE ? {
                nodeSelector: {
                    'kubernetes.io/hostname': process.env.K8S_WORKER_NODE
                }
            } : {}),
            dnsPolicy: 'None',
            dnsConfig: {
                nameservers: ['127.0.0.1']
            },
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
    if (podObj.metadata?.deletionTimestamp) return false;
    if (podObj.status.phase !== 'Running') return false;

    // Garante que os contêineres estejam ativos e não terminados/em erro
    const containerStatuses = podObj.status.containerStatuses || [];
    if (containerStatuses.length === 0) return false;
    for (const cs of containerStatuses) {
        if (!cs.ready) return false;
        if (cs.state?.terminated || cs.state?.waiting) return false;
    }

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
        console.log(`[WarmPool] Pod ${podName} criado e PRONTO para compilações`);
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

    // 1. Pods extras (> 1): morrem após 5 minutos de ociosidade
    if (podMap.size > 1) {
        entry.idleTimer = setTimeout(async () => {
            if (entry.status === 'idle' && podMap.size > 1) {
                console.log(`[WarmPool] Pod extra ${entry.name} permaneceu ocioso por ${IDLE_TIMEOUT_MS / 60000} minutos. Desalocando...`);
                await destruirPod(entry.name, 'timeout_ocioso_5min');
            }
        }, IDLE_TIMEOUT_MS);
        return;
    }

    // 2. Pod principal (único): se ninguém compilar nele por 24 horas consecutivas, desliga e fica em 0 pods!
    entry.idleTimer = setTimeout(async () => {
        if (entry.status === 'idle') {
            console.log(`[WarmPool] Nenhuma compilação ocorreu nas últimas 24h. Desalocando pod principal ${entry.name}. Pool em repouso (0 pods).`);
            await destruirPod(entry.name, 'sem_uso_24h');
        }
    }, BASE_POD_MAX_IDLE_MS);
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

    // 2. Se o pool estiver vazio (0 pods após 24h desligado) ou todos ocupados:
    // Sobe um novo pod sob demanda instantaneamente a hora que alguém compilar!
    if (podMap.size < MAX_WARM_PODS) {
        const motivo = podMap.size === 0 ? "Pool acordando de repouso (0 pods)" : `Todos os ${podMap.size} pods ocupados`;
        console.log(`[WarmPool] ${motivo}. Criando novo pod worker sob demanda...`);
        const novoPod = await criarPodWorker(podMap.size > 0);
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
            }).catch(() => { });
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
        let stdoutTamanhoBytes = 0;
        let stderrTamanhoBytes = 0;
        const MAX_BUFFER_OUTPUT_BYTES = 5 * 1024 * 1024; // Teto de 5 MB por execução para proteção de RAM

        const outStream = new stream.Writable({
            write(chunk, encoding, callback) {
                if (stdoutTamanhoBytes < MAX_BUFFER_OUTPUT_BYTES) {
                    stdoutTamanhoBytes += chunk.length;
                    stdout += chunk.toString('utf-8');
                }
                callback();
            }
        });

        const errStream = new stream.Writable({
            write(chunk, encoding, callback) {
                if (stderrTamanhoBytes < MAX_BUFFER_OUTPUT_BYTES) {
                    stderrTamanhoBytes += chunk.length;
                    stderr += chunk.toString('utf-8');
                }
                callback();
            }
        });

        const timer = setTimeout(() => {
            if (!isDone) {
                isDone = true;
                if (wsConn && typeof wsConn.close === 'function') {
                    try { wsConn.close(); } catch { }
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
    const totalTests = Array.isArray(tests) && tests.length > 0 ? tests.length : 1;
    const firstTimeoutSec = totalTests === 1
        ? Math.max(1, Number(limitSec.toFixed(2)))
        : Math.max(1, Number((limitSec * 0.85).toFixed(2)));
    const compileTimeoutMs = Number(process.env.COMPILE_TIMEOUT) || 30000;
    const compileTimeoutSec = Math.max(1, Math.ceil(compileTimeoutMs / 1000));
    const safeJobId = String(jobId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');

    let scriptTestes = `
START_TIME_MS=$(date +%s%3N)
HAD_TIMEOUT=0
TIMEOUT_COUNT=0

run_step() {
    local i="$1"
    local b64In="$2"
    echo "---STEP---"
    echo "INDEX:\${i}"

    NOW_MS=$(date +%s%3N)
    ELAPSED_TOTAL=$(( NOW_MS - START_TIME_MS ))
    if [ $ELAPSED_TOTAL -ge ${timeoutAlunoMs} ]; then
        HAD_TIMEOUT=1
    fi

    if [ $TIMEOUT_COUNT -ge 3 ]; then
        echo "TIME:0.000000"
        echo "STATUS:HARD_TIME_LIMIT"
        echo "GOT_B64:"
    else
        if [ $HAD_TIMEOUT -eq 1 ]; then
            STEP_TIMEOUT="0.15s"
        else
            STEP_TIMEOUT="${firstTimeoutSec}s"
        fi

        find "$WORK_DIR" -mindepth 1 -delete 2>/dev/null || true
        cd "$WORK_DIR"
        echo "$b64In" | base64 -d > "$CTRL_DIR/in_\${i}.txt"

        rm -f "$CTRL_DIR/time_\${i}.txt"
        timeout -k 0.2s -s 9 $STEP_TIMEOUT stdbuf -o0 -e0 /usr/local/bin/runner "$BIN_DIR/prog" "$CTRL_DIR/time_\${i}.txt" < "$CTRL_DIR/in_\${i}.txt" > "$CTRL_DIR/got_\${i}.txt" 2> "$CTRL_DIR/err_\${i}.txt"
        EXIT_CODE=$?
        pkill -9 -u 65534 2>/dev/null || true

        CPUTIME=$(cat "$CTRL_DIR/time_\${i}.txt" 2>/dev/null || echo "0.000000")
        echo "TIME:$CPUTIME"

        if [ $EXIT_CODE -eq 124 ] || [ $EXIT_CODE -eq 137 ]; then
            HAD_TIMEOUT=1
            TIMEOUT_COUNT=$(( TIMEOUT_COUNT + 1 ))
            echo "STATUS:HARD_TIME_LIMIT"
            echo "GOT_B64:$(head -c 262144 "$CTRL_DIR/got_\${i}.txt" 2>/dev/null | base64 -w 0 || echo '')"
        elif [ $EXIT_CODE -ne 0 ]; then
            echo "STATUS:RUNTIME_ERROR"
            echo "GOT_B64:$(head -c 262144 "$CTRL_DIR/got_\${i}.txt" 2>/dev/null | base64 -w 0 || echo '')"
            echo "ERR_B64:$(head -c 262144 "$CTRL_DIR/err_\${i}.txt" 2>/dev/null | base64 -w 0 || echo '')"
        else
            echo "STATUS:OK"
            echo "GOT_B64:$(head -c 262144 "$CTRL_DIR/got_\${i}.txt" 2>/dev/null | base64 -w 0 || echo '')"
        fi
        rm -f "$CTRL_DIR/in_\${i}.txt" "$CTRL_DIR/got_\${i}.txt" "$CTRL_DIR/err_\${i}.txt" "$CTRL_DIR/time_\${i}.txt"
    fi
}
`;

    tests.forEach((t, i) => {
        const b64In = Buffer.from(t.input || '', 'utf-8').toString('base64');
        scriptTestes += `run_step ${i} "${b64In}"\n`;
    });

    return `#!/usr/bin/env bash
export http_proxy="http://127.0.0.1:0"
export https_proxy="http://127.0.0.1:0"
export HTTP_PROXY="http://127.0.0.1:0"
export HTTPS_PROXY="http://127.0.0.1:0"
export all_proxy="http://127.0.0.1:0"

CTRL_DIR="/root/ctrl_${safeJobId}"
BIN_DIR="/var/run/judge_${safeJobId}"
WORK_DIR="/sandbox/job_${safeJobId}"

limpar_ambiente() {
    pkill -9 -u 65534 2>/dev/null || true
    cd /
    rm -rf "$CTRL_DIR" "$BIN_DIR" "$WORK_DIR"
    find /tmp /var/tmp /dev/shm -mindepth 1 -user 65534 -exec rm -rf {} + 2>/dev/null || true
}
trap limpar_ambiente EXIT

# Esteriliza processos e arquivos residuais antes de iniciar a submissão
pkill -9 -u 65534 2>/dev/null || true
find /tmp /var/tmp /dev/shm -mindepth 1 -user 65534 -exec rm -rf {} + 2>/dev/null || true

mkdir -p /sandbox && chmod 711 /sandbox
mkdir -p "$CTRL_DIR" && chmod 700 "$CTRL_DIR"
mkdir -p "$BIN_DIR" && chmod 755 "$BIN_DIR"
mkdir -p "$WORK_DIR" && chown 65534:65534 "$WORK_DIR" && chmod 700 "$WORK_DIR"

# Garante que o binário do runner esteja presente e atualizado (inclusive em Warm Pods adotados)
if [ ! -f /usr/local/bin/runner ] || [ ! -f /tmp/runner_v4_ready ]; then
    echo "${B64_RUNNER}" | base64 -d > "$CTRL_DIR/runner.c"
    gcc -O2 "$CTRL_DIR/runner.c" -o /usr/local/bin/runner
    chmod 555 /usr/local/bin/runner
    rm -f "$CTRL_DIR/runner.c"
    touch /tmp/runner_v4_ready
fi

cd "$WORK_DIR"
echo "${b64Code}" | base64 -d > main.c
chown 65534:65534 main.c
chmod 600 main.c

set +e
COMPILE_ERR=$(timeout -k 1s -s 9 ${compileTimeoutSec}s setpriv --reuid=65534 --regid=65534 --clear-groups bash -c 'ulimit -u 50; ulimit -f 50000; exec gcc -Wall main.c -o prog -lm' 2>&1)
COMPILE_STATUS=$?

if [ $COMPILE_STATUS -ne 0 ]; then
    if [ $COMPILE_STATUS -eq 124 ] || [ $COMPILE_STATUS -eq 137 ]; then
        COMPILE_ERR="main.c:1:1: error: Tempo limite de compilacao excedido (${compileTimeoutSec}s). Verifique diretivas #include ou macros."
    fi
    echo "STATUS:COMPILATION_ERROR"
    echo "ERR_B64:$(echo -n "$COMPILE_ERR" | base64 -w 0)"
    exit 0
fi
if [ -n "$COMPILE_ERR" ]; then
    echo "WARN_B64:$(echo -n "$COMPILE_ERR" | base64 -w 0)"
fi

mv "$WORK_DIR/prog" "$BIN_DIR/prog"
chown 0:0 "$BIN_DIR/prog"
chmod 555 "$BIN_DIR/prog"
rm -f "$WORK_DIR/main.c"

ulimit -u 50
ulimit -f 50000

${scriptTestes}

echo "STATUS:ALL_PASSED"
`;
}

async function executarJobNoPool(code, tests, timeoutAlunoMs, jobId = Date.now(), tentativa = 1) {
    const podName = await adquirirPod();
    let teveErroGrave = false;

    try {
        const scriptJob = montarScriptJob(code, tests, timeoutAlunoMs, jobId);
        const b64GzScript = zlib.gzipSync(Buffer.from(scriptJob, 'utf-8')).toString('base64');
        const comando = `echo "${b64GzScript}" | base64 -d | gzip -d | /bin/bash`;

        // Teto de execução: tempo limite configurado para o teste + margem de compilação do .env (COMPILE_TIMEOUT)
        const compileTimeoutMs = Number(process.env.COMPILE_TIMEOUT) || 30000;
        const timeoutExecMs = Math.min(Math.max(timeoutAlunoMs + compileTimeoutMs + 5000, 15000), 200000);

        const resultado = await executarComandoNoPod(podName, comando, timeoutExecMs);
        return (resultado.stdout || resultado.stderr || '').toString();
    } catch (err) {
        teveErroGrave = true;
        // Se foi a 1ª tentativa e o pod falhou na comunicação (ex: pod parado externamente no Docker/K8s),
        // recicla imediatamente e tenta uma nova execução com outro pod de forma transparente
        if (tentativa === 1) {
            console.warn(`[WarmPool] Pod ${podName} indisponível ou parado (${err.message}). Auto-recuperando e tentando novamente...`);
            liberarPod(podName, true);
            return await executarJobNoPool(code, tests, timeoutAlunoMs, jobId, 2);
        }
        throw err;
    } finally {
        if (!teveErroGrave || tentativa > 1) {
            liberarPod(podName, teveErroGrave);
        }
    }
}

async function verificarEManterPool() {
    try {
        const podsCluster = await apiListWorkerPods();
        const podsAtivosNoCluster = new Set();

        for (const pod of podsCluster) {
            const name = pod.metadata?.name;
            if (!name) continue;

            const isHealthy = isPodReady(pod);
            const isDeleting = !!pod.metadata?.deletionTimestamp;
            const isFailed = pod.status?.phase === 'Failed';

            // Se o pod falhou, está sendo terminado ou não está saudável, descarta
            if (!isHealthy && (isDeleting || isFailed || podMap.has(name))) {
                if (podMap.has(name) && podMap.get(name).status !== 'starting') {
                    console.log(`[WarmPool] Detectado pod inativo/parado no cluster: ${name}. Removendo...`);
                    await destruirPod(name, 'pod_inativo_ou_falho');
                }
                continue;
            }

            if (isHealthy) {
                podsAtivosNoCluster.add(name);

                // Adota pods saudáveis que já estejam no cluster (ex: após reboot da app)
                if (!podMap.has(name)) {
                    const criacao = pod.metadata?.creationTimestamp ? new Date(pod.metadata.creationTimestamp).getTime() : Date.now();
                    const novaEntrada = {
                        name,
                        status: 'idle',
                        createdAt: criacao,
                        lastUsedAt: Date.now(),
                        idleTimer: null,
                        isExtra: podMap.size >= MIN_WARM_PODS
                    };
                    podMap.set(name, novaEntrada);
                    console.log(`[WarmPool] Pod existente ${name} adotado no pool (Idade: ${Math.round((Date.now() - criacao) / 3600000)}h).`);
                    programarDesalocacaoSeExtra(novaEntrada);
                }
            }
        }

        // Limpa referências locais de pods que sumiram do cluster
        for (const [name, entry] of podMap.entries()) {
            if (!podsAtivosNoCluster.has(name) && entry.status !== 'starting') {
                if (entry.idleTimer) clearTimeout(entry.idleTimer);
                podMap.delete(name);
            }
        }

        // Se estiver abaixo do mínimo de pods (MIN_WARM_PODS > 0), sobe os que faltam
        const podsValidos = podMap.size;
        if (MIN_WARM_PODS > 0 && podsValidos < MIN_WARM_PODS) {
            const faltam = MIN_WARM_PODS - podsValidos;
            console.log(`[WarmPool] Iniciando ${faltam} pod(s) que faltam (Ativos: ${podsValidos} | Teto Máximo: ${MAX_WARM_PODS})...`);
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

async function garantirIsolamentoRede() {
    try {
        const netPolicyManifest = {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'NetworkPolicy',
            metadata: {
                name: 'isolate-judge-sandbox',
                namespace: TARGET_NS,
                labels: {
                    app: 'codecheck-judge',
                    role: 'judge-sandbox'
                }
            },
            spec: {
                podSelector: {
                    matchLabels: {
                        role: 'judge-sandbox'
                    }
                },
                policyTypes: ['Ingress', 'Egress'],
                ingress: [],
                egress: []
            }
        };

        try {
            await k8sNetworkingApi.createNamespacedNetworkPolicy({
                namespace: TARGET_NS,
                body: netPolicyManifest
            });
            console.log(`🛡️ [Segurança] NetworkPolicy de isolamento total aplicada com sucesso (${TARGET_NS}).`);
        } catch (createErr) {
            if (createErr.statusCode === 409 || (createErr.message && (createErr.message.includes('already exists') || createErr.message.includes('Conflict')))) {
                // Já existe
            } else if (createErr.message && createErr.message.includes('Required parameter')) {
                await k8sNetworkingApi.createNamespacedNetworkPolicy(TARGET_NS, netPolicyManifest);
                console.log(`🛡️ [Segurança] NetworkPolicy de isolamento total aplicada com sucesso (${TARGET_NS}).`);
            }
        }
    } catch (e) {
        // CNI sem suporte ou sem permissão de cluster; silencioso
    }
}

async function garantirNamespace() {
    if (!TARGET_NS || TARGET_NS === 'default') return;
    try {
        try {
            await k8sApi.readNamespace({ name: TARGET_NS });
        } catch (readErr) {
            const nsObj = { metadata: { name: TARGET_NS } };
            try {
                await k8sApi.createNamespace({ body: nsObj });
                console.log(`📦 [Kubernetes] Namespace "${TARGET_NS}" criado automaticamente.`);
            } catch (createErr) {
                if (createErr.statusCode !== 409) {
                    try {
                        await k8sApi.createNamespace(nsObj);
                        console.log(`📦 [Kubernetes] Namespace "${TARGET_NS}" criado automaticamente.`);
                    } catch { }
                }
            }
        }
    } catch (e) { }
}

async function inicializarPool() {
    if (inicializando) return;
    inicializando = true;

    try {
        await garantirNamespace();
        await garantirIsolamentoRede();
        await verificarEManterPool();

        // Inicia manutenção periódica a cada 10 segundos para rápida auto-recuperação
        if (!loopManutencao) {
            loopManutencao = setInterval(verificarEManterPool, 10000);
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
