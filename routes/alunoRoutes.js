const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');

const minioService = require('../services/minioService');
const judgeService = require('../services/judgeService');
const ActivityConfig = require('../models/ActivityConfig');
const ExerciseList = require('../models/ExerciseList');
const Exercise = require('../models/Exercise');
const Submission = require('../models/Submission');
const ActivityAttempt = require('../models/ActivityAttempt');

const MAX_TIME_LIMIT_MS = parseInt(process.env.MAX_EXECUTION_TIME_LIMIT_MS, 10) || 120000;
const COMPILE_TIMEOUT_MS = parseInt(process.env.COMPILE_TIMEOUT, 10) || 10000;

function obterContextoAuth(req) {
    const auth = req.auth || req.session || {};
    const isProfessor = auth.isProfessor === true;
    return {
        auth,
        isProfessor,
        userId: auth.userId || null,
        userName: auth.userName || null,
        activityId: auth.activityId ? String(auth.activityId) : ''
    };
}

function ehObjectIdValido(id) {
    return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id);
}

// Rate limit: 10 submissões/execuções por minuto por aluno/IP
const submitLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    keyGenerator: (req) => {
        return req.auth?.userId || req.session?.userId || req.ip;
    },
    skip: (req) => {
        return req.auth ? req.auth.isProfessor === true : req.session?.isProfessor === true;
    },
    message: {
        error: "Limite de submissões excedido. Você pode realizar no máximo 10 submissões por minuto. Aguarde um instante antes de tentar novamente."
    }
});

function isTestUser(userId, auth) {
    if (auth?.isProfessor === true) return true;
    return false;
}

function sanitizarMensagemErroServidor(msg) {
    if (!msg || typeof msg !== 'string') return "O ambiente de compilação está temporariamente indisponível. Tente novamente em instantes.";
    if (
        msg.includes('HTTP-Code') ||
        msg.includes('apiVersion') ||
        msg.includes('kind') ||
        msg.includes('namespaces') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('k8s') ||
        msg.includes('WebSocket') ||
        msg.includes('Tempo esgotado aguardando') ||
        msg.includes('status code') ||
        msg.includes('Kubernetes') ||
        msg.includes('Orquestrador') ||
        msg.trim().startsWith('{')
    ) {
        return "O ambiente de compilação e teste está temporariamente reiniciando no servidor. Por favor, tente novamente em instantes.";
    }
    return msg;
}

