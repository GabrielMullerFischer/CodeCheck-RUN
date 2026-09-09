require("dotenv").config();
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { connectDB } = require('./config/database');
const ltiController = require('./controllers/ltiController');
const judgeController = require('./controllers/judgeController');
const { initMinio } = require('./services/minioService');
const ColetorLixo = require('./services/coletorLixo');
const professorRoutes = require('./routes/professorRoutes');

const app = express();
const server = http.createServer(app);

const gari = new ColetorLixo(
    path.join(__dirname, 'tmp'), 
    Number(process.env.LIMPEZATMP) || 10
);

async function start() {
    try {
        await connectDB();
        console.log("✅ MongoDB Atlas Conectado");

        await initMinio();
        console.log("🚀 Sistema de arquivos MinIO pronto.");

        gari.iniciar();

        app.set('trust proxy', 1);

        app.use(session({
            secret: process.env.SESSION_SECRET || 'chave-secreta-tcc',
            resave: true,
            saveUninitialized: true,
            cookie: { 
                secure: true, 
                sameSite: 'none',
                httpOnly: true
            }
        }));

        await ltiController.setup(app); 

        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(express.static(path.join(__dirname, 'public')));
        app.use('/judge', professorRoutes);
        app.use('/judge', judgeController);

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`🚀 Sistema Online na porta ${PORT} e Sessão Ativa`);
        });

    } catch (error) {
        console.error("❌ FALHA CRÍTICA AO INICIAR O SISTEMA:");
        console.error(error.message);
        process.exit(1);
    }
}

start();