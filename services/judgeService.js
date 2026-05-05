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

async function runTests(code, tests, containerName) {
    const id = Date.now();
    const tempDir = path.resolve(__dirname, '../tmp', `${id}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const sourcePath = path.join(tempDir, 'main.c');
    fs.writeFileSync(sourcePath, code);

    const cpuLimit = process.env.DOCKER_CPU_LIMIT || "0.25";
    const memLimit = process.env.DOCKER_MEMORY_LIMIT || "128m";
    const timeoutComp = Number(process.env.COMPILE_TIMEOUT) || 30000;
    const timeoutAluno = Number(process.env.TIMEOUT_ALUNO) || 10000;

    return new Promise(async (resolve) => {
        const compileCmd = `docker run --rm -v "${tempDir}":/code -w /code gcc gcc main.c -o prog`;
        try {
            await execPromise(compileCmd, { timeout: timeoutComp });
        } catch (err) {
            limparPasta(tempDir);
            return resolve({ status: 'Compilation Error', details: err.stderr });
        }

        let results = [];
        const normalize = s => s.toString().replace(/\r/g, '').replace(/\s+/g, ' ').trim();

        const executarTeste = (index) => {
            if (index === tests.length) {
                limparPasta(tempDir);
                const passedAll = results.every(r => r.passed);
                return resolve({ status: passedAll ? 'Accepted' : 'Wrong Answer', results });
            }

            const t = tests[index];
            const runCmd = `docker run --rm --name ${containerName} --cpus="${cpuLimit}" --memory="${memLimit}" --network none -i -v "${tempDir}":/code -w /code gcc ./prog`;

            const child = exec(runCmd, { timeout: timeoutAluno }, (runErr, studentOut) => {
                if (runErr) {
                    const errorType = runErr.signal === 'SIGTERM' ? 'TLE' : 'Runtime Error';

                    exec(`docker rm -f ${containerName}`, () => {
                        results.push({ test: index + 1, passed: false, error: errorType });
                        executarTeste(index + 1);
                    });
                    return;
                }

                const isCorrect = normalize(studentOut) === normalize(t.output);
                results.push({ test: index + 1, passed: isCorrect });
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