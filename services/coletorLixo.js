const fs = require('fs');
const path = require('path');

class ColetorLixo {
    constructor(diretorio, minutosLimite = 10) {
        this.diretorio = diretorio;
        this.minutosLimite = Math.max(minutosLimite, 1);
        this.timer = null;
    }

    limparAntigos() {
        if (!fs.existsSync(this.diretorio)) return;

        const agora = Date.now();
        const limiteMs = this.minutosLimite * 60 * 1000;
        const pastas = fs.readdirSync(this.diretorio);

        if (pastas.length > 0) {
            console.log(`🗑️ Coletor de lixo... Verificando ${pastas.length} pastas.`);
        }

        pastas.forEach(pasta => {
            const caminho = path.join(this.diretorio, pasta);
            try {
                const stats = fs.statSync(caminho);
                if (agora - stats.mtimeMs > limiteMs) {
                    fs.rmSync(caminho, { recursive: true, force: true });
                    console.log(`✨ Pasta antiga removida: ${pasta}`);
                }
            } catch (err) {
            }
        });
    }

    limpezaTotal() {
        console.log("🧹 Coletor de lixo iniciado, apagando arquivos temporários...");
        if (fs.existsSync(this.diretorio)) {
            const itens = fs.readdirSync(this.diretorio);
            itens.forEach(item => {
                try {
                    fs.rmSync(path.join(this.diretorio, item), { recursive: true, force: true });
                } catch (e) {}
            });
            console.log("✨ Limpeza total concluída.");
        }
    }

    iniciar() {
        this.limpezaTotal();
        const intervaloMs = this.minutosLimite * 60 * 1000;
        this.timer = setInterval(() => this.limparAntigos(), intervaloMs);
        console.log(` 🗑️ Coletor de lixo a cada ${this.minutosLimite} min.`);
    }
}

module.exports = ColetorLixo;