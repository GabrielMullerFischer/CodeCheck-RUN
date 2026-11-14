const { k8sApi, namespace } = require('../config/kubernetes');
const zlib = require('zlib');
const warmPoolService = require('./warmPoolService');

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_COMPILATIONS, 10) || 6;
let activeExecutions = 0;
const executionQueue = [];

// Mapa de usuário -> timestamp do bloqueio (libera compilação automaticamente após 45s contra travamentos)
const activeUsers = new Map();
const USER_LOCK_TTL_MS = 45 * 1000; // Limite máximo de 45 segundos por usuário
const QUEUE_WAIT_TIMEOUT_MS = 60 * 1000; // Limite máximo de 60 segundos de espera na fila

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

function normalizarModoExercicio(mode) {
    if (mode === 'main_custom' || mode === 'function') return mode;
    return 'main_default';
}

function extrairAssinaturaFuncaoC(assinaturaOuTemplate) {
    const regexSig = /^((?:unsigned\s+)?(?:long\s+long(?:\s+int)?|long(?:\s+int)?|short(?:\s+int)?|int|float|double|char))\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)$/;
    const regexParam = /^((?:unsigned\s+)?(?:long\s+long(?:\s+int)?|long(?:\s+int)?|short(?:\s+int)?|int|float|double|char))\s+([a-zA-Z_][a-zA-Z0-9_]*)$/;

    function testarLinha(linhaBruta) {
        const isLocked = /^\s*(?:\*\*\*|###)/.test(linhaBruta);
        const semPrefixo = String(linhaBruta || '').replace(/^\s*(?:\*\*\*|###)\s*/, '').trim();
        if (!semPrefixo || semPrefixo.startsWith('#')) return null;
        const candidata = semPrefixo.replace(/\{[\s\S]*$/, '').replace(/;+\s*$/, '').trim();
        const match = candidata.match(regexSig);
        if (!match) return null;
        const returnType = match[1].replace(/\s+/g, ' ').trim();
        const funcName = match[2].trim();
        if (funcName === 'main') return null;
        const paramsRaw = match[3].trim();
        const params = [];

        if (paramsRaw && paramsRaw !== 'void') {
            const parts = paramsRaw.split(',').map(p => p.trim());
            for (const p of parts) {
                const mParam = p.match(regexParam);
                if (!mParam) return null;
                params.push({
                    type: mParam[1].replace(/\s+/g, ' ').trim(),
                    name: mParam[2].trim()
                });
            }
        }

        const paramsFormatados = params.map(p => `${p.type} ${p.name}`).join(', ');
        return {
            valido: true,
            isLocked,
            returnType,
            funcName,
            params,
            cleanSignature: `${returnType} ${funcName}(${paramsFormatados})`
        };
    }

    const texto = String(assinaturaOuTemplate || '').replace(/\r/g, '');
    if (!texto.trim()) return { valido: false };

    const linhas = texto.split('\n');
    const candidatos = [];
    let emComentarioBloco = false;
    let nivelChaves = 0;

    for (const linhaOriginal of linhas) {
        let linhaLimpa = '';
        for (let i = 0; i < linhaOriginal.length; i++) {
            if (!emComentarioBloco && linhaOriginal[i] === '/' && linhaOriginal[i + 1] === '*') {
                emComentarioBloco = true;
                i++;
            } else if (emComentarioBloco && linhaOriginal[i] === '*' && linhaOriginal[i + 1] === '/') {
                emComentarioBloco = false;
                i++;
            } else if (!emComentarioBloco && linhaOriginal[i] === '/' && linhaOriginal[i + 1] === '/') {
                break;
            } else if (!emComentarioBloco) {
                linhaLimpa += linhaOriginal[i];
            }
        }

        if (nivelChaves === 0 && linhaLimpa.trim()) {
            const res = testarLinha(linhaLimpa);
            if (res && res.valido) {
                candidatos.push(res);
            }
        }

        for (const ch of linhaLimpa) {
            if (ch === '{') nivelChaves++;
            else if (ch === '}') nivelChaves = Math.max(0, nivelChaves - 1);
        }
    }

    if (candidatos.length > 0) {
        return candidatos.find(c => c.isLocked) || candidatos[0];
    }
    return { valido: false };
}

function prepararCodigoMainCustom(code, templateCode, isCustomDebug = false) {
    const tplRaw = String(templateCode || '').replace(/\r/g, '');
    if (!tplRaw.trim()) {
        return { valido: true, codeFinal: code, useOfficialOut: false };
    }

    const linhasTpl = tplRaw.split('\n').map((linha, tplIdx) => {
        const isStar = /^\s*\*\*\*/.test(linha);
        const isHash = /^\s*###/.test(linha);
        const isProtected = isStar || isHash;
        const cleanText = isProtected ? linha.replace(/^(\s*)(?:\*\*\*|###)/, '$1') : linha;
        return {
            tplIdx,
            isStar,
            isHash,
            isProtected,
            cleanText
        };
    });

    const protegidas = linhasTpl.filter(l => l.isProtected);
    if (protegidas.length === 0) {
        return { valido: true, codeFinal: code, useOfficialOut: false };
    }

    const lastProtectedTplIdx = protegidas[protegidas.length - 1].tplIdx;
    let lastFreeTplIdx = -1;
    for (let i = lastProtectedTplIdx - 1; i >= 0; i--) {
        if (!linhasTpl[i].isProtected) {
            lastFreeTplIdx = i;
            break;
        }
    }

    const prefixAndMid = lastFreeTplIdx === -1
        ? protegidas
        : protegidas.filter(p => p.tplIdx < lastFreeTplIdx);
    const suffix = lastFreeTplIdx === -1
        ? []
        : protegidas.filter(p => p.tplIdx > lastFreeTplIdx);

    const linhasAluno = String(code || '').replace(/\r/g, '').split('\n');
    let cursor = 0;

    for (const p of prefixAndMid) {
        let achou = -1;
        for (let i = cursor; i < linhasAluno.length; i++) {
            if (linhasAluno[i].trim() === p.cleanText.trim()) {
                achou = i;
                break;
            }
        }
        if (achou === -1) {
            return {
                valido: false,
                error: "Violação de linha protegida pelo professor: Uma ou mais linhas travadas com cadeado foram modificadas ou removidas. Clique em 'Restaurar' para recuperar a estrutura original."
            };
        }
        p.matchedLineIdx = achou;
        cursor = achou + 1;
    }

    let upper = linhasAluno.length - 1;
    for (let k = suffix.length - 1; k >= 0; k--) {
        const p = suffix[k];
        let achou = -1;
        for (let i = upper; i >= cursor; i--) {
            if (linhasAluno[i].trim() === p.cleanText.trim()) {
                achou = i;
                break;
            }
        }
        if (achou === -1) {
            return {
                valido: false,
                error: "Violação de linha protegida pelo professor: Uma ou mais linhas travadas com cadeado foram modificadas ou removidas. Clique em 'Restaurar' para recuperar a estrutura original."
            };
        }
        p.matchedLineIdx = achou;
        upper = achou - 1;
    }

    // Verifica se o aluno comentou alguma linha protegida usando /* ... */
    const indicesProtegidosSet = new Set(protegidas.map(p => p.matchedLineIdx));
    let emComentarioBloco = false;
    for (let i = 0; i < linhasAluno.length; i++) {
        if (indicesProtegidosSet.has(i) && emComentarioBloco) {
            return {
                valido: false,
                error: "Violação de linha protegida pelo professor: Não é permitido comentar linhas travadas com cadeado."
            };
        }
        const linha = linhasAluno[i];
        let dentroAspas = false;
        for (let c = 0; c < linha.length; c++) {
            if (!emComentarioBloco && linha[c] === '"' && (c === 0 || linha[c - 1] !== '\\')) {
                dentroAspas = !dentroAspas;
            } else if (!dentroAspas && !emComentarioBloco && linha[c] === '/' && linha[c + 1] === '*') {
                emComentarioBloco = true;
                c++;
            } else if (!dentroAspas && !emComentarioBloco && linha[c] === '/' && linha[c + 1] === '/') {
                break;
            } else if (emComentarioBloco && linha[c] === '*' && linha[c + 1] === '/') {
                emComentarioBloco = false;
                c++;
            }
        }
    }

    // Na aba "Depuração" livre, retorna o stdout completo (incluindo prints de debug + prints do template)
    if (isCustomDebug) {
        return {
            valido: true,
            codeFinal: code,
            useOfficialOut: false
        };
    }

    // Substitui printf( por fprintf(__cc_out, exclusivamente nas linhas correspondentes a ###
    for (const p of protegidas) {
        if (p.isHash && typeof p.matchedLineIdx === 'number') {
            linhasAluno[p.matchedLineIdx] = linhasAluno[p.matchedLineIdx].replace(/\bprintf\s*\(/g, 'fprintf(__cc_out, ');
        }
    }

    const cabecalhoInjetado = [
        '#include <stdio.h>',
        'FILE *__cc_out = NULL;',
        '__attribute__((constructor)) static void __cc_init_out(void) { __cc_out = fopen("official_got.txt", "a"); if (__cc_out) setbuf(__cc_out, NULL); }',
        '#line 1 "main.c"'
    ].join('\n');

    return {
        valido: true,
        codeFinal: `${cabecalhoInjetado}\n${linhasAluno.join('\n')}`,
        useOfficialOut: true
    };
}

function obterFormatadorScanfC(tipoParam) {
    const t = String(tipoParam || '').replace(/\s+/g, ' ').trim();
    if (t === 'double') return { decl: 'double', init: '0.0', fmt: '%lf' };
    if (t === 'float') return { decl: 'float', init: '0.0f', fmt: '%f' };
    if (t === 'long long' || t === 'long long int') return { decl: 'long long', init: '0', fmt: '%lld' };
    if (t === 'unsigned long long') return { decl: 'unsigned long long', init: '0', fmt: '%llu' };
    if (t === 'long' || t === 'long int') return { decl: 'long', init: '0', fmt: '%ld' };
    if (t === 'unsigned long') return { decl: 'unsigned long', init: '0', fmt: '%lu' };
    if (t === 'short' || t === 'short int') return { decl: 'short', init: '0', fmt: '%hd' };
    if (t === 'unsigned int' || t === 'unsigned') return { decl: 'unsigned int', init: '0', fmt: '%u' };
    if (t === 'char') return { decl: 'char', init: "'\\0'", fmt: ' %c' };
    return { decl: 'int', init: '0', fmt: '%d' };
}

function obterFormatadorPrintRetornoC(returnType, floatPrecision = 2) {
    const t = String(returnType || '').replace(/\s+/g, ' ').trim();
    const prec = (!isNaN(parseInt(floatPrecision, 10)) && parseInt(floatPrecision, 10) >= 0 && parseInt(floatPrecision, 10) <= 10)
        ? parseInt(floatPrecision, 10)
        : 2;

    if (t === 'float' || t === 'double') {
        return { fmt: `%.${prec}f`, cast: '(double)' };
    }
    if (t === 'long long' || t === 'long long int') {
        return { fmt: '%lld', cast: '(long long)' };
    }
    if (t === 'unsigned long long') {
        return { fmt: '%llu', cast: '(unsigned long long)' };
    }
    if (t === 'long' || t === 'long int') {
        return { fmt: '%ld', cast: '(long)' };
    }
    if (t === 'unsigned long') {
        return { fmt: '%lu', cast: '(unsigned long)' };
    }
    if (t === 'unsigned int' || t === 'unsigned') {
        return { fmt: '%u', cast: '(unsigned int)' };
    }
    if (t === 'char') {
        return { fmt: '%c', cast: '(char)' };
    }
    return { fmt: '%d', cast: '(int)' };
}

function prepararCodigoModoFuncao(code, functionSignature, floatPrecision = 2, isCustomDebug = false, templateCode = null) {
    const sig = extrairAssinaturaFuncaoC(functionSignature || templateCode);
    if (!sig.valido) {
        return { valido: true, codeFinal: code, useOfficialOut: false };
    }

    if (templateCode && String(templateCode).trim()) {
        const validacaoTravas = prepararCodigoMainCustom(code, templateCode, true);
        if (!validacaoTravas.valido) {
            return validacaoTravas;
        }
    }

    const codigoStr = String(code || '').replace(/\r/g, '');
    // Remove comentários para validar assinatura e ausência de main()
    const codigoSemComentarios = codigoStr
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

    if (/\b(?:int|void)\s+main\s*\(/.test(codigoSemComentarios)) {
        return {
            valido: false,
            error: "Violação de estrutura: No Modo Função você não deve declarar a função main(). Programe apenas o corpo da função solicitada."
        };
    }

    const normCode = codigoSemComentarios.replace(/\s+/g, ' ');
    const normSig = sig.cleanSignature.replace(/\s+/g, ' ');
    if (!normCode.includes(normSig) || !codigoSemComentarios.trim().endsWith('}')) {
        return {
            valido: false,
            error: `Violação de linha protegida pelo professor: A assinatura da função "${sig.cleanSignature}" ou o fechamento "}" foi alterado. Clique em 'Restaurar' para recuperar a estrutura original.`
        };
    }

    const linhasLeitura = [];
    const nomesArgs = [];
    sig.params.forEach((p, idx) => {
        const info = obterFormatadorScanfC(p.type);
        const varName = `__cc_param_${idx}`;
        nomesArgs.push(varName);
        linhasLeitura.push(`    ${info.decl} ${varName} = ${info.init};`);
        linhasLeitura.push(`    if (scanf("${info.fmt}", &${varName}) != 1) {}`);
    });

    const retPrint = obterFormatadorPrintRetornoC(sig.returnType, floatPrecision);
    const chamada = `${sig.funcName}(${nomesArgs.join(', ')})`;

    let blocoImpressao = '';
    if (isCustomDebug) {
        blocoImpressao = `    printf("${retPrint.fmt}\\n", ${retPrint.cast}__cc_ret);`;
    } else {
        blocoImpressao = [
            '    FILE *__cc_out = fopen("official_got.txt", "a");',
            '    if (__cc_out) {',
            '        setbuf(__cc_out, NULL);',
            `        fprintf(__cc_out, "${retPrint.fmt}\\n", ${retPrint.cast}__cc_ret);`,
            '        fclose(__cc_out);',
            '    }'
        ].join('\n');
    }

    const mainGerada = [
        '',
        'int main(void) {',
        ...linhasLeitura,
        `    ${sig.returnType} __cc_ret = ${chamada};`,
        blocoImpressao,
        '    return 0;',
        '}'
    ].join('\n');

    const cabecalhoPadrao = [
        '#include <stdio.h>',
        '#include <stdlib.h>',
        '#include <math.h>',
        '#line 1 "main.c"'
    ].join('\n');

    return {
        valido: true,
        codeFinal: `${cabecalhoPadrao}\n${codigoStr}\n${mainGerada}\n`,
        useOfficialOut: !isCustomDebug
    };
}

function prepararCodigoPorModo(code, opcoesExercicio = {}) {
    const mode = normalizarModoExercicio(opcoesExercicio?.exerciseMode);
    const isCustomDebug = opcoesExercicio?.isCustomDebug === true;

    if (mode === 'main_custom') {
        return prepararCodigoMainCustom(code, opcoesExercicio.templateCode, isCustomDebug);
    }
    if (mode === 'function') {
        return prepararCodigoModoFuncao(
            code,
            opcoesExercicio.functionSignature,
            opcoesExercicio.floatPrecision,
            isCustomDebug,
            opcoesExercicio.templateCode
        );
    }
    return {
        valido: true,
        codeFinal: code,
        useOfficialOut: false
    };
}

function validarCodigoExercicio(code, exercicio) {
    if (!exercicio) return { valido: true };
    const prep = prepararCodigoPorModo(code, {
        exerciseMode: exercicio.exerciseMode,
        templateCode: exercicio.templateCode,
        functionSignature: exercicio.functionSignature,
        floatPrecision: exercicio.floatPrecision,
        isCustomDebug: false
    });
    return {
        valido: prep.valido,
        error: prep.error || null
    };
}

// Mapa de (userId + exercício) -> ordem atual dos índices de casos de teste ocultos.
// Mantém a mesma ordem enquanto o aluno erra e só reembaralha quando ele acerta (Accepted).
const ordemTestesOcultosMap = new Map();

function embaralharArray(lista) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = copia[i];
        copia[i] = copia[j];
        copia[j] = temp;
    }
    return copia;
}

function prepararTestesOrdenados(array, chaveOrdem = null) {
    if (!Array.isArray(array) || array.length === 0) return [];
    const todos = array.map((t, idx) => {
        const obj = (t && typeof t.toObject === 'function') ? t.toObject() : { ...t };
        obj.originalIndex = idx;
        return obj;
    });

    const temAlgumVisivel = todos.some(t => t.isVisible === true);
    const visiveis = [];
    const ocultos = [];

    todos.forEach((t, idx) => {
        const ehVisivel = temAlgumVisivel ? (t.isVisible === true) : (idx === 0);
        if (ehVisivel) {
            visiveis.push(t); // Testes visíveis NUNCA são embaralhados e rodam sempre primeiro
        } else {
            ocultos.push(t);
        }
    });

    if (ocultos.length <= 1) {
        return [...visiveis, ...ocultos];
    }

    if (!chaveOrdem) {
        return [...visiveis, ...embaralharArray(ocultos)];
    }

    const indicesOcultosAtuais = ocultos.map(t => t.originalIndex);
    let ordemSalva = ordemTestesOcultosMap.get(chaveOrdem);

    const ordemValida = Array.isArray(ordemSalva) &&
        ordemSalva.length === indicesOcultosAtuais.length &&
        indicesOcultosAtuais.every(idx => ordemSalva.includes(idx));

    if (!ordemValida) {
        ordemSalva = embaralharArray(indicesOcultosAtuais);
        ordemTestesOcultosMap.set(chaveOrdem, ordemSalva);
    }

    const mapaPorIndice = new Map(ocultos.map(t => [t.originalIndex, t]));
    const ocultosOrdenados = ordemSalva.map(idx => mapaPorIndice.get(idx)).filter(Boolean);

    return [...visiveis, ...ocultosOrdenados];
}

async function runTests(code, tests, containerName, timeLimitMs, chaveOrdem = null, opcoesExercicio = null) {
    const uid = extrairUserId(containerName);
    if (uid) activeUsers.set(uid, Date.now());

    const chaveEfetiva = chaveOrdem || (uid ? `${uid}_${Array.isArray(tests) ? tests.length : 0}` : null);

    const preparo = prepararCodigoPorModo(code, opcoesExercicio || {});
    if (!preparo.valido) {
        return {
            status: 'Compilation Error',
            details: preparo.error || 'Violação de linha protegida pelo professor.',
            executionTime: 0,
            percentage: 0,
            passedCount: 0,
            totalCount: Array.isArray(tests) ? tests.length : 0
        };
    }

    const codeParaExecutar = preparo.codeFinal;
    const useOfficialOut = preparo.useOfficialOut === true;

    await adquirirVagaNaFila();
    try {
        const testesOrdenados = prepararTestesOrdenados(tests, chaveEfetiva);
        const padraoTempoLimiteMs = Number(process.env.DEFAULT_TIME_LIMIT_MS || process.env.DEFAULT_EXECUTION_TIME_LIMIT_MS) || 5000;
        const timeoutAlunoMs = Number(timeLimitMs) > 0 ? Number(timeLimitMs) : padraoTempoLimiteMs;

        let resultadoFinal;
        // 1. Tenta executar no Warm Pod Pool (respostas < 0.5s)
        try {
            const outputBruto = await warmPoolService.executarJobNoPool(
                codeParaExecutar,
                testesOrdenados,
                timeoutAlunoMs,
                containerName || Date.now(),
                1,
                useOfficialOut
            );
            resultadoFinal = processarResultadoSandbox(outputBruto, testesOrdenados, timeoutAlunoMs);
        } catch (poolErr) {
            console.warn(`[Judge] Warm pool falhou ou indisponível (${poolErr.message}). Utilizando fallback para Pod efêmero...`);
            resultadoFinal = await executarProcessoDeTesteK8sIndividual(codeParaExecutar, testesOrdenados, containerName, timeoutAlunoMs, useOfficialOut);
        }

        // Quando o aluno acerta todos os testes (Accepted), reembaralha os ocultos para o próximo envio;
        // enquanto ele errar, mantém exatamente a mesma ordem sem embaralhar.
        if (chaveEfetiva && resultadoFinal && resultadoFinal.status === 'Accepted') {
            const ocultosIndices = testesOrdenados
                .filter((t, idx) => {
                    const temAlgumVisivel = testesOrdenados.some(item => item.isVisible === true);
                    const ehVisivel = temAlgumVisivel ? (t.isVisible === true) : (t.originalIndex === 0 && idx === 0);
                    return !ehVisivel;
                })
                .map(t => t.originalIndex);
            if (ocultosIndices.length > 1) {
                ordemTestesOcultosMap.set(chaveEfetiva, embaralharArray(ocultosIndices));
            }
        }

        return resultadoFinal;
    } finally {
        liberarVagaNaFila();
        liberarTravaUsuario(containerName);
    }
}

async function executarProcessoDeTesteK8sIndividual(code, tests, containerName, timeoutAlunoMs, useOfficialOut = false) {
    const podName = (containerName || `judge-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const targetNs = process.env.K8S_NAMESPACE || namespace || 'default';

    const cpuReq = process.env.K8S_CPU_REQUEST || '1000m';
    const cpuLim = process.env.K8S_CPU_LIMIT || '1000m';
    const memReq = process.env.K8S_MEMORY_REQUEST || '512Mi';
    const memLim = process.env.K8S_MEMORY_LIMIT || '512Mi';
    const image = process.env.K8S_IMAGE || 'gcc:latest';

    const runnerScript = gerarScriptSandbox(code, tests, timeoutAlunoMs, useOfficialOut);
    const b64GzRunner = zlib.gzipSync(Buffer.from(runnerScript, 'utf-8')).toString('base64');

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
                    args: [`echo "${b64GzRunner}" | base64 -d | gzip -d | /bin/bash`],
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

        const compileTimeoutMs = Number(process.env.COMPILE_TIMEOUT) || 30000;
        const tempoEsperaNodeMs = compileTimeoutMs + timeoutAlunoMs + 25000;

        const outputBruto = await aguardarPodFinalizar(podName, targetNs, tempoEsperaNodeMs);
        return processarResultadoSandbox(outputBruto, tests, timeoutAlunoMs);
    } catch (err) {
        if (err.message && err.message.includes('Tempo esgotado aguardando execução do Pod')) {
            return {
                status: 'Time Limit',
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
        } catch { }
    }
}

function gerarScriptSandbox(code, tests, timeLimitMs, useOfficialOut = false) {
    const b64Code = Buffer.from(code, 'utf-8').toString('base64');
    const limitSec = timeLimitMs / 1000;
    const totalTests = Array.isArray(tests) && tests.length > 0 ? tests.length : 1;
    const firstTimeoutSec = totalTests === 1
        ? Math.max(1, Number(limitSec.toFixed(2)))
        : Math.max(1, Number((limitSec * 0.85).toFixed(2)));
    const compileTimeoutMs = Number(process.env.COMPILE_TIMEOUT) || 30000;
    const compileTimeoutSec = Math.max(1, Math.ceil(compileTimeoutMs / 1000));
    const flagOfficialOut = useOfficialOut ? '1' : '0';

    const b64Runner = warmPoolService.B64_RUNNER;

    let scriptTestes = `
START_TIME_MS=$(date +%s%3N)
HAD_TIMEOUT=0
TIMEOUT_COUNT=0
USE_OFFICIAL_OUT=${flagOfficialOut}
if [ ! -f /usr/local/bin/runner ]; then
    echo "${b64Runner}" | base64 -d > "$CTRL_DIR/runner.c"
    gcc -O2 "$CTRL_DIR/runner.c" -o /usr/local/bin/runner
    chmod 555 /usr/local/bin/runner
    rm -f "$CTRL_DIR/runner.c"
fi

run_step() {
    local i="$1"
    local b64In="$2"
    echo "---STEP---"
    echo "INDEX:$i"

    NOW_MS=$(date +%s%3N)
    ELAPSED_TOTAL=$(( NOW_MS - START_TIME_MS ))
    if [ $ELAPSED_TOTAL -ge ${timeLimitMs} ]; then
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
        echo "$b64In" | base64 -d > "$CTRL_DIR/in_$i.txt"

        rm -f "$CTRL_DIR/time_$i.txt"
        timeout -k 0.2s -s 9 $STEP_TIMEOUT stdbuf -o0 -e0 /usr/local/bin/runner "$BIN_DIR/prog" "$CTRL_DIR/time_$i.txt" < "$CTRL_DIR/in_$i.txt" > "$CTRL_DIR/got_$i.txt" 2> "$CTRL_DIR/err_$i.txt"
        EXIT_CODE=$?
        pkill -9 -u 65534 2>/dev/null || true
        ipcrm -a 2>/dev/null || true

        if [ "$USE_OFFICIAL_OUT" = "1" ]; then
            if [ -f "$WORK_DIR/official_got.txt" ]; then
                cp -f "$WORK_DIR/official_got.txt" "$CTRL_DIR/got_$i.txt"
            else
                : > "$CTRL_DIR/got_$i.txt"
            fi
        fi

        CPUTIME=$(cat "$CTRL_DIR/time_$i.txt" 2>/dev/null || echo "0.000000")
        echo "TIME:$CPUTIME"

        if [ $EXIT_CODE -eq 124 ] || [ $EXIT_CODE -eq 137 ]; then
            HAD_TIMEOUT=1
            TIMEOUT_COUNT=$(( TIMEOUT_COUNT + 1 ))
            echo "STATUS:HARD_TIME_LIMIT"
            echo "GOT_B64:$(head -c 262144 "$CTRL_DIR/got_$i.txt" 2>/dev/null | base64 -w 0 || echo '')"
        elif [ $EXIT_CODE -ne 0 ]; then
            echo "STATUS:RUNTIME_ERROR"
            echo "GOT_B64:$(head -c 262144 "$CTRL_DIR/got_$i.txt" 2>/dev/null | base64 -w 0 || echo '')"
            echo "ERR_B64:$(head -c 262144 "$CTRL_DIR/err_$i.txt" 2>/dev/null | base64 -w 0 || echo '')"
        else
            echo "STATUS:OK"
            echo "GOT_B64:$(head -c 262144 "$CTRL_DIR/got_$i.txt" 2>/dev/null | base64 -w 0 || echo '')"
        fi
        rm -f "$CTRL_DIR/in_$i.txt" "$CTRL_DIR/got_$i.txt" "$CTRL_DIR/err_$i.txt" "$CTRL_DIR/time_$i.txt"
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

CTRL_DIR="/root/ctrl_ephemeral"
BIN_DIR="/var/run/judge_ephemeral"
WORK_DIR="/sandbox/work"

mkdir -p /sandbox && chmod 711 /sandbox
mkdir -p "$CTRL_DIR" && chmod 700 "$CTRL_DIR"
mkdir -p "$BIN_DIR" && chmod 755 "$BIN_DIR"
mkdir -p "$WORK_DIR" && chown 65534:65534 "$WORK_DIR" && chmod 700 "$WORK_DIR"

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
        } catch { }
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

    const warnMatch = rawOutput.match(/WARN_B64:([A-Za-z0-9+/=]*)/);
    const warnings = warnMatch && warnMatch[1] ? Buffer.from(warnMatch[1], 'base64').toString('utf-8') : '';

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
                    executionTime: durMs > 0 ? durMs : timeoutAlunoMs
                };
            }
        } else if (stepStatus === 'RUNTIME_ERROR') {
            const errMatch = step.match(/ERR_B64:([A-Za-z0-9+/=]*)/);
            const details = errMatch && errMatch[1] ? Buffer.from(errMatch[1], 'base64').toString('utf-8') : 'Runtime Error.';
            if (!primeiroErro) {
                primeiroErro = {
                    status: 'Runtime Error',
                    details,
                    input: testItem.input || '',
                    got: got,
                    expected: expected,
                    executionTime: durMs,
                    testIndex: origIdx
                };
            }
        } else if (stepStatus === 'WRONG_ANSWER' || !corresponds) {
            if (!primeiroErro) {
                primeiroErro = {
                    status: 'Wrong Answer',
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
                        executionTime: durMs
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

    if (somaTotalTemposMs > timeoutAlunoMs && !primeiroErro) {
        primeiroErro = {
            status: 'Time Limit',
            executionTime: somaTotalTemposMs
        };
    }

    if (passedCount === totalCount && totalCount > 0 && !primeiroErro) {
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
            warnings,
            executionTime: somaTotalTemposMs,
            percentage,
            passedCount,
            totalCount
        };
    }

    return {
        status: 'Runtime Error',
        details: 'Erro na execução dos testes.',
        warnings,
        executionTime: somaTotalTemposMs,
        percentage,
        passedCount,
        totalCount
    };
}

module.exports = {
    runTests,
    validarCodigoExercicio,
    prepararCodigoPorModo,
    extrairAssinaturaFuncaoC,
    isAlreadyRunning,
    liberarTravaUsuario,
    inicializarPool: warmPoolService.inicializarPool,
    encerrarPool: warmPoolService.encerrarPool
};