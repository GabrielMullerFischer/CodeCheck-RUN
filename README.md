# Guia de Instalação e Implantação — CodeCheck-RUN

Este documento reúne todos os pré-requisitos, configurações de infraestrutura, variáveis de ambiente e comandos necessários para instalar, configurar e colocar em produção o **CodeCheck-RUN** (Juiz de Programação em C com integração LTI 1.3 ao Moodle) utilizando orquestração nativa via **Kubernetes**.

---

## 1. Visão Geral da Arquitetura

O sistema adota uma arquitetura desacoplada e orientada a contêineres:

* **Aplicação Principal (Node.js 20 / Express):** Executa o servidor HTTP, orquestra a sessão LTI 1.3 e gerencia o ciclo de vida das submissões comunicando-se diretamente com a API do Kubernetes.
* **Sandbox de Execução (Kubernetes Pods Efêmeros):** Cada compilação e execução de código do aluno cria um Pod isolado baseado em `gcc:latest`, com flags de compilação matemática (`-lm`), limites rígidos de recursos (`requests`/`limits`) e sem acesso à rede externa.
* **Banco de Dados (MongoDB / Atlas):** Armazena dados de usuários, listas de exercícios, tentativas, pontuações e métricas de desempenho.
* **Armazenamento de Objetos (MinIO S3):** Mantém persistidos os rascunhos, histórico de códigos `.c` e logs de depuração das execuções.

---

## 2. Requisitos de Sistema

* **Orquestrador:** Cluster Kubernetes operacional (k3s, MicroK8s, Minikube ou Kubernetes multi-node v1.24+).
* **Hardware Mínimo Recomendado:**
  * **CPU:** 4 vCPUs ou núcleos dedicados.
  * **Memória RAM:** 8 GB.
  * **Armazenamento:** 40 GB SSD.
* **Portas de Rede / Serviços:**
  * `3000/TCP`: Interface Web principal da aplicação.
  * `3001/TCP`: Endpoint de autenticação e redirecionamento LTI 1.3 (`PORT + 1`).
  * `9000/TCP`: API S3 do MinIO.
  * `9001/TCP`: Painel Administrativo Web do MinIO.

---

## 3. Instalação das Dependências do Sistema

