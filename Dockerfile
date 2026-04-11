# 1. Imagem base (Node.js v20 no Debian)
FROM node:20-bullseye

# 2. Instala o GCC e ferramentas de compilação (O segredo do seu TCC)
RUN apt-get update && apt-get install -y \
    gcc \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 3. Define a pasta onde o código vai morar dentro do container
WORKDIR /app

# 4. Copia os arquivos de dependências primeiro (otimiza o cache)
COPY package*.json ./

# 5. Instala as bibliotecas do seu package.json (minio, mongoose, ltijs...)
RUN npm install

# 6. Copia todo o resto do seu código para dentro do container
COPY . .

# 7. Expõe a porta que o seu server.js usa
EXPOSE 3000

# 8. O comando que "dá o play" no seu sistema
CMD ["npm", "start"]

# 9. Permissão para criar arquivos temporários (compilação e execução dos códigos dos alunos)
RUN mkdir -p /app/tmp && chmod 777 /app/tmp