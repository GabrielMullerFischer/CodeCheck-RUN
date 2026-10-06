set -e

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo " Arquivo .env não encontrado!"
  exit 1
fi

export $(grep -v '^#' $ENV_FILE | xargs)

echo " 1. Reconstruindo a imagem Docker da aplicação Web..."
docker build -t codecheck-app:latest .

echo " 2. Atualizando limites de recursos no Kubernetes..."
kubectl set resources deployment codecheck-app \
  --requests=cpu=${APP_CPU_REQUEST:-1000m},memory=${APP_MEMORY_REQUEST:-512Mi} \
  --limits=cpu=${APP_CPU_LIMIT:-2000m},memory=${APP_MEMORY_LIMIT:-2Gi}

echo " 3. Reiniciando os pods da aplicação..."
kubectl rollout restart deployment codecheck-app

echo " 4. Aguardando a subida do novo Pod..."
kubectl rollout status deployment codecheck-app

echo " Deploy concluído com sucesso!"