#!/usr/bin/env bash
set -e

NAMESPACE="codecheck"
ENV_FILE=".env"
REGISTRY="localhost:32000"

# Processamento de argumentos
FORCED_MODE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --single-node|-s)
      FORCED_MODE="single"
      shift
      ;;
    --multi-node|-m)
      FORCED_MODE="multi"
      shift
      ;;
    --help|-h)
      echo "Uso: ./deploy.sh [OPÇÕES]"
      echo ""
      echo "Opções:"
      echo "  (sem argumentos)   Detecta automaticamente se é Single-Node ou Cluster Multi-Node"
      echo "  --single-node, -s  Força deploy em nó único (executa app e workers no nó local)"
      echo "  --multi-node,  -m  Força deploy em cluster multi-node (distribui workers pelos nós)"
      echo "  --help,        -h  Exibe esta mensagem de ajuda"
      exit 0
      ;;
    *)
      echo "Opção desconhecida: $1"
      echo "Use ./deploy.sh --help para ver as opções disponíveis."
      exit 1
      ;;
  esac
done

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Arquivo .env não encontrado!"
  exit 1
fi

# Detecta kubectl / microk8s
if command -v microk8s >/dev/null 2>&1; then
  KUBECMD="microk8s kubectl"
  IS_MICROK8S=true
else
  KUBECMD="kubectl"
  IS_MICROK8S=false
fi

# Detecta nó local (ex.: ubuntu05 no Linux ou docker-desktop no Windows)
HOST_NODE=$(hostname 2>/dev/null || echo "")
if [ -n "$HOST_NODE" ] && $KUBECMD get node "$HOST_NODE" >/dev/null 2>&1; then
  TARGET_NODE="$HOST_NODE"
