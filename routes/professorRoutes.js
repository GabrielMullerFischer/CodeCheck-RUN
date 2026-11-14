const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Exercise = require('../models/Exercise');
const ExerciseList = require('../models/ExerciseList');
const ActivityConfig = require('../models/ActivityConfig');
const Submission = require('../models/Submission');
const ActivityAttempt = require('../models/ActivityAttempt');
const minioService = require('../services/minioService');

const MAX_TIME_LIMIT_MS = parseInt(process.env.MAX_EXECUTION_TIME_LIMIT_MS, 10) || 120000;
const DEFAULT_TIME_LIMIT_MS = parseInt(process.env.DEFAULT_TIME_LIMIT_MS || process.env.DEFAULT_EXECUTION_TIME_LIMIT_MS, 10) || 5000;
const MAX_TESTS_PER_EXERCISE = 1000;
const MAX_TEST_IO_CHARS = 5000;

function obterContextoAuth(req) {
    const auth = req.auth || req.session || {};
    const isProfessor = auth.isProfessor === true;
    return {
        auth,
        isProfessor,
        userId: auth.userId || null,
        userName: auth.userName || null,
        activityId: auth.activityId ? String(auth.activityId) : '',
        rawActivityId: auth.rawActivityId ? String(auth.rawActivityId) : '',
        courseId: auth.courseId ? String(auth.courseId) : ''
    };
}

function construirFiltroDisciplina(courseId) {
    if (courseId) {
        return { courseId: String(courseId) };
    }
    return { $or: [{ courseId: null }, { courseId: '' }, { courseId: { $exists: false } }] };
}

function ehObjectIdValido(id) {
    return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id);
}

function resolverActivityIdProfessor(req, candidateId) {
    const ctx = obterContextoAuth(req);
    if (ctx.activityId) {
        const cand = candidateId ? String(candidateId) : '';
        if (cand && cand !== 'preview' && cand !== String(ctx.activityId) && cand !== String(ctx.rawActivityId)) {
            return {
                error: "Acesso negado: você não tem permissão para gerenciar outra atividade.",
                status: 403
            };
        }
        return { activityId: ctx.activityId, courseId: ctx.courseId, rawActivityId: ctx.rawActivityId };
    }
    return { activityId: candidateId ? String(candidateId) : '', courseId: ctx.courseId, rawActivityId: ctx.rawActivityId };
}

