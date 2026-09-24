const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execPromise = util.promisify(exec);

async function isAlreadyRunning(containerName) {
    try {
        const { stdout } = await execPromise(`docker ps -aq -f name=^/${containerName}$`);
        return stdout.trim().length > 0;
    } catch (e) { return false; }
}

async function runTests(code, tests, containerName, timeLimitMs) {
    const id = Date.now();
    const tempDir = path.resolve(__dirname, '../tmp', `${id}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const sourcePath = path.join(tempDir, 'main.c');
    fs.writeFileSync(sourcePath, code);

    const cpuLimit = process.env.DOCKER_CPU_LIMIT || "0.25";
    const memLimit = process.env.DOCKER_MEMORY_LIMIT || "128m";
    const timeoutComp = Number(process.env.COMPILE_TIMEOUT) || 30000;
    const timeoutAluno = Number(timeLimitMs) || Number(process.env.TIMEOUT_ALUNO) || 10000;

    return new Promise(async (resolve) => {
        const compileCmd = `docker run --rm -v "${tempDir}":/code -w /code gcc gcc main.c -o prog`;
        try {
            await execPromise(compileCmd, { timeout: timeoutComp });
        } catch (err) {
            limparPasta(tempDir);
            return resolve({ 
                status: 'Compilation Error',
                details: err.stderr || 'Erro desconhecido na compilação!' 
            });
        }

        const normalize = s => {
            if (!s) return '';
            return s.toString()
                .replace(/\r/g, '')
                .split('\n')
                .map(line => line.trimEnd())
                .join('\n')
                .trim();
        };

        const executarTeste = (index) => {
            if (index === tests.length) {
                limparPasta(tempDir);
                return resolve({ status: 'Accepted', message: "Correto!" });
            }

            const t = tests[index];
            const runCmd = `docker run --rm --name ${containerName} --cpus="${cpuLimit}" --memory="${memLimit}" --network none -i -v "${tempDir}":/code -w /code gcc ./prog`;

            const startTime = Date.now();
            const child = exec(runCmd, { timeout: timeoutAluno }, (runErr, studentOut, studentErr) => {
                const executionTime = Date.now() - startTime;

                if (runErr) {
                    exec(`docker rm -f ${containerName}`, () => {
                        limparPasta(tempDir);
                        if (runErr.killed || runErr.signal === 'SIGTERM' || executionTime >= timeoutAluno) {
                            return resolve({ 
                                status: "Time Limit", 
                                message: "Tempo limite de execução excedido!",
                                executionTime
                            });
                        }
                        return resolve({
                            status: "Runtime Error",
                            details: studentErr || runErr.message,
                            executionTime
                        });
                    });
                    return;
                }

                const obtido = normalize(studentOut);
                const esperado = normalize(t.output);

                if (obtido !== esperado) {
                    limparPasta(tempDir);
                    return resolve({ 
                        status: 'Wrong Answer', 
                        message: "A saída não corresponde!",
                        input: t.input,
                        got: studentOut ? studentOut.toString() : '',
                        expected: t.output,
                        executionTime
                    });
                }

                executarTeste(index + 1);
            });

            if (child.stdin) {
                child.stdin.write(`${t.input}\n`);
                child.stdin.end();
            }
        };

        executarTeste(0);
    });
}

function limparPasta(dir) {
    setTimeout(() => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }, 2500);
}

module.exports = { runTests, isAlreadyRunning };