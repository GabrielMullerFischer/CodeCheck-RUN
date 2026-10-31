require("dotenv").config();
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { connectDB } = require('./config/database');
const { attachAuthContext } = require('./config/authContext');
const ltiController = require('./controllers/ltiController');
const { initMinio } = require('./services/minioService');
const ColetorLixo = require('./services/coletorLixo');
const seederService = require('./services/seederService');
const professorRoutes = require('./routes/professorRoutes');
const alunoRoutes = require('./routes/alunoRoutes');
const judgeService = require('./services/judgeService');

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

        await seederService.popularBanco();

        gari.iniciar();

        app.set('trust proxy', 1);

        app.get('/healthz', (req, res) => {
            res.status(200).json({ status: 'ok', uptime: process.uptime() });
        });

        // Middleware de cabeçalhos de segurança HTTP (compatível com Moodle e Tailscale)
        app.use((req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

            const platformUrl = process.env.LTI_PLATFORM_URL ? process.env.LTI_PLATFORM_URL.trim() : '';
            const frameAncestors = [
                "'self'",
                "https://*.ts.net",
                "https://*.ngrok-free.app",
                "https://*.ngrok.io",
                "https://*.ufpel.edu.br",
                "http://localhost:*",
                "https://localhost:*"
            ];
            if (platformUrl && !frameAncestors.includes(platformUrl)) {
                frameAncestors.push(platformUrl);
            }

            res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors.join(' ')};`);
            res.removeHeader('X-Frame-Options');
            next();
        });

        if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'chave-secreta-tcc') {
            throw new Error("❌ [FATAL] SESSION_SECRET não configurada ou usando chave pública padrão ('chave-secreta-tcc'). Defina uma chave secreta forte no ambiente (.env ou Kubernetes Secret)!");
        }

        app.use(session({
            secret: process.env.SESSION_SECRET,
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: true,
                sameSite: 'none',
                httpOnly: true,
                maxAge: 24 * 60 * 60 * 1000 // Expira em 24h para evitar acúmulo no MemoryStore
            }
        }));

        await ltiController.setup(app);
        app.use(attachAuthContext);

        app.use(express.json({ limit: '1mb' }));
        app.use(express.urlencoded({ extended: true, limit: '1mb' }));
        app.use(express.static(path.join(__dirname, 'public')));
        app.use('/judge', alunoRoutes);
        app.use('/judge', professorRoutes);

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`🚀 Sistema Online na porta ${PORT} e Sessão Ativa`);
            judgeService.inicializarPool().catch(err => {
                console.warn("⚠️ [WarmPool] Aviso ao iniciar pool:", err.message);
            });
        });

        process.on('SIGTERM', () => {
            console.log('🛑 [SIGTERM] Sinal de término recebido do Kubernetes. Fechando conexões...');
            server.close(() => {
                console.log('👋 Servidor encerrado com sucesso.');
                process.exit(0);
            });
        });

    } catch (error) {
        console.error("❌ FALHA CRÍTICA AO INICIAR O SISTEMA:");
        console.error(error.message);
        process.exit(1);
    }
}

start();