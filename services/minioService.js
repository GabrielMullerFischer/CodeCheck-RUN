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

// Rascunhos isolados por exercício
async function salvarRascunho(userId, activityId, exerciseId, code) {
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
        }
    }

    const timestamp = Date.now();
    const nomeArquivo = `${prefixo}${timestamp}.c`;
    await minioClient.putObject(BUCKET_NAME, nomeArquivo, Buffer.from(code, 'utf-8'));
    
    return nomeArquivo;
}

// Lê arquivo do MinIO por caminho
async function lerArquivoPorPath(caminho) {
    const stream = await minioClient.getObject(BUCKET_NAME, caminho);
    return new Promise((resolve, reject) => {
        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
        stream.on('error', err => reject(err));
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

module.exports = {
    initMinio,
    minioClient,
    BUCKET_NAME,
    salvarRascunho,
    lerRascunho,
    arquivarSubmissao,
    lerArquivoPorPath,
    removerArquivo,
    salvarCodigo: async (userId, activityId, codigo) => {
        const nomeArquivo = `aluno_${userId}/atividade_${activityId}.c`;
        const buffer = Buffer.from(codigo, 'utf-8');
        await minioClient.putObject(BUCKET_NAME, nomeArquivo, buffer);
        return nomeArquivo;
    },

    lerCodigo: async (userId, activityId) => {
        const nomeArquivo = `aluno_${userId}/atividade_${activityId}.c`;
        const stream = await minioClient.getObject(BUCKET_NAME, nomeArquivo);
        return new Promise((resolve, reject) => {
            let content = '';
            stream.on('data', chunk => content += chunk);
            stream.on('end', () => resolve(content));
            stream.on('error', reject);
        });
    },

    listarArquivos: async (userId) => {
        const objects = [];
        const stream = minioClient.listObjects(BUCKET_NAME, `aluno_${userId}/`, true);
        return new Promise((resolve, reject) => {
            stream.on('data', obj => objects.push(obj));
            stream.on('error', err => reject(err));
            stream.on('end', () => resolve(objects));
        });
    }
};