set -e

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Arquivo .env nao encontrado!"
  exit 1
fi

set -a
source <(grep -E '^[A-Za-z0-9_]+=' "$ENV_FILE")
set +a

if command -v microk8s >/dev/null 2>&1; then
  KUBECMD="microk8s kubectl"
  IS_MICROK8S=true
else
  KUBECMD="kubectl"
  IS_MICROK8S=false
fi

echo "[1/5] Construindo imagem Docker..."
docker build -t codecheck-app:latest . >/dev/null

if [ "$IS_MICROK8S" = true ]; then
  echo "[2/5] Importando imagem para o MicroK8s..."
  microk8s ctr images rm docker.io/library/codecheck-app:latest >/dev/null 2>&1 || true
  docker save codecheck-app:latest | microk8s ctr image import - >/dev/null
fi

echo "[3/5] Atualizando configuracoes e manifests..."
CLEAN_ENV=$(mktemp)
grep -E '^[A-Za-z0-9_]+=' "$ENV_FILE" | awk -F= '{if (!seen[$1]++) print $0}' > "$CLEAN_ENV"
$KUBECMD create secret generic codecheck-env --from-env-file="$CLEAN_ENV" --dry-run=client -o yaml | $KUBECMD apply -f - >/dev/null
rm -f "$CLEAN_ENV"

$KUBECMD apply -f codecheck.yaml >/dev/null

$KUBECMD set resources deployment codecheck-app \
  --requests=cpu=${APP_CPU_REQUEST:-500m},memory=${APP_MEMORY_REQUEST:-512Mi} \
  --limits=cpu=${APP_CPU_LIMIT:-2000m},memory=${APP_MEMORY_LIMIT:-2Gi} >/dev/null

echo "[4/5] Reiniciando aplicacao..."
$KUBECMD rollout restart deployment codecheck-app >/dev/null
sleep 2

echo "[5/5] Aguardando pod subir..."
$KUBECMD rollout status deployment codecheck-app --timeout=60s || true

$KUBECMD get pods -l app=codecheck-app -o wide
echo "Deploy finalizado com sucesso."