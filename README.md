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

## 3. Preparação do Projeto e Configuração do `.env`

Antes de instalar o servidor, clone o repositório e crie o arquivo de configuração `.env`:

```bash
git clone https://github.com/usuario-exemplo/CodeCheck-RUN.git
cd CodeCheck-RUN
cp .env.example .env
nano .env
```

> [!IMPORTANT]
> **Ordem de Preenchimento do `.env` (Regra das Duas Fases):**
> * **PARTE 1 (Obrigatória ANTES de instalar o servidor):** As portas e as credenciais do **MinIO** (`PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, etc.) **DEVEM** ser configuradas antes de rodar o instalador do servidor (`./install-server.sh`), pois o contêiner do MinIO é criado com essas credenciais nessa etapa. O script bloqueará a instalação se essa parte estiver vazia.
> * **PARTE 2 (Configurar DEPOIS da instalação do servidor):** As configurações de banco de dados (`MONGO_DB_URI`), integração LTI 1.3 / Moodle e limites dos contêineres K8s **só serão necessárias na hora de subir a aplicação (`./deploy.sh`)**. Você pode instalar o servidor primeiro e preencher esses parâmetros antes do deploy.

*(Consulte o arquivo `.env.example` na raiz do projeto para o modelo detalhado de todas as variáveis e comentários explicativos).*

---

## 4. Instalação da Infraestrutura do Servidor

Com o repositório clonado e a **PARTE 1** do `.env` configurada, execute o script de instalação automatizada:

```bash
chmod +x install-server.sh
./install-server.sh
```

O script prepara automaticamente todo o ambiente Ubuntu (22.04 ou 24.04):
1. **Validação do `.env`:** Garante que o `.env` existe e contém as credenciais do MinIO configuradas.
2. **Docker e Snapd:** Atualiza os pacotes e instala os serviços necessários.
3. **MicroK8s:** Instala o cluster e adiciona o usuário aos grupos de permissão (`microk8s` e `docker`).
4. **Addons do Cluster:** Habilita `dns`, `rbac` e `hostpath-storage`.
5. **Armazenamento MinIO:** Cria o contêiner persistente do MinIO com as credenciais do seu `.env`.
6. **Compilador GCC:** Baixa a imagem `gcc:latest` e importa para o containerd do MicroK8s.
7. **Permissões:** Torna os scripts executáveis.

> **Pós-instalação:** Se for o primeiro acesso do seu usuário ao grupo do MicroK8s, execute `newgrp microk8s` (ou feche e abra a sessão SSH novamente) antes de rodar o deploy.

---

## 5. Deploy e Execução da Aplicação

### 5.1. Concluir o `.env` (PARTE 2)
Abra o `.env` e certifique-se de que a **PARTE 2** está preenchida (string do MongoDB, credenciais LTI do Moodle e recursos dos contêineres):

```bash
nano .env
```

### 5.2. Executar o Deploy
Inicie a aplicação utilizando o script de deploy automatizado:

```bash
chmod +x deploy.sh
./deploy.sh
```

O script realiza o build da imagem, sincroniza a Secret com base no `.env`, aplica o manifesto `codecheck.yaml` e atualiza os pods reiniciando-os.

---

## 6. Acesso aos Serviços

Após o deploy, os serviços estarão acessíveis nos seguintes endereços:

* **Aplicação Web:** `http://<IP_DO_SERVIDOR>:3000`
* **Endpoint de Autenticação LTI 1.3:** `http://<IP_DO_SERVIDOR>:3001`
* **Painel Administrativo do MinIO:** `http://<IP_DO_SERVIDOR>:9001` *(login com as credenciais da PARTE 1 do `.env`)*
* **API S3 do MinIO:** `http://<IP_DO_SERVIDOR>:9000`

---

## 7. Atualização Contínua (Novos Commits)

Para atualizar a aplicação após novos commits no repositório:

```bash
git pull origin main
./deploy.sh
```

---

## 8. Diagnóstico e Monitoramento

* **Logs da aplicação em tempo real:**
  ```bash
  microk8s kubectl logs -f deployment/codecheck-app -n default
  ```

* **Acompanhar pods dos alunos e status da aplicação:**
  ```bash
  microk8s kubectl get pods -n default -o wide -w
  ```

* **Verificar o contêiner do MinIO:**
  ```bash
  docker ps -f name=minio-server
  ```