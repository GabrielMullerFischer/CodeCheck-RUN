const express = require('express');
const router = express.Router();

const Exercise = require('../models/Exercise');
const ExerciseList = require('../models/ExerciseList');
const ActivityConfig = require('../models/ActivityConfig');
const Submission = require('../models/Submission');
const ActivityAttempt = require('../models/ActivityAttempt');
const minioService = require('../services/minioService');

const MAX_TIME_LIMIT_MS = parseInt(process.env.MAX_EXECUTION_TIME_LIMIT_MS, 10) || 120000;
const DEFAULT_TIME_LIMIT_MS = parseInt(process.env.DEFAULT_EXECUTION_TIME_LIMIT_MS, 10) || 1000;

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

        if (ex.authorId === 'codecheck_oficial') {
            return res.status(403).json({ success: false, error: "Itens oficiais do CodeCheck-RUN não podem ser editados. Clique em 'Importar' para criar sua própria cópia." });
        }

        if (String(ex.authorId) !== meuId && meuId !== 'preview_user') {
            return res.status(403).json({ success: false, error: "Sem permissão para alterar este exercício." });
        }

        let timeLimitVal = (timeLimit !== null && timeLimit !== undefined && timeLimit !== '') ? parseInt(timeLimit, 10) : null;
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

        if (ex.authorId === 'codecheck_oficial') {
            return res.status(403).json({ success: false, error: "Itens oficiais do CodeCheck-RUN não podem ser excluídos." });
        }

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

        if (lista.authorId === 'codecheck_oficial') {
            return res.status(403).json({ success: false, error: "Listas oficiais do CodeCheck-RUN não podem ser alteradas. Clique em 'Importar' para criar sua própria cópia." });
        }

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

        if (lista.authorId === 'codecheck_oficial') {
            return res.status(403).json({ success: false, error: "Listas oficiais do CodeCheck-RUN não podem ser excluídas." });
        }

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
            await minioService.limparArquivosAtividade(activityId);
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
        
        let bancoUniversalListas = todasListas.filter(l => String(l.authorId) !== meuId && l.isPublic !== false);
        bancoUniversalListas.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));

        const todosExercicios = await Exercise.find({ isArchived: { $ne: true } }).sort({ _id: -1 }).lean();
        const meusExercicios = todosExercicios.filter(e => String(e.authorId) === meuId);

        let bancoUniversalExercicios = todosExercicios.filter(e => String(e.authorId) !== meuId && e.isPublic !== false);
        bancoUniversalExercicios.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));

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
            rankingPorExercicio
        });
    } catch (e) {
        console.error("Erro nas métricas:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Importação individual com nome limpo e checagem de colisão
router.post('/professor/exercicio/importar', async (req, res) => {
    try {
        const { exerciseId, customTitle } = req.body;
        const meuId = String(req.session?.userId || 'preview_user');
        const meuNome = req.session?.userName || 'Professor';

        const exOriginal = await Exercise.findById(exerciseId);
        if (!exOriginal) {
            return res.status(404).json({ success: false, error: "Exercício não encontrado." });
        }

        const tituloDesejado = (customTitle || exOriginal.title).trim();

        const exJaExiste = await Exercise.findOne({
            title: tituloDesejado,
            authorId: meuId,
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
                error: `Você já possui um exercício chamado "${tituloDesejado}". Escolha outro nome.`
            });
        }

        const novoExercicio = await Exercise.create({
            title: tituloDesejado,
            description: exOriginal.description,
            tests: exOriginal.tests,
            authorId: meuId,
            authorName: meuNome,
            isPublic: false,
            timeLimit: exOriginal.timeLimit || null
        });

        res.json({ success: true, exercicio: novoExercicio });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Importação de lista com clonagem profunda e verificação de conflitos na lista e nos exercícios
router.post('/professor/lista/importar', async (req, res) => {
    try {
        const { listId, customTitle, exerciseTitles } = req.body;
        const meuId = String(req.session?.userId || 'preview_user');
        const meuNome = req.session?.userName || 'Professor';

        const listaOriginal = await ExerciseList.findById(listId).populate('exercises');
        if (!listaOriginal) {
            return res.status(404).json({ success: false, error: "Lista não encontrada." });
        }

        const tituloListaDesejado = (customTitle || listaOriginal.title).trim();

        const listaJaExiste = await ExerciseList.findOne({ title: tituloListaDesejado, authorId: meuId });
        const listConflict = !!(listaJaExiste && !customTitle);

        if (listaJaExiste && customTitle) {
            return res.status(400).json({
                success: false,
                error: `Você já possui uma lista chamada "${tituloListaDesejado}". Escolha outro título.`
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
                isPublic: false,
                timeLimit: exOriginal.timeLimit || null
            });

            novosIdsExercicios.push(novoExercicio._id);
        }

        const novaLista = await ExerciseList.create({
            title: tituloListaDesejado,
            authorId: meuId,
            authorName: meuNome,
            exercises: novosIdsExercicios,
            isPublic: false
        });

        res.json({ success: true, lista: novaLista });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Rota para desvincular uma atividade de uma lista, removendo todos os dados relacionados
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
        await Submission.deleteMany({ activityId });
        await minioService.limparArquivosAtividade(activityId);

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/professor/submissao-codigo', async (req, res) => {
    try {
        const { codePath, submissionId } = req.body;
        if (!codePath && !submissionId) {
            return res.status(400).json({ success: false, error: "codePath ou submissionId ausente." });
        }

        let caminhoArquivo = codePath;
        let caminhoLog = null;
        let sub = null;

        if (submissionId) {
            sub = await Submission.findById(submissionId).lean();
            if (sub) {
                caminhoArquivo = sub.codePath;
                caminhoLog = sub.logPath;
            }
        } else if (codePath) {
            sub = await Submission.findOne({ codePath }).lean();
            if (sub) {
                caminhoLog = sub.logPath;
            }
        }

        if (!caminhoArquivo) {
            return res.status(404).json({ success: false, error: "Submissão não encontrada." });
        }

        let code = '// Código não disponível.';
        try {
            code = await minioService.lerArquivoPorPath(caminhoArquivo);
        } catch (err) {
            console.error("[MinIO] Erro ao carregar código:", err.message);
            code = '// Arquivo de código não localizado no armazenamento.';
        }

        let logResultado = null;
        const targetLog = caminhoLog || caminhoArquivo.replace(/\.c$/, '.json');
        try {
            const rawLog = await minioService.lerArquivoPorPath(targetLog);
            logResultado = JSON.parse(rawLog);
        } catch (err) {
            if (sub) {
                logResultado = {
                    status: sub.status,
                    executionTime: sub.executionTime,
                    percentage: sub.percentage || 0,
                    details: sub.compilationDetails || '',
                    didacticHint: null
                };
            }
        }

        return res.json({ 
            success: true, 
            code, 
            resultado: logResultado,
            submission: sub 
        });
    } catch (err) {
        console.error("[DEBUG POST] Erro MinIO:", err.message);
        return res.status(500).json({ success: false, error: "Erro interno ao carregar submissão.", code: null });
    }
});

router.get('/professor/submissao-codigo', async (req, res) => {
    try {
        const { codePath, submissionId } = req.query;
        if (!codePath && !submissionId) {
            return res.status(400).json({ success: false, error: "codePath ou submissionId ausente." });
        }

        let caminhoArquivo = codePath;
        let caminhoLog = null;
        let sub = null;

        if (submissionId) {
            sub = await Submission.findById(submissionId).lean();
            if (sub) {
                caminhoArquivo = sub.codePath;
                caminhoLog = sub.logPath;
            }
        } else if (codePath) {
            sub = await Submission.findOne({ codePath }).lean();
            if (sub) {
                caminhoLog = sub.logPath;
            }
        }

        if (!caminhoArquivo) {
            return res.status(404).json({ success: false, error: "Submissão não encontrada." });
        }

        let code = '// Código não disponível.';
        try {
            code = await minioService.lerArquivoPorPath(caminhoArquivo);
        } catch (err) {
            console.error("[MinIO] Erro ao carregar código:", err.message);
            code = '// Arquivo de código não localizado no armazenamento.';
        }

        let logResultado = null;
        const targetLog = caminhoLog || caminhoArquivo.replace(/\.c$/, '.json');
        try {
            const rawLog = await minioService.lerArquivoPorPath(targetLog);
            logResultado = JSON.parse(rawLog);
        } catch (err) {
            if (sub) {
                logResultado = {
                    status: sub.status,
                    executionTime: sub.executionTime,
                    percentage: sub.percentage || 0,
                    details: sub.compilationDetails || '',
                    didacticHint: null
                };
            }
        }

        return res.json({ 
            success: true, 
            code, 
            resultado: logResultado,
            submission: sub 
        });
    } catch (err) {
        console.error("[DEBUG GET] Erro MinIO:", err.message);
        return res.status(500).json({ success: false, error: "Erro interno ao carregar submissão.", code: null });
    }
});

module.exports = router;