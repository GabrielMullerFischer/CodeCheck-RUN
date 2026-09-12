const express = require('express');
const router = express.Router();

const Exercise = require('../models/Exercise');
const ExerciseList = require('../models/ExerciseList');
const ActivityConfig = require('../models/ActivityConfig');
const Submission = require('../models/Submission');

// Salvar Exercício
router.post('/exercicio', async (req, res) => {
    try {
        const { title, description, tests } = req.body;
        const exercicio = await Exercise.create({ title, description, tests });
        res.json({ success: true, exercicio });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Salvar Nova Lista
router.post('/lista', async (req, res) => {
    try {
        const { title, exercises } = req.body;
        const lista = await ExerciseList.create({ title, exercises });
        res.json({ success: true, lista });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Vincular Lista Selecionada à Atividade
router.post('/atividade/vincular', async (req, res) => {
    try {
        const { activityId, listId, force } = req.body;

        const vinculoAtual = await ActivityConfig.findOne({ activityId });

        if (vinculoAtual && vinculoAtual.listId && String(vinculoAtual.listId) !== String(listId) && !force) {
            return res.json({
                success: false,
                requiresConfirmation: true,
                message: "⚠️ ATENÇÃO: Esta atividade já está configurada com outra lista.\n\nTrocar a lista agora fará com que a turma veja outros exercícios e pode causar perda ou inconsistência nas respostas dos alunos.\n\nDeseja realmente trocar a atividade vinculada?"
            });
        }

        await ActivityConfig.findOneAndUpdate(
            { activityId },
            { listId, updatedAt: new Date() },
            { upsert: true }
        );

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Carregar exercícios da lista vinculada à atividade
router.get('/atividade/exercicios', async (req, res) => {
    try {
        const { activityId, listId } = req.query;

        let targetListId = listId;
        if (!targetListId && activityId) {
            const config = await ActivityConfig.findOne({ activityId });
            if (config) {
                targetListId = config.listId;
            }
        }

        if (!targetListId) {
            return res.status(404).json({ 
                success: false, 
                error: "Nenhuma lista de exercícios foi vinculada a esta atividade ainda." 
            });
        }

        const listaCompleta = await ExerciseList.findById(targetListId).populate('exercises');
        
        if (!listaCompleta) {
            return res.status(404).json({
                success: false,
                error: "A lista vinculada não foi encontrada no banco de dados."
            });
        }

        res.json({
            success: true,
            lista: listaCompleta
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// routes/professorRoutes.js
router.get('/professor/dados', async (req, res) => {
    try {
        const { activityId } = req.query;
        const exercicios = await Exercise.find().sort({ _id: -1 });
        const listas = await ExerciseList.find().populate('exercises').sort({ _id: -1 });
        const vinculo = activityId ? await ActivityConfig.findOne({ activityId }) : null;

        res.json({
            success: true,
            exercicios,
            listas,
            listaVinculadaId: vinculo ? vinculo.listId : null
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Métricas da turma
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

        const submissoes = await Submission.find({ activityId }).sort({ createdAt: -1 }).lean();

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

module.exports = router;