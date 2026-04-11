const Minio = require('minio');

const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT) || 9000,
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY
});

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

module.exports = {
    initMinio,
    minioClient,
    BUCKET_NAME,
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