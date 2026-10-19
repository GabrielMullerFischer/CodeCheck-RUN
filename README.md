# Guia de Instalação e Implantação — CodeCheck-RUN

Este documento reúne todos os pré-requisitos, configurações de infraestrutura, variáveis de ambiente e comandos necessários para instalar, configurar e colocar em produção o **CodeCheck-RUN** (Juiz de Programação em C com integração LTI 1.3 ao Moodle), utilizando orquestração nativa via **Kubernetes**.

---

## 1. Visão Geral da Arquitetura

O sistema adota uma arquitetura desacoplada, resiliente e orientada a contêineres:

* **Aplicação Principal (Node.js 20 / Express):** Executa o servidor HTTP, orquestra a sessão LTI 1.3 e gerencia o ciclo de vida das compilações comunicando-se diretamente com a API do Kubernetes.
* **WarmPool de Pods Quentes (Juiz de Alta Performance):** Mantém contêineres GCC pré-aquecidos (`services/warmPoolService.js`) em espera no cluster. Ao receber um código em C, executa a compilação e os 50 testes diretamente no pod via `k8sExec` em frações de segundo, sem a latência de inicializar um container novo a cada submissão.
* **Isolamento e Segurança de Rede (Calico NetworkPolicy):** Todos os pods de compilação dos alunos rodam com rótulo `role: judge-sandbox` sob uma política de rede restrita e totalmente isolada (*air-gapped*): zero conexões de entrada (`ingress: []`) e zero conexões de saída (`egress: []`).
* **Governança de Recursos (ResourceQuota):** Limites rígidos de CPU, Memória e contagem de pods para garantir que a plataforma nunca monopolize os nós do cluster nem interfira em outros serviços (como `terminal-web` ou jobs MPI).
* **Banco de Dados (MongoDB / Atlas):** Armazena configurações de turmas, exercícios, listas, histórico de tentativas e métricas pedagógicas.
* **Armazenamento de Objetos (MinIO S3):** Mantém persistidos com segurança os códigos submetidos pelos alunos, rascunhos e logs detalhados das compilações.

---

## 2. Requisitos de Sistema

* **Orquestrador:** Cluster Kubernetes operacional (MicroK8s, K3s, Minikube ou Kubernetes multi-node v1.24+).
* **Hardware Mínimo Recomendado:**
  * **CPU:** 4 vCPUs ou núcleos dedicados.
  * **Memória RAM:** 8 GB.
  * **Armazenamento:** 40 GB SSD.
* **Portas de Rede / Serviços:**
  * `3000/TCP`: Interface Web principal interna da aplicação.
  * `3001/TCP`: Endpoint de autenticação e redirecionamento LTI 1.3 interno (`PORT + 1`).
  * `30000/TCP` (NodePort): Exposição externa da Interface Web (para ngrok ou acesso direto).
  * `30001/TCP` (NodePort): Exposição externa do endpoint de autenticação LTI 1.3.
  * `9000/TCP`: API S3 do MinIO.
  * `9001/TCP`: Painel Administrativo Web do MinIO.

---

## 3. Preparação do Projeto e Configuração do `.env`

Clone o repositório e crie o arquivo de configuração `.env` a partir do modelo:

```bash
git clone https://github.com/GabrielMullerFischer/CodeCheck-RUN.git
cd CodeCheck-RUN
cp .env.example .env
nano .env
```

