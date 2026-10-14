const { k8sApi, namespace } = require('../config/kubernetes');
const warmPoolService = require('./warmPoolService');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_COMPILATIONS, 10) || 6;
let activeExecutions = 0;
const executionQueue = [];

// Mapa de usuário -> timestamp do bloqueio (libera compilação automaticamente após 5 minutos contra travamentos)
const activeUsers = new Map();
const USER_LOCK_TTL_MS = 5 * 60 * 1000; // Limite máximo de 5 minutos por usuário
const QUEUE_WAIT_TIMEOUT_MS = 3 * 60 * 1000; // Limite máximo de 3 minutos de espera na fila

function extrairUserId(containerName) {
    if (!containerName) return null;
    const match = String(containerName).match(/^(?:judge|test)_([^_]+)/);
    return match ? match[1] : String(containerName);
}

function adquirirTravaUsuario(containerName) {
    const uid = extrairUserId(containerName);
    if (!uid) return true;
    const agora = Date.now();
    const lockTime = activeUsers.get(uid);

    // Se o usuário já está executando e o bloqueio tem MENOS de 5 minutos, bloqueia segunda compilação
    if (lockTime && (agora - lockTime < USER_LOCK_TTL_MS)) {
        return false;
    }

    // Se não existia ou se já ultrapassou os 5 minutos (auto-destrava contra travamentos), libera e renova
    activeUsers.set(uid, agora);
    return true;
}

function liberarTravaUsuario(containerName) {
    const uid = extrairUserId(containerName);
    if (uid) activeUsers.delete(uid);
}

async function isAlreadyRunning(containerName) {
    const conseguiuTrava = adquirirTravaUsuario(containerName);
    return !conseguiuTrava;
}

function adquirirVagaNaFila(timeoutMs = QUEUE_WAIT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        if (activeExecutions < MAX_CONCURRENT) {
            activeExecutions++;
            return resolve();
        }

        let timer = null;
        const itemFila = () => {
            if (timer) clearTimeout(timer);
            resolve();
        };

        timer = setTimeout(() => {
            const idx = executionQueue.indexOf(itemFila);
            if (idx !== -1) executionQueue.splice(idx, 1);
            reject(new Error("Tempo limite de espera na fila de compilação excedido. Tente novamente em instantes."));
        }, timeoutMs);

        executionQueue.push(itemFila);
    });
}

function liberarVagaNaFila() {
    activeExecutions--;
    if (executionQueue.length > 0) {
        activeExecutions++;
        const next = executionQueue.shift();
        if (typeof next === 'function') next();
    }
}

function normalize(s) {
    if (!s) return '';
    return s.toString()
        .replace(/\r/g, '')
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .trim();
}

function prepararTestesOrdenados(array) {
    if (!Array.isArray(array) || array.length === 0) return [];
    const comOrigIdx = array.map((t, idx) => {
        const obj = (t && typeof t.toObject === 'function') ? t.toObject() : { ...t };
        obj.originalIndex = idx;
        return obj;
    });

    const hasExplicitVisible = comOrigIdx.some(t => t.isVisible === true);
    const visiveis = [];
    const fechados = [];

    comOrigIdx.forEach((t, idx) => {
        const ehVisivel = hasExplicitVisible ? (t.isVisible === true) : (idx === 0);
        if (ehVisivel) {
            visiveis.push(t);
        } else {
            fechados.push(t);
        }
    });

    // Embaralha apenas os testes fechados/secretos para manter anti-trapaça
    for (let i = fechados.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = fechados[i];
        fechados[i] = fechados[j];
        fechados[j] = temp;
    }

    // Casos de teste visíveis (exemplos na tela) SEMPRE rodam primeiro!
    return [...visiveis, ...fechados];
}

