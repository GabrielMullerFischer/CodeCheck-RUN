document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ltiToken = urlParams.get('ltik') || document.querySelector('meta[name="ltik"]')?.content || '';

    const setupProfessor = document.getElementById('setup-professor');
    const areaPreview = document.getElementById('area-preview');
    const iframeAluno = document.getElementById('iframe-aluno');
    const btnPreview = document.getElementById('btnPreview');
    const btnVoltarConfig = document.getElementById('btnVoltarConfig');
    const containerExercicios = document.getElementById('container-exercicios-disponiveis');
    const contadorEl = document.getElementById('contador-selecionados');
    const containerListas = document.getElementById('container-listas-salvas');
    const btnVincularLista = document.getElementById('btnVincularLista');
    const btnSalvarNovaLista = document.getElementById('btnSalvarNovaLista');
    const nomeNovaLista = document.getElementById('nome-nova-lista');
    const modalContainerTestes = document.getElementById('modal-container-testes');
    const modalBtnMaisTeste = document.getElementById('modalBtnMaisTeste');
    const modalBtnSalvarEx = document.getElementById('modalBtnSalvarEx');
    const inputBuscaLista = document.getElementById('input-busca-lista') || document.querySelector('input[placeholder*="Pesquisar lista"]');
    const inputBuscaExercicio = document.getElementById('input-busca-exercicio') || document.querySelector('input[placeholder*="Pesquisar exercício"]');

    function fixarBotoesNaListaAtiva(listId) {
        const radioVinculado = document.querySelector(`input[name="listaSelecionada"][value="${listId}"]`);
        const containerBotoes = btnPreview ? btnPreview.parentElement : null;

        if (radioVinculado) {
            const linhaItem = radioVinculado.closest('.list-group-item');
            if (linhaItem) {
                if (containerBotoes) {
                    linhaItem.appendChild(containerBotoes);
                }
                if (containerListas) {
                    containerListas.prepend(linhaItem);
                }
            }
        }
    }

    function atualizarContador() {
        const selecionados = containerExercicios.querySelectorAll('.chk-exercicio:checked').length;
        if (contadorEl) {
            contadorEl.innerHTML = `<i class="fas fa-check-square mr-1"></i> ${selecionados} ${selecionados === 1 ? 'exercício selecionado' : 'exercícios selecionados'}`;
        }
    }

    async function carregarEstadoInicial() {
        const activityIdMeta = document.querySelector('meta[name="activity-id"]');
        const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';
        try {
            const res = await fetch(`/judge/professor/dados?activityId=${activityId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();
            if (!res.ok || !data.success) return;
            if (containerExercicios && data.exercicios) {
                containerExercicios.innerHTML = '';
                if (data.exercicios.length === 0) {
                    containerExercicios.innerHTML = '<p class="text-muted p-2 mb-0">Nenhum exercício cadastrado ainda.</p>';
                } else {
                    data.exercicios.forEach(ex => {
                        const div = document.createElement('div');
                        div.className = 'custom-control custom-checkbox border-bottom p-2 pl-4';
                        div.innerHTML = `
                            <input type="checkbox" class="custom-control-input chk-exercicio" id="ex_${ex._id}" value="${ex._id}">
                            <label class="custom-control-label w-100 cursor-pointer ml-2" for="ex_${ex._id}">
                                <strong>${ex.title}</strong>
                            </label>
                        `;
                        containerExercicios.appendChild(div);
                    });
                    atualizarContador();
                }
            }
            if (containerListas && data.listas) {
                containerListas.innerHTML = '';
                if (data.listas.length === 0) {
                    containerListas.innerHTML = '<p class="text-muted p-2 mb-0">Nenhuma lista criada ainda. Crie uma na Aba 2.</p>';
                } else {
                    if (data.listaVinculadaId) {
                        data.listas.sort((a, b) => {
                            if (String(a._id) === String(data.listaVinculadaId)) return -1;
                            if (String(b._id) === String(data.listaVinculadaId)) return 1;
                            return 0;
                        });
                    }

                    data.listas.forEach(lista => {
                        const isVinculada = data.listaVinculadaId && (String(lista._id) === String(data.listaVinculadaId));
                        const div = document.createElement('div');
                        div.className = 'list-group-item list-group-item-action border-0 border-bottom d-flex justify-content-between align-items-center';
                        div.innerHTML = `
                            <div class="custom-control custom-radio">
                                <input type="radio" id="lista_${lista._id}" name="listaSelecionada" class="custom-control-input" value="${lista._id}" ${isVinculada ? 'checked' : ''}>
                                <label class="custom-control-label font-weight-bold" for="lista_${lista._id}">
                                    ${lista.title} (${lista.exercises ? lista.exercises.length : 0} exercícios)
                                </label>
                            </div>
                        `;
                        containerListas.appendChild(div);
                    });

                    if (data.listaVinculadaId) {
                        fixarBotoesNaListaAtiva(data.listaVinculadaId);
                    }
                }
            }
        } catch (err) {
            console.error("Erro ao carregar listas do banco:", err);
        }
    }

    if (btnPreview) {
        btnPreview.onclick = () => {
            if (setupProfessor) setupProfessor.style.display = 'none';
            if (areaPreview) areaPreview.style.display = 'block';
            const radioDestaLinha = btnPreview.closest('.list-group-item')?.querySelector('input[type="radio"]');
            const listId = radioDestaLinha ? radioDestaLinha.value : '';
            const targetUrl = `/?mode=preview&listId=${listId}` + (ltiToken ? `&ltik=${ltiToken}` : '');
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

    if (containerExercicios) {
        containerExercicios.addEventListener('change', (e) => {
            if (e.target.classList.contains('chk-exercicio')) {
                atualizarContador();
            }
        });
    }

    if (modalBtnMaisTeste) {
        modalBtnMaisTeste.onclick = () => {
            const div = document.createElement('div');
            div.className = 'teste-item border rounded p-2 mb-2 bg-light position-relative';
            div.innerHTML = `
                <button type="button" class="close position-absolute" style="right:8px; top:2px;" onclick="this.parentElement.remove()">
                    <span>&times;</span>
                </button>
                <div class="row">
                    <div class="col">
                        <label class="small font-weight-bold">Entradas:</label>
                        <input type="text" class="form-control form-control-sm input-val" placeholder="ex: 10 20">
                    </div>
                    <div class="col">
                        <label class="small font-weight-bold">Saída Esperada:</label>
                        <input type="text" class="form-control form-control-sm output-val" placeholder="ex: 30">
                    </div>
                </div>
            `;
            modalContainerTestes.appendChild(div);
        };
    }

    if (modalBtnSalvarEx) {
        modalBtnSalvarEx.onclick = async () => {
            const title = document.getElementById('modal-titulo')?.value.trim();
            const description = document.getElementById('modal-desc')?.value.trim();

            if (!title || !description) {
                alert("Preencha o título e a descrição do exercício.");
                return;
            }

            const tests = [];
            document.querySelectorAll('#modal-container-testes .teste-item').forEach(item => {
                const input = item.querySelector('.input-val').value.trim();
                const output = item.querySelector('.output-val').value.trim();
                if (output !== '') tests.push({ input, output });
            });

            modalBtnSalvarEx.disabled = true;
            modalBtnSalvarEx.innerText = "Salvando...";

            try {
                const res = await fetch(`/judge/exercicio` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, description, tests })
                });
                const data = await res.json();

                if (res.ok && data.success) {
                    alert("Exercício cadastrado com sucesso!");
                    $('#modalNovoExercicio').modal('hide');
                    document.getElementById('modal-titulo').value = '';
                    document.getElementById('modal-desc').value = '';

                    if (containerExercicios) {
                        const novoDiv = document.createElement('div');
                        novoDiv.className = 'custom-control custom-checkbox border-bottom p-2 pl-4';
                        novoDiv.innerHTML = `
                            <input type="checkbox" class="custom-control-input chk-exercicio" id="ex_${data.exercicio._id}" value="${data.exercicio._id}">
                            <label class="custom-control-label w-100 cursor-pointer ml-2" for="ex_${data.exercicio._id}">
                                <strong>${data.exercicio.title}</strong>
                            </label>
                        `;
                        containerExercicios.prepend(novoDiv);
                    }
                } else {
                    alert("Erro ao salvar: " + (data.error || "Não autorizado"));
                }
            } catch (err) {
                alert("Erro de conexão ao salvar exercício.");
            } finally {
                modalBtnSalvarEx.disabled = false;
                modalBtnSalvarEx.innerText = "Salvar Exercício";
            }
        };
    }

    if (btnSalvarNovaLista) {
        btnSalvarNovaLista.onclick = async () => {
            const title = nomeNovaLista?.value.trim();
            const selecionados = Array.from(document.querySelectorAll('.chk-exercicio:checked')).map(c => c.value);
            if (!title) {
                alert("Informe um nome para a nova lista.");
                return;
            }
            if (selecionados.length === 0) {
                alert("Selecione pelo menos um exercício para compor a lista.");
                return;
            }
            btnSalvarNovaLista.disabled = true;
            btnSalvarNovaLista.innerText = "Salvando Lista...";
            try {
                const res = await fetch(`/judge/lista` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, exercises: selecionados })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    alert("Lista criada com sucesso!");
                    nomeNovaLista.value = '';
                    document.querySelectorAll('.chk-exercicio').forEach(c => c.checked = false);
                    atualizarContador();
                    if (containerListas) {
                        const divLista = document.createElement('div');
                        divLista.className = 'list-group-item list-group-item-action border-0 border-bottom d-flex justify-content-between align-items-center';
                        divLista.innerHTML = `
                            <div class="custom-control custom-radio">
                                <input type="radio" id="lista_${data.lista._id}" name="listaSelecionada" class="custom-control-input" value="${data.lista._id}">
                                <label class="custom-control-label font-weight-bold" for="lista_${data.lista._id}">
                                    ${data.lista.title} (${selecionados.length} exercícios)
                                </label>
                            </div>`;
                        containerListas.appendChild(divLista);
                        const novoRadio = divLista.querySelector('input[type="radio"]');
                        if (novoRadio) {
                            novoRadio.checked = true;
                        }
                    }
                    $('#tab-listas-link').tab('show');
                } else {
                    alert("Erro ao criar lista: " + (data.error || "Não autorizado"));
                }
            } catch (err) {
                alert("Erro de conexão ao criar lista.");
            } finally {
                btnSalvarNovaLista.disabled = false;
                btnSalvarNovaLista.innerText = "Salvar Nova Lista";
            }
        };
    }

    if (btnVincularLista) {
        btnVincularLista.onclick = async () => {
            const rad = document.querySelector('input[name="listaSelecionada"]:checked');
            const activityIdMeta = document.querySelector('meta[name="activity-id"]');
            const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';
            if (!rad) {
                alert("Selecione uma lista primeiro.");
                return;
            }
            async function executarVinculo(forcar = false) {
                btnVincularLista.disabled = true;
                btnVincularLista.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Vinculando...';
                try {
                    const res = await fetch(`/judge/atividade/vincular` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ activityId, listId: rad.value, force: forcar })
                    });
                    const data = await res.json();
                    if (data.requiresConfirmation) {
                        const confirmou = confirm(data.message);
                        if (confirmou) {
                            await executarVinculo(true);
                        }
                        return;
                    }
                    if (res.ok && data.success) {
                        alert("Atividade vinculada com sucesso!");
                        fixarBotoesNaListaAtiva(rad.value);
                    } else {
                        alert("Erro ao vincular: " + (data.error || "Não autorizado"));
                    }
                } catch (err) {
                    alert("Erro de conexão ao vincular atividade.");
                } finally {
                    btnVincularLista.disabled = false;
                    btnVincularLista.innerHTML = '<i class="fas fa-link mr-2"></i> Vincular Lista Selecionada à Atividade';
                }
            }
            await executarVinculo(false);
        };
    }

    if (inputBuscaLista && containerListas) {
        inputBuscaLista.addEventListener('input', () => {
            const termo = inputBuscaLista.value.trim().toLowerCase();
            const itensLista = containerListas.querySelectorAll('.list-group-item');
            itensLista.forEach(item => {
                const texto = item.textContent.toLowerCase();
                if (texto.includes(termo)) {
                    item.style.setProperty('display', 'flex', 'important');
                } else {
                    item.style.setProperty('display', 'none', 'important');
                }
            });
        });
    }

    if (inputBuscaExercicio && containerExercicios) {
        inputBuscaExercicio.addEventListener('input', () => {
            const termo = inputBuscaExercicio.value.trim().toLowerCase();
            const itensExercicios = containerExercicios.querySelectorAll('.chk-exercicio');

            itensExercicios.forEach(chk => {
                const containerItem = chk.closest('.custom-checkbox');
                if (!containerItem) return;

                const texto = containerItem.textContent.toLowerCase();
                if (texto.includes(termo)) {
                    containerItem.style.display = '';
                } else {
                    containerItem.style.display = 'none';
                }
            });
        });
    }

    carregarEstadoInicial();
});