else
  TARGET_NODE=$($KUBECMD get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
fi

# Conta número de nós do cluster
TOTAL_NODES=$($KUBECMD get nodes --no-headers 2>/dev/null | wc -l || echo "1")

# Verifica se o Container Registry local do cluster está disponível
HAS_REGISTRY=false
if curl -s -m 2 "http://${REGISTRY}/v2/" >/dev/null 2>&1 || $KUBECMD get ns container-registry >/dev/null 2>&1; then
  HAS_REGISTRY=true
fi

# Determina o modo de operação final
if [ -n "$FORCED_MODE" ]; then
  MODE="$FORCED_MODE"
elif [ "$TOTAL_NODES" -gt 1 ] && [ "$HAS_REGISTRY" = true ]; then
  MODE="multi"
else
  MODE="single"
fi

if [ "$MODE" = "multi" ]; then
  APP_IMAGE="${REGISTRY}/codecheck-app:latest"
  GCC_IMAGE="${REGISTRY}/gcc:latest"
  WORKER_NODE_CONF=""
  PULL_POLICY="IfNotPresent"
  DESC_MODO="Cluster Multi-Node (${TOTAL_NODES} nós detectados, escalonamento distribuído)"
else
  APP_IMAGE="codecheck-app:latest"
  GCC_IMAGE="gcc:latest"
  WORKER_NODE_CONF="${TARGET_NODE}"
  PULL_POLICY="IfNotPresent"
  DESC_MODO="Single-Node (Ambiente local / nó único: ${TARGET_NODE:-local})"
fi

echo "=================================================="
echo "🚀 Deploy Universal do CodeCheck-RUN"
echo "   Modo:        ${DESC_MODO}"
echo "   Namespace:   ${NAMESPACE}"
if [ "$MODE" = "multi" ]; then
  echo "   Agendamento: Dinâmico (Pods distribuídos livremente entre os nós do cluster)"
else
  echo "   Nó Alvo:     ${TARGET_NODE:-local}"
fi
echo "   App Image:   ${APP_IMAGE}"
echo "   GCC Image:   ${GCC_IMAGE}"
echo "=================================================="

# 1. Garantir existência do Namespace
echo "[1/6] Verificando/criando namespace '${NAMESPACE}'..."
$KUBECMD get ns "$NAMESPACE" >/dev/null 2>&1 || $KUBECMD create ns "$NAMESPACE" >/dev/null

# 2. Construir imagem Docker localmente
echo "[2/6] Construindo imagem Docker da aplicação (${APP_IMAGE})..."
docker build -t "$APP_IMAGE" . >/dev/null
if [ "$MODE" = "multi" ]; then
  docker tag "$APP_IMAGE" "codecheck-app:latest" >/dev/null 2>&1 || true
fi

# 3. Publicar ou importar imagens nos nós
echo "[3/6] Distribuindo imagens no cluster..."
if [ "$MODE" = "multi" ]; then
  echo "      Enviando imagem da aplicação ao registry (${APP_IMAGE})..."
  docker push "$APP_IMAGE" >/dev/null

  if ! docker image inspect "$GCC_IMAGE" >/dev/null 2>&1; then
    echo "      Garantindo compilador GCC no registry (${GCC_IMAGE})..."
    docker pull gcc:latest >/dev/null
    docker tag gcc:latest "$GCC_IMAGE"
    docker push "$GCC_IMAGE" >/dev/null
  else
    docker push "$GCC_IMAGE" >/dev/null 2>&1 || true
  fi
fi

# Se for MicroK8s, garante importação direta no containerd local para fallback de latência zero
if [ "$IS_MICROK8S" = true ]; then
  CTR_SOCK="/var/snap/microk8s/common/run/containerd.sock"
  CTR_BIN="/snap/microk8s/current/bin/ctr"
  if [ -S "$CTR_SOCK" ] && [ -x "$CTR_BIN" ]; then
    "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io images rm "docker.io/library/codecheck-app:latest" >/dev/null 2>&1 || true
    docker save "codecheck-app:latest" | "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io image import - >/dev/null
    if ! "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io images ls | grep -q "docker.io/library/gcc:latest"; then
      docker pull gcc:latest >/dev/null 2>&1 || true
      docker save gcc:latest | "$CTR_BIN" --address "$CTR_SOCK" -n k8s.io image import - >/dev/null
    fi
  else
    microk8s ctr images rm "docker.io/library/codecheck-app:latest" >/dev/null 2>&1 || true
    docker save "codecheck-app:latest" | microk8s ctr image import - >/dev/null
  fi
fi

# 4. Sincronizar Secret no namespace dedicado
echo "[4/6] Sincronizando Secret 'codecheck-env'..."
CLEAN_ENV=$(mktemp)
grep -E '^[A-Za-z0-9_]+=' "$ENV_FILE" | awk -F= '{if (!seen[$1]++) { k=$1; sub(/^[^=]*=/, ""); gsub(/^[\x27"]|[\x27"]$/, ""); print k "=" $0 }}' > "$CLEAN_ENV"

# Ajusta variáveis de orquestração no Secret
grep -v -E '^(K8S_NAMESPACE|K8S_IMAGE|K8S_IMAGE_PULL_POLICY|K8S_WORKER_NODE)=' "$CLEAN_ENV" > "${CLEAN_ENV}.tmp" || true
mv "${CLEAN_ENV}.tmp" "$CLEAN_ENV"
{
  echo "K8S_NAMESPACE=${NAMESPACE}"
  echo "K8S_IMAGE=${GCC_IMAGE}"
  echo "K8S_IMAGE_PULL_POLICY=${PULL_POLICY}"
  echo "K8S_WORKER_NODE=${WORKER_NODE_CONF}"
} >> "$CLEAN_ENV"

$KUBECMD create secret generic codecheck-env \
  --from-env-file="$CLEAN_ENV" \
  --namespace="$NAMESPACE" \
  --dry-run=client -o yaml | $KUBECMD apply -f - >/dev/null
rm -f "$CLEAN_ENV"

# 5. Aplicar manifesto base e fixar nó da aplicação
echo "[5/6] Aplicando manifesto 'codecheck.yaml'..."
$KUBECMD apply -f codecheck.yaml >/dev/null

# Ajusta imagem do deployment para o modo escolhido
$KUBECMD set image deployment/codecheck-app codecheck-server="${APP_IMAGE}" -n "$NAMESPACE" >/dev/null 2>&1 || true

# Configura agendamento do pod da aplicação no nó local onde a imagem foi compilada
if [ -n "$TARGET_NODE" ]; then
  $KUBECMD patch deployment codecheck-app -n "$NAMESPACE" \
    --type='json' \
    -p="[{\"op\": \"add\", \"path\": \"/spec/template/spec/nodeSelector\", \"value\": {\"kubernetes.io/hostname\": \"${TARGET_NODE}\"}}]" >/dev/null 2>&1 || true
fi

# 6. Reiniciar aplicação e aguardar Pod
echo "[6/6] Reiniciando aplicação com Rolling Update..."
$KUBECMD rollout restart deployment codecheck-app -n "$NAMESPACE" >/dev/null

echo "⏳ Aguardando Pod atingir estado Ready (timeout 120s)..."
$KUBECMD rollout status deployment codecheck-app -n "$NAMESPACE" --timeout=120s || true

echo "=================================================="
echo "✅ Deploy finalizado com sucesso no namespace '${NAMESPACE}'!"
echo "=================================================="
$KUBECMD get pods -n "$NAMESPACE" -o wide
