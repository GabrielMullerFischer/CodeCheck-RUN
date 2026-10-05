const { k8sApi, namespace } = require('../config/kubernetes');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_COMPILATIONS, 10) || 4;
let activeExecutions = 0;
const executionQueue = [];

function adquirirVagaNaFila() {
    return new Promise((resolve) => {
        if (activeExecutions < MAX_CONCURRENT) {
            activeExecutions++;
            return resolve();
        }
        executionQueue.push(resolve);
    });
}

function liberarVagaNaFila() {
    activeExecutions--;
    if (executionQueue.length > 0) {
        activeExecutions++;
        const next = executionQueue.shift();
        next();
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

async function isAlreadyRunning(containerName) {
    try {
        const podName = containerName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const targetNs = process.env.K8S_NAMESPACE || namespace || 'default';
        
        let res;
        try {
            res = await k8sApi.readNamespacedPodStatus({ name: podName, namespace: targetNs });
        } catch {
            res = await k8sApi.readNamespacedPodStatus(podName, targetNs);
        }
        const pod = res?.body || res;
        const phase = pod?.status?.phase;
        return phase === 'Running' || phase === 'Pending';
    } catch {
        return false;
    }
}

async function runTests(code, tests, containerName, timeLimitMs) {
    await adquirirVagaNaFila();
    try {
        return await executarProcessoDeTesteK8s(code, tests, containerName, timeLimitMs);
    } finally {
        liberarVagaNaFila();
    }
}

async function executarProcessoDeTesteK8s(code, tests, containerName, timeLimitMs) {
    const podName = containerName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const targetNs = process.env.K8S_NAMESPACE || namespace || 'default';

    const cpuReq = process.env.K8S_CPU_REQUEST || '500m';
    const cpuLim = process.env.K8S_CPU_LIMIT || '500m';
    const memReq = process.env.K8S_MEMORY_REQUEST || '512Mi';
    const memLim = process.env.K8S_MEMORY_LIMIT || '512Mi';
    const image = process.env.K8S_IMAGE || 'gcc:latest';

    const limiteCompiladorMs = Number(process.env.COMPILE_TIMEOUT) || 30000;
    const timeoutAlunoMs = Number(timeLimitMs) > 0 ? Number(timeLimitMs) : limiteCompiladorMs;
    const timeoutAlunoSec = Math.max(1, Math.ceil(timeoutAlunoMs / 1000));

    const runnerScript = gerarScriptSandbox(code, tests, timeoutAlunoSec);
    const b64Runner = Buffer.from(runnerScript, 'utf-8').toString('base64');

    const podManifest = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
            name: podName,
            namespace: targetNs,
            labels: {
                app: 'codecheck-judge',
                submission: podName
            }
        },
        spec: {
            restartPolicy: 'Never',
            automountServiceAccountToken: false,
            containers: [
                {
                    name: 'runner',
                    image: image,
                    command: ['/bin/bash', '-c'],
                    args: [`echo "${b64Runner}" | base64 -d | /bin/bash`],
                    resources: {
                        requests: {
                            cpu: cpuReq,
                            memory: memReq
                        },
                        limits: {
                            cpu: cpuLim,
                            memory: memLim
                        }
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
        const tempoEsperaNodeMs = (timeoutAlunoMs * totalTestes) + 20000;
        const outputBruto = await aguardarPodFinalizar(podName, targetNs, tempoEsperaNodeMs);
        return processarResultadoSandbox(outputBruto, tests);
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
        return {
            status: 'Runtime Error',
            details: `Erro no orquestrador Kubernetes: ${err.message}`,
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

function gerarScriptSandbox(code, tests, timeoutSec) {
    const b64Code = Buffer.from(code, 'utf-8').toString('base64');

    let scriptTestes = '';
    tests.forEach((t, i) => {
        const b64In = Buffer.from(t.input || '', 'utf-8').toString('base64');
        const b64Exp = Buffer.from(t.output || '', 'utf-8').toString('base64');

        scriptTestes += `
# Teste ${i}
echo "${b64In}" | base64 -d > in_${i}.txt
echo "${b64Exp}" | base64 -d > exp_${i}.txt

START_MS=$(date +%s%3N)
set +e
timeout -k 1s -s 9 "${timeoutSec}s" ./prog < in_${i}.txt > got_${i}.txt 2> err_${i}.txt
EXIT_CODE=$?
END_MS=$(date +%s%3N)
DUR=$((END_MS - START_MS))

echo "---STEP---"
echo "INDEX:${i}"
echo "TIME:$DUR"

if [ $EXIT_CODE -eq 124 ] || [ $EXIT_CODE -eq 137 ]; then
    echo "STATUS:TIME_LIMIT"
elif [ $EXIT_CODE -ne 0 ]; then
    echo "STATUS:RUNTIME_ERROR"
    echo "ERR_B64:$(base64 -w 0 < err_${i}.txt 2>/dev/null || echo '')"
else
    echo "STATUS:OK"
    echo "GOT_B64:$(base64 -w 0 < got_${i}.txt 2>/dev/null || echo '')"
    echo "EXP_B64:$(base64 -w 0 < exp_${i}.txt 2>/dev/null || echo '')"
fi
`;
    });

    return `#!/usr/bin/env bash
mkdir -p /sandbox && cd /sandbox

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

function processarResultadoSandbox(rawOutput, testsOriginais) {
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
    let passedCount = 0;
    let primeiroErro = null;
    let ultimoGot = '';

    for (const step of steps) {
        const idxMatch = step.match(/INDEX:(\d+)/);
        const timeMatch = step.match(/TIME:(\d+)/);
        const statusMatch = step.match(/STATUS:(\w+)/);

        const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
        const dur = timeMatch ? parseInt(timeMatch[1], 10) : 0;
        if (dur > maxTime) maxTime = dur;

        const stepStatus = statusMatch ? statusMatch[1] : '';

        if (stepStatus === 'TIME_LIMIT') {
            if (!primeiroErro) {
                primeiroErro = {
                    status: 'Time Limit',
                    message: 'Tempo limite de execução excedido!',
                    executionTime: dur,
                    testIndex: idx
                };
            }
        } else if (stepStatus === 'RUNTIME_ERROR') {
            const errMatch = step.match(/ERR_B64:([A-Za-z0-9+/=]*)/);
            const details = errMatch && errMatch[1] ? Buffer.from(errMatch[1], 'base64').toString('utf-8') : 'Runtime Error.';
            if (!primeiroErro) {
                primeiroErro = {
                    status: 'Runtime Error',
                    details,
                    executionTime: dur,
                    testIndex: idx
                };
            }
        } else {
            const gotMatch = step.match(/GOT_B64:([A-Za-z0-9+/=]*)/);
            const expMatch = step.match(/EXP_B64:([A-Za-z0-9+/=]*)/);

            const got = gotMatch && gotMatch[1] ? Buffer.from(gotMatch[1], 'base64').toString('utf-8') : '';
            const exp = expMatch && expMatch[1] ? Buffer.from(expMatch[1], 'base64').toString('utf-8') : '';
            ultimoGot = got;

            if (normalize(got) === normalize(exp)) {
                passedCount++;
            } else {
                if (!primeiroErro) {
                    primeiroErro = {
                        status: 'Wrong Answer',
                        message: 'A saída não corresponde!',
                        input: testsOriginais[idx]?.input || '',
                        got: got,
                        expected: testsOriginais[idx]?.output || '',
                        executionTime: dur,
                        testIndex: idx
                    };
                }
            }
        }
    }

    const percentage = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

    if (passedCount === totalCount && totalCount > 0) {
        return {
            status: 'Accepted',
            message: 'Correto!',
            executionTime: maxTime,
            percentage: 100,
            passedCount,
            totalCount,
            got: ultimoGot
        };
    }

    if (primeiroErro) {
        return {
            ...primeiroErro,
            executionTime: maxTime,
            percentage,
            passedCount,
            totalCount
        };
    }

    if (rawOutput.includes('STATUS:TIME_LIMIT')) {
        const timeMatch = rawOutput.match(/TIME:(\d+)/);
        const executionTime = timeMatch ? parseInt(timeMatch[1], 10) : maxTime;
        return { status: 'Time Limit', message: 'Tempo limite de execução excedido!', executionTime, percentage: 0, passedCount: 0, totalCount };
    }

    if (rawOutput.includes('STATUS:RUNTIME_ERROR')) {
        const timeMatch = rawOutput.match(/TIME:(\d+)/);
        const errMatch = rawOutput.match(/ERR_B64:([A-Za-z0-9+/=]+)/);
        const details = errMatch ? Buffer.from(errMatch[1], 'base64').toString('utf-8') : 'Runtime Error.';
        return { status: 'Runtime Error', details, executionTime: timeMatch ? parseInt(timeMatch[1], 10) : maxTime, percentage: 0, passedCount: 0, totalCount };
    }

    return {
        status: 'Runtime Error',
        details: 'Erro na execução dos testes.',
        executionTime: maxTime,
        percentage,
        passedCount,
        totalCount
    };
}

module.exports = { runTests, isAlreadyRunning };