# Guia de Instalação e Implantação — CodeCheck-RUN

Este documento reúne todos os pré-requisitos, dependências de sistema, configurações de containers e comandos necessários para instalar, configurar e colocar em produção o ambiente do **CodeCheck-RUN** (Juiz de Programação em C com integração LTI 1.3 ao Moodle).

## 1. Visão Geral da Arquitetura

O sistema é composto por:

* **Aplicação Principal (Node.js 20 / Express):** Executa o servidor web, autenticação LTI 1.3 e lógica do juiz.

* **Banco de Dados (MongoDB):** Armazena dados de listas, exercícios, tentativas, submissões e métricas.

* **Armazenamento de Objetos (MinIO):** Guarda arquivos de código-fonte `.c`, rascunhos e históricos de submissões.

* **Sandbox de Execução (Docker Engine + Imagem GCC):** Executa e compila o código dos alunos em containers isolados e sem acesso à rede.

## 2. Requisitos de Sistema do Servidor

* **Sistema Operacional:** Ubuntu 22.04 LTS / Debian 11+ (ou distribuição Linux equivalente).

* **Hardware Recomendado (Turma de até 30 alunos simultâneos):**

  * **CPU:** 4 vCPUs.

  * **Memória RAM:** 8 GB.

  * **Armazenamento:** 40 GB SSD.

* **Portas de Rede Necessárias:**

  * `3000/TCP`: Porta principal da aplicação (HTTP/HTTPS via proxy reverso).

  * `3001/TCP`: Porta interna do mecanismo LTI (`PORT + 1`).

  * `9000/TCP`: API S3 do MinIO.

  * `9001/TCP`: Console Web do MinIO.

  * `27017/TCP`: MongoDB (caso instalado localmente).

## 3. Instalação das Dependências Básicas

Atualize os pacotes do sistema e instale os utilitários fundamentais:

```
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential apt-transport-https ca-certificates gnupg lsb-release

```

## 4. Instalação e Configuração do Docker Engine

O motor de correção depende diretamente do Docker para criar containers efêmeros e seguros para cada compilação de código em C.

### 4.1. Instalar o Docker

```
# Adiciona a chave GPG oficial do Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Configura o repositório
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Instala o Docker e plugins
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Adiciona o usuário atual ao grupo docker para executar sem sudo
sudo usermod -aG docker $USER
newgrp docker

```

### 4.2. Baixar a imagem GCC (Sandbox dos Alunos)

Baixe a imagem oficial do compilador GCC que o `judgeService` usa para compilar e rodar os códigos:

```
docker pull gcc:latest

```

## 5. Instalação e Configuração do MinIO

O MinIO é utilizado para o armazenamento dos rascunhos e históricos de submissões.

### 5.1. Criar o diretório de dados persistentes

```
sudo mkdir -p /data/minio
sudo chown -R $USER:$USER /data/minio

```

### 5.2. Subir o container do MinIO

Execute o MinIO com credenciais seguras:

```
docker run -d \
  --name minio-server \
  --restart unless-stopped \
  -p 9000:9000 \
  -p 9001:9001 \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=SuaSenhaForteMinio123!" \
  -v /data/minio:/data \
  minio/minio server /data --console-address ":9001"

```

* **Acesso Web (Console):** `http://IP_DO_SERVIDOR:9001`

* **API Endpoint:** `http://IP_DO_SERVIDOR:9000`

## 6. Configuração do MongoDB

Você pode utilizar uma instância gerenciada (MongoDB Atlas) ou subir um container local:

```
sudo mkdir -p /data/mongodb
sudo chown -R $USER:$USER /data/mongodb

docker run -d \
  --name mongodb-codecheck \
  --restart unless-stopped \
  -p 27017:27017 \
  -v /data/mongodb:/data/db \
  mongo:7.0

```

## 7. Instalação e Configuração da Aplicação

### 7.1. Clonar o repositório

```
git clone https://github.com/GabrielMullerFischer/CodeCheck-RUN.git
cd CodeCheck-RUN

```

### 7.2. Configurar o arquivo `.env`

Crie o arquivo de variáveis na raiz do projeto:

```
nano .env

```

Preencha os valores de acordo com sua infraestrutura:

```
# Configurações do Servidor
PORT=3000
NODE_ENV=production
SESSION_SECRET=coloque_uma_chave_secreta_aleatoria_longa_aqui

# Banco de Dados MongoDB
MONGO_DB_URI=mongodb://localhost:27017/codecheck
# OU MongoDB Atlas:
# MONGO_DB_URI=mongodb+srv://usuario:senha@cluster.mongodb.net/codecheck?retryWrites=true&w=majority

# Armazenamento MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=SuaSenhaForteMinio123!
MINIO_NAME=arquivos-alunos

# Configurações do Juiz / Sandbox
COMPILE_TIMEOUT=30000
TIMEOUT_ALUNO=10000
DEFAULT_EXECUTION_TIME_LIMIT_MS=1000
MAX_EXECUTION_TIME_LIMIT_MS=7200000
MAX_SUBMISSION_HISTORY=10
DOCKER_CPU_LIMIT=0.25
DOCKER_MEMORY_LIMIT=128m
LIMPEZATMP=10

# Integração LTI 1.3 (Moodle)
LTI_ENCRYPTION_KEY=chave_de_criptografia_lti_super_secreta
LTI_PLATFORM_URL=https://moodle.suainstituicao.edu.br
LTI_PLATFORM_NAME=MoodleInst
LTI_CLIENT_ID=seu_client_id_gerado_no_moodle
LTI_AUTH_ENDPOINT=https://moodle.suainstituicao.edu.br/mod/lti/auth.php
LTI_TOKEN_ENDPOINT=https://moodle.suainstituicao.edu.br/mod/lti/token.php
LTI_KEYSET_ENDPOINT=https://moodle.suainstituicao.edu.br/mod/lti/certs.php

```

## 8. Execução da Aplicação via Docker

Como a aplicação cria containers sob demanda para compilar e testar os códigos em C, o container do CodeCheck-RUN precisa ter acesso ao socket do Docker do host (`/var/run/docker.sock`).

1. **Construir a imagem da aplicação:**

```
docker build -t codecheck-app .

```

2. **Iniciar o container da aplicação:**

```
docker run -d \
  --name codecheck-app \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 3001:3001 \
  --env-file .env \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $(pwd)/tmp:/app/tmp \
  codecheck-app

```

## 9. Atualização Contínua (Deploy de Novos Commits)

Sempre que subir novidades no repositório GitHub, execute o seguinte comando no servidor:

```
# 1. Entrar na pasta e puxar o código atualizado
cd /caminho/para/CodeCheck-RUN
git pull origin main

# 2. Reconstruir a imagem e reiniciar o container
docker build -t codecheck-app .
docker stop codecheck-app
docker rm codecheck-app

docker run -d \
  --name codecheck-app \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 3001:3001 \
  --env-file .env \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $(pwd)/tmp:/app/tmp \
  codecheck-app

```

## 10. Verificação e Diagnóstico

* **Acompanhar logs da aplicação em tempo real:**

  ```
  docker logs -f codecheck-app
  
  ```

* **Testar se o container do GCC responde:**

  ```
  docker run --rm gcc gcc --version
  
  ```

* **Testar acesso ao MinIO:**
  Acesse `http://IP_DO_SERVIDOR:9001` no navegador com seu usuário e senha definidos no `.env` e confirme se o bucket `arquivos-alunos` foi inicializado após a primeira subida da aplicação.
