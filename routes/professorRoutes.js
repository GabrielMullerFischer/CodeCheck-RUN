const express = require('express');
const router = express.Router();

const Exercise = require('../models/Exercise');
const ExerciseList = require('../models/ExerciseList');
const ActivityConfig = require('../models/ActivityConfig');

// Carregar dados - Listas e Exercícios
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

module.exports = router;