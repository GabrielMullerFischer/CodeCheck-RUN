#!/usr/bin/env bash
set -e

NAMESPACE="codecheck"
ENV_FILE=".env"
REGISTRY="localhost:32000"
APP_IMAGE="${REGISTRY}/codecheck-app:latest"
GCC_IMAGE="${REGISTRY}/gcc:latest"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Arquivo .env não encontrado!"
  exit 1
fi

if command -v microk8s >/dev/null 2>&1; then
  KUBECMD="microk8s kubectl"
else
  KUBECMD="kubectl"
fi

echo "=================================================="
echo "🚀 Iniciando Deploy Multi-Node do CodeCheck-RUN"
echo "   Namespace: ${NAMESPACE}"
echo "   Registry:  ${REGISTRY}"
echo "=================================================="

# 1. Garantir existência do Namespace isolado
echo "[1/7] Verificando/criando namespace '${NAMESPACE}'..."
$KUBECMD get ns "$NAMESPACE" >/dev/null 2>&1 || $KUBECMD create ns "$NAMESPACE" >/dev/null

# 2. Construir e publicar a imagem no Container Registry do cluster
echo "[2/7] Construindo imagem Docker da aplicação..."
docker build -t "$APP_IMAGE" . >/dev/null

echo "[3/7] Enviando imagem da aplicação ao registry local (${APP_IMAGE})..."
docker push "$APP_IMAGE" >/dev/null

# 3. Garantir que a imagem do GCC sandbox está no registry do cluster
echo "[4/7] Verificando imagem base do compilador (${GCC_IMAGE})..."
if ! docker image inspect "$GCC_IMAGE" >/dev/null 2>&1; then
  echo "      Baixando gcc:latest e publicando em ${GCC_IMAGE}..."
  docker pull gcc:latest >/dev/null
  docker tag gcc:latest "$GCC_IMAGE"
  docker push "$GCC_IMAGE" >/dev/null
else
  docker push "$GCC_IMAGE" >/dev/null 2>&1 || true
fi

# 4. Sincronizar Secret no namespace dedicado
echo "[5/7] Sincronizando Secret 'codecheck-env' no namespace '${NAMESPACE}'..."
CLEAN_ENV=$(mktemp)
grep -E '^[A-Za-z0-9_]+=' "$ENV_FILE" | awk -F= '{if (!seen[$1]++) { k=$1; sub(/^[^=]*=/, ""); gsub(/^[\x27"]|[\x27"]$/, ""); print k "=" $0 }}' > "$CLEAN_ENV"
# Garante que dentro do cluster multi-node o K8S_IMAGE aponte para o registry local
if grep -q "^K8S_IMAGE=" "$CLEAN_ENV"; then
  sed -i "s|^K8S_IMAGE=.*|K8S_IMAGE=${GCC_IMAGE}|" "$CLEAN_ENV" 2>/dev/null || true
else
  echo "K8S_IMAGE=${GCC_IMAGE}" >> "$CLEAN_ENV"
fi
$KUBECMD create secret generic codecheck-env \
  --from-env-file="$CLEAN_ENV" \
  --namespace="$NAMESPACE" \
  --dry-run=client -o yaml | $KUBECMD apply -f - >/dev/null
rm -f "$CLEAN_ENV"

# 5. Aplicar o manifesto unificado de produção (Namespace, RBAC, Quotas, NetPol, Deployment, Service, Ingress)
echo "[6/7] Aplicando manifesto unificado 'k8s/codecheck.yaml'..."
$KUBECMD apply -f k8s/codecheck.yaml >/dev/null

# 6. Reiniciar com Rolling Update caso a imagem tenha sido atualizada
echo "[7/7] Executando Rolling Update do Deployment..."
$KUBECMD rollout restart deployment codecheck-app -n "$NAMESPACE" >/dev/null

echo "⏳ Aguardando Pod atingir estado Ready (timeout 120s)..."
$KUBECMD rollout status deployment codecheck-app -n "$NAMESPACE" --timeout=120s || true

echo "=================================================="
echo "✅ Deploy finalizado com sucesso no namespace '${NAMESPACE}'!"
echo "=================================================="
$KUBECMD get pods -n "$NAMESPACE" -o wide