function gerarDicaDidatica(status, details, got) {
    const txt = `${details || ''} ${got || ''}`;

    if (/SIGSEGV|segmentation fault|core dumped/i.test(txt)) {
        return "Falha de segmentação (Segmentation Fault): Seu código tentou acessar um endereço de memória inválido. Verifique se não ultrapassou o tamanho de um vetor (índice fora dos limites), se não usou ponteiro não inicializado ou se não esqueceu o '&' no scanf.";
    }
    if (/SIGFPE|floating point exception/i.test(txt)) {
        return "Erro aritmético de execução: Provavelmente ocorreu uma divisão por zero (x / 0) ou resto de divisão por zero (x % 0). Verifique os valores do divisor.";
    }
    if (/expected ';' before/i.test(txt)) {
        return "Ponto e vírgula (;) ausente: O compilador esperava um ';' antes deste trecho ou na linha imediatamente anterior.";
    }
    if (/expected '\)' before|expected '}' before|expected '\]' before/i.test(txt)) {
        return "Fechamento ausente: Verifique se todos os parênteses '()', colchetes '[]' ou chaves '{}' abertos foram devidamente fechados.";
    }
    if (/undeclared \(first use in this function\)/i.test(txt)) {
        return "Variável não declarada: O compilador encontrou um nome desconhecido. Verifique se declarou a variável antes de usar ou se houve erro de digitação.";
    }
    if (/undefined reference to `?main'?/i.test(txt)) {
        return "Função main ausente: Todo programa em C precisa de uma função principal 'int main() { ... }' para ser executado.";
    }
    if (/format '%[a-zA-Z]+' expects argument of type/i.test(txt)) {
        return "Incompatibilidade no printf/scanf: O tipo especificado no marcador (ex: %d, %f, %s) não corresponde ao tipo da variável informada.";
    }
    if (/suggest parentheses around assignment used as truth value/i.test(txt)) {
        return "Possível erro de lógica no 'if': Você usou '=' (atribuição) em vez de '==' (comparação de igualdade).";
    }
    if (status === 'Time Limit') {
        return "Tempo limite excedido: Seu programa demorou mais que o permitido para responder. Verifique se não há laços infinitos ou se a condição de parada do laço está correta.";
    }
    return null;
}

// Consulta o status do cronômetro do aluno na atividade
router.get('/atividade/timer-status', async (req, res) => {
    const ctx = obterContextoAuth(req);
    if (!ctx.userId) {
        return res.status(401).json({ success: false, error: "Não autorizado: faça login pelo Moodle." });
    }

    const userId = ctx.userId;
    const effectiveActivityId = ctx.isProfessor
        ? (ctx.activityId || req.query.activityId || 'preview')
        : ctx.activityId;

    if (ctx.isProfessor || !effectiveActivityId || effectiveActivityId === 'preview') {
        return res.json({ success: true, hasTimeLimit: false });
    }

    try {
        const config = await ActivityConfig.findOne({ activityId: effectiveActivityId });
        if (!config || !config.hasTimeLimit) {
            return res.json({ success: true, hasTimeLimit: false });
        }

        const attempt = await ActivityAttempt.findOne({ userId, activityId: effectiveActivityId });

        res.json({
            success: true,
            hasTimeLimit: true,
            timeLimitMinutes: config.timeLimitMinutes || 0,
            started: !!attempt,
            expiresAt: attempt ? attempt.expiresAt : null,
            serverTime: Date.now()
        });
    } catch (e) {
        console.error("❌ [Erro timer-status]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao consultar o cronômetro." });
    }
});

// Inicia a contagem oficial da avaliação no servidor
router.post('/atividade/iniciar-timer', async (req, res) => {
    const ctx = obterContextoAuth(req);

    // Bloqueio de segurança: exige autenticação ativa do Moodle
    if (!ctx.userId) {
        return res.status(401).json({ success: false, error: "Não autorizado: faça login pelo Moodle." });
    }

    if (ctx.isProfessor) {
        return res.json({ success: true, hasTimeLimit: false });
    }

    const userId = ctx.userId;
    const effectiveActivityId = ctx.activityId;

    if (!effectiveActivityId || effectiveActivityId === 'preview') {
        return res.status(403).json({ success: false, error: "Atividade inválida." });
    }

    try {
        const config = await ActivityConfig.findOne({ activityId: effectiveActivityId });
        if (!config || !config.hasTimeLimit) {
            return res.json({ success: true, hasTimeLimit: false });
        }

        let attempt = await ActivityAttempt.findOne({ userId, activityId: effectiveActivityId });
        if (!attempt) {
            const startedAt = new Date();
            const expiresAt = new Date(startedAt.getTime() + (config.timeLimitMinutes * 60 * 1000));
            attempt = await ActivityAttempt.create({
                userId,
                activityId: effectiveActivityId,
                startedAt,
                expiresAt
            });
        }

        res.json({
            success: true,
            expiresAt: attempt.expiresAt,
            serverTime: Date.now()
        });
    } catch (e) {
        console.error("❌ [Erro timer-status]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao consultar o cronômetro." });
    }
});

// Submissão oficial (protegida com limite de 10 submissões por minuto)
router.post('/submit', submitLimiter, async (req, res) => {
    const { code, activityId, listId, exerciseId, draftOnly } = req.body;
    const ctx = obterContextoAuth(req);
    const isProfessorReal = ctx.isProfessor;

    // Bloqueio de segurança: exige autenticação ativa do Moodle
    if (!ctx.userId) {
        return res.status(401).json({ error: "Não autorizado: faça login pelo Moodle." });
    }

    const isModoTeste = isProfessorReal || isTestUser(req.body.userId, ctx.auth);
    const userId = isModoTeste ? 'professor_test' : ctx.userId;
    const userName = isModoTeste ? 'Professor' : (ctx.userName || 'Aluno');
    const effectiveActivityId = isModoTeste
        ? (ctx.activityId || activityId || 'preview')
        : ctx.activityId;

    if (!isModoTeste && (!effectiveActivityId || effectiveActivityId === 'preview')) {
        return res.status(403).json({ error: "Atividade não identificada na sessão do Moodle." });
    }

    if (!effectiveActivityId && !listId && !exerciseId) {
        return res.status(400).json({ error: "ID da atividade, lista ou exercício faltando." });
    }

    try {
        let exercicioAlvo = null;
        let configAtividade = null;

        if (!isModoTeste) {
            // Aluno real: só pode submeter exercícios pertencentes à lista vinculada à atividade atual
            configAtividade = await ActivityConfig.findOne({ activityId: effectiveActivityId }).populate({
                path: 'listId',
                populate: { path: 'exercises' }
            });

            if (!configAtividade || !configAtividade.listId) {
                return res.status(403).json({ error: "Nenhuma lista vinculada a esta atividade." });
            }

            const exerciciosDaAtividade = configAtividade.listId.exercises || [];
            if (exerciseId) {
                exercicioAlvo = exerciciosDaAtividade.find(e => e && String(e._id) === String(exerciseId)) || null;
                if (!exercicioAlvo) {
                    return res.status(403).json({ error: "Este exercício não pertence à atividade atual." });
                }
            } else if (exerciciosDaAtividade.length > 0) {
                exercicioAlvo = exerciciosDaAtividade[0];
            }
        } else {
            // Professor em modo teste/preview ou recompilando submissão no dossiê
            if (exerciseId) {
                if (!ehObjectIdValido(String(exerciseId))) {
                    return res.status(400).json({ error: "ID de exercício inválido." });
                }
                const exCandidate = await Exercise.findById(exerciseId);
                if (exCandidate) {
                    const meuIdProf = String(ctx.userId || 'preview_user');
                    let permitido = exCandidate.isPublic !== false || meuIdProf === 'preview_user' || String(exCandidate.authorId) === meuIdProf;
                    if (!permitido) {
                        const emListaAcessivel = await ExerciseList.exists({
                            exercises: exCandidate._id,
                            $or: [{ isPublic: { $ne: false } }, { authorId: meuIdProf }]
                        });
                        if (emListaAcessivel) permitido = true;
                    }
                    if (!permitido && ctx.activityId) {
                        const cfgProf = await ActivityConfig.findOne({ activityId: ctx.activityId }).populate('listId').lean();
                        const idsVinculados = (cfgProf?.listId?.exercises || []).map(id => String(id._id || id));
                        if (idsVinculados.includes(String(exCandidate._id))) permitido = true;
                    }
                    if (!permitido) {
                        return res.status(403).json({ error: "Sem permissão para testar este exercício privado." });
                    }
                    exercicioAlvo = exCandidate;
                }
            }
            if (!exercicioAlvo && listId) {
                if (!ehObjectIdValido(String(listId))) {
                    return res.status(400).json({ error: "ID de lista inválido." });
                }
                const lista = await ExerciseList.findById(listId).populate('exercises');
                const meuIdProf = String(ctx.userId || 'preview_user');
                if (lista && lista.isPublic === false && meuIdProf !== 'preview_user' && String(lista.authorId) !== meuIdProf) {
                    return res.status(403).json({ error: "Sem permissão para testar esta lista privada." });
                }
                if (lista?.exercises?.length > 0) exercicioAlvo = lista.exercises[0];
            }
            if (!exercicioAlvo && effectiveActivityId && effectiveActivityId !== 'preview') {
                const config = await ActivityConfig.findOne({ activityId: effectiveActivityId }).populate({
                    path: 'listId',
                    populate: { path: 'exercises' }
                });
                if (config?.listId?.exercises?.length > 0) exercicioAlvo = config.listId.exercises[0];
            }
        }

        let testesParaExecutar = exercicioAlvo ? exercicioAlvo.tests : null;
        if (!testesParaExecutar || testesParaExecutar.length === 0) {
            return res.status(404).json({ error: "Nenhum teste encontrado para esta questão." });
        }

        const idExercicioFinal = exercicioAlvo._id;

        let timeLimit = COMPILE_TIMEOUT_MS;
        if (exercicioAlvo.timeLimit && Number(exercicioAlvo.timeLimit) > 0) {
            timeLimit = Number(exercicioAlvo.timeLimit);
        }

        if (timeLimit > MAX_TIME_LIMIT_MS) {
            timeLimit = MAX_TIME_LIMIT_MS;
        }

        // Validações de servidor para alunos: tempo limite e limite de tentativas
        if (!isModoTeste) {
            if (configAtividade && configAtividade.hasTimeLimit) {
                const attempt = await ActivityAttempt.findOne({ userId, activityId: effectiveActivityId });
                if (!attempt) {
                    return res.status(403).json({ error: "Você precisa iniciar a contagem de tempo da atividade primeiro." });
                }
                if (Date.now() > new Date(attempt.expiresAt).getTime()) {
                    return res.status(403).json({ error: "O tempo limite de entrega desta atividade encerrou." });
                }
            }

            if (configAtividade && configAtividade.isEvaluative) {
                const totalTentativas = await Submission.countDocuments({
                    userId,
                    activityId: effectiveActivityId,
                    exerciseId: idExercicioFinal
                });
                const maxTentativas = configAtividade.maxAttempts || 3;
                if (totalTentativas >= maxTentativas) {
                    return res.status(403).json({
                        error: `Limite de tentativas atingido (${maxTentativas}/${maxTentativas}) para este exercício.`
                    });
                }
            }
        }

        // Bloqueio no servidor para submissões idênticas (impede burlar 'Altere seu código' no F12)
        if (!isProfessorReal && !isModoTeste && !draftOnly) {
            const ultimaSub = await Submission.findOne({
                userId,
                activityId: effectiveActivityId,
                exerciseId: idExercicioFinal
            }).sort({ createdAt: -1 });

            if (ultimaSub && ultimaSub.codePath) {
                try {
                    const ultimoCodigo = await minioService.lerArquivoPorPath(ultimaSub.codePath);
                    if (ultimoCodigo && ultimoCodigo.trim() === (code || '').trim()) {
                        return res.status(400).json({
                            error: "Altere seu código no editor para poder compilar novamente."
                        });
                    }
                } catch { }
            }
        }

        if (!isModoTeste) {
            await minioService.salvarRascunho(userId, effectiveActivityId, idExercicioFinal, code, ctx.auth);
        }

        if (draftOnly) {
            return res.json({ success: true, draftSaved: !isModoTeste });
        }

        const containerName = `judge_${String(userId).replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;
        const isRunning = await judgeService.isAlreadyRunning(containerName);
        if (isRunning) {
            return res.status(429).json({ error: "Você já tem uma compilação em andamento." });
        }

        let resultado;
        try {
            resultado = await judgeService.runTests(code, testesParaExecutar, containerName, timeLimit);
        } catch (execErr) {
            judgeService.liberarTravaUsuario(containerName);
            throw execErr;
        }

        const tempoGastoMs = resultado.executionTime || 0;
        const isAccepted = resultado.status === 'Accepted';
        const dicaDidatica = gerarDicaDidatica(resultado.status, resultado.details, resultado.got);

        let respostaResultado = {
            ...resultado,
            executionTime: tempoGastoMs,
            didacticHint: dicaDidatica
        };

        if (isModoTeste) {
            // Professor em teste/preview: exibe feedback na tela do navegador,
            // mas NUNCA salva no MinIO nem grava no MongoDB (Submission).
            // Não polui o ranking de alunos e ao fechar a aba/sair tudo se perde.
            return res.json(respostaResultado);
        }

        const melhorExistente = await Submission.findOne({
            userId,
            activityId: effectiveActivityId,
            exerciseId: idExercicioFinal,
            isAccepted: true
        }).sort({ executionTime: 1, createdAt: -1 });

        let caminhoMaisRapidoProtegido = melhorExistente ? melhorExistente.codePath : null;

        if (isAccepted) {
            const menorTempo = (melhorExistente && typeof melhorExistente.executionTime === 'number')
                ? melhorExistente.executionTime
                : Infinity;
            if (tempoGastoMs <= menorTempo) {
                caminhoMaisRapidoProtegido = 'NOVO';
            }
        }

        const caminhoMinio = await minioService.arquivarSubmissao(
            userId,
            effectiveActivityId,
            idExercicioFinal,
            isAccepted,
            code,
            caminhoMaisRapidoProtegido,
            ctx.auth
        );

        const caminhoLog = caminhoMinio.replace(/\.c$/, '.json');
        const logPayload = JSON.stringify({
            status: resultado.status,
            details: resultado.details || '',
            input: resultado.input || '',
            got: resultado.got || '',
            expected: resultado.expected || '',
            executionTime: isAccepted ? tempoGastoMs : null,
            percentage: typeof resultado.percentage === 'number' ? resultado.percentage : 0,
            passedCount: resultado.passedCount || 0,
            totalCount: resultado.totalCount || 0,
            isSlowMatch: !!resultado.isSlowMatch,
            message: resultado.message || '',
            didacticHint: dicaDidatica
        });
        await minioService.salvarArquivo(caminhoLog, logPayload);

        await Submission.create({
            userId,
            userName,
            activityId: effectiveActivityId,
            exerciseId: idExercicioFinal,
            codePath: caminhoMinio,
            logPath: caminhoLog,
            status: resultado.status,
            isAccepted,
            executionTime: isAccepted ? tempoGastoMs : null,
            percentage: typeof resultado.percentage === 'number' ? resultado.percentage : 0,
            compilationDetails: resultado.details || ''
        });

        res.json(respostaResultado);
    } catch (err) {
        console.error("Erro na submissão:", err);
        res.status(500).json({ error: sanitizarMensagemErroServidor(err.message) });
    }
});

