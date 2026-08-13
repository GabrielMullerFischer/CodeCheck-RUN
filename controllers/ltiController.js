const path = require('path');
const fs = require('fs');
const lti = require('ltijs').Provider;
const Question = require('../models/Question');


async function renderTemplate(res, req, userName, activityId) { 
    try {
        const question = await Question.findOne({ activityId });
        const isProf = req.session.isProfessor === true;
        const isPreview = req.query.mode === 'preview';
        const arquivo = (!isProf || isPreview) ? 'aluno.html' : 'professor.html';
        const templatePath = path.resolve(__dirname, `../views/${arquivo}`);
        const ltikVal = req.query.ltik || (res.locals && (res.locals.ltik || res.locals.token)) || '';

        let exemploTexto = "Nenhum exemplo disponível.";

        if (question && question.tests) {
            try {
                const testes = typeof question.tests === 'string' ? JSON.parse(question.tests) : question.tests;
                if (Array.isArray(testes) && testes.length > 0) {
                    exemploTexto = `Entrada(s): ${testes[0].input} | Saída Esperada: ${testes[0].output}`;
                }
            } catch (jsonErr) {}
        }

        fs.readFile(templatePath, 'utf8', (err, html) => {
            if (err) return res.status(500).send("Erro ao carregar HTML.");

            let finalHtml = html
                .replace(/{{LTIK_TOKEN}}/g, ltikVal)
                .replace(/{{NOME_USUARIO}}/g, userName)
                .replace(/{{NOME_QUESTAO}}/g, question ? question.title : "Questão não configurada")
                .replace(/{{DESCRICAO_QUESTAO}}/g, question ? question.description : "Aguardando enunciado.")
                .replace(/{{TITULO_QUESTAO_VAL}}/g, question ? question.title : "")
                .replace(/{{DESCRICAO_QUESTAO_VAL}}/g, question ? question.description : "")
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

        req.session.userId = token.user;
        req.session.isProfessor = !!isProf; 
        req.session.activityId = activityId;

        console.log(`[LOGIN] ${token.userInfo.name} logado como ${isProf ? 'Professor' : 'Aluno'}`);

        req.session.save((err) => {
            renderTemplate(res, req, token.userInfo.name, activityId);
        });
    });
}

module.exports = { setup };