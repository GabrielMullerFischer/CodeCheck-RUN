const path = require('path');
const fs = require('fs');
const lti = require('ltijs').Provider;
const ActivityConfig = require('../models/ActivityConfig');
const ExerciseList = require('../models/ExerciseList');


async function renderTemplate(res, req, userName, activityId) { 
    try {
        const isProf = req.session.isProfessor === true;
        const isPreview = req.query.mode === 'preview';
        const arquivo = (!isProf || isPreview) ? 'aluno.html' : 'professor.html';
        const templatePath = path.resolve(__dirname, `../views/${arquivo}`);
        const ltikVal = req.query.ltik || (res.locals && (res.locals.ltik || res.locals.token)) || '';

        let exercicioAtual = null;
        if (req.query.listId) {
            const listaPreview = await ExerciseList.findById(req.query.listId).populate('exercises');
            if (listaPreview && listaPreview.exercises && listaPreview.exercises.length > 0) {
                exercicioAtual = listaPreview.exercises[0];
            }
        }

        if (!exercicioAtual && activityId) {
            const config = await ActivityConfig.findOne({ activityId }).populate({
                path: 'listId',
                populate: { path: 'exercises' }
            });
            if (config && config.listId && config.listId.exercises && config.listId.exercises.length > 0) {
                exercicioAtual = config.listId.exercises[0];
            }
        }

        let exemploTexto = "Nenhum exemplo disponível.";
        if (exercicioAtual && exercicioAtual.tests) {
            try {
                const testes = typeof exercicioAtual.tests === 'string' 
                    ? JSON.parse(exercicioAtual.tests) 
                    : exercicioAtual.tests;
                if (Array.isArray(testes) && testes.length > 0) {
                    exemploTexto = `Entrada(s): ${testes[0].input || '(vazio)'} | Saída Esperada: ${testes[0].output || ''}`;
                }
            } catch (jsonErr) {}
        }

        const tituloFinal = exercicioAtual ? exercicioAtual.title : "Questão não configurada";
        const descFinal = exercicioAtual ? exercicioAtual.description : "Aguardando enunciado pelo professor.";

        fs.readFile(templatePath, 'utf8', (err, html) => {
            if (err) return res.status(500).send("Erro ao carregar HTML.");

            let finalHtml = html
                .replace(/{{LTIK_TOKEN}}/g, ltikVal)
                .replace(/{{NOME_USUARIO}}/g, userName)
                .replace(/{{NOME_QUESTAO}}/g, tituloFinal)
                .replace(/{{DESCRICAO_QUESTAO}}/g, descFinal)
                .replace(/{{TITULO_QUESTAO_VAL}}/g, tituloFinal)
                .replace(/{{DESCRICAO_QUESTAO_VAL}}/g, descFinal)
                .replace(/{{IS_PROFESSOR_VAL}}/g, isProf ? 'true' : 'false')
                .replace(/{{ACTIVITY_ID}}/g, activityId)
                .replace(/{{EXEMPLO_QUESTAO}}/g, exemploTexto);

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
            devMode: true
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
        { route: '/js/aluno.js', method: 'get' },
        { route: '/js/professor.js', method: 'get' },
        { route: '/favicon.ico', method: 'get' }
    );

    app.use(lti.app);

    lti.onConnect(async (token, req, res) => {
        const roles = token.platformContext.roles || [];

        const isProf = roles.some(role => 
            role.toLowerCase().includes('instructor') || 
            role.toLowerCase().includes('teacher') || 
            role.toLowerCase().includes('admin')
        );

        const activityId = token.platformContext.resource.id; 
        const userName = token.userInfo?.name || token.userInfo?.given_name || 'Aluno';

        req.session.userId = token.user;
        req.session.isProfessor = !!isProf; 
        req.session.activityId = activityId;
        req.session.userName = userName;

        console.log(`[LOGIN] ${token.userInfo.name} logado como ${isProf ? 'Professor' : 'Aluno'}`);

        req.session.save((err) => {
            renderTemplate(res, req, token.userInfo.name, activityId);
        });
    });
}

module.exports = { setup };