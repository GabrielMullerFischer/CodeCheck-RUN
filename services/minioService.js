const Minio = require('minio');

const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT) || 9000,
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY
});

const MAX_SUBMISSION_HISTORY = parseInt(process.env.MAX_SUBMISSION_HISTORY, 10) || 10;
const BUCKET_NAME = process.env.MINIO_NAME || 'arquivos-alunos';

async function initMinio() {
    try {
        console.log("🔍 Verificando bucket no MinIO...");
        const exists = await minioClient.bucketExists(BUCKET_NAME);
        if (!exists) {
            await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
            console.log(`✅ Bucket '${BUCKET_NAME}' criado com sucesso.`);
        } else {
            console.log(`✅ Bucket '${BUCKET_NAME}' já existe.`);
        }
    } catch (err) {
        console.error("❌ Erro de conexão com o MinIO:", err.message);
        throw err;
    }
}

function isTestUser(userId, session, body) {
    return (
        userId === 'preview_user' ||
        userId === 'professor_test' ||
        session?.isProfessor === true ||
        body?.mode === 'preview'
    );
}

// Rascunhos isolados por exercício
async function salvarRascunho(userId, activityId, exerciseId, code) {
    if (isTestUser(userId)) return null;
    const objectName = `drafts/${userId}/${activityId}/${exerciseId}.c`;
    const buffer = Buffer.from(code, 'utf-8');
    await minioClient.putObject(BUCKET_NAME, objectName, buffer);
    return objectName;
}

// Lê rascunho isolado por exercício
async function lerRascunho(userId, activityId, exerciseId) {
    const objectName = `drafts/${userId}/${activityId}/${exerciseId}.c`;
    const stream = await minioClient.getObject(BUCKET_NAME, objectName);
    return new Promise((resolve, reject) => {
        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
        stream.on('error', err => reject(err));
    });
}

// Salva arquivos genéricos de texto/JSON (usado para o log bruto)
async function salvarArquivo(caminho, conteudo) {
    const buffer = Buffer.from(conteudo || '', 'utf-8');
    await minioClient.putObject(BUCKET_NAME, caminho, buffer, buffer.length, {
        'Content-Type': 'application/json; charset=utf-8'
    });
    return caminho;
}

// Histórico de submissões (até 10 acertos e 10 erros separados)
async function arquivarSubmissao(userId, activityId, exerciseId, isAccepted, code) {
    const pastaTipo = isAccepted ? 'acertos' : 'erros';
    const prefixo = `historico/${activityId}/${exerciseId}/${userId}/${pastaTipo}/`;

    const objetos = [];
    const stream = minioClient.listObjectsV2(BUCKET_NAME, prefixo, true);

    await new Promise((resolve) => {
        stream.on('data', obj => objetos.push(obj));
        stream.on('end', resolve);
        stream.on('error', () => resolve());
    });

    if (objetos.length >= MAX_SUBMISSION_HISTORY) {
        objetos.sort((a, b) => new Date(a.lastModified) - new Date(b.lastModified));
        const excedentes = objetos.slice(0, objetos.length - (MAX_SUBMISSION_HISTORY - 1));
        for (const ex of excedentes) {
            await minioClient.removeObject(BUCKET_NAME, ex.name).catch(() => {});
            const logName = ex.name.replace(/\.c$/, '.json');
            await minioClient.removeObject(BUCKET_NAME, logName).catch(() => {});
        }
    }

    const timestamp = Date.now();
    const nomeArquivo = `${prefixo}${timestamp}.c`;
    await minioClient.putObject(BUCKET_NAME, nomeArquivo, Buffer.from(code, 'utf-8'));
    
    return nomeArquivo;
}

// Lê arquivo do MinIO por caminho
async function lerArquivoPorPath(caminho) {
    if (!caminho) throw new Error("Caminho não fornecido.");
    const objectName = caminho.replace(/^\/+/, '');

    return new Promise((resolve, reject) => {
        minioClient.getObject(BUCKET_NAME, objectName, (err, dataStream) => {
            if (err) {
                console.error(`[MinIO] Erro ao obter objeto "${objectName}":`, err.message);
                return reject(err);
            }
            const chunks = [];
            dataStream.on('data', chunk => chunks.push(chunk));
            dataStream.on('end', () => {
                const bufferCompleto = Buffer.concat(chunks);
                resolve(bufferCompleto.toString('utf-8'));
            });
            dataStream.on('error', errStream => {
                console.error(`[MinIO] Erro no stream de "${objectName}":`, errStream.message);
                reject(errStream);
            });
        });
    });
}

// Remove arquivo do MinIO
async function removerArquivo(objectName) {
    try {
        await minioClient.removeObject(BUCKET_NAME, objectName);
    } catch (err) {
        console.error("Erro ao remover arquivo do MinIO:", err.message);
    }
}

// Limpa arquivos de uma atividade ao remiver da submissão
async function limparArquivosAtividade(activityId) {
    if (!activityId || activityId === 'preview') return;
    try {
        const objetosParaRemover = [];

        const streamHist = minioClient.listObjectsV2(BUCKET_NAME, `historico/${activityId}/`, true);
        await new Promise((resolve) => {
            streamHist.on('data', obj => { if (obj && obj.name) objetosParaRemover.push(obj.name); });
            streamHist.on('end', resolve);
            streamHist.on('error', () => resolve());
        });

        const streamDrafts = minioClient.listObjectsV2(BUCKET_NAME, 'drafts/', true);
        await new Promise((resolve) => {
            streamDrafts.on('data', obj => {
                if (obj && obj.name && obj.name.includes(`/${activityId}/`)) {
                    objetosParaRemover.push(obj.name);
                }
            });
            streamDrafts.on('end', resolve);
            streamDrafts.on('error', () => resolve());
        });

        if (objetosParaRemover.length > 0) {
            await minioClient.removeObjects(BUCKET_NAME, objetosParaRemover);
        }
    } catch (err) {
        console.error(`Erro ao limpar arquivos da atividade ${activityId} no MinIO:`, err.message);
    }
}

module.exports = {
    initMinio,
    minioClient,
    BUCKET_NAME,
    salvarRascunho,
    lerRascunho,
    salvarArquivo,
    arquivarSubmissao,
    lerArquivoPorPath,
    removerArquivo,
    limparArquivosAtividade,
    isTestUser
};