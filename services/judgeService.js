const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function runTests(code, tests) {
    const id = Date.now();
    const tempDir = path.join(__dirname, '../tmp', `${id}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const sourcePath = path.join(tempDir, 'main.c');
    const binPath = path.join(tempDir, 'prog');
    fs.writeFileSync(sourcePath, code);

    const timeoutCompilador = Number(process.env.TIMEOUT_COMPILADOR) * 3 || 30000;
    const timeoutAluno = Number(process.env.TIMEOUT_COMPILADOR) || 10000;

    return new Promise((resolve) => {
        exec(`gcc ${sourcePath} -o ${binPath}`, { timeout: timeoutCompilador }, (err, stdout, stderr) => {
            if (err) {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
                return resolve({ status: 'Compilation Error', details: stderr });
            }

            let results = [];
            const runSingle = (index) => {
                if (index === tests.length) {
                    setTimeout(() => {
                        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {
                            console.log(`❌ Não foi possível remover a pasta ${id}... aguardando coletor de lixo 🗑️`);
                        }
                    }, 1000);

                    const passedAll = results.every(r => r.passed);
                    return resolve({ status: passedAll ? 'Accepted' : 'Wrong Answer', results });
                }

                const t = tests[index];
                
                const child = exec(`${binPath}`, { timeout: timeoutAluno }, (runErr, studentOut) => {
                    if (runErr) {
                        const errorType = runErr.signal === 'SIGTERM' ? 'Time Limit Exceeded' : 'Runtime Error';
                        results.push({ test: index + 1, passed: false, error: errorType });
                        return runSingle(index + 1);
                    }

                    const normalize = s => s.replace(/\s+/g, ' ').trim();
                    const isCorrect = normalize(studentOut) === normalize(t.output);
                    
                    results.push({ test: index + 1, passed: isCorrect });
                    runSingle(index + 1);
                });

                if (child.stdin) {
                    child.stdin.write(t.input);
                    child.stdin.end();
                }
            };
            runSingle(0);
        });
    });
}

module.exports = { runTests };