async function runTests(code, tests, containerName, timeLimitMs) {
    const uid = extrairUserId(containerName);
    if (uid) activeUsers.set(uid, Date.now());

    await adquirirVagaNaFila();
    try {
        const testesOrdenados = prepararTestesOrdenados(tests);
        const limiteCompiladorMs = Number(process.env.COMPILE_TIMEOUT) || 10000;
        const timeoutAlunoMs = Number(timeLimitMs) > 0 ? Number(timeLimitMs) : limiteCompiladorMs;

        // 1. Tenta executar no Warm Pod Pool (respostas < 0.5s)
        try {
            const outputBruto = await warmPoolService.executarJobNoPool(
                code,
                testesOrdenados,
                timeoutAlunoMs,
                containerName || Date.now()
            );
            return processarResultadoSandbox(outputBruto, testesOrdenados, timeoutAlunoMs);
        } catch (poolErr) {
            console.warn(`[Judge] Warm pool falhou ou indisponível (${poolErr.message}). Utilizando fallback para Pod efêmero...`);
            return await executarProcessoDeTesteK8sIndividual(code, testesOrdenados, containerName, timeoutAlunoMs);
        }
    } finally {
        liberarVagaNaFila();
        liberarTravaUsuario(containerName);
    }
}

async function executarProcessoDeTesteK8sIndividual(code, tests, containerName, timeoutAlunoMs) {
    const podName = (containerName || `judge-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const targetNs = process.env.K8S_NAMESPACE || namespace || 'default';

    const cpuReq = process.env.K8S_CPU_REQUEST || '1000m';
    const cpuLim = process.env.K8S_CPU_LIMIT || '1000m';
    const memReq = process.env.K8S_MEMORY_REQUEST || '512Mi';
    const memLim = process.env.K8S_MEMORY_LIMIT || '512Mi';
    const image = process.env.K8S_IMAGE || 'gcc:latest';

    const runnerScript = gerarScriptSandbox(code, tests, timeoutAlunoMs);
    const b64Runner = Buffer.from(runnerScript, 'utf-8').toString('base64');

    const podManifest = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
            name: podName,
            namespace: targetNs,
            labels: {
                app: 'codecheck-judge',
                role: 'judge-sandbox',
                submission: podName
            }
        },
        spec: {
            restartPolicy: 'Never',
            automountServiceAccountToken: false,
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
                    args: [`echo "${b64Runner}" | base64 -d | /bin/bash`],
                    resources: {
                        requests: { cpu: cpuReq, memory: memReq },
                        limits: { cpu: cpuLim, memory: memLim }
                    }
                }
            ]
        }
    };

    try {
        try {
            await k8sApi.createNamespacedPod({
                namespace: targetNs,
                body: podManifest
            });
        } catch (callErr) {
            if (callErr.message && callErr.message.includes('Required parameter')) {
                await k8sApi.createNamespacedPod(targetNs, podManifest);
            } else {
                throw callErr;
            }
        }

        const totalTestes = Array.isArray(tests) && tests.length > 0 ? tests.length : 1;
        const hardTimeoutSec = Math.min(Math.max(1, Math.ceil((timeoutAlunoMs * 3) / 1000)), 30);
        const tempoEsperaNodeMs = (hardTimeoutSec * 1000 * totalTestes) + 25000;
        
        const outputBruto = await aguardarPodFinalizar(podName, targetNs, tempoEsperaNodeMs);
        return processarResultadoSandbox(outputBruto, tests, timeoutAlunoMs);
    } catch (err) {
        if (err.message && err.message.includes('Tempo esgotado aguardando execução do Pod')) {
            return {
                status: 'Time Limit',
                message: 'Tempo limite de execução excedido!',
                executionTime: timeoutAlunoMs,
                percentage: 0,
                passedCount: 0,
                totalCount: Array.isArray(tests) ? tests.length : 0
            };
        }
        console.error(`[Judge] Erro no cluster Kubernetes (${podName}):`, err.message);
        return {
            status: 'Runtime Error',
            details: 'O ambiente de execução e compilação está temporariamente indisponível no servidor. Por favor, tente novamente em instantes.',
            executionTime: 0,
            percentage: 0,
            passedCount: 0,
            totalCount: Array.isArray(tests) ? tests.length : 0
        };
    } finally {
        try {
            try {
                await k8sApi.deleteNamespacedPod({
                    name: podName,
                    namespace: targetNs,
                    gracePeriodSeconds: 0
                });
            } catch {
                await k8sApi.deleteNamespacedPod(podName, targetNs, undefined, undefined, 0);
            }
        } catch {}
    }
}

function gerarScriptSandbox(code, tests, timeLimitMs) {
    const b64Code = Buffer.from(code, 'utf-8').toString('base64');
    const limitSec = timeLimitMs / 1000;
    const hardTimeoutSec = Math.min(Math.max(1, Math.ceil(limitSec * 3)), 30);

    const runnerC = `
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <sys/types.h>

int main(int argc, char *argv[]) {
    if (argc < 3) return 1;
    pid_t pid = fork();
    if (pid < 0) return 1;
    if (pid == 0) {
        // Reduz privilégios estritamente para o usuário 'nobody' (UID/GID 65534)
        setgid(65534);
        setuid(65534);
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
    const b64Runner = Buffer.from(runnerC, 'utf-8').toString('base64');

    let scriptTestes = `
if [ ! -f /usr/local/bin/runner ]; then
    echo "${b64Runner}" | base64 -d > /tmp/runner.c
    gcc -O2 /tmp/runner.c -o /usr/local/bin/runner
    chmod 555 /usr/local/bin/runner
    rm -f /tmp/runner.c
fi
`;

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
export http_proxy="http://127.0.0.1:0"
export https_proxy="http://127.0.0.1:0"
export HTTP_PROXY="http://127.0.0.1:0"
export HTTPS_PROXY="http://127.0.0.1:0"
export all_proxy="http://127.0.0.1:0"

mkdir -p /sandbox && cd /sandbox
chmod 777 /sandbox
ulimit -u 50
ulimit -f 50000

echo "${b64Code}" | base64 -d > main.c
set +e
COMPILE_ERR=$(gcc main.c -o prog -lm 2>&1)
COMPILE_STATUS=$?

if [ $COMPILE_STATUS -ne 0 ]; then
    echo "STATUS:COMPILATION_ERROR"
    echo "ERR_B64:$(echo -n "$COMPILE_ERR" | base64 -w 0)"
    exit 0
fi

${scriptTestes}
echo "STATUS:ALL_PASSED"
`;
}

async function aguardarPodFinalizar(podName, ns, timeoutMs) {
    const inicio = Date.now();
    const targetNs = ns || process.env.K8S_NAMESPACE || 'default';
    const maxWaitMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : 45000;

    while (Date.now() - inicio < maxWaitMs) {
        try {
            let res;
            try {
                res = await k8sApi.readNamespacedPodStatus({ name: podName, namespace: targetNs });
            } catch {
                res = await k8sApi.readNamespacedPodStatus(podName, targetNs);
            }

            const pod = res?.body || res;
            const phase = pod?.status?.phase;

            if (phase === 'Succeeded' || phase === 'Failed') {
                let logsRes;
                try {
                    logsRes = await k8sApi.readNamespacedPodLog({ name: podName, namespace: targetNs });
                } catch {
                    logsRes = await k8sApi.readNamespacedPodLog(podName, targetNs);
                }
                return (logsRes?.body || logsRes).toString();
            }
        } catch {}
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Tempo esgotado aguardando execução do Pod no Kubernetes (ultrapassou ${maxWaitMs / 1000}s).`);
}

function processarResultadoSandbox(rawOutput, testsOriginais, timeoutAlunoMs = (Number(process.env.COMPILE_TIMEOUT) || 10000)) {
    const totalCount = Array.isArray(testsOriginais) ? testsOriginais.length : 0;

    if (!rawOutput) {
        return { status: 'Runtime Error', details: 'Nenhum retorno gerado pelo Pod.', executionTime: 0, percentage: 0, passedCount: 0, totalCount };
    }

    if (rawOutput.includes('STATUS:COMPILATION_ERROR')) {
        const match = rawOutput.match(/ERR_B64:([A-Za-z0-9+/=]+)/);
        const details = match ? Buffer.from(match[1], 'base64').toString('utf-8') : 'Erro de compilação.';
        return { status: 'Compilation Error', details, executionTime: 0, percentage: 0, passedCount: 0, totalCount };
    }

    const steps = rawOutput.split('---STEP---').slice(1);
    let maxTime = 0;
    let somaTotalSegundos = 0;
    let passedCount = 0;
    let primeiroErro = null;
    let ultimoGot = '';

    for (const step of steps) {
        const idxMatch = step.match(/INDEX:(\d+)/);
        const statusMatch = step.match(/STATUS:(\w+)/);
        const timeMatch = step.match(/TIME:([0-9.]+)/);

        const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
        const stepStatus = statusMatch ? statusMatch[1] : '';
        const durSec = timeMatch ? parseFloat(timeMatch[1]) : 0;
        const tempoPassoMs = durSec * 1000;
        const durMs = tempoPassoMs < 10 ? Number(tempoPassoMs.toFixed(2)) : (tempoPassoMs < 100 ? Number(tempoPassoMs.toFixed(1)) : Math.round(tempoPassoMs));

        somaTotalSegundos += durSec;
        if (durMs > maxTime) maxTime = durMs;

        const gotMatch = step.match(/GOT_B64:([A-Za-z0-9+/=]*)/);
        const got = gotMatch && gotMatch[1] ? Buffer.from(gotMatch[1], 'base64').toString('utf-8') : '';
        if (got) ultimoGot = got;

        const testItem = testsOriginais[idx] || {};
        const expected = testItem.output || '';
        const corresponds = normalize(got) === normalize(expected);
        const origIdx = testItem.originalIndex !== undefined ? testItem.originalIndex : idx;

        if (stepStatus === 'HARD_TIME_LIMIT') {
            if (!primeiroErro) {
                primeiroErro = {
                    status: 'Time Limit',
                    message: 'Tempo limite de execução excedido!',
                    executionTime: durMs,
                    testIndex: origIdx
                };
            }
        } else if (stepStatus === 'RUNTIME_ERROR') {
            const errMatch = step.match(/ERR_B64:([A-Za-z0-9+/=]*)/);
            const details = errMatch && errMatch[1] ? Buffer.from(errMatch[1], 'base64').toString('utf-8') : 'Runtime Error.';
            if (!primeiroErro) {
                primeiroErro = {
                    status: 'Runtime Error',
                    details,
                    executionTime: durMs,
                    testIndex: origIdx
                };
            }
        } else if (stepStatus === 'WRONG_ANSWER' || !corresponds) {
            if (!primeiroErro) {
                primeiroErro = {
                    status: 'Wrong Answer',
                    message: 'A saída não corresponde!',
                    input: testItem.input || '',
                    got: got,
                    expected: expected,
                    executionTime: durMs,
                    testIndex: origIdx
                };
            }
        } else if (stepStatus === 'OK') {
            if (durMs > timeoutAlunoMs) {
                if (!primeiroErro) {
                    primeiroErro = {
                        status: 'Time Limit',
                        message: `A saída está correta, mas demorou ${durMs} ms (o limite do exercício é ${timeoutAlunoMs} ms). Tente otimizar seu algoritmo!`,
                        executionTime: durMs,
                        testIndex: origIdx,
                        isSlowMatch: true
                    };
                }
            } else {
                passedCount++;
            }
        }
    }

    const percentage = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;
    const tempoTotalMs = somaTotalSegundos * 1000;
    const somaTotalTemposMs = tempoTotalMs < 10 ? Number(tempoTotalMs.toFixed(2)) : (tempoTotalMs < 100 ? Number(tempoTotalMs.toFixed(1)) : Math.round(tempoTotalMs));

    if (passedCount === totalCount && totalCount > 0) {
        return {
            status: 'Accepted',
            message: 'Correto!',
            executionTime: somaTotalTemposMs,
            percentage: 100,
            passedCount,
            totalCount,
            got: ultimoGot
        };
    }

    if (primeiroErro) {
        return {
            ...primeiroErro,
            executionTime: somaTotalTemposMs,
            percentage,
            passedCount,
            totalCount
        };
    }

    return {
        status: 'Runtime Error',
        details: 'Erro na execução dos testes.',
        executionTime: somaTotalTemposMs,
        percentage,
        passedCount,
        totalCount
    };
}

module.exports = {
    runTests,
    isAlreadyRunning,
    liberarTravaUsuario,
    inicializarPool: warmPoolService.inicializarPool,
    obterStatusPool: warmPoolService.obterStatusPool
};