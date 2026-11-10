#!/usr/bin/env bash
set -e

NAMESPACE="codecheck"
ENV_FILE=".env"
APP_IMAGE="codecheck-app:latest"
GCC_IMAGE="gcc:latest"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Arquivo .env não encontrado!"
  exit 1
fi

if command -v microk8s >/dev/null 2>&1; then
  KUBECMD="microk8s kubectl"
  IS_MICROK8S=true
else
  KUBECMD="kubectl"
  IS_MICROK8S=false
fi

# Detecta automaticamente o nó local
HOST_NODE=$(hostname 2>/dev/null || echo "")
if [ -n "$HOST_NODE" ] && $KUBECMD get node "$HOST_NODE" >/dev/null 2>&1; then
  TARGET_NODE="$HOST_NODE"
else
  TARGET_NODE=$($KUBECMD get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
fi

echo "=================================================="
echo "🚀 Iniciando Deploy Single-Node do CodeCheck-RUN"
echo "   Namespace: ${NAMESPACE}"
echo "   Nó Alvo:   ${TARGET_NODE:-automático}"
echo "=================================================="

# 1. Garantir existência do Namespace
echo "[1/6] Verificando/criando namespace '${NAMESPACE}'..."
$KUBECMD get ns "$NAMESPACE" >/dev/null 2>&1 || $KUBECMD create ns "$NAMESPACE" >/dev/null

# 2. Construir imagem Docker localmente
echo "[2/6] Construindo imagem Docker local (${APP_IMAGE})..."
docker build -t "$APP_IMAGE" . >/dev/null

# 3. Garantir que a imagem do compilador GCC existe localmente
echo "[3/6] Verificando imagem base do compilador (${GCC_IMAGE})..."
if ! docker image inspect "$GCC_IMAGE" >/dev/null 2>&1; then
  echo "      Baixando ${GCC_IMAGE}..."
  docker pull "$GCC_IMAGE" >/dev/null
fi

# 4. Se for MicroK8s, importar imagens diretamente para o containerd local (sem depender de registry externo)
if [ "$IS_MICROK8S" = true ]; then
  echo "[4/6] Importando imagem para o containerd local do MicroK8s..."
  CTR_SOCK="/var/snap/microk8s/common/run/containerd.sock"
  CTR_BIN="/snap/microk8s/current/bin/ctr"
  if [ -S "$CTR_SOCK" ] && [ -x "$CTR_BIN" ]; then
    "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io images rm "docker.io/library/${APP_IMAGE}" >/dev/null 2>&1 || true
    docker save "$APP_IMAGE" | "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io image import - >/dev/null
    if ! "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io images ls | grep -q "docker.io/library/gcc:latest"; then
      echo "      Importando ${GCC_IMAGE} para o containerd local..."
      docker save "$GCC_IMAGE" | "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io image import - >/dev/null
    fi
  else
    microk8s ctr images rm "docker.io/library/${APP_IMAGE}" >/dev/null 2>&1 || true
    docker save "$APP_IMAGE" | microk8s ctr image import - >/dev/null
  fi
else
  echo "[4/6] Ambiente Kubernetes local detectado (Docker Desktop / K8s padrão)..."
fi

# 5. Sincronizar Secret no namespace dedicado forçando execução e imagens locais
echo "[5/6] Sincronizando Secret 'codecheck-env' para nó único (${TARGET_NODE:-local})..."
CLEAN_ENV=$(mktemp)
grep -E '^[A-Za-z0-9_]+=' "$ENV_FILE" | awk -F= '{if (!seen[$1]++) { k=$1; sub(/^[^=]*=/, ""); gsub(/^[\x27"]|[\x27"]$/, ""); print k "=" $0 }}' > "$CLEAN_ENV"

# Sobrescreve variáveis de K8s para modo Single-Node (independente do cluster)
grep -v -E '^(K8S_NAMESPACE|K8S_IMAGE|K8S_IMAGE_PULL_POLICY|K8S_WORKER_NODE)=' "$CLEAN_ENV" > "${CLEAN_ENV}.tmp" || true
mv "${CLEAN_ENV}.tmp" "$CLEAN_ENV"
{
  echo "K8S_NAMESPACE=${NAMESPACE}"
  echo "K8S_IMAGE=${GCC_IMAGE}"
  echo "K8S_IMAGE_PULL_POLICY=IfNotPresent"
  if [ -n "$TARGET_NODE" ]; then
    echo "K8S_WORKER_NODE=${TARGET_NODE}"
  fi
} >> "$CLEAN_ENV"

$KUBECMD create secret generic codecheck-env \
  --from-env-file="$CLEAN_ENV" \
  --namespace="$NAMESPACE" \
  --dry-run=client -o yaml | $KUBECMD apply -f - >/dev/null
rm -f "$CLEAN_ENV"

# 6. Aplicar manifesto single-node e fixar no nó local
echo "[6/6] Aplicando manifesto 'codecheck.yaml' e reiniciando aplicação..."
$KUBECMD apply -f codecheck.yaml >/dev/null

if [ -n "$TARGET_NODE" ]; then
  $KUBECMD patch deployment codecheck-app -n "$NAMESPACE" \
    --type='json' \
    -p="[{\"op\": \"add\", \"path\": \"/spec/template/spec/nodeSelector\", \"value\": {\"kubernetes.io/hostname\": \"${TARGET_NODE}\"}}]" >/dev/null
fi

$KUBECMD rollout restart deployment codecheck-app -n "$NAMESPACE" >/dev/null

echo "⏳ Aguardando Pod atingir estado Ready (timeout 120s)..."
$KUBECMD rollout status deployment codecheck-app -n "$NAMESPACE" --timeout=120s || true

echo "=================================================="
echo "✅ Deploy Single-Node finalizado com sucesso!"
echo "=================================================="
$KUBECMD get pods -n "$NAMESPACE" -o wide

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Arquivo .env não encontrado!"
  exit 1
fi

if command -v microk8s >/dev/null 2>&1; then
  KUBECMD="microk8s kubectl"
  IS_MICROK8S=true
else
  KUBECMD="kubectl"
  IS_MICROK8S=false
fi

# Detecta automaticamente o nó local (ex.: ubuntu05 no Linux ou docker-desktop no Windows)
HOST_NODE=$(hostname 2>/dev/null || echo "")
if [ -n "$HOST_NODE" ] && $KUBECMD get node "$HOST_NODE" >/dev/null 2>&1; then
  TARGET_NODE="$HOST_NODE"
else
  TARGET_NODE=$($KUBECMD get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
fi

echo "=================================================="
echo "🚀 Iniciando Deploy Single-Node do CodeCheck-RUN"
echo "   Namespace: ${NAMESPACE}"
echo "   Nó Alvo:   ${TARGET_NODE:-automático}"
echo "=================================================="

# 1. Garantir existência do Namespace
echo "[1/6] Verificando/criando namespace '${NAMESPACE}'..."
$KUBECMD get ns "$NAMESPACE" >/dev/null 2>&1 || $KUBECMD create ns "$NAMESPACE" >/dev/null

# 2. Construir imagem Docker localmente
echo "[2/6] Construindo imagem Docker local (${APP_IMAGE})..."
docker build -t "$APP_IMAGE" . >/dev/null

# 3. Garantir que a imagem do compilador GCC existe localmente
echo "[3/6] Verificando imagem base do compilador (${GCC_IMAGE})..."
if ! docker image inspect "$GCC_IMAGE" >/dev/null 2>&1; then
  echo "      Baixando ${GCC_IMAGE}..."
  docker pull "$GCC_IMAGE" >/dev/null
fi

# 4. Se for MicroK8s, importar imagens diretamente para o containerd local (sem depender de registry externo)
if [ "$IS_MICROK8S" = true ]; then
  echo "[4/6] Importando imagem para o containerd local do MicroK8s..."
  CTR_SOCK="/var/snap/microk8s/common/run/containerd.sock"
  CTR_BIN="/snap/microk8s/current/bin/ctr"
  if [ -S "$CTR_SOCK" ] && [ -x "$CTR_BIN" ]; then
    "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io images rm "docker.io/library/${APP_IMAGE}" >/dev/null 2>&1 || true
    docker save "$APP_IMAGE" | "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io image import - >/dev/null
    if ! "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io images ls | grep -q "docker.io/library/gcc:latest"; then
      echo "      Importando ${GCC_IMAGE} para o containerd local..."
      docker save "$GCC_IMAGE" | "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io image import - >/dev/null
    fi
  else
    microk8s ctr images rm "docker.io/library/${APP_IMAGE}" >/dev/null 2>&1 || true
    docker save "$APP_IMAGE" | microk8s ctr image import - >/dev/null
  fi
else
  echo "[4/6] Ambiente Kubernetes local detectado (Docker Desktop / K8s padrão)..."
fi

# 5. Sincronizar Secret no namespace dedicado forçando execução e imagens locais
echo "[5/6] Sincronizando Secret 'codecheck-env' para nó único (${TARGET_NODE:-local})..."
CLEAN_ENV=$(mktemp)
grep -E '^[A-Za-z0-9_]+=' "$ENV_FILE" | awk -F= '{if (!seen[$1]++) { k=$1; sub(/^[^=]*=/, ""); gsub(/^[\x27"]|[\x27"]$/, ""); print k "=" $0 }}' > "$CLEAN_ENV"

# Sobrescreve variáveis de K8s para modo Single-Node (independente do cluster)
grep -v -E '^(K8S_NAMESPACE|K8S_IMAGE|K8S_IMAGE_PULL_POLICY|K8S_WORKER_NODE)=' "$CLEAN_ENV" > "${CLEAN_ENV}.tmp" || true
mv "${CLEAN_ENV}.tmp" "$CLEAN_ENV"
{
  echo "K8S_NAMESPACE=${NAMESPACE}"
  echo "K8S_IMAGE=${GCC_IMAGE}"
  echo "K8S_IMAGE_PULL_POLICY=IfNotPresent"
  if [ -n "$TARGET_NODE" ]; then
    echo "K8S_WORKER_NODE=${TARGET_NODE}"
  fi
} >> "$CLEAN_ENV"

$KUBECMD create secret generic codecheck-env \
  --from-env-file="$CLEAN_ENV" \
  --namespace="$NAMESPACE" \
  --dry-run=client -o yaml | $KUBECMD apply -f - >/dev/null
rm -f "$CLEAN_ENV"

# 6. Aplicar manifesto single-node e fixar no nó local
echo "[6/6] Aplicando manifesto 'codecheck.yaml' e reiniciando aplicação..."
$KUBECMD apply -f codecheck.yaml >/dev/null

if [ -n "$TARGET_NODE" ]; then
  $KUBECMD patch deployment codecheck-app -n "$NAMESPACE" \
    --type='json' \
    -p="[{\"op\": \"add\", \"path\": \"/spec/template/spec/nodeSelector\", \"value\": {\"kubernetes.io/hostname\": \"${TARGET_NODE}\"}}]" >/dev/null
fi

$KUBECMD rollout restart deployment codecheck-app -n "$NAMESPACE" >/dev/null

echo "⏳ Aguardando Pod atingir estado Ready (timeout 120s)..."
$KUBECMD rollout status deployment codecheck-app -n "$NAMESPACE" --timeout=120s || true

echo "=================================================="
echo "✅ Deploy Single-Node finalizado com sucesso!"
echo "=================================================="
$KUBECMD get pods -n "$NAMESPACE" -o wide
