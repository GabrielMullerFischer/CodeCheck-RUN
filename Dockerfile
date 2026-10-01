# 1. Imagem base mais leve (Node.js v20 Slim)
FROM node:20-bullseye-slim

# 2. Define o diretório de trabalho da aplicação
WORKDIR /app

# 3. Copia apenas os manifests de dependências primeiro (aproveita cache de build)
COPY package*.json ./

# 4. Instala as dependências de produção
RUN npm install --omit=dev

# 5. Copia o código-fonte da aplicação
COPY . .

# 6. Cria a pasta tmp caso algum coletor ou rotina auxiliar precise
RUN mkdir -p /app/tmp

# 7. Expõe as portas da aplicação web (3000) e do mecanismo LTI (3001)
EXPOSE 3000
EXPOSE 3001

# 8. Comando de inicialização
CMD ["npm", "start"]