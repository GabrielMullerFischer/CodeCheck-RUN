const express = require('express');
const router = express.Router();
const minioService = require('../services/minioService');
const judgeService = require('../services/judgeService');
const ActivityConfig = require('../models/ActivityConfig');
const ExerciseList = require('../models/ExerciseList');
const Exercise = require('../models/Exercise');
const Submission = require('../models/Submission');

router.post('/submit', async (req, res) => {
    const { code, activityId, listId, exerciseId, draftOnly } = req.body;
    const userId = req.session?.userId || req.body.userId || 'preview_user';
    const userName = req.session?.userName || req.body.userName || 'Aluno';

    if (!activityId && !listId) {
        return res.status(400).json({ error: "ID da atividade ou lista faltando." });
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

        await minioService.salvarRascunho(userId, activityId || 'preview', idExercicioFinal, code);

        if (draftOnly) {
            return res.json({ success: true, draftSaved: true });
        }

        const containerName = `judge_${String(userId).replace(/[^a-zA-Z0-9]/g, '')}`;
        const isRunning = await judgeService.isAlreadyRunning(containerName);
        if (isRunning) {
            return res.status(429).json({ error: "Você já tem uma compilação em andamento." });
        }

        const inicioExec = Date.now();
        const resultado = await judgeService.runTests(code, testesParaExecutar, containerName);
        const tempoGastoMs = Date.now() - inicioExec;

        const isAccepted = resultado.status === 'Accepted';

        const isProfessor = req.session?.isProfessor === true || userId === 'professor_test' || userId === 'preview_user';
        if (isProfessor) {
            return res.json({
                ...resultado,
                executionTime: tempoGastoMs
            });
        }

        const caminhoMinio = await minioService.arquivarSubmissao(
            userId, 
            activityId || 'preview', 
            idExercicioFinal, 
            isAccepted, 
            code
        );

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

        if (isAccepted) {
            const acertos = await Submission.find({
                userId,
                activityId: activityId || 'preview',
                exerciseId: idExercicioFinal,
                isAccepted: true
            }).sort({ createdAt: 1 });

            if (acertos.length > 5) {
                // Localiza o menor tempo para não apagar
                let recorde = acertos[0];
                for (const sub of acertos) {
                    if (sub.executionTime !== null && (recorde.executionTime === null || sub.executionTime < recorde.executionTime)) {
                        recorde = sub;
                    }
                }

                // Apaga os mais antigos, pulando o que tem melhor tempo
                const descartaveis = acertos.filter(s => String(s._id) !== String(recorde._id));
                const qtdRemover = acertos.length - 5;
                const paraExcluir = descartaveis.slice(0, qtdRemover);

                for (const subEx of paraExcluir) {
                    await minioService.removerArquivo(subEx.codePath);
                    await Submission.findByIdAndDelete(subEx._id);
                }
            }
        } else {
            const erros = await Submission.find({
                userId,
                activityId: activityId || 'preview',
                exerciseId: idExercicioFinal,
                isAccepted: false
            }).sort({ createdAt: 1 });

            if (erros.length > 5) {
                const qtdRemover = erros.length - 5;
                const paraExcluir = erros.slice(0, qtdRemover);

                for (const subEx of paraExcluir) {
                    await minioService.removerArquivo(subEx.codePath);
                    await Submission.findByIdAndDelete(subEx._id);
                }
            }
        }

        res.json({
            ...resultado,
            executionTime: tempoGastoMs
        });
    } catch (err) {
        console.error("Erro na submissão:", err);
        res.status(500).json({ error: "Erro no motor de correção: " + err.message });
    }
});