> [!IMPORTANT]
> **Ordem de Preenchimento do `.env` (Regra das Duas Fases):**
> * **PARTE 1 (Obrigatória ANTES de instalar o servidor):** As portas e as credenciais do **MinIO** (`PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, etc.) **DEVEM** ser configuradas antes de rodar o instalador do servidor (`./install-server.sh`), pois o contêiner Docker do MinIO é provisionado nessa etapa.
> * **PARTE 2 (Configurar antes de iniciar a aplicação):** As configurações de banco de dados (`MONGO_DB_URI`), integração LTI 1.3 / Moodle e limites dos contêineres K8s serão carregadas no deploy.

Consulte o arquivo [.env.example](file:///home/ubuntu/CodeCheck-RUN/.env.example) para a lista comentada de cada variável.

---

## 4. Instalação da Infraestrutura do Servidor (Nó Inicial)

Se estiver preparando uma nova máquina Ubuntu (22.04 ou 24.04), execute o script de instalação automatizada:

```bash
chmod +x install-server.sh
./install-server.sh
```

O script configura:
1. Docker Engine e Snapd.
2. MicroK8s com addons essenciais (`dns`, `rbac`, `hostpath-storage`).
3. Contêiner do servidor MinIO persistente.
4. Download e importação da imagem do compilador `gcc:latest`.
5. Permissões de usuário para os grupos `microk8s` e `docker`.

> **Pós-instalação:** Se for o primeiro acesso do seu usuário ao grupo do MicroK8s, execute `newgrp microk8s` (ou encerre e reabra a sessão SSH) antes de continuar.

---

## 5. Estratégias de Deploy da Aplicação

O projeto possui dois fluxos de deploy automatizados, dependendo da topologia do seu cluster:

### Opção A: Cluster Multi-Node (Recomendado para Produção)
Para clusters com múltiplos nós (ex: nós computacionais `ubuntu00` a `ubuntu11`), onde a imagem precisa ser distribuída para qualquer nó do cluster via registry local:

```bash
chmod +x deploy-multinode.sh
./deploy-multinode.sh
```

O que o `./deploy-multinode.sh` faz:
* Cria e isola o namespace dedicado `codecheck`.
* Constrói a imagem da aplicação e publica no Container Registry do cluster (`localhost:32000/codecheck-app:latest`).
* Garante a distribuição da imagem base do compilador (`localhost:32000/gcc:latest`).
* Sincroniza a Secret `codecheck-env` de forma sanitizada.
* Aplica o manifesto unificado `k8s/codecheck.yaml` (Namespace, RBAC, ResourceQuota, NetworkPolicy, Deployment, Service NodePort e Ingress blueprint).
* Executa o rollout com estratégia `Recreate` para nunca sobrepor limites de memória.

---

### Opção B: Servidor Único Standalone (Single-Node)
Para máquinas de desenvolvimento ou servidores com apenas um nó local MicroK8s:

```bash
chmod +x deploy.sh
./deploy.sh
```

O script realiza o build da imagem, importa diretamente para o containerd local (`microk8s ctr image import`) e aplica o manifesto `codecheck.yaml` no namespace `default`.

---

## 6. Catálogo de Conteúdo Pré-Carregado

O sistema já vem integrado de fábrica com um seeder automático ([data/exerciciosPadrao.json](file:///home/ubuntu/CodeCheck-RUN/data/exerciciosPadrao.json)), sincronizado a cada inicialização:

* **20 Listas Temáticas Oficiais:**
  1. Fundamentos e Expressões Aritméticas
  2. Cálculos de Grandeza e Conversões
  3. Estruturas Condicionais Básicas
  4. Regras de Negócio e Tomada de Decisão
  5. Laços de Repetição e Sequências
  6. Algoritmos com Números e Matemática
  7. Vetores (Arrays Unidimensionais)
  8. Cadeias de Caracteres (Strings)
  9. Matrizes Bidimensionais
  10. Algoritmos Avançados, Busca e Structs
  11. Algoritmos Clássicos e Desafios Competitivos
  12. Ordenação, Matrizes e Problemas Clássicos
  13. Ponteiros e Passagem por Referência
  14. Aritmética de Ponteiros e Vetores
  15. Ponteiros e Manipulação de Strings
  16. Alocação Dinâmica de Memória (malloc e free)
  17. Estruturas (Structs) e Ponteiros
  18. Recursão e Algoritmos Clássicos
  19. Algoritmos de Ordenação e Eficiência
  20. Desafios Lógicos e Estruturas Lineares
* **101 Exercícios de Programação em C:**
  * **50 Casos de Teste por Exercício:** Cobrindo fluxos normais, valores extremos, zeros, negativos e limites.
* **Barra de Pesquisa Unificada:**
  * Todas as 5 áreas de busca do painel do professor (Minhas Listas, Criar Lista, Banco de Listas, Banco de Exercícios e o Modal de Edição de Lista) contam com filtragem em tempo real, insensibilidade a acentuação e mensagens de estado vazio.

---

## 7. Configuração da Atividade no Moodle (LTI 1.3)

No painel de **Administração do Moodle** -> **Plugins** -> **Módulos de atividade** -> **Ferramenta externa** -> **Gerenciar ferramentas**:

1. Clique em **Configurar uma ferramenta manualmente**.
2. Preencha os campos de conexão com a URL pública ou túnel ngrok da sua aplicação:
   * **Nome da Ferramenta:** `CodeCheck-RUN`
   * **URL da Ferramenta:** `https://<SEU_DOMINIO_OU_NGROK>/`
   * **Versão do LTI:** `LTI 1.3`
   * **Tipo de chave pública:** `URL do conjunto de chaves (Keyset URL)`
   * **URL do conjunto de chaves:** `https://<SEU_DOMINIO_OU_NGROK>:30001/keys`
   * **URL de início de login:** `https://<SEU_DOMINIO_OU_NGROK>:30001/login`
   * **URIs de redirecionamento:**
     ```text
     https://<SEU_DOMINIO_OU_NGROK>/
     https://<SEU_DOMINIO_OU_NGROK>:30001/
     ```
3. Em **Serviços**, habilite:
   * *Sincronização de notas (LTI Assignment and Grade Services - AGS)*
   * *Nomes e fornecimento de papéis (Names and Role Provisioning Services - NRPS)*
4. Salve e clique no ícone de visualização da ferramenta para copiar o **Client ID**, **Deployment ID** e endpoints gerados pelo Moodle para o seu `.env`.

---

## 8. Diagnóstico e Monitoramento

Comandos úteis para inspecionar a saúde do sistema em produção no cluster:

* **Verificar Pods e Nós alocados:**
  ```bash
  microk8s kubectl get pods -n codecheck -o wide
  ```

* **Logs da aplicação em tempo real:**
  ```bash
  microk8s kubectl logs -f deployment/codecheck-app -n codecheck
  ```

* **Monitorar uso de cotas do namespace (Memória e CPU):**
  ```bash
  microk8s kubectl describe quota -n codecheck
  ```

* **Consumo real de CPU e Memória física dos contêineres:**
  ```bash
  microk8s kubectl top pods -n codecheck
  ```

* **Testar o endpoint de saúde do servidor:**
  ```bash
  curl -i http://localhost:30000/healthz
  ```

* **Verificar o contêiner do MinIO:**
  ```bash
  docker ps -f name=minio-server
  ```

---

## 9. Desenvolvimento Local (PC Windows / Linux / macOS)

Para rodar e testar o código em ambiente local de desenvolvimento sem depender de HTTPS nem de um cluster remoto:

1. No seu `.env` local, configure:
   ```ini
   NODE_ENV=development
   LTI_DEV_MODE=true
   PORT=3000
   MINIO_ENDPOINT=localhost
   K8S_IMAGE=gcc:latest
   ```
2. Instale as dependências e inicie o servidor:
   ```bash
   npm install
   node server.js
   ```
3. Com `LTI_DEV_MODE=true` e `NODE_ENV=development`, o servidor relaxa as restrições de cookies `Secure`, permitindo a navegação em `http://localhost:3000`.