// Execução livre com entrada customizada do aluno (protegida com limite de 10 execuções por minuto)
router.post('/test-custom', submitLimiter, async (req, res) => {
    const { code, input, exerciseId, activityId } = req.body;
    const ctx = obterContextoAuth(req);
    const isProfessor = ctx.isProfessor;

    // Bloqueio de segurança: exige autenticação ativa do Moodle
    if (!ctx.userId) {
        return res.status(401).json({ error: "Não autorizado: faça login pelo Moodle." });
    }

    const userId = isProfessor ? (ctx.userId || 'preview_user') : ctx.userId;
    const effectiveActivityId = isProfessor
        ? (ctx.activityId || activityId || 'preview')
        : ctx.activityId;

    if (!code) return res.status(400).json({ error: "Código vazio." });

    try {
        if (!isProfessor) {
            if (!effectiveActivityId || effectiveActivityId === 'preview') {
                return res.status(403).json({ error: "Atividade inválida ou não vinculada ao Moodle." });
            }

            const configAtividade = await ActivityConfig.findOne({ activityId: effectiveActivityId }).populate('listId');
            if (!configAtividade || !configAtividade.listId) {
                return res.status(403).json({ error: "Nenhuma lista vinculada a esta atividade." });
            }

            if (configAtividade.isEvaluative) {
                return res.status(403).json({
                    error: "A depuração com entradas livres está desativada para atividades com limite de tentativas."
                });
            }

            if (configAtividade.hasTimeLimit) {
                const attempt = await ActivityAttempt.findOne({ userId, activityId: effectiveActivityId });
                if (!attempt) {
                    return res.status(403).json({ error: "Você precisa iniciar a contagem de tempo da atividade primeiro." });
                }
                if (Date.now() > new Date(attempt.expiresAt).getTime()) {
                    return res.status(403).json({ error: "O tempo limite de realização desta atividade encerrou." });
                }
            }

            const idsPermitidos = (configAtividade.listId.exercises || []).map(id => String(id._id || id));
            if (exerciseId && !idsPermitidos.includes(String(exerciseId))) {
                return res.status(403).json({ error: "Este exercício não pertence à atividade atual." });
            }
        }

        let timeLimit = COMPILE_TIMEOUT_MS;
        if (exerciseId && ehObjectIdValido(String(exerciseId))) {
            const ex = await Exercise.findById(exerciseId).lean();
            if (ex && ex.timeLimit && Number(ex.timeLimit) > 0) {
                timeLimit = Number(ex.timeLimit);
            }
        }
        if (timeLimit > MAX_TIME_LIMIT_MS) {
            timeLimit = MAX_TIME_LIMIT_MS;
        }

        const containerName = `test_${String(userId).replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;
        const isRunning = await judgeService.isAlreadyRunning(containerName);
        if (isRunning) {
            return res.status(429).json({ error: "Você já tem uma compilação em andamento." });
        }

        let resultado;
        try {
            const testes = [{ input: input || '', output: '' }];
            resultado = await judgeService.runTests(code, testes, containerName, timeLimit);
        } catch (execErr) {
            judgeService.liberarTravaUsuario(containerName);
            throw execErr;
        }

        const tempoGastoMs = resultado.executionTime || 0;
        const dicaDidatica = gerarDicaDidatica(resultado.status, resultado.details, resultado.got);
        const isSuccess = resultado.status === 'Accepted' || (resultado.status === 'Wrong Answer' && !resultado.details);

        res.json({
            success: true,
            status: isSuccess ? 'Success' : resultado.status,
            output: resultado.got || '',
            details: resultado.details || '',
            executionTime: tempoGastoMs,
            didacticHint: dicaDidatica
        });
    } catch (err) {
        console.error("Erro no teste customizado:", err);
        res.status(500).json({ error: sanitizarMensagemErroServidor(err.message) });
    }
});

// Lista de submissões do aluno
router.get('/aluno/submissoes', async (req, res) => {
    const { exerciseId } = req.query;
    const ctx = obterContextoAuth(req);
    const isProfessor = ctx.isProfessor;

    if (!ctx.userId) {
        return res.status(401).json({ success: false, error: "Não autorizado: faça login pelo Moodle." });
    }

    // Se é professor em teste/preview (não está consultando um aluno específico via req.query.userId),
    // retorna lista vazia pois testes de professor não são salvos.
    if (isProfessor && !req.query.userId) {
        return res.json({ success: true, submissoes: [] });
    }

    if (isProfessor && ctx.activityId && req.query.activityId && req.query.activityId !== 'preview' && String(req.query.activityId) !== String(ctx.activityId)) {
        return res.status(403).json({ success: false, error: "Sem permissão para consultar submissões de outra atividade." });
    }

    const userId = isProfessor ? req.query.userId : ctx.userId;
    const effectiveActivityId = isProfessor
        ? (ctx.activityId || req.query.activityId || 'preview')
        : ctx.activityId;

    if (!exerciseId || !ehObjectIdValido(String(exerciseId))) {
        return res.status(400).json({ success: false, error: "exerciseId ausente ou inválido." });
    }

    if (!effectiveActivityId || effectiveActivityId === 'preview') {
        return res.json({ success: true, submissoes: [] });
    }

    try {
        if (!isProfessor) {
            const configAtividade = await ActivityConfig.findOne({ activityId: effectiveActivityId }).populate('listId').lean();
            const idsPermitidos = (configAtividade?.listId?.exercises || []).map(id => String(id._id || id));
            if (!idsPermitidos.includes(String(exerciseId))) {
                return res.status(403).json({ success: false, error: "Este exercício não pertence à atividade atual." });
            }
        }

        const ultimasSubmissoes = await Submission.find({
            userId,
            activityId: effectiveActivityId,
            exerciseId
        })
            .sort({ createdAt: -1 })
            .limit(minioService.MAX_SUBMISSION_HISTORY || 10)
            .select('_id status isAccepted executionTime percentage createdAt codePath logPath')
            .lean();

        const submissoes = ultimasSubmissoes.reverse();

        res.json({ success: true, submissoes });
    } catch (e) {
        console.error("❌ [Erro timer-status]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao consultar o cronômetro." });
    }
});

// Carregamento sob demanda do código e do log bruto
router.get('/aluno/submissao-codigo', async (req, res) => {
    const { submissionId } = req.query;
    const ctx = obterContextoAuth(req);
    const isProfessor = ctx.isProfessor;

    if (!ctx.userId) {
        return res.status(401).json({ error: "Não autorizado: faça login pelo Moodle." });
    }

    if (!submissionId || !ehObjectIdValido(String(submissionId))) {
        return res.status(400).json({ error: "submissionId inválido." });
    }

    try {
        const sub = await Submission.findById(submissionId);
        if (!sub) return res.status(404).json({ error: "Submissão não encontrada." });

        if (!isProfessor) {
            if (String(sub.userId) !== String(ctx.userId)) {
                return res.status(403).json({ error: "Não autorizado a acessar esta submissão." });
            }
            if (ctx.activityId && String(sub.activityId) !== String(ctx.activityId)) {
                return res.status(403).json({ error: "Submissão pertencente a outra atividade." });
            }
        } else if (ctx.activityId && String(sub.activityId) !== String(ctx.activityId)) {
            return res.status(403).json({ error: "Não autorizado a acessar submissões de outra atividade." });
        }

        let codigo = '// Código não disponível.';
        try {
            if (sub.codePath && sub.codePath !== 'preview') {
                codigo = await minioService.lerArquivoPorPath(sub.codePath);
            }
        } catch (e) {
            codigo = '// Arquivo de código não localizado no armazenamento.';
        }

        let logResultado = null;
        const caminhoLog = sub.logPath || (sub.codePath && sub.codePath !== 'preview' ? sub.codePath.replace(/\.c$/, '.json') : '');
        try {
            if (caminhoLog && caminhoLog !== 'preview') {
                const rawLog = await minioService.lerArquivoPorPath(caminhoLog);
                logResultado = JSON.parse(rawLog);
            }
        } catch { }

        if (!logResultado) {
            logResultado = {
                status: sub.status,
                executionTime: sub.executionTime,
                percentage: sub.percentage || 0,
                details: sub.compilationDetails || '',
                didacticHint: null
            };
        }

        res.json({
            success: true,
            code: codigo,
            resultado: logResultado
        });
    } catch (e) {
        console.error("Erro ao carregar submissão:", e);
        res.status(500).json({ error: "Erro interno ao consultar submissão." });
    }
});

router.get('/get-draft', async (req, res) => {
    const { exerciseId } = req.query;
    const ctx = obterContextoAuth(req);
    const isProfessor = ctx.isProfessor;

    if (isProfessor) {
        return res.status(404).json({ error: "Sem rascunho persistido para professor." });
    }

    if (!ctx.userId) {
        return res.status(401).json({ error: "Não autorizado: faça login pelo Moodle." });
    }

    const userId = ctx.userId;
    const effectiveActivityId = ctx.activityId;

    if (!effectiveActivityId || effectiveActivityId === 'preview' || !exerciseId || !ehObjectIdValido(String(exerciseId))) {
        return res.status(400).json({ error: "Dados ausentes ou inválidos." });
    }

    try {
        const configAtividade = await ActivityConfig.findOne({ activityId: effectiveActivityId }).populate('listId').lean();
        const idsPermitidos = (configAtividade?.listId?.exercises || []).map(id => String(id._id || id));
        if (!idsPermitidos.includes(String(exerciseId))) {
            return res.status(403).json({ error: "Este exercício não pertence à atividade atual." });
        }

        const codigo = await minioService.lerRascunho(userId, effectiveActivityId, exerciseId, ctx.auth);
        res.json({ code: codigo });
    } catch (e) {
        res.status(404).json({ error: "Sem rascunho salvo para este exercício." });
    }
});

router.get('/ranking', async (req, res) => {
    const { exerciseId } = req.query;
    const ctx = obterContextoAuth(req);
    const isProfessorReal = ctx.isProfessor;

    if (!ctx.userId) {
        return res.status(401).json({ success: false, error: "Não autorizado: faça login pelo Moodle." });
    }

    if (isProfessorReal && ctx.activityId && req.query.activityId && req.query.activityId !== 'preview' && String(req.query.activityId) !== String(ctx.activityId)) {
        return res.status(403).json({ success: false, error: "Sem permissão para consultar ranking de outra atividade." });
    }

    const userId = isProfessorReal ? (ctx.userId || 'preview_user') : ctx.userId;
    const effectiveActivityId = isProfessorReal
        ? (ctx.activityId || req.query.activityId || 'preview')
        : ctx.activityId;

    try {
        const submissoes = effectiveActivityId && effectiveActivityId !== 'preview'
            ? await Submission.find({
                activityId: effectiveActivityId,
                codePath: { $ne: 'preview' },
                userId: { $nin: ['professor_test', 'preview_user'] }
            }).lean()
            : [];

        const configAtividade = effectiveActivityId && effectiveActivityId !== 'preview'
            ? await ActivityConfig.findOne({ activityId: effectiveActivityId }).populate({
                path: 'listId',
                populate: { path: 'exercises' }
            }).lean()
            : null;

        const isEvaluative = (configAtividade && !isProfessorReal) ? !!configAtividade.isEvaluative : false;
        const maxAttempts = configAtividade && configAtividade.maxAttempts ? configAtividade.maxAttempts : 3;
        const exercicios = configAtividade?.listId?.exercises || [];

        if (exerciseId && !isProfessorReal && exercicios.length > 0) {
            const idsPermitidos = exercicios.map(e => String(e._id || e));
            if (!idsPermitidos.includes(String(exerciseId))) {
                return res.status(403).json({ success: false, error: "Este exercício não pertence à atividade atual." });
            }
        }

        let minhasTentativasEx = 0;
        let timeLimitEx = null;

        if (exerciseId && ehObjectIdValido(String(exerciseId))) {
            minhasTentativasEx = isProfessorReal ? 0 : submissoes.filter(s => String(s.userId) === String(userId) && String(s.exerciseId) === String(exerciseId)).length;
            const exObj = await Exercise.findById(exerciseId).lean();
            if (exObj && exObj.timeLimit) timeLimitEx = exObj.timeLimit;
        }

        const statusMeusExercicios = {};
        submissoes.filter(s => String(s.userId) === String(userId)).forEach(s => {
            const exId = String(s.exerciseId);
            if (s.isAccepted) {
                statusMeusExercicios[exId] = 'accepted';
            } else if (statusMeusExercicios[exId] !== 'accepted') {
                statusMeusExercicios[exId] = 'wrong';
            }
        });

        // Para o pódio e ranking da turma, ignora usuários de teste/preview e submissões com codePath 'preview'
        const submissoesTurma = submissoes.filter(s =>
            s.codePath !== 'preview' &&
            !['professor_test', 'preview_user'].includes(s.userId) &&
            !(isProfessorReal && ctx.userId && String(s.userId) === String(ctx.userId))
        );

        let rankingExercicio = [];
        let minhaPosicaoEx = null;
        let meuTempoEx = null;

        if (exerciseId) {
            const subsEx = submissoesTurma
                .filter(s => String(s.exerciseId) === String(exerciseId) && s.isAccepted)
                .sort((a, b) => {
                    if (a.executionTime !== b.executionTime) return a.executionTime - b.executionTime;
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                });

            const melhoresPorAluno = {};
            subsEx.forEach(sub => {
                if (!melhoresPorAluno[sub.userId]) {
                    melhoresPorAluno[sub.userId] = {
                        userId: sub.userId,
                        userName: sub.userName || 'Aluno',
                        executionTime: sub.executionTime,
                        createdAt: sub.createdAt
                    };
                }
            });

            rankingExercicio = Object.values(melhoresPorAluno).sort((a, b) => {
                if (a.executionTime !== b.executionTime) return a.executionTime - b.executionTime;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });

            const posIdx = rankingExercicio.findIndex(r => String(r.userId) === String(userId));
            if (posIdx !== -1) {
                minhaPosicaoEx = posIdx + 1;
                meuTempoEx = rankingExercicio[posIdx].executionTime;
            }
        }

        const alunosGeral = {};
        submissoesTurma.forEach(sub => {
            if (!alunosGeral[sub.userId]) {
                alunosGeral[sub.userId] = {
                    userId: sub.userId,
                    userName: sub.userName || 'Aluno',
                    resolvidos: new Set(),
                    melhoresTemposPorEx: {}
                };
            }

            if (sub.isAccepted) {
                const exId = String(sub.exerciseId);
                alunosGeral[sub.userId].resolvidos.add(exId);
                const t = sub.executionTime || 0;
                if (
                    alunosGeral[sub.userId].melhoresTemposPorEx[exId] === undefined ||
                    t < alunosGeral[sub.userId].melhoresTemposPorEx[exId]
                ) {
                    alunosGeral[sub.userId].melhoresTemposPorEx[exId] = t;
                }
            }
        });

        const rankingGeral = Object.values(alunosGeral).map(a => ({
            userId: a.userId,
            userName: a.userName,
            totalResolvidos: a.resolvidos.size,
            tempoTotalMs: (() => {
                const soma = Object.values(a.melhoresTemposPorEx).reduce((acc, t) => acc + t, 0);
                return soma < 10 ? Number(soma.toFixed(2)) : (soma < 100 ? Number(soma.toFixed(1)) : Math.round(soma));
            })()
        })).sort((a, b) => {
            if (b.totalResolvidos !== a.totalResolvidos) return b.totalResolvidos - a.totalResolvidos;
            return a.tempoTotalMs - b.tempoTotalMs;
        });

        const posGeralIdx = rankingGeral.findIndex(r => String(r.userId) === String(userId));

        const rankingPorExercicio = {};
        exercicios.forEach(ex => {
            const exId = String(ex._id);
            const subsEsteEx = submissoesTurma.filter(s => String(s.exerciseId) === exId && s.isAccepted);
            const mapa = {};
            subsEsteEx.forEach(sub => {
                if (!mapa[sub.userId] || sub.executionTime < mapa[sub.userId].executionTime) {
                    mapa[sub.userId] = {
                        userId: sub.userId,
                        userName: sub.userName || 'Aluno',
                        executionTime: sub.executionTime
                    };
                }
            });
            const ordenados = Object.values(mapa).sort((a, b) => a.executionTime - b.executionTime);
            rankingPorExercicio[exId] = {
                title: ex.title,
                lider: ordenados[0] || null,
                ranking: ordenados
            };
        });

        res.json({
            success: true,
            isEvaluative,
            maxAttempts,
            minhasTentativasEx,
            timeLimit: timeLimitEx,
            statusMeusExercicios,
            exercicio: {
                totalResolvidos: rankingExercicio.length,
                minhaPosicao: minhaPosicaoEx,
                meuTempo: meuTempoEx,
                primeiroLugar: rankingExercicio[0] || null
            },
            geral: {
                minhaPosicaoGeral: posGeralIdx !== -1 ? posGeralIdx + 1 : null,
                totalAlunos: rankingGeral.length,
                rankingCompleto: rankingGeral
            },
            rankingPorExercicio
        });
    } catch (e) {
        console.error("Erro na rota /ranking:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar o ranking." });
    }
});

module.exports = router;