router.get('/get-draft', async (req, res) => {
    const { activityId, exerciseId } = req.query;
    const userId = req.session?.userId || 'preview_user';
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
    const userId = req.session?.userId || 'preview_user';

    try {
        if (!activityId) return res.status(400).json({ success: false, error: "activityId ausente." });

        const submissoes = await Submission.find({ activityId }).lean();

        const statusMeusExercicios = {};
        submissoes.filter(s => s.userId === userId).forEach(s => {
            const exId = String(s.exerciseId);
            if (s.isAccepted) {
                statusMeusExercicios[exId] = 'accepted';
            } else if (statusMeusExercicios[exId] !== 'accepted') {
                statusMeusExercicios[exId] = 'wrong';
            }
        });

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

        const alunosGeral = {};
        submissoes.forEach(sub => {
            if (!alunosGeral[sub.userId]) {
                alunosGeral[sub.userId] = {
                    userId: sub.userId,
                    userName: sub.userName || 'Aluno',
                    resolvidos: new Set(),
                    tempoTotalMs: 0
                };
            }

            if (sub.isAccepted) {
                alunosGeral[sub.userId].resolvidos.add(String(sub.exerciseId));
                if (sub.executionTime) {
                    alunosGeral[sub.userId].tempoTotalMs += sub.executionTime;
                }
            }
        });

        const rankingGeral = Object.values(alunosGeral).map(a => ({
            userId: a.userId,
            userName: a.userName,
            totalResolvidos: a.resolvidos.size,
            tempoTotalMs: a.tempoTotalMs
        })).sort((a, b) => {
            if (b.totalResolvidos !== a.totalResolvidos) {
                return b.totalResolvidos - a.totalResolvidos;
            }
            return a.tempoTotalMs - b.tempoTotalMs;
        });

        const posGeralIdx = rankingGeral.findIndex(r => r.userId === userId);

        res.json({
            success: true,
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
            }
        });
    } catch (e) {
        console.error("Erro na rota /ranking:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Dados e Métricas da Turma
router.get('/professor/turma-metricas', async (req, res) => {
    try {
        const { activityId } = req.query;
        if (!activityId) return res.status(400).json({ success: false, error: "activityId ausente." });

        const config = await ActivityConfig.findOne({ activityId }).populate({
            path: 'listId',
            populate: { path: 'exercises' }
        });

        if (!config || !config.listId) {
            return res.json({ success: false, semVinculo: true, message: "Vincule uma lista a esta atividade primeiro." });
        }

        const exercicios = config.listId.exercises || [];
        const mapaExercicios = {};
        exercicios.forEach(ex => {
            mapaExercicios[String(ex._id)] = ex.title;
        });

        const submissoes = await Submission.find({ 
            activityId, 
            userId: { $nin: ['professor_test', 'preview_user'] } 
        }).sort({ createdAt: -1 }).lean();

        // Taxa de Acertos por Exercício
        const metricasExercicios = exercicios.map(ex => {
            const subsEx = submissoes.filter(s => String(s.exerciseId) === String(ex._id));
            const totalEnvios = subsEx.length;
            const enviosAceitos = subsEx.filter(s => s.isAccepted).length;
            const alunosQueResolveram = new Set(subsEx.filter(s => s.isAccepted).map(s => s.userId)).size;
            const taxaAcerto = totalEnvios > 0 ? Math.round((enviosAceitos / totalEnvios) * 100) : 0;

            return {
                exerciseId: ex._id,
                title: ex.title,
                totalEnvios,
                enviosAceitos,
                alunosQueResolveram,
                taxaAcerto
            };
        });

        const alunosMap = {};
        submissoes.forEach(sub => {
            if (!alunosMap[sub.userId]) {
                alunosMap[sub.userId] = {
                    userId: sub.userId,
                    userName: sub.userName || 'Aluno',
                    resolvidos: new Set(),
                    melhoresTemposPorEx: {},
                    submissoesAcertos: [],
                    submissoesErros: [],
                    ultimaAtividade: sub.createdAt
                };
            }

            const itemSub = {
                _id: sub._id,
                exerciseId: sub.exerciseId,
                exerciseTitle: mapaExercicios[String(sub.exerciseId)] || 'Exercício',
                status: sub.status,
                isAccepted: sub.isAccepted,
                executionTime: typeof sub.executionTime === 'number' ? sub.executionTime : 0,
                codePath: sub.codePath,
                createdAt: sub.createdAt
            };

            if (sub.isAccepted) {
                alunosMap[sub.userId].resolvidos.add(String(sub.exerciseId));
                alunosMap[sub.userId].submissoesAcertos.push(itemSub);

                const tempoAtual = typeof sub.executionTime === 'number' ? sub.executionTime : 0;
                if (
                    alunosMap[sub.userId].melhoresTemposPorEx[sub.exerciseId] === undefined ||
                    tempoAtual < alunosMap[sub.userId].melhoresTemposPorEx[sub.exerciseId]
                ) {
                    alunosMap[sub.userId].melhoresTemposPorEx[sub.exerciseId] = tempoAtual;
                }
            } else {
                alunosMap[sub.userId].submissoesErros.push(itemSub);
            }
        });

        const ranking = Object.values(alunosMap).map(aluno => {
            const tempoTotalMs = Object.values(aluno.melhoresTemposPorEx).reduce((acc, t) => acc + t, 0);
            return {
                userId: aluno.userId,
                userName: aluno.userName,
                totalResolvidos: aluno.resolvidos.size,
                tempoTotalMs,
                ultimaAtividade: aluno.ultimaAtividade,
                submissoesAcertos: aluno.submissoesAcertos,
                submissoesErros: aluno.submissoesErros,
                totalTentativas: aluno.submissoesAcertos.length + aluno.submissoesErros.length
            };
        }).sort((a, b) => {
            if (b.totalResolvidos !== a.totalResolvidos) return b.totalResolvidos - a.totalResolvidos;
            return a.tempoTotalMs - b.tempoTotalMs;
        });

        res.json({
            success: true,
            totalExercicios: exercicios.length,
            metricasExercicios,
            ranking
        });
    } catch (e) {
        console.error("Erro nas métricas:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Leitura do Código no MinIO
router.get('/professor/submissao-codigo', async (req, res) => {
    try {
        const { codePath } = req.query;
        if (!codePath) return res.status(400).json({ error: "Caminho ausente." });

        const codigo = await minioService.lerArquivoPorPath(codePath);
        res.json({ success: true, code: codigo });
    } catch (e) {
        res.status(404).json({ error: "Código não encontrado no MinIO." });
    }
});

module.exports = router;