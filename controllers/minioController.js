const express = require('express');
const router = express.Router();
const minioService = require('../services/minioService'); 

const getUserId = (req) => req.session.userId || (process.env.NODE_ENV === 'development' ? 'devUser' : null);

router.get('/backups', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Sessão inválida." });

    try {
        const arquivos = await minioService.listarArquivos(userId);
        res.json(arquivos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/backups', async (req, res) => {
    const userId = getUserId(req);
    const { nomeCompleto } = req.body; 

    try {
        if(!userId) return res.status(401).json({error: "Não autorizado"});
        await minioService.deletarArquivo(userId, nomeCompleto);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;