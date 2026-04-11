document.addEventListener('DOMContentLoaded', () => {
    const btnSubmeter = document.getElementById('btn-submeter');
    const editor = document.getElementById('editor');
    const resContainer = document.getElementById('resultado-container');
    const statusVeredito = document.getElementById('status-veredito');
    const detalhesErro = document.getElementById('detalhes-erro');

    btnSubmeter.onclick = async () => {
        const code = editor.value;
        if (!code.trim()) return alert("O código não pode estar vazio!");

        btnSubmeter.disabled = true;
        btnSubmeter.innerText = "Processando...";
        resContainer.style.display = "none";

        try {
            const response = await fetch('/judge/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });

            const data = await response.json();

            resContainer.style.display = "block";
            statusVeredito.innerText = data.status;
            statusVeredito.className = `status-badge ${data.status.split(' ')[0]}`;

            if (data.status !== 'Accepted') {
                detalhesErro.innerText = data.details || `Erro no teste ${data.testIndex || ''}`;
            } else {
                detalhesErro.innerText = "";
            }

        } catch (error) {
            alert("Erro ao conectar com o servidor de correção.");
        } finally {
            btnSubmeter.disabled = false;
            btnSubmeter.innerText = "Enviar Trabalho";
        }
    };
});