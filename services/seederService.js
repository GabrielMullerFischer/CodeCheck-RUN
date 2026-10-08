const fs = require('fs');
const path = require('path');
const Exercise = require('../models/Exercise');
const ExerciseList = require('../models/ExerciseList');

const SISTEMA_AUTHOR_ID = 'codecheck_oficial';
const SISTEMA_AUTHOR_NAME = 'CodeCheck-RUN';

async function popularBanco() {
    try {
        const caminhoJson = path.resolve(__dirname, '../data/exerciciosPadrao.json');
        if (!fs.existsSync(caminhoJson)) return;

        const dadosPadrao = JSON.parse(fs.readFileSync(caminhoJson, 'utf-8'));
        const mapaExerciciosCriados = {};

        if (Array.isArray(dadosPadrao.exercicios)) {
            for (const exData of dadosPadrao.exercicios) {
                let exercicio = await Exercise.findOne({
                    title: exData.title,
                    authorId: SISTEMA_AUTHOR_ID
                });

                if (!exercicio) {
                    exercicio = await Exercise.create({
                        title: exData.title,
                        description: exData.description,
                        tests: exData.tests,
                        timeLimit: exData.timeLimit || 1000,
                        isPublic: true,
                        isArchived: false,
                        authorId: SISTEMA_AUTHOR_ID,
                        authorName: SISTEMA_AUTHOR_NAME
                    });
                } else {
                    exercicio.description = exData.description;
                    exercicio.tests = exData.tests;
                    exercicio.timeLimit = exData.timeLimit || 1000;
                    exercicio.isPublic = true;
                    exercicio.isArchived = false;
                    await exercicio.save();
                }
                mapaExerciciosCriados[exData.title] = exercicio._id;
            }
        }

        if (Array.isArray(dadosPadrao.listas)) {
            for (const listaData of dadosPadrao.listas) {
                const idsExercicios = (listaData.exercises || [])
                    .map(titulo => mapaExerciciosCriados[titulo])
                    .filter(id => Boolean(id));

                let lista = await ExerciseList.findOne({
                    title: listaData.title,
                    authorId: SISTEMA_AUTHOR_ID
                });

                if (!lista) {
                    await ExerciseList.create({
                        title: listaData.title,
                        exercises: idsExercicios,
                        isPublic: true,
                        isEvaluative: false,
                        maxAttempts: 3,
                        authorId: SISTEMA_AUTHOR_ID,
                        authorName: SISTEMA_AUTHOR_NAME
                    });
                } else {
                    lista.exercises = idsExercicios;
                    lista.isPublic = true;
                    lista.updatedAt = new Date();
                    await lista.save();
                }
            }
        }

        console.log(`📦 Seeder: Sincronizados ${dadosPadrao.exercicios.length} exercícios e ${dadosPadrao.listas.length} listas padrão do exerciciosPadrao.json.`);
    } catch (err) {
        console.error('Erro no Seeder CodeCheck-RUN:', err.message);
    }
}

module.exports = { popularBanco, SISTEMA_AUTHOR_ID, SISTEMA_AUTHOR_NAME };