// Rota para consulta dos exercícios da atividade (acessível por alunos e professores)
router.get('/atividade/exercicios', async (req, res) => {
    try {
        const { activityId, listId, exerciseId } = req.query;
        const ctx = obterContextoAuth(req);
        const isProfessor = ctx.isProfessor;

        if (!ctx.userId && !isProfessor) {
            return res.status(401).json({
                success: false,
                error: "Não autorizado: faça login pelo Moodle."
            });
        }

        if (!isProfessor && (exerciseId || listId)) {
            return res.status(403).json({
                success: false,
                error: "Acesso não autorizado a exercícios ou listas avulsas."
            });
        }

        const userId = isProfessor ? (ctx.userId || 'preview_user') : ctx.userId;
        const effectiveActivityId = isProfessor
            ? (ctx.activityId || activityId || 'preview')
            : ctx.activityId;

        if (!isProfessor && (!effectiveActivityId || effectiveActivityId === 'preview')) {
            return res.status(403).json({
                success: false,
                error: "Atividade inválida ou não vinculada ao Moodle."
            });
        }

        if (isProfessor && exerciseId) {
            if (!ehObjectIdValido(String(exerciseId))) {
                return res.status(400).json({ success: false, error: "ID de exercício inválido." });
            }
            const exercicioIndividual = await Exercise.findById(exerciseId);
            if (exercicioIndividual) {
                const meuId = String(ctx.userId || 'preview_user');
                let permitido = exercicioIndividual.isPublic !== false || meuId === 'preview_user' || String(exercicioIndividual.authorId) === meuId;
                if (!permitido) {
                    const emListaAcessivel = await ExerciseList.exists({
                        exercises: exercicioIndividual._id,
                        $or: [{ isPublic: { $ne: false } }, { authorId: meuId }]
                    });
                    if (emListaAcessivel) permitido = true;
                }
                if (!permitido && ctx.activityId) {
                    const cfgAtual = await ActivityConfig.findOne({ activityId: ctx.activityId }).populate('listId').lean();
                    const idsVinculados = (cfgAtual?.listId?.exercises || []).map(id => String(id._id || id));
                    if (idsVinculados.includes(String(exercicioIndividual._id))) permitido = true;
                }
                if (!permitido) {
                    return res.status(403).json({
                        success: false,
                        error: "Sem permissão para visualizar este exercício privado."
                    });
                }

                const exObj = exercicioIndividual.toObject ? exercicioIndividual.toObject() : JSON.parse(JSON.stringify(exercicioIndividual));
                exObj.timeLimit = exObj.timeLimit || DEFAULT_TIME_LIMIT_MS;
                return res.json({
                    success: true,
                    lista: {
                        _id: 'individual_preview',
                        title: `Teste: ${exObj.title}`,
                        exercises: [exObj]
                    }
                });
            }
        }

        let targetListId = isProfessor ? listId : null;
        let config = null;
        if (!targetListId && effectiveActivityId && effectiveActivityId !== 'preview') {
            config = await ActivityConfig.findOne({ activityId: effectiveActivityId });
            if (config) {
                targetListId = config.listId;
            }
        }

        if (!targetListId || !ehObjectIdValido(String(targetListId))) {
            return res.status(404).json({ 
                success: false, 
                error: "Nenhuma lista de exercícios foi vinculada a esta atividade ainda." 
            });
        }

        // Se a atividade for cronometrada e o aluno ainda não iniciou a tentativa,
        // NÃO liberamos a lista com enunciados para impedir leitura antecipada via F12/Network.
        if (!isProfessor && config && config.hasTimeLimit && effectiveActivityId && effectiveActivityId !== 'preview') {
            const attempt = await ActivityAttempt.findOne({ userId, activityId: effectiveActivityId });
            if (!attempt) {
                return res.json({
                    success: true,
                    timerRequired: true,
                    hasTimeLimit: true,
                    timeLimitMinutes: config.timeLimitMinutes || 0,
                    lista: {
                        _id: targetListId,
                        title: "Atividade Cronometrada",
                        exercises: []
                    }
                });
            }
        }

        const listaCompleta = await ExerciseList.findById(targetListId).populate('exercises');
        if (!listaCompleta) {
            return res.status(404).json({ 
                success: false, 
                error: "A lista vinculada não foi encontrada no banco de dados." 
            });
        }

        if (isProfessor && listId) {
            const meuId = String(ctx.userId || 'preview_user');
            const isListaVinculadaAtiv = config && config.listId && String(config.listId) === String(listaCompleta._id);
            if (listaCompleta.isPublic === false && meuId !== 'preview_user' && String(listaCompleta.authorId) !== meuId && !isListaVinculadaAtiv) {
                return res.status(403).json({
                    success: false,
                    error: "Sem permissão para visualizar esta lista privada."
                });
            }
        }

        const listaObj = listaCompleta.toObject ? listaCompleta.toObject() : JSON.parse(JSON.stringify(listaCompleta));

        if (Array.isArray(listaObj.exercises)) {
            listaObj.exercises = listaObj.exercises.map(ex => {
                ex.timeLimit = ex.timeLimit || DEFAULT_TIME_LIMIT_MS;
                return ex;
            });
        }

        // Sanitização crítica: para alunos, remove TODOS os casos de teste privados/secretos,
        // enviando estritamente os casos de teste visíveis (máximo 3) que servem de exemplo na interface.
        if (!isProfessor && Array.isArray(listaObj.exercises)) {
            listaObj.exercises = listaObj.exercises.map(ex => {
                if (Array.isArray(ex.tests) && ex.tests.length > 0) {
                    const visiveis = ex.tests.filter(t => t.isVisible === true);
                    if (visiveis.length > 0) {
                        ex.tests = visiveis.slice(0, 3).map(t => ({ input: t.input, output: t.output, isVisible: true }));
                    } else {
                        ex.tests = [{ input: ex.tests[0].input, output: ex.tests[0].output, isVisible: true }];
                    }
                } else {
                    ex.tests = [];
                }
                return ex;
            });
        }

        res.json({
            success: true,
            lista: listaObj
        });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

// Middleware de proteção: TODAS as rotas abaixo exigem privilégios de professor e sessão ativa (cookie/LTI)
function verificarProfessor(req, res, next) {
    const ctx = obterContextoAuth(req);
    if (!ctx.userId) {
        return res.status(401).json({ 
            success: false, 
            error: "Acesso não autorizado: sessão não encontrada. Faça login pelo Moodle." 
        });
    }
    if (!ctx.isProfessor) {
        return res.status(403).json({ 
            success: false, 
            error: "Acesso não autorizado: rota restrita a professores." 
        });
    }
    return next();
}


function processarTestesExercicio(tests) {
    if (!Array.isArray(tests)) return [];
    const processados = tests
        .filter(t => t && typeof t === 'object' && (('output' in t) || ('input' in t) || ('saida' in t) || ('entrada' in t)))
        .map(t => {
            let inp = String(t.input !== undefined && t.input !== null ? t.input : (t.entrada || ''));
            let out = String(t.output !== undefined && t.output !== null ? t.output : (t.saida || ''));
            if (inp.length > MAX_TEST_IO_CHARS) inp = inp.substring(0, MAX_TEST_IO_CHARS);
            if (out.length > MAX_TEST_IO_CHARS) out = out.substring(0, MAX_TEST_IO_CHARS);
            return {
                input: inp,
                output: out,
                isVisible: t.isVisible === true || t.isVisible === 'true'
            };
        });

    const visiveisCount = processados.filter(t => t.isVisible).length;
    if (processados.length > 0 && visiveisCount === 0) {
        processados[0].isVisible = true;
    }
    return processados;
}

router.post('/exercicio', verificarProfessor, async (req, res) => {
    try {
        const { title, description, tests, isPrivate, timeLimit } = req.body;
        const ctx = obterContextoAuth(req);
        const authorId = ctx.userId || 'preview_user';
        const authorName = ctx.userName || 'Professor';

        const tituloFormatado = (title || '').trim();
        const filtroCurso = construirFiltroDisciplina(ctx.courseId);
        const existe = await Exercise.findOne({ title: tituloFormatado, authorId, ...filtroCurso, isArchived: { $ne: true } });
        if (existe) {
            return res.status(400).json({ success: false, error: "Você já possui um exercício cadastrado com este título nesta disciplina." });
        }

        if (!Array.isArray(tests) || tests.length === 0) {
            return res.status(400).json({ success: false, error: "Informe ao menos um caso de teste válido." });
        }
        if (tests.length > MAX_TESTS_PER_EXERCISE) {
            return res.status(400).json({ 
                success: false, 
                error: `O número máximo de casos de teste por exercício é ${MAX_TESTS_PER_EXERCISE}.` 
            });
        }
        const temExcedenteIO = tests.some(t => {
            const inp = String(t?.input !== undefined && t?.input !== null ? t.input : (t?.entrada || ''));
            const out = String(t?.output !== undefined && t?.output !== null ? t.output : (t?.saida || ''));
            return inp.length > MAX_TEST_IO_CHARS || out.length > MAX_TEST_IO_CHARS;
        });
        if (temExcedenteIO) {
            return res.status(400).json({
                success: false,
                error: `O tamanho máximo permitido por entrada ou saída de caso de teste é de ${MAX_TEST_IO_CHARS} caracteres.`
            });
        }

        const testesFormatados = processarTestesExercicio(tests);
        if (testesFormatados.length === 0) {
            return res.status(400).json({ success: false, error: "Informe ao menos um caso de teste válido." });
        }
        const visiveisCount = testesFormatados.filter(t => t.isVisible).length;
        if (visiveisCount === 0) {
            return res.status(400).json({ success: false, error: "Pelo menos 1 caso de teste deve ser marcado como visível para o aluno." });
        }
        if (visiveisCount > 3) {
            return res.status(400).json({ success: false, error: "No máximo 3 casos de teste podem ser marcados como visíveis." });
        }

        let timeLimitVal = (timeLimit !== null && timeLimit !== undefined && timeLimit !== '') ? parseInt(timeLimit, 10) : DEFAULT_TIME_LIMIT_MS;
        if (timeLimitVal !== null) {
            if (isNaN(timeLimitVal) || timeLimitVal < 100) {
                return res.status(400).json({ success: false, error: "O tempo limite deve ser de pelo menos 100 ms." });
            }
            if (timeLimitVal > MAX_TIME_LIMIT_MS) {
                const minutos = (MAX_TIME_LIMIT_MS / 60000).toFixed(1).replace('.0', '');
                return res.status(400).json({
                    success: false,
                    error: `O tempo limite não pode exceder o teto máximo do servidor de ${MAX_TIME_LIMIT_MS} ms (${minutos} min).`
                });
            }
        }

        const exercicio = await Exercise.create({ 
            title: tituloFormatado, 
            description, 
            tests: testesFormatados, 
            authorId, 
            authorName, 
            courseId: ctx.courseId || null,
            isPublic: !isPrivate, 
            timeLimit: timeLimitVal 
        });
        res.json({ success: true, exercicio });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

router.put('/exercicio/:id', verificarProfessor, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, tests, isPrivate, timeLimit } = req.body;
        const ctx = obterContextoAuth(req);
        const meuId = String(ctx.userId || 'preview_user');

        const ex = await Exercise.findById(id);
        if (!ex) return res.status(404).json({ success: false, error: "Exercício não encontrado." });

        if (ex.authorId === 'codecheck_oficial') {
            return res.status(403).json({ success: false, error: "Itens oficiais do CodeCheck-RUN não podem ser editados. Clique em 'Importar' para criar sua própria cópia." });
        }

        if (String(ex.authorId) !== meuId && meuId !== 'preview_user') {
            return res.status(403).json({ success: false, error: "Sem permissão para alterar este exercício." });
        }

        if (!Array.isArray(tests) || tests.length === 0) {
            return res.status(400).json({ success: false, error: "Informe ao menos um caso de teste válido." });
        }
        if (tests.length > MAX_TESTS_PER_EXERCISE) {
            return res.status(400).json({ 
                success: false, 
                error: `O número máximo de casos de teste por exercício é ${MAX_TESTS_PER_EXERCISE}.` 
            });
        }
        const temExcedenteIO = tests.some(t => {
            const inp = String(t?.input !== undefined && t?.input !== null ? t.input : (t?.entrada || ''));
            const out = String(t?.output !== undefined && t?.output !== null ? t.output : (t?.saida || ''));
            return inp.length > MAX_TEST_IO_CHARS || out.length > MAX_TEST_IO_CHARS;
        });
        if (temExcedenteIO) {
            return res.status(400).json({
                success: false,
                error: `O tamanho máximo permitido por entrada ou saída de caso de teste é de ${MAX_TEST_IO_CHARS} caracteres.`
            });
        }

        const testesFormatados = processarTestesExercicio(tests);
        if (testesFormatados.length === 0) {
            return res.status(400).json({ success: false, error: "Informe ao menos um caso de teste válido." });
        }
        const visiveisCount = testesFormatados.filter(t => t.isVisible).length;
        if (visiveisCount === 0) {
            return res.status(400).json({ success: false, error: "Pelo menos 1 caso de teste deve ser marcado como visível para o aluno." });
        }
        if (visiveisCount > 3) {
            return res.status(400).json({ success: false, error: "No máximo 3 casos de teste podem ser marcados como visíveis." });
        }

        let timeLimitVal = (timeLimit !== null && timeLimit !== undefined && timeLimit !== '') ? parseInt(timeLimit, 10) : DEFAULT_TIME_LIMIT_MS;
        if (timeLimitVal !== null) {
            if (isNaN(timeLimitVal) || timeLimitVal < 100) {
                return res.status(400).json({ success: false, error: "O tempo limite deve ser de pelo menos 100 ms." });
            }
            if (timeLimitVal > MAX_TIME_LIMIT_MS) {
                const minutos = (MAX_TIME_LIMIT_MS / 60000).toFixed(1).replace('.0', '');
                return res.status(400).json({
                    success: false,
                    error: `O tempo limite não pode exceder o teto máximo do servidor de ${MAX_TIME_LIMIT_MS} ms (${minutos} min).`
                });
            }
        }

        // Proteção entre disciplinas: se o exercício pertencer a outra disciplina,
        // clona uma cópia exclusiva para a disciplina atual para nunca alterar enunciados de outra turma!
        const deveClonarParaDisciplina = !!(ctx.courseId && String(ex.courseId || '') !== String(ctx.courseId));

        if (deveClonarParaDisciplina) {
            const novoEx = await Exercise.create({
                title: (title || ex.title).trim(),
                description,
                tests: testesFormatados,
                authorId: meuId,
                authorName: ctx.userName || ex.authorName || 'Professor',
                courseId: ctx.courseId,
                isPublic: !isPrivate,
                timeLimit: timeLimitVal
            });
            await ExerciseList.updateMany(
                { authorId: meuId, courseId: ctx.courseId, exercises: ex._id },
                { $set: { "exercises.$": novoEx._id } }
            );
            return res.json({ success: true, exercicio: novoEx, cloned: true });
        }

        ex.title = (title || '').trim();
        ex.description = description;
        ex.tests = testesFormatados;
        ex.isPublic = !isPrivate;
        ex.timeLimit = timeLimitVal;
        await ex.save();

        res.json({ success: true, exercicio: ex });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

router.delete('/exercicio/:id', verificarProfessor, async (req, res) => {
    try {
        const { id } = req.params;
        if (!ehObjectIdValido(id)) {
            return res.status(400).json({ success: false, error: "ID de exercício inválido." });
        }
        const { removeFromAllLists } = req.query;
        const ctx = obterContextoAuth(req);
        const meuId = String(ctx.userId || 'preview_user');

        const ex = await Exercise.findById(id);
        if (!ex) return res.status(404).json({ success: false, error: "Exercício não encontrado." });

        const objId = new mongoose.Types.ObjectId(id);

        // Se for exercício oficial (codecheck_oficial), de outro autor, ou de outra disciplina:
        // O original permanece intacto para não afetar outras turmas, sendo apenas removido das listas da disciplina atual.
        if (
            ex.authorId === 'codecheck_oficial' ||
            (String(ex.authorId) !== meuId && meuId !== 'preview_user') ||
            (ctx.courseId && String(ex.courseId || '') !== String(ctx.courseId))
        ) {
            const filtroLista = ctx.courseId
                ? { authorId: meuId, courseId: ctx.courseId, exercises: objId }
                : { authorId: meuId, exercises: objId };
            await ExerciseList.updateMany(filtroLista, { $pull: { exercises: objId } });
            return res.json({ success: true, message: "Exercício removido das listas desta disciplina com sucesso." });
        }

        if (removeFromAllLists === 'true') {
            const usadoPorOutroProfessor = await ExerciseList.exists({
                exercises: objId,
                authorId: { $ne: meuId }
            });
            await ExerciseList.updateMany({ authorId: meuId, exercises: objId }, { $pull: { exercises: objId } });
            if (usadoPorOutroProfessor) {
                ex.isArchived = true;
                await ex.save();
            } else {
                await Exercise.findByIdAndDelete(objId);
            }
        } else {
            ex.isArchived = true;
            await ex.save();
        }

        res.json({ success: true });
    } catch (e) {
        console.error("❌ [Erro ao excluir exercício]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao excluir o exercício." });
    }
});

router.post('/lista', verificarProfessor, async (req, res) => {
    try {
        const { title, exercises, isPrivate } = req.body;
        const ctx = obterContextoAuth(req);
        const authorId = ctx.userId || 'preview_user';
        const authorName = ctx.userName || 'Professor';

        if (!Array.isArray(exercises) || exercises.length === 0) {
            return res.status(400).json({ success: false, error: "Selecione pelo menos um exercício válido." });
        }

        const idsValidos = exercises.filter(id => ehObjectIdValido(String(id)));
        if (idsValidos.length !== exercises.length) {
            return res.status(400).json({ success: false, error: "Um ou mais IDs de exercícios são inválidos." });
        }

        const exerciciosEncontrados = await Exercise.find({ _id: { $in: idsValidos } }).select('_id authorId isPublic').lean();
        if (exerciciosEncontrados.length !== new Set(idsValidos.map(String)).size) {
            return res.status(404).json({ success: false, error: "Um ou mais exercícios selecionados não foram encontrados." });
        }

        if (String(authorId) !== 'preview_user') {
            const temPrivadoAlheio = exerciciosEncontrados.some(ex => ex.isPublic === false && String(ex.authorId) !== String(authorId));
            if (temPrivadoAlheio) {
                return res.status(403).json({ success: false, error: "Sem permissão para incluir exercícios privados de outro docente." });
            }
        }

        const tituloFormatado = (title || '').trim();
        const filtroCurso = construirFiltroDisciplina(ctx.courseId);
        const existe = await ExerciseList.findOne({ title: tituloFormatado, authorId, ...filtroCurso });
        if (existe) {
            return res.status(400).json({ success: false, error: "Você já possui uma lista cadastrada com este título nesta disciplina." });
        }

        const lista = await ExerciseList.create({ 
            title: tituloFormatado, 
            exercises: idsValidos, 
            authorId, 
            authorName, 
            courseId: ctx.courseId || null,
            isPublic: !isPrivate 
        });
        res.json({ success: true, lista });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

router.post('/lista-ia', verificarProfessor, async (req, res) => {
    try {
        const { title, titulo, exercises, exercicios, isPrivate } = req.body;
        const ctx = obterContextoAuth(req);
        const authorId = ctx.userId || 'preview_user';
        const authorName = ctx.userName || 'Professor';
        const filtroCurso = construirFiltroDisciplina(ctx.courseId);

        const rawTitulo = (title || titulo || '').trim();
        const rawExercicios = exercises || exercicios;

        if (!Array.isArray(rawExercicios) || rawExercicios.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: "Formato inválido: a lista deve conter ao menos um exercício." 
            });
        }

        if (!rawTitulo) {
            return res.status(400).json({ 
                success: false, 
                error: "O nome da lista é obrigatório." 
            });
        }

        const listaTitulo = rawTitulo;

        const exerciciosCriadosIds = [];
        const avisos = [];

        for (let i = 0; i < rawExercicios.length; i++) {
            const rawEx = rawExercicios[i];
            if (!rawEx) continue;

            const exTitulo = (rawEx.title || rawEx.titulo || `Exercício ${i + 1}`).trim();
            const exDescricao = (rawEx.description || rawEx.descricao || '').trim();
            const rawTestes = rawEx.tests || rawEx.testes || [];

            if (!exDescricao) {
                avisos.push(`Exercício #${i + 1} ("${exTitulo}") foi ignorado por não possuir descrição.`);
                continue;
            }

            // Normaliza testes
            // Regra mandatória: 1º teste é visível (isVisible = true), demais são ocultos (isVisible = false)
            // Aplica teto de segurança contra exaustão de pool e DoS
            const testesValidos = [];
            if (Array.isArray(rawTestes)) {
                const rawTestesLimitados = rawTestes.slice(0, MAX_TESTS_PER_EXERCISE);
                rawTestesLimitados.forEach((t, tIdx) => {
                    if (!t || typeof t !== 'object') return;
                    const temChave = ('output' in t) || ('saida' in t) || ('input' in t) || ('entrada' in t);
                    if (!temChave) return;

                    let out = (t.output !== undefined && t.output !== null) ? String(t.output) : 
                                ((t.saida !== undefined && t.saida !== null) ? String(t.saida) : '');
                    let inp = (t.input !== undefined && t.input !== null) ? String(t.input) : 
                                ((t.entrada !== undefined && t.entrada !== null) ? String(t.entrada) : '');

                    if (inp.length > MAX_TEST_IO_CHARS) inp = inp.substring(0, MAX_TEST_IO_CHARS);
                    if (out.length > MAX_TEST_IO_CHARS) out = out.substring(0, MAX_TEST_IO_CHARS);

                    testesValidos.push({
                        input: inp,
                        output: out,
                        isVisible: (tIdx === 0)
                    });
                });
            }

            if (testesValidos.length === 0) {
                avisos.push(`Exercício #${i + 1} ("${exTitulo}") foi ignorado por não possuir testes.`);
                continue;
            }

            // Garante que o 1º teste é visível e os outros falsos
            testesValidos[0].isVisible = true;
            for (let k = 1; k < testesValidos.length; k++) {
                testesValidos[k].isVisible = false;
            }

            // Evita erro de duplicação de título no mesmo autor dentro da mesma disciplina
            let tituloFinal = exTitulo;
            let counter = 1;
            while (await Exercise.findOne({ title: tituloFinal, authorId, ...filtroCurso, isArchived: { $ne: true } })) {
                tituloFinal = `${exTitulo} (${counter})`;
                counter++;
            }

            // Cria o exercício:
            // Regra: timeLimit = DEFAULT_TIME_LIMIT_MS (5000ms padrão do sistema)
            // Regra: isPublic = true (público por padrão)
            const novoEx = await Exercise.create({
                title: tituloFinal,
                description: exDescricao,
                tests: testesValidos,
                authorId,
                authorName,
                courseId: ctx.courseId || null,
                isPublic: true,
                timeLimit: DEFAULT_TIME_LIMIT_MS
            });

            exerciciosCriadosIds.push(novoEx._id);
        }

        if (exerciciosCriadosIds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: "Nenhum exercício válido pôde ser criado a partir do JSON fornecido.",
                avisos
            });
        }

        // Evita colisão de título na lista para o mesmo autor na mesma disciplina
        let tituloListaFinal = listaTitulo;
        let listCounter = 1;
        while (await ExerciseList.findOne({ title: tituloListaFinal, authorId, ...filtroCurso })) {
            tituloListaFinal = `${listaTitulo} (${listCounter})`;
            listCounter++;
        }

        // Cria a lista: pública por padrão (isPublic: !isPrivate)
        const novaLista = await ExerciseList.create({
            title: tituloListaFinal,
            exercises: exerciciosCriadosIds,
            authorId,
            authorName,
            courseId: ctx.courseId || null,
            isPublic: isPrivate === true ? false : true
        });

        res.json({
            success: true,
            lista: novaLista,
            totalExercicios: exerciciosCriadosIds.length,
            avisos: avisos.length > 0 ? avisos : undefined
        });
    } catch (e) {
        console.error("Erro na criação de lista com IA:", e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao processar os exercícios via IA." });
    }
});

router.put('/lista/:id', verificarProfessor, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, exercises, isPrivate } = req.body;
        const ctx = obterContextoAuth(req);
        const meuId = String(ctx.userId || 'preview_user');

        const lista = await ExerciseList.findById(id);
        if (!lista) return res.status(404).json({ success: false, error: "Lista não encontrada." });

        if (!Array.isArray(exercises) || exercises.length === 0) {
            return res.status(400).json({ success: false, error: "Selecione pelo menos um exercício válido." });
        }

        const idsValidos = exercises.filter(exId => ehObjectIdValido(String(exId)));
        if (idsValidos.length !== exercises.length) {
            return res.status(400).json({ success: false, error: "Um ou mais IDs de exercícios são inválidos." });
        }

        const idsOriginais = new Set((lista.exercises || []).map(e => String(e._id || e)));
        const exerciciosEncontrados = await Exercise.find({ _id: { $in: idsValidos } }).select('_id authorId isPublic').lean();
        if (meuId !== 'preview_user') {
            const temPrivadoAlheio = exerciciosEncontrados.some(ex =>
                ex.isPublic === false &&
                String(ex.authorId) !== meuId &&
                !idsOriginais.has(String(ex._id))
            );
            if (temPrivadoAlheio) {
                return res.status(403).json({ success: false, error: "Sem permissão para incluir exercícios privados de outro docente." });
            }
        }

        // Verifica se a lista é oficial, de outro docente ou de outra disciplina
        const deveClonarLista = lista.authorId === 'codecheck_oficial' ||
            (String(lista.authorId) !== meuId && meuId !== 'preview_user') ||
            (ctx.courseId && String(lista.courseId || '') !== String(ctx.courseId));

        if (deveClonarLista) {
            const novaLista = await ExerciseList.create({
                title: (title || lista.title).trim(),
                authorId: meuId,
                authorName: ctx.userName || 'Professor',
                courseId: ctx.courseId || null,
                exercises: idsValidos,
                isPublic: !isPrivate
            });

            if (ctx.activityId) {
                await ActivityConfig.updateOne({ activityId: ctx.activityId, listId: lista._id }, { $set: { listId: novaLista._id } });
            }
            return res.json({ success: true, lista: novaLista, cloned: true });
        }

        lista.title = (title || '').trim();
        lista.exercises = idsValidos;
        lista.isPublic = !isPrivate;
        lista.updatedAt = new Date();
        await lista.save();

        res.json({ success: true, lista });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

router.delete('/lista/:id', verificarProfessor, async (req, res) => {
    try {
        const { id } = req.params;
        if (!ehObjectIdValido(id)) {
            return res.status(400).json({ success: false, error: "ID de lista inválido." });
        }
        const ctx = obterContextoAuth(req);
        const meuId = String(ctx.userId || 'preview_user');

        const lista = await ExerciseList.findById(id);
        if (!lista) return res.status(404).json({ success: false, error: "Lista não encontrada." });

        const objId = new mongoose.Types.ObjectId(id);

        // Se for lista oficial, de outro docente ou de outra disciplina:
        // Mantém o original intacto e apenas desvincula da atividade atual
        if (
            lista.authorId === 'codecheck_oficial' ||
            (String(lista.authorId) !== meuId && meuId !== 'preview_user') ||
            (ctx.courseId && lista.courseId && String(lista.courseId) !== String(ctx.courseId))
        ) {
            if (ctx.activityId) {
                await ActivityConfig.updateOne({ activityId: ctx.activityId, listId: objId }, { $unset: { listId: "" } });
            }
            return res.json({ success: true, message: "Lista desvinculada com sucesso." });
        }

        await ExerciseList.findByIdAndDelete(objId);
        if (ctx.courseId) {
            await ActivityConfig.updateMany({ listId: objId, $or: [{ courseId: ctx.courseId }, { activityId: ctx.activityId }] }, { $unset: { listId: "" } });
        } else {
            await ActivityConfig.updateMany({ listId: objId }, { $unset: { listId: "" } });
        }

        res.json({ success: true });
    } catch (e) {
        console.error("❌ [Erro ao excluir lista]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao excluir a lista." });
    }
});

router.post('/atividade/vincular', verificarProfessor, async (req, res) => {
    try {
        const { activityId: bodyActivityId, listId, isEvaluative, maxAttempts, hasTimeLimit, timeLimitMinutes, force } = req.body;
        const resolvido = resolverActivityIdProfessor(req, bodyActivityId);
        if (resolvido.error) {
            return res.status(resolvido.status).json({ success: false, error: resolvido.error });
        }
        const activityId = resolvido.activityId;
        if (!activityId) {
            return res.status(400).json({ success: false, error: "activityId ausente." });
        }
        if (!listId || !ehObjectIdValido(String(listId))) {
            return res.status(400).json({ success: false, error: "listId inválido." });
        }

        const ctx = obterContextoAuth(req);
        const meuId = String(ctx.userId || 'preview_user');
        const listaAlvo = await ExerciseList.findById(listId).select('_id authorId isPublic').lean();
        if (!listaAlvo) {
            return res.status(404).json({ success: false, error: "Lista não encontrada." });
        }
        if (listaAlvo.isPublic === false && meuId !== 'preview_user' && String(listaAlvo.authorId) !== meuId) {
            return res.status(403).json({ success: false, error: "Sem permissão para vincular uma lista privada de outro docente." });
        }

        const vinculoAtual = await ActivityConfig.findOne({ activityId });
        const houveTrocaDeLista = vinculoAtual && vinculoAtual.listId && String(vinculoAtual.listId) !== String(listId);

        if (houveTrocaDeLista && !force) {
            return res.json({
                success: false,
                requiresConfirmation: true,
                message: "⚠️ ATENÇÃO: Esta atividade já está configurada com outra lista.\n\nTrocar a lista agora fará com que todos os dados anteriores dos alunos (tentativas, timers e códigos enviados) sejam apagados para iniciar a nova atividade do zero.\n\nDeseja realmente trocar a atividade vinculada?"
            });
        }

        const isEvalBool = isEvaluative === true || isEvaluative === 'true';
        const maxAttInt = parseInt(maxAttempts, 10) || 3;
        const hasTimeLimitBool = hasTimeLimit === true || hasTimeLimit === 'true';
        const timeLimitMinInt = parseInt(timeLimitMinutes, 10) || 0;

        await ActivityConfig.findOneAndUpdate(
            { activityId },
            { 
                listId, 
                courseId: ctx.courseId || null,
                rawActivityId: ctx.rawActivityId || activityId,
                isEvaluative: isEvalBool, 
                maxAttempts: maxAttInt, 
                hasTimeLimit: hasTimeLimitBool, 
                timeLimitMinutes: timeLimitMinInt, 
                updatedAt: new Date() 
            },
            { upsert: true }
        );

        if (houveTrocaDeLista) {
            await ActivityAttempt.deleteMany({ activityId });
            await Submission.deleteMany({ activityId });
            await minioService.limparArquivosAtividade(activityId);
        }

        res.json({ success: true });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

router.post('/atividade/config', verificarProfessor, async (req, res) => {
    try {
        const { activityId: bodyActivityId, isEvaluative, maxAttempts, hasTimeLimit, timeLimitMinutes } = req.body;
        const resolvido = resolverActivityIdProfessor(req, bodyActivityId);
        if (resolvido.error) {
            return res.status(resolvido.status).json({ success: false, error: resolvido.error });
        }
        const activityId = resolvido.activityId;
        if (!activityId) return res.status(400).json({ success: false, error: "activityId ausente." });

        const ctx = obterContextoAuth(req);
        const duracaoMinutos = parseInt(timeLimitMinutes, 10) || 0;
        const temLimiteTempo = hasTimeLimit === true || hasTimeLimit === 'true';

        const config = await ActivityConfig.findOneAndUpdate(
            { activityId },
            {
                courseId: ctx.courseId || null,
                rawActivityId: ctx.rawActivityId || activityId,
                isEvaluative: isEvaluative === true || isEvaluative === 'true',
                maxAttempts: parseInt(maxAttempts, 10) || 3,
                hasTimeLimit: temLimiteTempo,
                timeLimitMinutes: duracaoMinutos,
                updatedAt: new Date()
            },
            { upsert: true, returnDocument: 'after' }
        );

        if (temLimiteTempo && duracaoMinutos > 0) {
            const tentativasAtivas = await ActivityAttempt.find({ activityId });
            for (const attempt of tentativasAtivas) {
                attempt.expiresAt = new Date(attempt.startedAt.getTime() + (duracaoMinutos * 60 * 1000));
                await attempt.save();
            }
        } else if (!temLimiteTempo) {
            await ActivityAttempt.deleteMany({ activityId });
        }

        res.json({ success: true, config });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

router.get('/professor/dados', verificarProfessor, async (req, res) => {
    try {
        const resolvido = resolverActivityIdProfessor(req, req.query.activityId);
        if (resolvido.error) {
            return res.status(resolvido.status).json({ success: false, error: resolvido.error });
        }
        const activityId = resolvido.activityId;
        const ctx = obterContextoAuth(req);
        const meuId = String(ctx.userId || 'preview_user');
        const crsAtual = ctx.courseId ? String(ctx.courseId) : '';

        const vinculo = activityId ? await ActivityConfig.findOne({ activityId }).populate({
            path: 'listId',
            populate: { path: 'exercises' }
        }) : null;
        const idListaVinculadaStr = vinculo && vinculo.listId ? String(vinculo.listId._id || vinculo.listId) : null;

        const todasListas = await ExerciseList.find().populate('exercises').sort({ _id: -1 }).lean();
        todasListas.forEach(l => {
            if (Array.isArray(l.exercises)) {
                l.exercises.forEach(ex => {
                    if (ex && !ex.timeLimit) ex.timeLimit = DEFAULT_TIME_LIMIT_MS;
                });
            }
        });

        // Minhas Listas (isoladas estritamente pela disciplina atual)
        const minhasListas = todasListas.filter(l => {
            if (String(l.authorId) !== meuId) return false;
            if (!crsAtual) return true;
            if (String(l.courseId) === crsAtual) return true;
            if (idListaVinculadaStr && String(l._id) === idListaVinculadaStr) return true;
            return false;
        });
        const idsMinhasListas = new Set(minhasListas.map(l => String(l._id)));

        // Banco Universal de Listas (inclui listas públicas de outros docentes e listas do próprio docente em outras disciplinas para importação)
        let bancoUniversalListas = todasListas.filter(l => {
            if (idsMinhasListas.has(String(l._id))) return false;
            return l.isPublic !== false || String(l.authorId) === meuId;
        });
        bancoUniversalListas.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));

        const idsExerciciosEmMinhasListas = new Set();
        minhasListas.forEach(l => {
            if (Array.isArray(l.exercises)) {
                l.exercises.forEach(ex => {
                    if (ex) idsExerciciosEmMinhasListas.add(String(ex._id || ex));
                });
            }
        });

        const todosExercicios = await Exercise.find({ isArchived: { $ne: true } }).sort({ _id: -1 }).lean();
        todosExercicios.forEach(ex => {
            if (!ex.timeLimit) ex.timeLimit = DEFAULT_TIME_LIMIT_MS;
        });

        // Meus Exercícios (isolados estritamente pela disciplina atual)
        const meusExercicios = todosExercicios.filter(e => {
            if (String(e.authorId) !== meuId) return false;
            if (!crsAtual) return true;
            if (String(e.courseId) === crsAtual) return true;
            if (idsExerciciosEmMinhasListas.has(String(e._id))) return true;
            return false;
        });
        const idsMeusExercicios = new Set(meusExercicios.map(e => String(e._id)));

        let bancoUniversalExercicios = todosExercicios.filter(e => {
            if (idsMeusExercicios.has(String(e._id))) return false;
            return e.isPublic !== false || String(e.authorId) === meuId;
        });
        bancoUniversalExercicios.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));

        res.json({
            success: true,
            minhasListas,
            bancoUniversalListas,
            meusExercicios,
            bancoUniversalExercicios,
            listaVinculadaId: vinculo && vinculo.listId ? vinculo.listId._id : null,
            listaVinculada: vinculo ? vinculo.listId : null,
            isEvaluative: vinculo ? !!vinculo.isEvaluative : false,
            maxAttempts: vinculo && vinculo.maxAttempts ? vinculo.maxAttempts : 3,
            hasTimeLimit: vinculo ? !!vinculo.hasTimeLimit : false,
            timeLimitMinutes: vinculo && vinculo.timeLimitMinutes ? vinculo.timeLimitMinutes : 0,
            maxExecutionTimeLimitMs: MAX_TIME_LIMIT_MS,
            defaultExecutionTimeLimitMs: DEFAULT_TIME_LIMIT_MS,
            maxSubmissionHistory: minioService.MAX_SUBMISSION_HISTORY
        });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

router.get('/professor/turma-metricas', verificarProfessor, async (req, res) => {
    try {
        const resolvido = resolverActivityIdProfessor(req, req.query.activityId);
        if (resolvido.error) {
            return res.status(resolvido.status).json({ success: false, error: resolvido.error });
        }
        const activityId = resolvido.activityId;
        if (!activityId) return res.status(400).json({ success: false, error: "activityId ausente." });

        const config = await ActivityConfig.findOne({ activityId }).populate({
            path: 'listId',
            populate: { path: 'exercises' }
        });

        if (!config || !config.listId) {
            return res.json({ success: false, semVinculo: true, message: "Vincule uma lista a esta atividade primeiro." });
        }

        const exercicios = config.listId.exercises || [];
        const mapaExercicios = {};
        exercicios.forEach(ex => {
            mapaExercicios[String(ex._id)] = ex.title;
        });

        const submissoes = await Submission.find({ 
            activityId, 
            userId: { $nin: ['professor_test', 'preview_user'] } 
        }).sort({ createdAt: -1 }).lean();

        let totalGeralEnvios = 0;
        let totalGeralAceitos = 0;
        let somaTempoAceitos = 0;

        const metricasExercicios = exercicios.map(ex => {
            const subsEx = submissoes.filter(s => String(s.exerciseId) === String(ex._id));
            const totalEnvios = subsEx.length;
            const enviosAceitos = subsEx.filter(s => s.isAccepted).length;
            const alunosQueResolveram = new Set(subsEx.filter(s => s.isAccepted).map(s => s.userId)).size;
            const taxaAcerto = totalEnvios > 0 ? Math.round((enviosAceitos / totalEnvios) * 100) : 0;

            totalGeralEnvios += totalEnvios;
            totalGeralAceitos += enviosAceitos;

            return {
                exerciseId: ex._id,
                title: ex.title,
                totalEnvios,
                enviosAceitos,
                alunosQueResolveram,
                taxaAcerto
            };
        });

        const alunosMap = {};
        const rankingPorExercicio = {};

exercicios.forEach(ex => {
            const exId = String(ex._id);
            const subsEx = submissoes
                .filter(s => String(s.exerciseId) === exId && s.isAccepted)
                .sort((a, b) => {
                    if (a.executionTime !== b.executionTime) return a.executionTime - b.executionTime;
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                });

            const mapa = {};
            subsEx.forEach(sub => {
                if (!mapa[sub.userId]) {
                    mapa[sub.userId] = {
                        userId: sub.userId,
                        userName: sub.userName || 'Aluno',
                        executionTime: sub.executionTime,
                        createdAt: sub.createdAt
                    };
                }
            });

            const ordenados = Object.values(mapa).sort((a, b) => {
                if (a.executionTime !== b.executionTime) return a.executionTime - b.executionTime;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });

            rankingPorExercicio[exId] = {
                title: ex.title,
                lider: ordenados[0] || null,
                ranking: ordenados
            };
        });

        submissoes.forEach(sub => {
            if (!alunosMap[sub.userId]) {
                alunosMap[sub.userId] = {
                    userId: sub.userId,
                    userName: sub.userName || 'Aluno',
                    resolvidos: new Set(),
                    melhoresTemposPorEx: {},
                    submissoesAcertos: [],
                    submissoesErros: [],
                    submissoes: [],
                    ultimaAtividade: sub.createdAt
                };
            }

            const itemSub = {
                _id: sub._id,
                exerciseId: sub.exerciseId,
                exerciseTitle: mapaExercicios[String(sub.exerciseId)] || 'Exercício',
                status: sub.status,
                isAccepted: sub.isAccepted,
                executionTime: typeof sub.executionTime === 'number' ? sub.executionTime : 0,
                codePath: sub.codePath,
                createdAt: sub.createdAt
            };

            alunosMap[sub.userId].submissoes.push(itemSub);

            if (sub.isAccepted) {
                somaTempoAceitos += itemSub.executionTime;
                alunosMap[sub.userId].resolvidos.add(String(sub.exerciseId));
                alunosMap[sub.userId].submissoesAcertos.push(itemSub);

                const tempoAtual = typeof sub.executionTime === 'number' ? sub.executionTime : 0;
                if (
                    alunosMap[sub.userId].melhoresTemposPorEx[sub.exerciseId] === undefined ||
                    tempoAtual < alunosMap[sub.userId].melhoresTemposPorEx[sub.exerciseId]
                ) {
                    alunosMap[sub.userId].melhoresTemposPorEx[sub.exerciseId] = tempoAtual;
                }
            } else {
                alunosMap[sub.userId].submissoesErros.push(itemSub);
            }
        });

        const ranking = Object.values(alunosMap).map(aluno => {
            const somaTempos = Object.values(aluno.melhoresTemposPorEx).reduce((acc, t) => acc + t, 0);
            const tempoTotalMs = somaTempos < 10 ? Number(somaTempos.toFixed(2)) : (somaTempos < 100 ? Number(somaTempos.toFixed(1)) : Math.round(somaTempos));

            return {
                userId: aluno.userId,
                userName: aluno.userName,
                totalResolvidos: aluno.resolvidos.size,
                tempoTotalMs,
                ultimaAtividade: aluno.ultimaAtividade,
                submissoesAcertos: aluno.submissoesAcertos,
                submissoesErros: aluno.submissoesErros,
                submissoes: aluno.submissoes,
                totalTentativas: aluno.submissoes.length
            };
        }).sort((a, b) => {
            if (b.totalResolvidos !== a.totalResolvidos) return b.totalResolvidos - a.totalResolvidos;
            return a.tempoTotalMs - b.tempoTotalMs;
        });

        const taxaGeralAcertos = totalGeralEnvios > 0 ? Math.round((totalGeralAceitos / totalGeralEnvios) * 100) : 0;
        const mediaMs = totalGeralAceitos > 0 ? (somaTempoAceitos / totalGeralAceitos) : 0;
        const tempoMedioMs = mediaMs < 10 ? Number(mediaMs.toFixed(2)) : (mediaMs < 100 ? Number(mediaMs.toFixed(1)) : Math.round(mediaMs));

        res.json({
            success: true,
            totalExercicios: exercicios.length,
            metricasExercicios,
            taxaGeralAcertos,
            tempoMedioMs,
            ranking,
            rankingPorExercicio,
            maxSubmissionHistory: minioService.MAX_SUBMISSION_HISTORY
        });
    } catch (e) {
        console.error("Erro nas métricas:", e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar métricas da turma." });
    }
});

// Importação individual com nome limpo e checagem de colisão
router.post('/professor/exercicio/importar', verificarProfessor, async (req, res) => {
    try {
        const { exerciseId, customTitle } = req.body;
        const ctx = obterContextoAuth(req);
        const meuId = String(ctx.userId || 'preview_user');
        const meuNome = ctx.userName || 'Professor';

        if (!exerciseId || !ehObjectIdValido(String(exerciseId))) {
            return res.status(400).json({ success: false, error: "ID de exercício inválido." });
        }

        const exOriginal = await Exercise.findById(exerciseId);
        if (!exOriginal) {
            return res.status(404).json({ success: false, error: "Exercício não encontrado." });
        }

        if (exOriginal.isPublic === false && meuId !== 'preview_user' && String(exOriginal.authorId) !== meuId) {
            return res.status(403).json({
                success: false,
                error: "Sem permissão para importar um exercício privado de outro docente."
            });
        }

        const tituloDesejado = (customTitle || exOriginal.title).trim();
        const filtroCurso = construirFiltroDisciplina(ctx.courseId);

        const exJaExiste = await Exercise.findOne({
            title: tituloDesejado,
            authorId: meuId,
            ...filtroCurso,
            isArchived: { $ne: true }
        });

        if (exJaExiste && !customTitle) {
            return res.json({
                success: false,
                requiresNewTitle: true,
                currentTitle: exOriginal.title
            });
        }

        if (exJaExiste && customTitle) {
            return res.status(400).json({
                success: false,
                error: `Você já possui um exercício chamado "${tituloDesejado}" nesta disciplina. Escolha outro nome.`
            });
        }

        const novoExercicio = await Exercise.create({
            title: tituloDesejado,
            description: exOriginal.description,
            tests: exOriginal.tests,
            authorId: meuId,
            authorName: meuNome,
            courseId: ctx.courseId || null,
            isPublic: false,
            timeLimit: exOriginal.timeLimit || DEFAULT_TIME_LIMIT_MS
        });

        res.json({ success: true, exercicio: novoExercicio });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

// Importação de lista com clonagem profunda e verificação de conflitos na lista e nos exercícios
router.post('/professor/lista/importar', verificarProfessor, async (req, res) => {
    try {
        const { listId, customTitle, exerciseTitles } = req.body;
        const ctx = obterContextoAuth(req);
        const meuId = String(ctx.userId || 'preview_user');
        const meuNome = ctx.userName || 'Professor';
        const filtroCurso = construirFiltroDisciplina(ctx.courseId);

        if (!listId || !ehObjectIdValido(String(listId))) {
            return res.status(400).json({ success: false, error: "ID de lista inválido." });
        }

        const listaOriginal = await ExerciseList.findById(listId).populate('exercises');
        if (!listaOriginal) {
            return res.status(404).json({ success: false, error: "Lista não encontrada." });
        }

        if (listaOriginal.isPublic === false && meuId !== 'preview_user' && String(listaOriginal.authorId) !== meuId) {
            return res.status(403).json({
                success: false,
                error: "Sem permissão para importar uma lista privada de outro docente."
            });
        }

        const tituloListaDesejado = (customTitle || listaOriginal.title).trim();

        const listaJaExiste = await ExerciseList.findOne({ title: tituloListaDesejado, authorId: meuId, ...filtroCurso });
        const listConflict = !!(listaJaExiste && !customTitle);

        if (listaJaExiste && customTitle) {
            return res.status(400).json({
                success: false,
                error: `Você já possui uma lista chamada "${tituloListaDesejado}" nesta disciplina. Escolha outro título.`
            });
        }

        const mapaTitulosEx = exerciseTitles || {};
        const exerciciosComConflito = [];

        for (const exOriginal of listaOriginal.exercises) {
            if (!exOriginal) continue;
            const tituloFinalEx = (mapaTitulosEx[exOriginal._id] || exOriginal.title).trim();

            const exExiste = await Exercise.findOne({
                title: tituloFinalEx,
                authorId: meuId,
                ...filtroCurso,
                isArchived: { $ne: true }
            });

            if (exExiste && !mapaTitulosEx[exOriginal._id]) {
                exerciciosComConflito.push({
                    id: String(exOriginal._id),
                    title: exOriginal.title
                });
            }
        }

        if (listConflict || exerciciosComConflito.length > 0) {
            return res.json({
                success: false,
                requiresConflictResolution: true,
                listConflict,
                currentListTitle: listaOriginal.title,
                conflictingExercises: exerciciosComConflito,
                customTitle: customTitle || null
            });
        }

        const novosIdsExercicios = [];
        for (const exOriginal of listaOriginal.exercises) {
            if (!exOriginal) continue;
            const tituloFinalEx = (mapaTitulosEx[exOriginal._id] || exOriginal.title).trim();

            const novoExercicio = await Exercise.create({
                title: tituloFinalEx,
                description: exOriginal.description,
                tests: exOriginal.tests,
                authorId: meuId,
                authorName: meuNome,
                courseId: ctx.courseId || null,
                isPublic: false,
                timeLimit: exOriginal.timeLimit || DEFAULT_TIME_LIMIT_MS
            });

            novosIdsExercicios.push(novoExercicio._id);
        }

        const novaLista = await ExerciseList.create({
            title: tituloListaDesejado,
            authorId: meuId,
            authorName: meuNome,
            courseId: ctx.courseId || null,
            exercises: novosIdsExercicios,
            isPublic: false
        });

        res.json({ success: true, lista: novaLista });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

// Rota para desvincular uma atividade de uma lista, removendo todos os dados relacionados
router.post('/atividade/desvincular', verificarProfessor, async (req, res) => {
    try {
        const resolvido = resolverActivityIdProfessor(req, req.body.activityId);
        if (resolvido.error) {
            return res.status(resolvido.status).json({ success: false, error: resolvido.error });
        }
        const activityId = resolvido.activityId;
        if (!activityId) {
            return res.status(400).json({ success: false, error: "activityId ausente." });
        }

        await ActivityConfig.findOneAndUpdate(
            { activityId },
            { $unset: { listId: "" }, updatedAt: new Date() }
        );

        await ActivityAttempt.deleteMany({ activityId });
        await Submission.deleteMany({ activityId });
        await minioService.limparArquivosAtividade(activityId);

        res.json({ success: true });
    } catch (e) {
        console.error("❌ [Erro /atividade/exercicios]:", e?.message || e);
        res.status(500).json({ success: false, error: "Ocorreu um erro interno no servidor ao carregar os exercícios." });
    }
});

async function carregarSubmissaoProfessor(req, res, params) {
    try {
        const { codePath, submissionId } = params || {};
        if (!codePath && !submissionId) {
            return res.status(400).json({ success: false, error: "codePath ou submissionId ausente." });
        }

        const ctx = obterContextoAuth(req);
        let sub = null;

        if (submissionId) {
            if (!ehObjectIdValido(String(submissionId))) {
                return res.status(400).json({ success: false, error: "submissionId inválido." });
            }
            sub = await Submission.findById(submissionId).lean();
        } else if (codePath && typeof codePath === 'string') {
            sub = await Submission.findOne({ codePath }).lean();
        }

        // Nunca permite leitura arbitrária do MinIO sem documento Submission correspondente
        if (!sub || !sub.codePath) {
            return res.status(404).json({ success: false, error: "Submissão não encontrada." });
        }

        // Restringe estritamente à atividade autenticada via LTI do professor
        if (ctx.activityId && String(sub.activityId) !== String(ctx.activityId) && String(sub.activityId) !== String(ctx.rawActivityId)) {
            return res.status(403).json({
                success: false,
                error: "Sem permissão para acessar submissões de outra atividade."
            });
        }

        const caminhoArquivo = sub.codePath;
        const caminhoLog = sub.logPath;

        let code = '// Código não disponível.';
        try {
            if (caminhoArquivo && caminhoArquivo !== 'preview') {
                code = await minioService.lerArquivoPorPath(caminhoArquivo);
            }
        } catch (err) {
            console.error("[MinIO] Erro ao carregar código:", err.message);
            code = '// Arquivo de código não localizado no armazenamento.';
        }

        let logResultado = null;
        const targetLog = caminhoLog || (caminhoArquivo && caminhoArquivo !== 'preview' ? caminhoArquivo.replace(/\.c$/, '.json') : null);
        try {
            if (targetLog && targetLog !== 'preview') {
                const rawLog = await minioService.lerArquivoPorPath(targetLog);
                logResultado = JSON.parse(rawLog);
                if (logResultado && logResultado.status === 'Time Limit') {
                    delete logResultado.input;
                    delete logResultado.got;
                    delete logResultado.expected;
                    delete logResultado.testIndex;
                }
            }
        } catch (err) {
            logResultado = {
                status: sub.status,
                executionTime: sub.executionTime,
                percentage: sub.percentage || 0,
                details: sub.compilationDetails || '',
                didacticHint: null
            };
        }

        return res.json({ 
            success: true, 
            code, 
            resultado: logResultado,
            submission: sub 
        });
    } catch (err) {
        console.error("[DEBUG] Erro MinIO:", err.message);
        return res.status(500).json({ success: false, error: "Erro interno ao carregar submissão.", code: null });
    }
}

router.post('/professor/submissao-codigo', verificarProfessor, async (req, res) => {
    return carregarSubmissaoProfessor(req, res, req.body);
});

router.get('/professor/submissao-codigo', verificarProfessor, async (req, res) => {
    return carregarSubmissaoProfessor(req, res, req.query);
});

module.exports = router;