const express = require('express');
const router = express.Router();
const minioService = require('../services/minioService');
const judgeService = require('../services/judgeService');
const ActivityConfig = require('../models/ActivityConfig');
const ExerciseList = require('../models/ExerciseList');
const Exercise = require('../models/Exercise');
const Submission = require('../models/Submission');

const MAX_TIME_LIMIT_MS = parseInt(process.env.MAX_EXECUTION_TIME_LIMIT_MS, 10) || 7200000;
const DEFAULT_TIME_LIMIT_MS = parseInt(process.env.DEFAULT_EXECUTION_TIME_LIMIT_MS, 10) || 1000;

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
        return "Tempo limite excedido: Seu programa demorou mais que o permitido para responder. Verifique se não há laços infinitos (como 'while(1)') ou se a condição de parada do laço está correta.";
    }
    return null;
}

// Submissão oficial
router.post('/submit', async (req, res) => {
    const { code, activityId, listId, exerciseId, draftOnly } = req.body;
    const userId = req.session?.userId || req.body.userId || 'preview_user';
    const userName = req.session?.userName || req.body.userName || (userId === 'preview_user' ? 'Professor (Preview)' : 'Aluno');

    if (!activityId && !listId && !exerciseId) {
        return res.status(400).json({ error: "ID da atividade, lista ou exercício faltando." });
    }

    try {
        let exercicioAlvo = null;
        if (exerciseId) {
            exercicioAlvo = await Exercise.findById(exerciseId);
        }
        if (!exercicioAlvo && listId) {
            const lista = await ExerciseList.findById(listId).populate('exercises');
            if (lista?.exercises?.length > 0) exercicioAlvo = lista.exercises[0];
        }
        if (!exercicioAlvo && activityId) {
            const config = await ActivityConfig.findOne({ activityId }).populate({
                path: 'listId',
                populate: { path: 'exercises' }
            });
            if (config?.listId?.exercises?.length > 0) exercicioAlvo = config.listId.exercises[0];
        }

        let testesParaExecutar = exercicioAlvo ? exercicioAlvo.tests : null;
        if (!testesParaExecutar || testesParaExecutar.length === 0) {
            return res.status(404).json({ error: "Nenhum teste encontrado para esta questão." });
        }

        const idExercicioFinal = exercicioAlvo._id;

        let timeLimit = exercicioAlvo.timeLimit;
        if (!timeLimit || isNaN(timeLimit)) {
            timeLimit = DEFAULT_TIME_LIMIT_MS;
        } else if (timeLimit > MAX_TIME_LIMIT_MS) {
            timeLimit = MAX_TIME_LIMIT_MS;
        }

        const isProfessorReal = req.session?.isProfessor === true || userId === 'professor_test';

        // Validação de limite de tentativas apenas para alunos reais em atividades avaliativas
        if (!isProfessorReal && userId !== 'preview_user' && activityId && activityId !== 'preview') {
            const configAtividade = await ActivityConfig.findOne({ activityId });
            if (configAtividade && configAtividade.isEvaluative) {
                const totalTentativas = await Submission.countDocuments({
                    userId,
                    activityId,
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

        await minioService.salvarRascunho(userId, activityId || 'preview', idExercicioFinal, code);

        if (draftOnly) {
            return res.json({ success: true, draftSaved: true });
        }

        const containerName = `judge_${String(userId).replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;
        const isRunning = await judgeService.isAlreadyRunning(containerName);
        if (isRunning) {
            return res.status(429).json({ error: "Você já tem uma compilação em andamento." });
        }

        const inicioExec = Date.now();
        const resultado = await judgeService.runTests(code, testesParaExecutar, containerName, timeLimit);
        const tempoGastoMs = Date.now() - inicioExec;

        const isAccepted = resultado.status === 'Accepted';
        const dicaDidatica = gerarDicaDidatica(resultado.status, resultado.details, resultado.got);

        // Apenas o teste interno não grava histórico
        if (userId === 'professor_test') {
            return res.json({
                ...resultado,
                executionTime: tempoGastoMs,
                didacticHint: dicaDidatica
            });
        }

        // Busca o código do melhor tempo para imunizar da remoção
        const melhorEnvio = await Submission.findOne({
            userId,
            activityId: activityId || 'preview',
            exerciseId: idExercicioFinal,
            isAccepted: true
        }).sort({ executionTime: 1 }).select('codePath').lean();

        const melhorCodePath = melhorEnvio ? melhorEnvio.codePath : null;

        // Salva a submissão no MinIO protegendo o menor tempo
        const caminhoMinio = await minioService.arquivarSubmissao(
            userId, 
            activityId || 'preview', 
            idExercicioFinal, 
            isAccepted, 
            code,
            melhorCodePath
        );

        // Grava no MongoDB
        await Submission.create({
            userId,
            userName,
            activityId: activityId || 'preview',
            exerciseId: idExercicioFinal,
            codePath: caminhoMinio,
            status: resultado.status,
            isAccepted,
            executionTime: isAccepted ? tempoGastoMs : null
        });

        res.json({
            ...resultado,
            executionTime: tempoGastoMs,
            didacticHint: dicaDidatica
        });
    } catch (err) {
        console.error("Erro na submissão:", err);
        res.status(500).json({ error: "Erro no motor de correção: " + err.message });
    }
});

// Execução livre com entrada customizada do aluno (sem gravar histórico)
router.post('/test-custom', async (req, res) => {
    const { code, input, exerciseId, activityId } = req.body;
    const userId = req.session?.userId || req.body.userId || 'preview_user';
    const isProfessor = req.session?.isProfessor === true || userId === 'professor_test' || userId === 'preview_user';

    if (!code) return res.status(400).json({ error: "Código vazio." });

    try {
        if (!isProfessor && activityId && activityId !== 'preview') {
            const configAtividade = await ActivityConfig.findOne({ activityId });
            if (configAtividade && configAtividade.isEvaluative) {
                return res.status(403).json({ 
                    error: "A depuração com entradas livres está desativada para atividades com limite de tentativas." 
                });
            }
        }

        let timeLimit = DEFAULT_TIME_LIMIT_MS;
        if (exerciseId) {
            const ex = await Exercise.findById(exerciseId).lean();
            if (ex && ex.timeLimit) timeLimit = ex.timeLimit;
        }

        const containerName = `test_${String(userId).replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;
        const isRunning = await judgeService.isAlreadyRunning(containerName);
        if (isRunning) {
            return res.status(429).json({ error: "Você já tem uma compilação em andamento." });
        }

        const testes = [{ input: input || '', output: '' }];
        const inicioExec = Date.now();
        const resultado = await judgeService.runTests(code, testes, containerName, timeLimit);
        const tempoGastoMs = Date.now() - inicioExec;

        const dicaDidatica = gerarDicaDidatica(resultado.status, resultado.details, resultado.got);

        res.json({
            success: true,
            status: resultado.status === 'Accepted' ? 'Success' : resultado.status,
            output: resultado.got || '',
            details: resultado.details || '',
            executionTime: tempoGastoMs,
            didacticHint: dicaDidatica
        });
    } catch (err) {
        res.status(500).json({ error: "Erro ao executar teste: " + err.message });
    }
});

// Lista de submissões do aluno
router.get('/aluno/submissoes', async (req, res) => {
    const { activityId, exerciseId } = req.query;
    const userId = req.session?.userId || req.query.userId || 'preview_user';

    if (!exerciseId) return res.status(400).json({ success: false, error: "exerciseId ausente." });

    try {
        const ultimasSubmissoes = await Submission.find({
            userId,
            activityId: activityId || 'preview',
            exerciseId
        })
        .sort({ createdAt: -1 })
        .limit(MAX_SUBMISSION_HISTORY)
        .select('_id status isAccepted executionTime createdAt codePath')
        .lean();

        const submissoes = ultimasSubmissoes.reverse();

        res.json({ success: true, submissoes });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Carregamento sob demanda do código de uma submissão passada
router.get('/aluno/submissao-codigo', async (req, res) => {
    const { submissionId } = req.query;
    const userId = req.session?.userId || req.query.userId || 'preview_user';
    const isProfessor = req.session?.isProfessor === true || userId === 'preview_user';

    try {
        const sub = await Submission.findById(submissionId);
        if (!sub) return res.status(404).json({ error: "Submissão não encontrada." });

        if (sub.userId !== userId && !isProfessor) {
            return res.status(403).json({ error: "Não autorizado a acessar esta submissão." });
        }

        const codigo = await minioService.lerArquivoPorPath(sub.codePath);
        res.json({ success: true, code: codigo });
    } catch (e) {
        res.status(404).json({ error: "Erro ao carregar código do MinIO." });
    }
});

router.get('/get-draft', async (req, res) => {
    const { activityId, exerciseId } = req.query;
    const userId = req.session?.userId || req.query.userId || 'preview_user';
    if (!activityId || !exerciseId) return res.status(400).json({ error: "Dados ausentes" });

    try {
        const codigo = await minioService.lerRascunho(userId, activityId, exerciseId);
        res.json({ code: codigo });
    } catch (e) {
        res.status(404).json({ error: "Sem rascunho salvo para este exercício." });
    }
});

router.get('/ranking', async (req, res) => {
    const { activityId, exerciseId } = req.query;
    const userId = req.session?.userId || req.query.userId || 'preview_user';

    try {
        const submissoes = activityId && activityId !== 'preview' 
            ? await Submission.find({ activityId, userId: { $nin: ['professor_test', 'preview_user'] } }).lean() 
            : [];

        const configAtividade = activityId && activityId !== 'preview' 
            ? await ActivityConfig.findOne({ activityId }).populate({
                path: 'listId',
                populate: { path: 'exercises' }
            }).lean() 
            : null;

        const isEvaluative = configAtividade ? !!configAtividade.isEvaluative : false;
        const maxAttempts = configAtividade && configAtividade.maxAttempts ? configAtividade.maxAttempts : 3;
        const exercicios = configAtividade?.listId?.exercises || [];

        let minhasTentativasEx = 0;
        let timeLimitEx = null;

        if (exerciseId) {
            minhasTentativasEx = submissoes.filter(s => s.userId === userId && String(s.exerciseId) === String(exerciseId)).length;
            const exObj = await Exercise.findById(exerciseId).lean();
            if (exObj && exObj.timeLimit) timeLimitEx = exObj.timeLimit;
        }

        const statusMeusExercicios = {};
        submissoes.filter(s => s.userId === userId).forEach(s => {
            const exId = String(s.exerciseId);
            if (s.isAccepted) {
                statusMeusExercicios[exId] = 'accepted';
            } else if (statusMeusExercicios[exId] !== 'accepted') {
                statusMeusExercicios[exId] = 'wrong';
            }
        });

        // Estatísticas do exercício ativo na tela
        let rankingExercicio = [];
        let minhaPosicaoEx = null;
        let meuTempoEx = null;

        if (exerciseId) {
            const subsEx = submissoes.filter(s => String(s.exerciseId) === String(exerciseId) && s.isAccepted);
            const melhoresPorAluno = {};

            subsEx.forEach(sub => {
                if (!melhoresPorAluno[sub.userId] || sub.executionTime < melhoresPorAluno[sub.userId].executionTime) {
                    melhoresPorAluno[sub.userId] = {
                        userId: sub.userId,
                        userName: sub.userName || 'Aluno',
                        executionTime: sub.executionTime
                    };
                }
            });

            rankingExercicio = Object.values(melhoresPorAluno).sort((a, b) => a.executionTime - b.executionTime);
            const posIdx = rankingExercicio.findIndex(r => r.userId === userId);
            if (posIdx !== -1) {
                minhaPosicaoEx = posIdx + 1;
                meuTempoEx = rankingExercicio[posIdx].executionTime;
            }
        }

        // Classificação Geral da Lista Completa
        const alunosGeral = {};
        submissoes.forEach(sub => {
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
            tempoTotalMs: Object.values(a.melhoresTemposPorEx).reduce((acc, t) => acc + t, 0)
        })).sort((a, b) => {
            if (b.totalResolvidos !== a.totalResolvidos) return b.totalResolvidos - a.totalResolvidos;
            return a.tempoTotalMs - b.tempoTotalMs;
        });

        const posGeralIdx = rankingGeral.findIndex(r => r.userId === userId);

        // Classificação por Exercício
        const rankingPorExercicio = {};
        exercicios.forEach(ex => {
            const exId = String(ex._id);
            const subsEsteEx = submissoes.filter(s => String(s.exerciseId) === exId && s.isAccepted);
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
        console.error("Erro na rota /ranking:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;