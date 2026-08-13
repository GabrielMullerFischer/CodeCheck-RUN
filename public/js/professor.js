document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ltiToken = urlParams.get('ltik');

    const setupProfessor = document.getElementById('setup-professor');
    const areaPreview = document.getElementById('area-preview');
    const iframeAluno = document.getElementById('iframe-aluno');
    const btnPreview = document.getElementById('btnPreview');
    const btnVoltarConfig = document.getElementById('btnVoltarConfig');
    const btnMaisTeste = document.getElementById('btnMaisTeste');
    const btnSalvar = document.getElementById('btnSalvar');

    if (btnPreview) {
        btnPreview.onclick = () => {
            if (setupProfessor) setupProfessor.style.display = 'none';
            if (areaPreview) areaPreview.style.display = 'block';
            
            const titulo = document.getElementById('titulo-input')?.value || '';
            const desc = document.getElementById('desc-input')?.value || '';

            sessionStorage.setItem('preview_titulo', titulo);
            sessionStorage.setItem('preview_desc', desc);

            const targetUrl = '/?mode=preview' + (ltiToken ? `&ltik=${ltiToken}` : '');
            if (iframeAluno) {
                iframeAluno.src = targetUrl;
            }
        };
    }

    if (btnVoltarConfig) {
        btnVoltarConfig.onclick = () => {
            if (areaPreview) areaPreview.style.display = 'none';
            if (setupProfessor) setupProfessor.style.display = 'block';
        };
    }

    if (btnMaisTeste) {
        btnMaisTeste.onclick = () => {
            const container = document.getElementById('container-testes');
            if (container) {
                const div = document.createElement('div');
                div.className = 'teste-item border rounded p-3 pt-4 mb-2 bg-white position-relative shadow-sm';
                div.innerHTML = `
                    <button type="button" class="close position-absolute" style="right:10px; top:5px;" onclick="this.parentElement.remove()">
                        <span aria-hidden="true">&times;</span>
                    </button>
                    <div class="row">
                        <div class="col">
                            <label class="small font-weight-bold">Entradas:</label>
                            <input type="text" class="form-control input-val" placeholder="ex: 10 20">
                        </div>
                        <div class="col">
                            <label class="small font-weight-bold">Saída Esperada:</label>
                            <input type="text" class="form-control output-val" placeholder="ex: 30">
                        </div>
                    </div>
                `;
                container.appendChild(div);
            }
        };
    }

    if (btnSalvar) {
        btnSalvar.onclick = async () => {
            const activityIdMeta = document.querySelector('meta[name="activity-id"]');
            const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';

            btnSalvar.disabled = true;
            btnSalvar.innerText = "Salvando...";

            const itens = document.querySelectorAll('.teste-item');
            const testesArray = [];
            itens.forEach(item => {
                const input = item.querySelector('.input-val').value.trim();
                const output = item.querySelector('.output-val').value.trim();
                if (input !== "" || output !== "") {
                    testesArray.push({ input, output });
                }
            });

            const dados = {
                title: document.getElementById('titulo-input').value,
                description: document.getElementById('desc-input').value,
                tests: JSON.stringify(testesArray),
                activityId: activityId, 
                isProfessor: 'true' 
            };

            try {
                const url = '/judge/setup' + (ltiToken ? `?ltik=${ltiToken}` : '');
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dados)
                });
                const result = await res.json();
                if (res.ok && result.success) {
                    alert("Configuração salva com sucesso!");
                    location.reload();
                } else {
                    alert("Erro ao salvar: " + (result.error || "Não autorizado"));
                }
            } catch (err) {
                alert("Erro de conexão ao salvar.");
            } finally {
                btnSalvar.disabled = false;
                btnSalvar.innerText = "Submeter Atividade";
            }
        };
    }
});