Atualize os repositórios locais e instale os pacotes fundamentais:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git apt-transport-https ca-certificates gnupg lsb-release
```

Instale o cliente de linha de comando do Kubernetes (`kubectl`):

```bash
curl -fsSL [https://pkgs.k8s.io/core:/stable:/v1.30/deb/Release.key](https://pkgs.k8s.io/core:/stable:/v1.30/deb/Release.key) | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] [https://pkgs.k8s.io/core:/stable:/v1.30/deb/](https://pkgs.k8s.io/core:/stable:/v1.30/deb/) /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo apt update
sudo apt install -y kubectl
```

Baixe previamente a imagem base do compilador GCC utilizada nas sandboxes:

```bash
docker pull gcc:latest
```

---

## 4. Configuração do MinIO (Armazenamento de Objetos)

### 4.1. Criar diretório de dados persistentes

```bash
sudo mkdir -p /data/minio
sudo chown -R $USER:$USER /data/minio
```

### 4.2. Inicializar o servidor MinIO

Suba o serviço MinIO vinculando o diretório de dados com as credenciais que serão inseridas no `.env`:

```bash
docker run -d \
  --name minio-server \
  --restart unless-stopped \
  -p 9000:9000 \
  -p 9001:9001 \
  -e "MINIO_ROOT_USER=minio_admin" \
  -e "MINIO_ROOT_PASSWORD=minio_senha_segura" \
  -v /data/minio:/data \
  minio/minio server /data --console-address ":9001"
```

* **Console Web:** `http://IP_DO_SERVIDOR:9001`
* **Endpoint da API:** `http://IP_DO_SERVIDOR:9000`

---

## 5. Configuração da Aplicação

### 5.1. Clonar o repositório

```bash
git clone [https://github.com/GabrielMullerFischer/CodeCheck-RUN.git](https://github.com/GabrielMullerFischer/CodeCheck-RUN.git)
cd CodeCheck-RUN
```

### 5.2. Criar e preencher o `.env`

Crie o arquivo de variáveis na raiz do projeto:

```bash
nano .env
```

Preencha os valores conforme o modelo abaixo:

```env
# Porta do Servidor
PORT=3000

# MiniO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minio_admin
MINIO_SECRET_KEY=minio_senha_segura
MINIO_NAME=arquivos-alunos

# Autenticação e Sessão
SESSION_SECRET="sua_chave_secreta_de_sessao_exemplo_123456"
LTI_ENCRYPTION_KEY="sua_chave_de_criptografia_lti_exemplo_123456"

# MongoDB
MONGO_DB_URI=mongodb+srv://usuario_exemplo:senha_exemplo@cluster-exemplo.mongodb.net/codecheck?retryWrites=true&w=majority

# Integração LTI / Moodle
LTI_PLATFORM_URL='https://moodle.exemplo.edu.br'
LTI_PLATFORM_NAME='MOODLE-EXEMPLO'
LTI_CLIENT_ID='client_id_exemplo_123'
LTI_AUTH_ENDPOINT='https://moodle.exemplo.edu.br/mod/lti/auth.php'
LTI_TOKEN_ENDPOINT='https://moodle.exemplo.edu.br/mod/lti/token.php'
LTI_KEYSET_ENDPOINT='https://moodle.exemplo.edu.br/mod/lti/certs.php'

# Sandbox de Execução via Kubernetes
K8S_NAMESPACE=default
K8S_IMAGE=gcc:latest
K8S_CPU_REQUEST=500m
K8S_CPU_LIMIT=500m
K8S_MEMORY_REQUEST=512Mi
K8S_MEMORY_LIMIT=512Mi
MAX_CONCURRENT_COMPILATIONS=4

# Configurações do Juiz / Sandbox
COMPILE_TIMEOUT=30000
DEFAULT_TIME_LIMIT_MS=5000
MAX_EXECUTION_TIME_LIMIT_MS=7200000
MAX_SUBMISSION_HISTORY=10
LIMPEZATMP=30
```

### 5.3. Dicionário das Variáveis de Ambiente

| Variável | Valor Padrão / Exemplo | Descrição |
| :--- | :--- | :--- |
| `PORT` | `3000` | Porta TCP do servidor Express. |
| `SESSION_SECRET` | `...` | Segredo para assinar cookies de sessão. |
| `LTI_ENCRYPTION_KEY` | `...` | Chave simétrica para encriptação LTI. |
| `MONGO_DB_URI` | `mongodb+srv://...` | URI de conexão do cluster MongoDB. |
| `MINIO_ENDPOINT` | `localhost` | Endereço de rede do servidor MinIO. |
| `MINIO_PORT` | `9000` | Porta da API S3 do MinIO. |
| `MINIO_ACCESS_KEY` | `minio_admin` | Chave de acesso do MinIO. |
| `MINIO_SECRET_KEY` | `minio_senha_segura` | Chave secreta de autenticação do MinIO. |
| `MINIO_NAME` | `arquivos-alunos` | Nome do bucket para armazenar os códigos e logs. |
| `LTI_PLATFORM_URL` | `https://moodle.exemplo.edu.br` | URL base do Moodle. |
| `LTI_PLATFORM_NAME` | `MOODLE-EXEMPLO` | Identificador da ferramenta configurada no LMS. |
| `LTI_CLIENT_ID` | `client_id_exemplo_123` | Client ID registrado no Moodle. |
| `LTI_AUTH_ENDPOINT` | `.../auth.php` | Endpoint de autenticação OIDC do Moodle. |
| `LTI_TOKEN_ENDPOINT` | `.../token.php` | Endpoint para troca de tokens de serviço LTI. |
| `LTI_KEYSET_ENDPOINT`| `.../certs.php` | Endpoint JWKS para validação das chaves públicas. |
| `K8S_NAMESPACE` | `default` | Namespace onde os Pods de execução são criados. |
| `K8S_IMAGE` | `gcc:latest` | Imagem utilizada para compilar e executar o código C. |
| `K8S_CPU_REQUEST` / `LIMIT` | `500m` | Fração de CPU reservada e limite por Pod. |
| `K8S_MEMORY_REQUEST` / `LIMIT`| `512Mi` | Quantidade de RAM reservada e limite por Pod. |
| `MAX_CONCURRENT_COMPILATIONS` | `4` | Máximo de compilações simultâneas na fila. |
| `COMPILE_TIMEOUT` | `30000` | Tempo limite padrão do juiz em milissegundos (30s). |
| `DEFAULT_TIME_LIMIT_MS` | `5000` | Sugestão padrão no modal do professor ao marcar tempo limite (5s). |
| `MAX_EXECUTION_TIME_LIMIT_MS` | `7200000` | Teto absoluto aceito pelo sistema (2 horas). |
| `MAX_SUBMISSION_HISTORY` | `10` | Quantidade de submissões mantidas por pasta no MinIO. |
| `LIMPEZATMP` | `30` | Minutos para expiração de pastas temporárias. |

---

## 6. Implantação no Cluster Kubernetes

### 6.1. Criar o Secret com as Variáveis de Ambiente

Crie o Secret no namespace de execução a partir do arquivo `.env`:

```bash
kubectl create secret generic codecheck-env --from-env-file=.env -n default
```

*(Caso altere o `.env` no futuro, execute `kubectl delete secret codecheck-env -n default` e recrie-o).*

### 6.2. Construir a Imagem da Aplicação

Construa a imagem para produção:

```bash
docker build -t codecheck-app:latest .
```

*Nota: Se estiver operando em um cluster multi-node, envie a imagem para o seu container registry (`docker tag` e `docker push`) ou importe-a diretamente nos nós de trabalho.*

### 6.3. Aplicar os Recursos Kubernetes (RBAC, Deployment e Service)

Aplique as definições de ServiceAccount, Role, RoleBinding, Deployment e Service presentes no manifesto:

```bash
kubectl apply -f k8s/codecheck.yaml
```

---

## 7. Atualização Contínua (Deploy de Novos Commits)

Para atualizar o sistema após alterações no repositório:

```bash
# 1. Puxar alterações do repositório
git pull origin main

# 2. Reconstruir a imagem da aplicação
docker build -t codecheck-app:latest .

# 3. Reiniciar o Deployment para atualizar os Pods
kubectl rollout restart deployment/codecheck-app -n default
```

---

## 8. Diagnóstico e Monitoramento

* **Acompanhar os logs da aplicação principal:**
  ```bash
  kubectl logs -f deployment/codecheck-app -n default
  ```

* **Monitorar os Pods efêmeros dos alunos sendo criados e destruídos em tempo real:**
  ```bash
  kubectl get pods -n default -w
  ```

* **Inspecionar as portas e o Service ativo:**
  ```bash
  kubectl get svc codecheck-service -n default
  ```

* **Acessar o MinIO:**
  Acesse `http://IP_DO_SERVIDOR:9001` com as credenciais minio_administrativas definidas no `.env` para verificar a criação automática do bucket configurado em `MINIO_NAME`.