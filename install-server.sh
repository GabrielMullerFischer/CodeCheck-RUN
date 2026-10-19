#!/usr/bin/env bash
# ==============================================================================
# CodeCheck-RUN — Script de Instalação e Configuração Automatizada do Servidor
# Plataforma Alvo: Ubuntu 22.04 LTS / 24.04 LTS
# Componentes: Docker, MicroK8s (DNS, RBAC, Storage), MinIO S3, Sandbox GCC
# ==============================================================================

set -e

# Cores para feedback no terminal
VERDE='\033[0;32m'
AZUL='\033[0;34m'
AMARELO='\033[1;33m'
VERMELHO='\033[0;31m'
NC='\033[0m'

echo -e "${AZUL}==================================================================${NC}"
echo -e "${AZUL}      CodeCheck-RUN — Instalação do Servidor (MicroK8s + MinIO)   ${NC}"
echo -e "${AZUL}==================================================================${NC}"

# 1. Verificação de permissões
SUDO=""
if [ "$EUID" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo -e "${VERMELHO}[ERRO] Este script requer privilégios de administrador (root ou sudo).${NC}"
    exit 1
  fi
fi

# Detectar usuário real (caso execute com sudo)
TARGET_USER="${SUDO_USER:-$USER}"
TARGET_HOME=$(eval echo "~$TARGET_USER")

echo -e "\n${AZUL}[Verificação Inicial] Validando configurações obrigatórias do .env...${NC}"

if [ ! -f ".env" ]; then
  echo -e "${VERMELHO}[ERRO] O arquivo .env não foi encontrado na raiz do projeto!${NC}"
  echo -e "${AMARELO}O arquivo .env DEVE ser criado antes de instalar o servidor.${NC}"
  echo -e "O contêiner do MinIO precisa receber o usuário e a senha configurados no momento da criação."
  echo -e ""
  echo -e "Como prosseguir agora:"
  echo -e "  1. Crie o arquivo a partir do modelo:  ${AZUL}cp .env.example .env${NC}"
  echo -e "  2. Abra o arquivo:                    ${AZUL}nano .env${NC}"
  echo -e "  3. Preencha as variáveis da ${AZUL}PARTE 1${NC} (Porta e credenciais do MinIO)."
  echo -e "  4. Execute novamente este instalador:  ${AZUL}./install-server.sh${NC}"
  echo -e ""
  echo -e "${AMARELO}(Nota: As variáveis da PARTE 2 — MongoDB, LTI e recursos K8s — podem ser preenchidas depois, antes de rodar o deploy).${NC}\n"
  exit 1
fi

# Extrair credenciais do MinIO da PARTE 1 do .env
MINIO_USER=$(grep -E '^[[:space:]]*MINIO_ACCESS_KEY=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r' | xargs)
MINIO_PASS=$(grep -E '^[[:space:]]*MINIO_SECRET_KEY=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r' | xargs)

if [ -z "$MINIO_USER" ] || [ -z "$MINIO_PASS" ]; then
  echo -e "${VERMELHO}[ERRO] Credenciais do MinIO não preenchidas no arquivo .env!${NC}"
  echo -e "As variáveis ${AZUL}MINIO_ACCESS_KEY${NC} e ${AZUL}MINIO_SECRET_KEY${NC} são obrigatórias na PARTE 1 do .env."
  echo -e "Por favor, defina um usuário e senha para o MinIO no seu .env e execute novamente:"
  echo -e "  ${AZUL}./install-server.sh${NC}\n"
  exit 1
fi

echo -e "${VERDE}Configurações obrigatórias da PARTE 1 encontradas no .env.${NC}"

echo -e "\n${AZUL}[1/7] Atualizando repositórios e instalando dependências base...${NC}"
$SUDO apt-get update -y
$SUDO apt-get install -y \
  curl \
  wget \
  git \
  ca-certificates \
  gnupg \
  lsb-release \
  apt-transport-https \
  snapd \
  docker.io

# Garantir serviço do Docker rodando
$SUDO systemctl enable --now docker
if [ -n "$TARGET_USER" ] && [ "$TARGET_USER" != "root" ]; then
  $SUDO usermod -aG docker "$TARGET_USER" || true
fi

echo -e "\n${AZUL}[2/7] Instalando e configurando MicroK8s via Snap...${NC}"
if ! snap list microk8s >/dev/null 2>&1; then
  $SUDO snap install microk8s --classic
else
  echo "MicroK8s já instalado via Snap."
fi

# Permissões do usuário para o MicroK8s
if [ -n "$TARGET_USER" ] && [ "$TARGET_USER" != "root" ]; then
  $SUDO usermod -a -G microk8s "$TARGET_USER" || true
  $SUDO mkdir -p "$TARGET_HOME/.kube"
  $SUDO chown -f -R "$TARGET_USER" "$TARGET_HOME/.kube" || true
fi

echo "Aguardando inicialização do MicroK8s..."
$SUDO microk8s status --wait-ready >/dev/null 2>&1 || true

echo -e "\n${AZUL}[3/7] Habilitando Addons Essenciais do MicroK8s...${NC}"
$SUDO microk8s enable dns rbac hostpath-storage

echo -e "\n${AZUL}[4/7] Configurando Servidor MinIO (Armazenamento S3 com credenciais do .env)...${NC}"
$SUDO mkdir -p /data/minio
$SUDO chown -R 1000:1000 /data/minio || true

# Verificar se container do MinIO já existe
if docker ps -a --format '{{.Names}}' | grep -Eq "^minio-server$"; then
  echo "Container minio-server já existe. Verificando status..."
  if ! docker ps --format '{{.Names}}' | grep -Eq "^minio-server$"; then
    echo "Iniciando container minio-server parado..."
    docker start minio-server
  else
    echo "Container minio-server já está em execução."
  fi
else
  echo "Criando container minio-server com credenciais configuradas..."
  docker rm -f minio #remover resquícios se houver
  docker run -d \
    --name minio-server \
    --restart unless-stopped \
    -p 9000:9000 \
    -p 9001:9001 \
    -e "MINIO_ROOT_USER=$MINIO_USER" \
    -e "MINIO_ROOT_PASSWORD=$MINIO_PASS" \
    -v /data/minio:/data \
    minio/minio server /data --console-address ":9001"
fi

echo -e "\n${AZUL}[5/7] Baixando imagem base do GCC e importando no containerd do MicroK8s...${NC}"
docker pull gcc:latest
echo "Importando gcc:latest para o containerd do MicroK8s..."
$SUDO microk8s ctr images rm docker.io/library/gcc:latest >/dev/null 2>&1 || true
docker save gcc:latest | $SUDO microk8s ctr image import -

echo -e "\n${AZUL}[6/7] Ajustando permissões de execução dos scripts locais...${NC}"
chmod +x deploy.sh || true
chmod +x install-server.sh || true

echo -e "\n${AZUL}[7/7] Verificando preparação para o deploy...${NC}"
echo -e "${VERDE}Infraestrutura do servidor pronta para receber a aplicação.${NC}"

echo -e "${VERDE} ----------------------- Servidor Pronto! ----------------------- ${NC}"
echo -e "${AMARELO}Próximos passos antes de rodar o deploy:${NC}"
echo -e "1. Edite o .env para preencher a ${AZUL}PARTE 2${NC} (MongoDB, LTI 1.3 / Moodle e limites dos contêineres):"
echo -e "   ${AZUL}nano .env${NC}"
echo -e "2. Caso este seja seu primeiro acesso com o usuário '${TARGET_USER}', recarregue os grupos:"
echo -e "   ${AZUL}newgrp microk8s${NC}  (ou reconecte a sessão SSH)"
echo -e "3. Execute o deploy da aplicação:"
echo -e "   ${AZUL}./deploy.sh${NC}"
echo -e "Serviços configurados no servidor:"
echo -e "  • MinIO API S3:       http://<IP_DO_SERVIDOR>:9000"
echo -e "  • MinIO Console Web:  http://<IP_DO_SERVIDOR>:9001 (Credenciais da PARTE 1 do .env)"
echo -e "  • Aplicação Web:      http://<IP_DO_SERVIDOR>:3000"
echo -e "  • Endpoint LTI 1.3:   http://<IP_DO_SERVIDOR>:3001"
echo -e ""

