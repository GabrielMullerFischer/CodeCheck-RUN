const Minio = require('minio');

const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'minio-service',
    port: parseInt(process.env.MINIO_PORT) || 9000,
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY
});

const BUCKET_NAME = 'arquivos-alunos';

async function initMinio() {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
        await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
        console.log('✅ Bucket do MinIO criado.');
    }
}

module.exports = { minioClient, BUCKET_NAME, initMinio };