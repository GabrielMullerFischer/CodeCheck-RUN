const express = require('express');
const router = express.Router();
const Question = require('../models/Question');
const minioService = require('../services/minioService');
const judgeService = require('../services/judgeService');

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
    const { code, activityId } = req.body;
    const userId = req.session.userId || "aluno_generico"; 

    if (!activityId) return res.status(400).json({ error: "ID da atividade faltando" });

    try {
        await minioService.salvarCodigo(userId, activityId, code);
        
        const questao = await Question.findOne({ activityId });
        if (!questao) return res.status(404).json({ status: "Questão não configurada." });

        const resultado = await judgeService.runTests(code, questao.tests);
        
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