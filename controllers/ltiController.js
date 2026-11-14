const path = require('path');
const fs = require('fs');
const lti = require('ltijs').Provider;
const ActivityConfig = require('../models/ActivityConfig');
const ExerciseList = require('../models/ExerciseList');
const ActivityAttempt = require('../models/ActivityAttempt');
const { construirAuthContext, extrairRolesIsProfessor, comporIdentificadorAtividade } = require('../config/authContext');

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function renderTemplate(res, req, userName, activityId) {
    try {
        const auth = construirAuthContext(req, res);
        const isProf = auth.isProfessor === true;
        const isPreview = isProf && req.query.mode === 'preview';
        const arquivo = (!isProf || isPreview) ? 'aluno.html' : 'professor.html';
        const templatePath = path.resolve(__dirname, `../views/${arquivo}`);
        const ltikVal = (res.locals && res.locals.ltik) ? String(res.locals.ltik) : (auth.ltik || '');

        let exercicioAtual = null;
        let configAtividade = null;

        if (isProf && req.query.listId) {
            const listaPreview = await ExerciseList.findById(req.query.listId).populate('exercises');
            const podeAcessarLista = listaPreview && (
                listaPreview.isPublic !== false ||
                !auth.userId ||
                String(listaPreview.authorId) === String(auth.userId)
            );
            if (podeAcessarLista && listaPreview.exercises && listaPreview.exercises.length > 0) {
                exercicioAtual = listaPreview.exercises[0];
            }
        }

        if (!exercicioAtual && activityId) {
            configAtividade = await ActivityConfig.findOne({ activityId }).populate({
                path: 'listId',
                populate: { path: 'exercises' }
            });
            if (configAtividade && configAtividade.listId && configAtividade.listId.exercises && configAtividade.listId.exercises.length > 0) {
                exercicioAtual = configAtividade.listId.exercises[0];
            }
        }

        // Se for aluno em atividade cronometrada que ainda não iniciou o cronômetro,
        // NÃO enviamos o enunciado ou o exemplo de teste no HTML inicial (evita leitura prévia via F12/Elements).
        let precisaIniciarTimer = false;
        if (!isProf && !isPreview && configAtividade && configAtividade.hasTimeLimit && activityId && activityId !== 'preview') {
            const userId = auth.userId;
            const attempt = await ActivityAttempt.findOne({ userId, activityId });
            if (!attempt) {
                precisaIniciarTimer = true;
            }
        }

        let exemploTexto = "Nenhum exemplo disponível.";
        if (precisaIniciarTimer) {
            exemploTexto = "Disponível após o início da atividade.";
        } else if (exercicioAtual && exercicioAtual.tests) {
            try {
                const testes = typeof exercicioAtual.tests === 'string'
                    ? JSON.parse(exercicioAtual.tests)
                    : exercicioAtual.tests;
                if (Array.isArray(testes) && testes.length > 0) {
                    const visiveis = testes.filter(t => t.isVisible === true);
                    const testesExibir = visiveis.length > 0 ? visiveis.slice(0, 3) : [testes[0]];
                    exemploTexto = testesExibir.map((t, idx) => {
                        const prefixo = testesExibir.length > 1 ? `Exemplo #${idx + 1}: ` : '';
                        return `${prefixo}Entrada(s): ${t.input || '(vazio)'} | Saída Esperada: ${t.output || ''}`;
                    }).join(' | ');
                }
            } catch (jsonErr) { }
        }

        const tituloFinal = precisaIniciarTimer
            ? "Atividade Cronometrada"
            : (exercicioAtual ? exercicioAtual.title : "Questão não configurada");

        const descFinal = precisaIniciarTimer
            ? "Esta atividade possui contagem de tempo. Clique no botão 'Iniciar Atividade' no aviso para iniciar o cronômetro e liberar as questões."
            : (exercicioAtual ? exercicioAtual.description : "Aguardando enunciado pelo professor.");

        fs.readFile(templatePath, 'utf8', (err, html) => {
            if (err) return res.status(500).send("Erro ao carregar HTML.");

            let finalHtml = html
                .replace(/{{LTIK_TOKEN}}/g, escapeHtml(ltikVal))
                .replace(/{{NOME_USUARIO}}/g, escapeHtml(userName))
                .replace(/{{NOME_QUESTAO}}/g, escapeHtml(tituloFinal))
                .replace(/{{DESCRICAO_QUESTAO}}/g, escapeHtml(descFinal))
                .replace(/{{TITULO_QUESTAO_VAL}}/g, escapeHtml(tituloFinal))
                .replace(/{{DESCRICAO_QUESTAO_VAL}}/g, escapeHtml(descFinal))
                .replace(/{{IS_PROFESSOR_VAL}}/g, isProf ? 'true' : 'false')
                .replace(/{{ACTIVITY_ID}}/g, escapeHtml(activityId))
                .replace(/{{EXEMPLO_QUESTAO}}/g, escapeHtml(exemploTexto));

            res.send(finalHtml);
        });
    } catch (error) {
        console.error("Erro no renderTemplate:", error);
        res.status(500).send("Erro interno nos dados.");
    }
}

async function setup(app) {
    await lti.setup(process.env.LTI_ENCRYPTION_KEY,
        { url: process.env.MONGO_DB_URI },
        {
            cookies: { secure: true, sameSite: 'None' },
            devMode: process.env.NODE_ENV === 'development' || process.env.LTI_DEV_MODE === 'true'
        }
    );

    await lti.deploy({ port: parseInt(process.env.PORT) + 1 });

    try {
        await lti.registerPlatform({
            url: process.env.LTI_PLATFORM_URL,
            name: process.env.LTI_PLATFORM_NAME,
            clientId: process.env.LTI_CLIENT_ID,
            authenticationEndpoint: process.env.LTI_AUTH_ENDPOINT,
            accesstokenEndpoint: process.env.LTI_TOKEN_ENDPOINT,
            authConfig: {
                method: 'JWK_SET',
                key: process.env.LTI_KEYSET_ENDPOINT
            }
        });
        console.log("✅ Plataforma registrada/verificada.");
    } catch (err) {
        console.log("ℹ️ Plataforma já estava registrada.");
    }

    lti.whitelist(
        { route: '/healthz', method: 'get' },
        { route: '/js/aluno.js', method: 'get' },
        { route: '/js/professor.js', method: 'get' },
        { route: '/favicon.ico', method: 'get' }
    );

    app.use(lti.app);

    lti.onConnect(async (token, req, res) => {
        const roles = token.platformContext.roles || [];
        const isProf = extrairRolesIsProfessor(roles);

        const rawActivityId = token.platformContext?.resource?.id ? String(token.platformContext.resource.id) : '';
        const courseId = token.platformContext?.context?.id ? String(token.platformContext.context.id) : '';
        const userName = token.userInfo?.name || token.userInfo?.given_name || (isProf ? 'Professor' : 'Aluno');

        const activityId = comporIdentificadorAtividade(rawActivityId, courseId);

        req.session.userId = token.user;
        req.session.isProfessor = !!isProf;
        req.session.activityId = activityId;
        req.session.rawActivityId = rawActivityId;
        req.session.courseId = courseId;
        req.session.userName = userName;
        req.auth = construirAuthContext(req, res);

        console.log(`[LOGIN] ${userName} logado como ${isProf ? 'Professor' : 'Aluno'} (Disciplina: ${courseId || 'N/A'} | Atividade: ${activityId})`);

        req.session.save(() => {
            renderTemplate(res, req, userName, activityId);
        });
    });
}

module.exports = { setup };