const express = require('express');
const router = express.Router();
const minioService = require('../services/minioService');
const judgeService = require('../services/judgeService');
const Question = require('../models/Question');
const ActivityConfig = require('../models/ActivityConfig');
const ExerciseList = require('../models/ExerciseList');
const Exercise = require('../models/Exercise');

router.post('/setup', async (req, res) => {
    const isProf = req.body.isProfessor == 'true' || req.body.isProfessor === true || req.session.isProfessor === true;
    const activityId = req.body.activityId;

    if (!isProf || !activityId) {
        return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    try {
        await Question.findOneAndUpdate(
            { activityId },
            { 
                title: req.body.title, 
                description: req.body.description, 
                tests: typeof req.body.tests === 'string' ? JSON.parse(req.body.tests) : req.body.tests 
            },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Erro no setup:", err);
        res.status(500).json({ success: false, error: "Erro no servidor" });
    }
});

router.post('/submit', async (req, res) => {
    const { code, activityId , listId, exerciseId } = req.body;
    const userId = req.session.userId || req.body.userId; 

    if (!activityId) return res.status(400).json({ error: "ID da atividade faltando" });

    try {
        const containerName = `judge_${String(userId).replace(/[^a-zA-Z0-9]/g, '')}`;
        const isRunning = await judgeService.isAlreadyRunning(containerName);
        if (isRunning) {
            return res.status(429).json({ error: "Você já tem uma compilação em andamento." });
        }

        let testesParaExecutar = null;

        const config = await ActivityConfig.findOne({ activityId }).populate({
            path: 'listId',
            populate: { path: 'exercises' }
        });

        if (config && config.listId && config.listId.exercises && config.listId.exercises.length > 0) {
            // Se veio um exerciseId específico selecionado pelo aluno, usa ele; senão pega o primeiro da lista
            const exercicioAlvo = exerciseId
                ? config.listId.exercises.find(e => String(e._id) === String(exerciseId))
                : config.listId.exercises[0];

            if (exercicioAlvo) {
                testesParaExecutar = exercicioAlvo.tests;
            }
        }

        // 2. Fallback: Se não encontrou na estrutura nova, busca na tabela antiga Question
        if (!testesParaExecutar || testesParaExecutar.length === 0) {
            const questaoLegada = await Question.findOne({ activityId });
            if (questaoLegada) {
                testesParaExecutar = questaoLegada.tests;
            }
        }

        if (!testesParaExecutar || testesParaExecutar.length === 0) {
            return res.status(404).json({ error: "Nenhum caso de teste configurado para esta atividade." });
        }

        await minioService.salvarCodigo(userId, activityId, code);

        // Executa a validação no container Docker
        const resultado = await judgeService.runTests(code, testesParaExecutar, containerName);
        
        res.json(resultado);
    } catch (err) {
        console.error("Erro na submissão:", err);
        res.status(500).json({ error: "Erro no motor de correção" });
    }
});

router.get('/get-draft', async (req, res) => {
    const { activityId } = req.query;
    const userId = req.session.userId;
    if (!userId || !activityId) return res.status(400).json({ error: "Dados ausentes" });

    try {
        const codigo = await minioService.lerCodigo(userId, activityId);
        res.json({ code: codigo });
    } catch (e) {
        res.status(404).json({ error: "Sem rascunho" });
    }
});

module.exports = router;