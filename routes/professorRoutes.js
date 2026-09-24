const express = require('express');
const router = express.Router();

const Exercise = require('../models/Exercise');
const ExerciseList = require('../models/ExerciseList');
const ActivityConfig = require('../models/ActivityConfig');
const Submission = require('../models/Submission');
const ActivityAttempt = require('../models/ActivityAttempt');

const MAX_TIME_LIMIT_MS = parseInt(process.env.MAX_EXECUTION_TIME_LIMIT_MS, 10) || 7200000;
const DEFAULT_TIME_LIMIT_MS = parseInt(process.env.DEFAULT_EXECUTION_TIME_LIMIT_MS, 10) || 1000;

async function gerarTituloUnicoExercicio(baseTitle, authorId) {
    let title = baseTitle;
    let count = 1;
    while (await Exercise.findOne({ title, authorId })) {
        title = `${baseTitle} (${count})`;
        count++;
    }
    return title;
}

async function gerarTituloUnicoLista(baseTitle, authorId) {
    let title = baseTitle;
    let count = 1;
    while (await ExerciseList.findOne({ title, authorId })) {
        title = `${baseTitle} (${count})`;
        count++;
    }
    return title;
}

router.post('/exercicio', async (req, res) => {
    try {
        const { title, description, tests, isPrivate, timeLimit } = req.body;
        const authorId = req.session?.userId || 'preview_user';
        const authorName = req.session?.userName || 'Professor';

        const tituloFormatado = (title || '').trim();
        const existe = await Exercise.findOne({ title: tituloFormatado, authorId, isArchived: { $ne: true } });
        if (existe) {
            return res.status(400).json({ success: false, error: "Você já possui um exercício cadastrado com este título." });
        }

        let timeLimitVal = (timeLimit !== null && timeLimit !== undefined && timeLimit !== '') ? parseInt(timeLimit, 10) : null;
        if (timeLimitVal !== null) {
            if (isNaN(timeLimitVal) || timeLimitVal < 100) {
                return res.status(400).json({ success: false, error: "O tempo limite deve ser de pelo menos 100 ms." });
            }
            if (timeLimitVal > MAX_TIME_LIMIT_MS) {
                const horas = (MAX_TIME_LIMIT_MS / 3600000).toFixed(1).replace('.0', '');
                return res.status(400).json({
                    success: false,
                    error: `O tempo limite não pode exceder o teto máximo do servidor de ${MAX_TIME_LIMIT_MS} ms (${horas}h).`
                });
            }
        }

        const exercicio = await Exercise.create({ 
            title: tituloFormatado, 
            description, 
            tests, 
            authorId, 
            authorName,
            isPublic: !isPrivate,
            timeLimit: timeLimitVal
        });
        res.json({ success: true, exercicio });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/exercicio/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, tests, isPrivate, timeLimit } = req.body;
        const meuId = String(req.session?.userId || 'preview_user');

        const ex = await Exercise.findById(id);
        if (!ex) return res.status(404).json({ success: false, error: "Exercício não encontrado." });

        if (String(ex.authorId) !== meuId && meuId !== 'preview_user') {
            return res.status(403).json({ success: false, error: "Sem permissão para alterar este exercício." });
        }

        let timeLimitVal = (timeLimit !== null && timeLimit !== undefined && timeLimit !== '') ? parseInt(timeLimit, 10) : null;
        if (timeLimitVal !== null) {
            if (isNaN(timeLimitVal) || timeLimitVal < 100) {
                return res.status(400).json({ success: false, error: "O tempo limite deve ser de pelo menos 100 ms." });
            }
            if (timeLimitVal > MAX_TIME_LIMIT_MS) {
                const horas = (MAX_TIME_LIMIT_MS / 3600000).toFixed(1).replace('.0', '');
                return res.status(400).json({
                    success: false,
                    error: `O tempo limite não pode exceder o teto máximo do servidor de ${MAX_TIME_LIMIT_MS} ms (${horas}h).`
                });
            }
        }

        ex.title = (title || '').trim();
        ex.description = description;
        ex.tests = tests;
        ex.isPublic = !isPrivate;
        ex.timeLimit = timeLimitVal;
        await ex.save();

        res.json({ success: true, exercicio: ex });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/exercicio/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { removeFromAllLists } = req.query;
        const meuId = String(req.session?.userId || 'preview_user');

        const ex = await Exercise.findById(id);
        if (!ex) return res.status(404).json({ success: false, error: "Exercício não encontrado." });

        if (String(ex.authorId) !== meuId && meuId !== 'preview_user') {
            return res.status(403).json({ success: false, error: "Sem permissão para excluir este exercício." });
        }

        if (removeFromAllLists === 'true') {
            await Exercise.findByIdAndDelete(id);
            await ExerciseList.updateMany({ exercises: id }, { $pull: { exercises: id } });
        } else {
            ex.isArchived = true;
            await ex.save();
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/lista', async (req, res) => {
    try {
        const { title, exercises, isPrivate } = req.body;
        const authorId = req.session?.userId || 'preview_user';
        const authorName = req.session?.userName || 'Professor';

        const tituloFormatado = (title || '').trim();
        const existe = await ExerciseList.findOne({ title: tituloFormatado, authorId });
        if (existe) {
            return res.status(400).json({ success: false, error: "Você já possui uma lista cadastrada com este título." });
        }

        const lista = await ExerciseList.create({ 
            title: tituloFormatado, 
            exercises, 
            authorId, 
            authorName,
            isPublic: !isPrivate
        });
        res.json({ success: true, lista });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/lista/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, exercises, isPrivate } = req.body;
        const meuId = String(req.session?.userId || 'preview_user');

        const lista = await ExerciseList.findById(id);
        if (!lista) return res.status(404).json({ success: false, error: "Lista não encontrada." });

        if (String(lista.authorId) !== meuId && meuId !== 'preview_user') {
            return res.status(403).json({ success: false, error: "Sem permissão para alterar esta lista." });
        }

        lista.title = (title || '').trim();
        lista.exercises = exercises;
        lista.isPublic = !isPrivate;
        lista.updatedAt = new Date();
        await lista.save();

        res.json({ success: true, lista });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/lista/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const meuId = String(req.session?.userId || 'preview_user');

        const lista = await ExerciseList.findById(id);
        if (!lista) return res.status(404).json({ success: false, error: "Lista não encontrada." });

        if (String(lista.authorId) !== meuId && meuId !== 'preview_user') {
            return res.status(403).json({ success: false, error: "Sem permissão para excluir esta lista." });
        }

        await ExerciseList.findByIdAndDelete(id);
        await ActivityConfig.updateMany({ listId: id }, { $unset: { listId: "" } });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/atividade/vincular', async (req, res) => {
    try {
        const { activityId, listId, isEvaluative, maxAttempts, hasTimeLimit, timeLimitMinutes, force } = req.body;

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
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/atividade/config', async (req, res) => {
    try {
        const { activityId, isEvaluative, maxAttempts, hasTimeLimit, timeLimitMinutes } = req.body;
        if (!activityId) return res.status(400).json({ success: false, error: "activityId ausente." });

        const duracaoMinutos = parseInt(timeLimitMinutes, 10) || 0;
        const temLimiteTempo = hasTimeLimit === true || hasTimeLimit === 'true';

        const config = await ActivityConfig.findOneAndUpdate(
            { activityId },
            {
                isEvaluative: isEvaluative === true || isEvaluative === 'true',
                maxAttempts: parseInt(maxAttempts, 10) || 3,
                hasTimeLimit: temLimiteTempo,
                timeLimitMinutes: duracaoMinutos,
                updatedAt: new Date()
            },
            { upsert: true, new: true }
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
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/atividade/exercicios', async (req, res) => {
    try {
        const { activityId, listId, exerciseId } = req.query;

        if (exerciseId) {
            const exercicioIndividual = await Exercise.findById(exerciseId);
            if (exercicioIndividual) {
                return res.json({
                    success: true,
                    lista: {
                        _id: 'individual_preview',
                        title: `Teste: ${exercicioIndividual.title}`,
                        exercises: [exercicioIndividual]
                    }
                });
            }
        }

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

router.get('/professor/dados', async (req, res) => {
    try {
        const { activityId } = req.query;
        const meuId = String(req.session?.userId || 'preview_user');

        const todasListas = await ExerciseList.find().populate('exercises').sort({ _id: -1 }).lean();
        const minhasListas = todasListas.filter(l => String(l.authorId) === meuId);
        const bancoUniversalListas = todasListas.filter(l => String(l.authorId) !== meuId && l.isPublic !== false);

        const todosExercicios = await Exercise.find({ isArchived: { $ne: true } }).sort({ _id: -1 }).lean();
        const meusExercicios = todosExercicios.filter(e => String(e.authorId) === meuId);
        const bancoUniversalExercicios = todosExercicios.filter(e => String(e.authorId) !== meuId && e.isPublic !== false);

        const vinculo = activityId ? await ActivityConfig.findOne({ activityId }).populate({
            path: 'listId',
            populate: { path: 'exercises' }
        }) : null;

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
            defaultExecutionTimeLimitMs: DEFAULT_TIME_LIMIT_MS
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/professor/turma-metricas', async (req, res) => {
    try {
        const { activityId } = req.query;
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

        submissoes.forEach(sub => {
            if (!alunosMap[sub.userId]) {
                alunosMap[sub.userId] = {
                    userId: sub.userId,
                    userName: sub.userName || 'Aluno',
                    resolvidos: new Set(),
                    melhoresTemposPorEx: {},
                    submissoesAcertos: [],
                    submissoesErros: [],
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
            const tempoTotalMs = Object.values(aluno.melhoresTemposPorEx).reduce((acc, t) => acc + t, 0);

            return {
                userId: aluno.userId,
                userName: aluno.userName,
                totalResolvidos: aluno.resolvidos.size,
                tempoTotalMs,
                ultimaAtividade: aluno.ultimaAtividade,
                submissoesAcertos: aluno.submissoesAcertos,
                submissoesErros: aluno.submissoesErros,
                totalTentativas: aluno.submissoesAcertos.length + aluno.submissoesErros.length
            };
        }).sort((a, b) => {
            if (b.totalResolvidos !== a.totalResolvidos) return b.totalResolvidos - a.totalResolvidos;
            return a.tempoTotalMs - b.tempoTotalMs;
        });

        const taxaGeralAcertos = totalGeralEnvios > 0 ? Math.round((totalGeralAceitos / totalGeralEnvios) * 100) : 0;
        const tempoMedioMs = totalGeralAceitos > 0 ? Math.round(somaTempoAceitos / totalGeralAceitos) : 0;

        res.json({
            success: true,
            totalExercicios: exercicios.length,
            metricasExercicios,
            taxaGeralAcertos,
            tempoMedioMs,
            ranking
        });
    } catch (e) {
        console.error("Erro nas métricas:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/professor/exercicio/importar', async (req, res) => {
    try {
        const { exerciseId } = req.body;
        const meuId = req.session?.userId || 'preview_user';
        const meuNome = req.session?.userName || 'Professor';

        const exOriginal = await Exercise.findById(exerciseId);
        if (!exOriginal) {
            return res.status(404).json({ success: false, error: "Exercício não encontrado." });
        }

        const novoTitulo = await gerarTituloUnicoExercicio(exOriginal.title, meuId);

        const novoExercicio = await Exercise.create({
            title: novoTitulo,
            description: exOriginal.description,
            tests: exOriginal.tests,
            authorId: meuId,
            authorName: meuNome,
            isPublic: exOriginal.isPublic !== false,
            timeLimit: exOriginal.timeLimit || null
        });

        res.json({ success: true, exercicio: novoExercicio });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/professor/lista/importar', async (req, res) => {
    try {
        const { listId } = req.body;
        const meuId = req.session?.userId || 'preview_user';
        const meuNome = req.session?.userName || 'Professor';

        const listaOriginal = await ExerciseList.findById(listId);
        if (!listaOriginal) {
            return res.status(404).json({ success: false, error: "Lista não encontrada." });
        }

        const novoTitulo = await gerarTituloUnicoLista(listaOriginal.title, meuId);

        const novaLista = await ExerciseList.create({
            title: novoTitulo,
            authorId: meuId,
            authorName: meuNome,
            exercises: listaOriginal.exercises,
            isPublic: listaOriginal.isPublic !== false
        });

        res.json({ success: true, lista: novaLista });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/atividade/desvincular', async (req, res) => {
    try {
        const { activityId } = req.body;
        if (!activityId) {
            return res.status(400).json({ success: false, error: "activityId ausente." });
        }

        await ActivityConfig.findOneAndUpdate(
            { activityId },
            { $unset: { listId: "" }, updatedAt: new Date() }
        );

        await ActivityAttempt.deleteMany({ activityId });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;