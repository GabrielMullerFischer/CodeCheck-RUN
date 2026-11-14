require("dotenv").config();
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const mongoose = require('mongoose');
const connectMongo = require('connect-mongo');
const MongoStore = connectMongo.MongoStore || connectMongo.default || connectMongo;
const { connectDB } = require('./config/database');
const { attachAuthContext } = require('./config/authContext');
const ltiController = require('./controllers/ltiController');
const { initMinio } = require('./services/minioService');
const seederService = require('./services/seederService');
const professorRoutes = require('./routes/professorRoutes');
const alunoRoutes = require('./routes/alunoRoutes');
const judgeService = require('./services/judgeService');

const app = express();
const server = http.createServer(app);

async function start() {
    try {
        await connectDB();
        console.log("MongoDB Atlas Conectado");

        await initMinio();
        console.log("Sistema de arquivos MinIO pronto.");

        await seederService.popularBanco();

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
                "https://*.ufpel.edu.br",
                "http://localhost:*",
                "https://localhost:*"
            ];
            if (platformUrl && !frameAncestors.includes(platformUrl)) {
                frameAncestors.push(platformUrl);
            }
            if (process.env.EXTRA_FRAME_ANCESTORS) {
                process.env.EXTRA_FRAME_ANCESTORS.split(/\s+/).filter(Boolean).forEach(origin => {
                    if (!frameAncestors.includes(origin)) frameAncestors.push(origin);
                });
            }

            res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors.join(' ')};`);
            res.removeHeader('X-Frame-Options');
            next();
        });

        if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'chave-secreta-tcc') {
            throw new Error("[FATAL] SESSION_SECRET não configurada ou usando chave pública padrão ('chave-secreta-tcc'). Defina uma chave secreta forte no ambiente (.env ou Kubernetes Secret)!");
        }

        app.use(session({
            secret: process.env.SESSION_SECRET,
            resave: false,
            saveUninitialized: false,
            store: MongoStore.create({
                client: mongoose.connection.getClient(),
                collectionName: 'sessions',
                ttl: 24 * 60 * 60, // 24h com remoção automática (TTL Index nativo do MongoDB)
                autoRemove: 'native',
                touchAfter: 3600 // Evita regravar sessão no banco a cada request se nada mudou (atualiza no máx. 1x por hora)
            }),
            cookie: {
                secure: true,
                sameSite: 'none',
                httpOnly: true,
                maxAge: 24 * 60 * 60 * 1000
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
            console.log(`Sistema Online na porta ${PORT} e Sessão Ativa`);
            judgeService.inicializarPool().catch(err => {
                console.warn("[WarmPool] Aviso ao iniciar pool:", err.message);
            });
        });

        const encerrarGraciosamente = async (sinal) => {
            console.log(`[${sinal}] Sinal de término recebido. Limpando pool de workers e fechando conexões...`);
            try {
                if (typeof judgeService.encerrarPool === 'function') {
                    await judgeService.encerrarPool();
                }
            } catch (err) {
                console.warn('Erro ao limpar pool no desligamento:', err.message);
            }
            server.close(() => {
                console.log('Servidor encerrado com sucesso.');
                process.exit(0);
            });
            setTimeout(() => process.exit(0), 5000).unref();
        };

        process.on('SIGTERM', () => encerrarGraciosamente('SIGTERM'));
        process.on('SIGINT', () => encerrarGraciosamente('SIGINT'));

    } catch (error) {
        console.error("FALHA CRÍTICA AO INICIAR O SISTEMA:");
        console.error(error.message);
        process.exit(1);
    }
}

start();