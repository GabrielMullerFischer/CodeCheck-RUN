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
    const inputBuscaBancoUniversal = document.getElementById('input-busca-banco-universal');
    const inputBuscaBancoEx = document.getElementById('input-busca-banco-ex');
    const tabTurmaLink = document.getElementById('tab-turma-link');
    const btnAtualizarTurma = document.getElementById('btnAtualizarTurma');
    const containerTaxas = document.getElementById('container-taxas-exercicios');
    const tbodyRanking = document.getElementById('tbody-ranking-turma');
    const containerBancoUniversal = document.getElementById('container-banco-universal');
    const containerBancoEx = document.getElementById('container-banco-exercicios-comunidade');
    const labelTotalAlunos = document.getElementById('labelTotalAlunos');
    let dadosTurmaCarregados = [];
    let submissaoAtivaParaCompilar = null;
    let alunoSelecionado = null;
    let listaExerciciosModal = [];
    let indiceExercicioModal = 0;
    let metricasGlobaisExercicios = [];

    // Fixar os botões de ação na lista ativa
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

    // Atualizar o contador de exercícios selecionados
    function atualizarContador() {
        const selecionados = containerExercicios ? containerExercicios.querySelectorAll('.chk-exercicio:checked').length : 0;
        if (contadorEl) {
            contadorEl.innerHTML = `<i class="fas fa-check-square mr-1"></i> ${selecionados} ${selecionados === 1 ? 'exercício selecionado' : 'exercícios selecionados'}`;
        }
    }

    // Carregar estado inicial da página
    async function carregarEstadoInicial() {
        const activityIdMeta = document.querySelector('meta[name="activity-id"]');
        const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';
        try {
            const res = await fetch(`/judge/professor/dados?activityId=${activityId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();
            if (!res.ok || !data.success) return;

            const meusEx = data.meusExercicios || data.exercicios || [];
            if (containerExercicios && meusEx) {
                containerExercicios.innerHTML = '';
                if (meusEx.length === 0) {
                    containerExercicios.innerHTML = '<p class="text-muted p-2 mb-0">Nenhum exercício cadastrado ainda.</p>';
                } else {
                    meusEx.forEach(ex => {
                        const div = document.createElement('div');
                        div.className = 'custom-control custom-checkbox border-bottom p-2 pl-4 d-flex justify-content-between align-items-center';
                        div.innerHTML = `
                            <div>
                                <input type="checkbox" class="custom-control-input chk-exercicio" id="ex_${ex._id}" value="${ex._id}">
                                <label class="custom-control-label cursor-pointer ml-2" for="ex_${ex._id}">
                                    <strong>${ex.title}</strong>
                                    ${ex.isPublic === false ? '<span class="badge badge-secondary ml-1"><i class="fas fa-lock mr-1"></i>Privado</span>' : ''}
                                </label>
                            </div>
                        `;
                        containerExercicios.appendChild(div);
                    });
                    atualizarContador();
                }
            }

            const bancoEx = data.bancoUniversalExercicios || [];
            window.exerciciosComunidadeCache = bancoEx;

            if (containerBancoEx && bancoEx) {
                containerBancoEx.innerHTML = '';
                if (bancoEx.length === 0) {
                    containerBancoEx.innerHTML = '<p class="text-muted p-3 mb-0 text-center">Nenhum exercício compartilhado ainda.</p>';
                } else {
                    bancoEx.forEach(ex => {
                        const div = document.createElement('div');
                        div.className = 'border-bottom p-2 d-flex justify-content-between align-items-center';
                        div.innerHTML = `
                            <div class="text-truncate mr-2">
                                <strong class="text-dark">${ex.title}</strong>
                                <small class="text-muted ml-2"><i class="fas fa-user-edit mr-1"></i>${ex.authorName || 'Professor'}</small>
                            </div>
                            <div class="text-nowrap">
                                <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 mr-1 btn-ver-ex" data-exid="${ex._id}">
                                    <i class="fas fa-eye mr-1"></i> Ver
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-success font-weight-bold btn-importar-ex py-0 px-2" data-exid="${ex._id}">
                                    <i class="fas fa-file-import mr-1"></i> Copiar para Meus Exercícios
                                </button>
                            </div>
                        `;
                        containerBancoEx.appendChild(div);
                    });

                    containerBancoEx.querySelectorAll('.btn-ver-ex').forEach(btn => {
                        btn.onclick = () => {
                            const exerciseId = btn.dataset.exid;
                            const ex = (window.exerciciosComunidadeCache || []).find(e => String(e._id) === String(exerciseId));
                            if (!ex) return;

                            document.getElementById('modalVerExTitulo').innerHTML = `<i class="fas fa-file-code text-primary mr-2"></i> ${ex.title}`;
                            document.getElementById('modalVerExAutor').innerText = ex.authorName || 'Outro Professor';
                            document.getElementById('modalVerExDescricao').innerText = ex.description || 'Sem descrição cadastrada.';

                            const containerTeste = document.getElementById('modalVerExTeste');
                            if (ex.tests && ex.tests.length > 0) {
                                const t = ex.tests[0];
                                containerTeste.innerHTML = `
                                    <div class="row">
                                        <div class="col-md-6 mb-1 mb-md-0">
                                            <strong class="d-block text-muted">Entrada (stdin):</strong>
                                            <pre class="bg-light p-2 border rounded mb-0 text-dark" style="font-size: 0.85rem;">${t.input ? t.input : '<em>(Vazio)</em>'}</pre>
                                        </div>
                                        <div class="col-md-6">
                                            <strong class="d-block text-muted">Saída Esperada (stdout):</strong>
                                            <pre class="bg-light p-2 border rounded mb-0 text-dark" style="font-size: 0.85rem;">${t.output ? t.output : '<em>(Vazio)</em>'}</pre>
                                        </div>
                                    </div>
                                `;
                            } else {
                                containerTeste.innerHTML = '<span class="text-muted">Nenhum caso de teste disponível para exibição.</span>';
                            }

                            const btnCopiarModal = document.getElementById('modalBtnCopiarExAberto');
                            if (btnCopiarModal) {
                                btnCopiarModal.onclick = () => {
                                    $('#modalVerExercicioIndividual').modal('hide');
                                    const btnOriginal = containerBancoEx.querySelector(`.btn-importar-ex[data-exid="${ex._id}"]`);
                                    if (btnOriginal) btnOriginal.click();
                                };
                            }

                            $('#modalVerExercicioIndividual').modal('show');
                        };
                    });

                    containerBancoEx.querySelectorAll('.btn-importar-ex').forEach(btn => {
                        btn.onclick = async () => {
                            const exerciseId = btn.dataset.exid;
                            btn.disabled = true;
                            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Copiando...';

                            try {
                                const impExRes = await fetch(`/judge/professor/exercicio/importar` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ exerciseId })
                                });
                                const impExData = await impExRes.json();
                                if (impExRes.ok && impExData.success) {
                                    alert("Exercício copiado com sucesso para seus exercícios!");
                                    await carregarEstadoInicial();
                                } else {
                                    alert("Erro ao copiar exercício: " + (impExData.error || "Erro interno"));
                                    btn.disabled = false;
                                }
                            } catch (err) {
                                alert("Erro de conexão ao copiar exercício.");
                                btn.disabled = false;
                            }
                        };
                    });
                }
            }

            // 2. Renderiza "Minhas Listas"
            if (containerListas && data.minhasListas) {
                containerListas.innerHTML = '';
                if (data.minhasListas.length === 0) {
                    containerListas.innerHTML = '<p class="text-muted p-3 mb-0 text-center">Você ainda não criou nenhuma lista. Crie uma na Aba 2 ou importe do Banco Universal.</p>';
                } else {
                    data.minhasListas.forEach(lista => {
                        const isVinculada = data.listaVinculadaId && (String(lista._id) === String(data.listaVinculadaId));
                        const div = document.createElement('div');
                        div.className = 'list-group-item list-group-item-action border-0 border-bottom d-flex justify-content-between align-items-center';
                        div.innerHTML = `
                            <div class="custom-control custom-radio">
                                <input type="radio" id="lista_${lista._id}" name="listaSelecionada" class="custom-control-input" value="${lista._id}" ${isVinculada ? 'checked' : ''}>
                                <label class="custom-control-label font-weight-bold" for="lista_${lista._id}">
                                    ${lista.title} <span class="badge badge-light border text-muted ml-1">${lista.exercises ? lista.exercises.length : 0} exercícios</span>
                                    ${lista.isPublic === false ? '<span class="badge badge-secondary ml-1"><i class="fas fa-lock mr-1"></i>Privada</span>' : ''}
                                </label>
                            </div>
                        `;
                        containerListas.appendChild(div);
                    });
                }
            }

            // 3. Renderiza "Banco Universal" (Comunidade)
            const listasComunidade = data.bancoUniversal || data.bancoUniversalListas || [];
            window.listasComunidadeCache = listasComunidade;

            if (containerBancoUniversal && listasComunidade) {
                containerBancoUniversal.innerHTML = '';
                if (listasComunidade.length === 0) {
                    containerBancoUniversal.innerHTML = '<p class="text-muted p-3 mb-0 text-center">Nenhuma lista compartilhada por outros professores ainda.</p>';
                } else {
                    listasComunidade.forEach(lista => {
                        const div = document.createElement('div');
                        div.className = 'list-group-item list-group-item-action border-0 border-bottom d-flex justify-content-between align-items-center';
                        div.innerHTML = `
                            <div class="text-truncate mr-2">
                                <strong class="text-dark">${lista.title}</strong>
                                <span class="badge badge-light border text-muted ml-1">${lista.exercises ? lista.exercises.length : 0} exercícios</span>
                                <small class="text-muted ml-2"><i class="fas fa-user-edit mr-1"></i>${lista.authorName || 'Professor'}</small>
                            </div>
                            <div class="text-nowrap">
                                <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 mr-1 btn-ver-lista" data-listid="${lista._id}">
                                    <i class="fas fa-eye mr-1"></i> Ver Exercícios
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-success py-0 px-2 font-weight-bold btn-importar-lista" data-listid="${lista._id}">
                                    <i class="fas fa-file-import mr-1"></i> Importar
                                </button>
                            </div>
                        `;
                        containerBancoUniversal.appendChild(div);
                    });

                    containerBancoUniversal.querySelectorAll('.btn-ver-lista').forEach(btn => {
                        btn.onclick = () => {
                            const listId = btn.dataset.listid;
                            const lista = window.listasComunidadeCache.find(l => String(l._id) === String(listId));
                            if (!lista) return;

                            document.getElementById('modalVerListaTitulo').innerHTML = `<i class="fas fa-list-alt text-primary mr-2"></i> ${lista.title}`;
                            document.getElementById('modalVerListaAutor').innerText = lista.authorName || 'Outro Professor';
                            document.getElementById('modalVerListaQtd').innerText = `${lista.exercises ? lista.exercises.length : 0} exercícios`;

                            const containerConteudo = document.getElementById('modalVerListaConteudo');
                            containerConteudo.innerHTML = '';

                            if (!lista.exercises || lista.exercises.length === 0) {
                                containerConteudo.innerHTML = '<p class="text-muted text-center py-3">Esta lista não possui exercícios cadastrados.</p>';
                            } else {
                                lista.exercises.forEach((ex, idx) => {
                                    const card = document.createElement('div');
                                    card.className = 'card mb-2 border shadow-sm';
                                    card.innerHTML = `
                                        <div class="card-header bg-white py-2 font-weight-bold text-dark">
                                            <span><strong>#${idx + 1}</strong> - ${ex.title}</span>
                                        </div>
                                        <div class="card-body p-2 bg-light">
                                            <p class="mb-0 text-secondary small" style="white-space: pre-line;">${ex.description || 'Sem enunciado cadastrado.'}</p>
                                        </div>
                                    `;
                                    containerConteudo.appendChild(card);
                                });
                            }

                            const btnImportarModal = document.getElementById('modalBtnImportarListaAberta');
                            if (btnImportarModal) {
                                btnImportarModal.onclick = () => {
                                    $('#modalVerExerciciosLista').modal('hide');
                                    const btnOriginal = containerBancoUniversal.querySelector(`.btn-importar-lista[data-listid="${lista._id}"]`);
                                    if (btnOriginal) btnOriginal.click();
                                };
                            }

                            $('#modalVerExerciciosLista').modal('show');
                        };
                    });

                    containerBancoUniversal.querySelectorAll('.btn-importar-lista').forEach(btn => {
                        btn.onclick = async () => {
                            const listId = btn.dataset.listid;
                            btn.disabled = true;
                            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Importando...';

                            try {
                                const impRes = await fetch(`/judge/professor/lista/importar` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ listId })
                                });
                                const impData = await impRes.json();

                                if (impRes.ok && impData.success) {
                                    alert(`Lista importada com sucesso para "Minhas Listas"!`);
                                    await carregarEstadoInicial();
                                    const pillMinhas = document.getElementById('pill-minhas-listas');
                                    if (window.$ && pillMinhas) $(pillMinhas).tab('show');
                                } else {
                                    alert("Erro ao importar lista: " + (impData.error || "Erro interno"));
                                    btn.disabled = false;
                                    btn.innerHTML = '<i class="fas fa-file-import mr-1"></i> Importar';
                                }
                            } catch (err) {
                                alert("Erro de conexão ao importar.");
                                btn.disabled = false;
                                btn.innerHTML = '<i class="fas fa-file-import mr-1"></i> Importar';
                            }
                        };
                    });
                }
            }

            if (data.listaVinculadaId) {
                fixarBotoesNaListaAtiva(data.listaVinculadaId);
            }

        } catch (err) {
            console.error("Erro ao carregar listas do banco:", err);
        }
    }

    // Fixar os botões de ação na lista ativa
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

    // Voltar para a configuração da atividade
    if (btnVoltarConfig) {
        btnVoltarConfig.onclick = () => {
            if (areaPreview) areaPreview.style.display = 'none';
            if (setupProfessor) setupProfessor.style.display = 'block';
        };
    }

    // Atualizar contador de exercícios selecionados
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
                <button type="button" class="close position-absolute" 
                        style="top: 4px; right: 10px; z-index: 10; width: 26px; height: 26px; line-height: 26px; text-align: center; outline: none; cursor: pointer;" 
                        onclick="this.closest('.teste-item').remove()" 
                        title="Remover teste" 
                        aria-label="Fechar">
                    <span aria-hidden="true">&times;</span>
                </button>
                <div class="row">
                    <div class="col">
                        <label class="small font-weight-bold">Entradas:</label>
                        <input type="text" class="form-control form-control-sm input-val">
                    </div>
                    <div class="col">
                        <label class="small font-weight-bold">Saída Esperada:</label>
                        <input type="text" class="form-control form-control-sm output-val">
                    </div>
                </div>
            `;
            modalContainerTestes.appendChild(div);
        };
    }

    // Salvar novo exercício
    if (modalBtnSalvarEx) {
        modalBtnSalvarEx.onclick = async () => {
            const title = document.getElementById('modal-titulo')?.value.trim();
            const description = document.getElementById('modal-desc')?.value.trim();
            const isPrivate = document.getElementById('modal-exercicio-privado')?.checked || false;

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
                    body: JSON.stringify({ title, description, tests, isPrivate })
                });
                const data = await res.json();

                if (res.ok && data.success) {
                    alert("Exercício cadastrado com sucesso!");
                    $('#modalNovoExercicio').modal('hide');
                    limparModalNovoExercicio();
                    carregarEstadoInicial();
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

    $('#modalNovoExercicio').on('hidden.bs.modal', () => {
        limparModalNovoExercicio();
    });

    // Salvar nova lista de exercícios
    if (btnSalvarNovaLista) {
        btnSalvarNovaLista.onclick = async () => {
            const title = nomeNovaLista?.value.trim();
            const selecionados = Array.from(document.querySelectorAll('.chk-exercicio:checked')).map(c => c.value);
            const isPrivate = document.getElementById('chk-lista-privada')?.checked || false;

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
                    body: JSON.stringify({ title, exercises: selecionados, isPrivate })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    alert("Lista criada com sucesso!");
                    nomeNovaLista.value = '';
                    const chkListaPrivada = document.getElementById('chk-lista-privada');
                    if (chkListaPrivada) chkListaPrivada.checked = false;
                    document.querySelectorAll('.chk-exercicio').forEach(c => c.checked = false);
                    atualizarContador();
                    await carregarEstadoInicial();
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

    // Vincular lista selecionada à atividade
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

    // Atualizar contador de exercícios selecionados
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

    // Atualizar contador de exercícios selecionados
    if (inputBuscaExercicio && containerExercicios) {
        inputBuscaExercicio.addEventListener('input', () => {
            const termo = inputBuscaExercicio.value.trim().toLowerCase();
            const itensExercicios = containerExercicios.querySelectorAll('.custom-checkbox');

            itensExercicios.forEach(containerItem => {
                const texto = containerItem.textContent.toLowerCase();
                if (texto.includes(termo)) {
                    containerItem.style.display = '';
                } else {
                    containerItem.style.display = 'none';
                }
            });
        });
    }

    if (inputBuscaBancoUniversal && containerBancoUniversal) {
        inputBuscaBancoUniversal.addEventListener('input', () => {
            const termo = inputBuscaBancoUniversal.value.trim().toLowerCase();
            const itens = containerBancoUniversal.querySelectorAll('.list-group-item');
            itens.forEach(item => {
                const texto = item.textContent.toLowerCase();
                if (texto.includes(termo)) {
                    item.style.setProperty('display', 'flex', 'important');
                } else {
                    item.style.setProperty('display', 'none', 'important');
                }
            });
        });
    }

    if (inputBuscaBancoEx && containerBancoEx) {
        inputBuscaBancoEx.addEventListener('input', () => {
            const termo = inputBuscaBancoEx.value.trim().toLowerCase();
            const itens = containerBancoEx.querySelectorAll('.border-bottom');
            itens.forEach(item => {
                const texto = item.textContent.toLowerCase();
                if (texto.includes(termo)) {
                    item.style.setProperty('display', 'flex', 'important');
                } else {
                    item.style.setProperty('display', 'none', 'important');
                }
            });
        });
    }

    // Carregar métricas da turma
    async function carregarMetricasTurma() {
        const activityIdMeta = document.querySelector('meta[name="activity-id"]');
        const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';
        if (!activityId) return;

        if (tbodyRanking) {
            tbodyRanking.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando dados da turma...</td></tr>';
        }

        try {
            const res = await fetch(`/judge/professor/turma-metricas?activityId=${activityId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();

            if (!data.success) {
                if (tbodyRanking) tbodyRanking.innerHTML = `<tr><td colspan="7" class="text-center text-warning py-3">${data.message || 'Erro ao carregar dados.'}</td></tr>`;
                return;
            }

            dadosTurmaCarregados = data.ranking || [];
            metricasGlobaisExercicios = data.metricasExercicios || [];

            if (containerTaxas) {
                containerTaxas.innerHTML = '';
                data.metricasExercicios.forEach(m => {
                    const col = document.createElement('div');
                    col.className = 'col-md-4 col-sm-6 mb-2';
                    col.innerHTML = `
                        <div class="border rounded p-2 bg-white shadow-sm">
                            <div class="d-flex justify-content-between align-items-center mb-1">
                                <strong class="text-truncate mr-2" style="max-width: 150px;" title="${m.title}">${m.title}</strong>
                                <span class="badge ${m.taxaAcerto >= 70 ? 'badge-success' : (m.taxaAcerto >= 40 ? 'badge-warning' : 'badge-danger')}">
                                    ${m.taxaAcerto}%
                                </span>
                            </div>
                            <div class="progress" style="height: 6px;">
                                <div class="progress-bar ${m.taxaAcerto >= 70 ? 'bg-success' : (m.taxaAcerto >= 40 ? 'bg-warning' : 'bg-danger')}" 
                                     role="progressbar" style="width: ${m.taxaAcerto}%"></div>
                            </div>
                            <div class="small text-muted mt-1">
                                ${m.alunosQueResolveram} acertaram / ${m.totalEnvios} envios
                            </div>
                        </div>
                    `;
                    containerTaxas.appendChild(col);
                });
            }

            if (labelTotalAlunos) labelTotalAlunos.innerText = `${dadosTurmaCarregados.length} alunos participando`;

            if (tbodyRanking) {
                tbodyRanking.innerHTML = '';
                if (dadosTurmaCarregados.length === 0) {
                    tbodyRanking.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Nenhum aluno realizou submissões nesta atividade ainda.</td></tr>';
                } else {
                    dadosTurmaCarregados.forEach((aluno, idx) => {
                        const tr = document.createElement('tr');
                        const dataUltimoEnvio = aluno.ultimaAtividade 
                            ? new Date(aluno.ultimaAtividade).toLocaleDateString() + ' ' + new Date(aluno.ultimaAtividade).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : '-';

                        const medalha = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `${idx + 1}º`));

                        tr.innerHTML = `
                            <td class="font-weight-bold text-center">${medalha}</td>
                            <td>
                                <strong>${aluno.userName}</strong>
                            </td>
                            <td class="text-center">
                                <span class="badge ${aluno.totalResolvidos === data.totalExercicios ? 'badge-success' : 'badge-primary'} p-2">
                                    ${aluno.totalResolvidos} / ${data.totalExercicios}
                                </span>
                            </td>
                            <td class="text-center font-weight-bold text-secondary">
                                ${aluno.tempoTotalMs > 0 ? `${aluno.tempoTotalMs} ms` : (aluno.totalResolvidos > 0 ? '< 1 ms' : '-')}
                            </td>
                            <td class="text-center text-muted">
                                ${aluno.totalTentativas} tentativas
                            </td>
                            <td class="text-center text-muted small">
                                ${dataUltimoEnvio}
                            </td>
                            <td class="text-right pr-4">
                                <button class="btn btn-sm btn-outline-primary btn-abrir-dossie" data-userid="${aluno.userId}">
                                    <i class="fas fa-folder-open mr-1"></i> Ver Submissões
                                </button>
                            </td>
                        `;
                        tbodyRanking.appendChild(tr);
                    });

                    tbodyRanking.querySelectorAll('.btn-abrir-dossie').forEach(btn => {
                        btn.onclick = () => abrirDossieAluno(btn.dataset.userid);
                    });
                }
            }
        } catch (e) {
            console.error("Erro ao carregar dados da turma:", e);
        }
    }

    if (window.$ && tabTurmaLink) {
        $(tabTurmaLink).on('shown.bs.tab', carregarMetricasTurma);
    }
    if (tabTurmaLink) {
        tabTurmaLink.addEventListener('click', carregarMetricasTurma);
    }
    if (btnAtualizarTurma) {
        btnAtualizarTurma.onclick = carregarMetricasTurma;
    }

    function abrirDossieAluno(userId) {
        alunoSelecionado = dadosTurmaCarregados.find(a => a.userId === userId);
        if (!alunoSelecionado) return;

        document.getElementById('modalAlunoTitulo').innerHTML = `
            <i class="fas fa-user-graduate mr-2 text-primary"></i> Submissões de: <strong>${alunoSelecionado.userName}</strong>
        `;

        listaExerciciosModal = metricasGlobaisExercicios || []; 
        indiceExercicioModal = 0;

        montarNavegacaoModal();
        carregarExercicioNoModal(0);

        const btnRecompilar = document.getElementById('btnRecompilarCodigoAluno');
        if (btnRecompilar) {
            btnRecompilar.onclick = async () => {
                if (!submissaoAtivaParaCompilar) return;

                const code = document.getElementById('modalInspecionarEditor').value;
                const divResultado = document.getElementById('modalInspecionarResultado');
                const activityIdMeta = document.querySelector('meta[name="activity-id"]');
                const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';

                divResultado.innerHTML = '<div class="alert alert-info py-1 small"><i class="fas fa-spinner fa-spin mr-1"></i> Executando testes no Docker...</div>';
                btnRecompilar.disabled = true;

                try {
                    const res = await fetch('/judge/submit' + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            code,
                            activityId,
                            exerciseId: submissaoAtivaParaCompilar.exerciseId,
                            userId: 'professor_test'
                        })
                    });
                    const data = await res.json();

                    if (data.status === 'Accepted') {
                        divResultado.innerHTML = `<div class="alert alert-success py-1 small"><strong>Aceito!</strong> Tempo de execução: ${data.executionTime} ms</div>`;
                    } else if (data.status === 'Compilation Error') {
                        divResultado.innerHTML = `<div class="alert alert-warning py-1 small"><strong>Erro de Compilação:</strong><pre class="bg-dark text-white p-1 mt-1 mb-0">${data.details || ''}</pre></div>`;
                    } else {
                        divResultado.innerHTML = `<div class="alert alert-danger py-1 small"><strong>${data.status}:</strong> ${data.message || 'Falhou nos testes.'}</div>`;
                    }
                } catch (e) {
                    divResultado.innerHTML = '<div class="alert alert-danger py-1 small">Erro de conexão com o servidor.</div>';
                } finally {
                    btnRecompilar.disabled = false;
                }
            };
        }

        $('#modalHistoricoAluno').modal('show');
    }

    function montarNavegacaoModal() {
        const container = document.getElementById('modalContainerNavExercicios');
        if (!container) return;
        container.innerHTML = '';

        listaExerciciosModal.forEach((ex, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `btn btn-sm ${idx === indiceExercicioModal ? 'btn-primary font-weight-bold shadow-sm' : 'btn-outline-secondary'} px-3`;
            btn.style.minWidth = '38px';
            btn.innerText = idx + 1;

            btn.onclick = () => carregarExercicioNoModal(idx);
            container.appendChild(btn);
        });

        const btnAnt = document.getElementById('modalBtnExAnterior');
        const btnProx = document.getElementById('modalBtnExProximo');
        if (btnAnt) {
            btnAnt.disabled = (indiceExercicioModal === 0);
            btnAnt.onclick = () => carregarExercicioNoModal(indiceExercicioModal - 1);
        }
        if (btnProx) {
            btnProx.disabled = (indiceExercicioModal === listaExerciciosModal.length - 1);
            btnProx.onclick = () => carregarExercicioNoModal(indiceExercicioModal + 1);
        }
    }

    function carregarExercicioNoModal(index) {
        if (index < 0 || index >= listaExerciciosModal.length) return;
        indiceExercicioModal = index;

        const exAtual = listaExerciciosModal[indiceExercicioModal];
        montarNavegacaoModal();

        const tituloEl = document.getElementById('modalTituloExercicioAtivo');
        const badgeStatus = document.getElementById('modalBadgeStatusExercicio');
        if (tituloEl) tituloEl.innerText = `Exercício ${index + 1}: ${exAtual.title}`;

        const acertosEx = alunoSelecionado.submissoesAcertos.filter(s => String(s.exerciseId) === String(exAtual.exerciseId));
        const errosEx = alunoSelecionado.submissoesErros.filter(s => String(s.exerciseId) === String(exAtual.exerciseId));

        if (badgeStatus) {
            if (acertosEx.length > 0) {
                badgeStatus.className = 'badge badge-success p-1';
                badgeStatus.innerText = 'Resolvido';
            } else if (errosEx.length > 0) {
                badgeStatus.className = 'badge badge-danger p-1';
                badgeStatus.innerText = 'Não Resolvido';
            } else {
                badgeStatus.className = 'badge badge-secondary p-1';
                badgeStatus.innerText = 'Sem Envios';
            }
        }

        document.getElementById('count-acertos').innerText = acertosEx.length;
        document.getElementById('count-erros').innerText = errosEx.length;

        const editor = document.getElementById('modalInspecionarEditor');
        const labelArquivo = document.getElementById('labelInspecaoArquivo');
        const divResultado = document.getElementById('modalInspecionarResultado');
        const btnCompilar = document.getElementById('btnRecompilarCodigoAluno');
        editor.value = '// Selecione um envio acima para carregar o código...';
        divResultado.innerHTML = '';
        btnCompilar.disabled = true;
        submissaoAtivaParaCompilar = null;

        let menorTempo = null;
        if (acertosEx.length > 0) {
            menorTempo = Math.min(...acertosEx.map(s => s.executionTime));
        }

        const tbodyAcertos = document.getElementById('tbody-modal-acertos');
        tbodyAcertos.innerHTML = '';
        if (acertosEx.length === 0) {
            tbodyAcertos.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-2">Nenhum acerto registrado para este exercício.</td></tr>';
        } else {
            acertosEx.forEach(sub => {
                const tr = document.createElement('tr');
                const isMelhor = sub.executionTime === menorTempo;
                const dataFormat = new Date(sub.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                tr.innerHTML = `
                    <td>
                        <span class="badge badge-success mr-1">Accepted</span>
                        ${isMelhor ? '<span class="badge badge-warning text-dark font-weight-bold"><i class="fas fa-star mr-1"></i>Melhor Tempo (Imunizado)</span>' : ''}
                    </td>
                    <td><strong>${sub.executionTime} ms</strong></td>
                    <td class="text-muted small">${dataFormat}</td>
                    <td class="text-right">
                        <button class="btn btn-xs btn-outline-primary py-0 px-2 btn-carregar-codigo" 
                                data-codepath="${sub.codePath}" data-ex="${sub.exerciseId}" data-title="${exAtual.title}">
                            <i class="fas fa-eye mr-1"></i> Inspecionar
                        </button>
                    </td>
                `;
                tbodyAcertos.appendChild(tr);
            });
        }

        const tbodyErros = document.getElementById('tbody-modal-erros');
        tbodyErros.innerHTML = '';
        if (errosEx.length === 0) {
            tbodyErros.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-2">Nenhum erro registrado para este exercício.</td></tr>';
        } else {
            errosEx.forEach(sub => {
                const tr = document.createElement('tr');
                const dataFormat = new Date(sub.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                tr.innerHTML = `
                    <td><span class="badge badge-danger">${sub.status}</span></td>
                    <td class="text-muted small">${dataFormat}</td>
                    <td class="text-right">
                        <button class="btn btn-xs btn-outline-danger py-0 px-2 btn-carregar-codigo" 
                                data-codepath="${sub.codePath}" data-ex="${sub.exerciseId}" data-title="${exAtual.title}">
                            <i class="fas fa-eye mr-1"></i> Inspecionar
                        </button>
                    </td>
                `;
                tbodyErros.appendChild(tr);
            });
        }

        $('#modalHistoricoAluno').find('.btn-carregar-codigo').off('click').on('click', async function() {
            const codePath = this.dataset.codepath;
            const exId = this.dataset.ex;
            const exTitle = this.dataset.title;

            labelArquivo.innerHTML = `<i class="fas fa-file-code mr-1"></i> Inspecionando: <strong>${exTitle}</strong> (${codePath})`;
            editor.value = "// Carregando código do MinIO...";
            divResultado.innerHTML = '';
            submissaoAtivaParaCompilar = { exerciseId: exId };

            try {
                const res = await fetch(`/judge/professor/submissao-codigo?codePath=${encodeURIComponent(codePath)}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
                const d = await res.json();
                editor.value = d.code || "// Sem código gravado.";
                btnCompilar.disabled = false;
            } catch (err) {
                editor.value = "// Erro ao buscar arquivo no MinIO.";
            }
        });
    }

    // Limpar campos do novo exercício
    function limparModalNovoExercicio() {
        const inputTitulo = document.getElementById('modal-titulo');
        const inputDesc = document.getElementById('modal-desc');
        const containerTestes = document.getElementById('modal-container-testes');
        const chkPrivado = document.getElementById('modal-exercicio-privado');

        if (inputTitulo) inputTitulo.value = '';
        if (inputDesc) inputDesc.value = '';
        if (chkPrivado) chkPrivado.checked = false;

        if (containerTestes) {
            containerTestes.innerHTML = `
                <div class="teste-item border rounded p-2 mb-2 bg-light position-relative">
                    <div class="row">
                        <div class="col">
                            <label class="small font-weight-bold">Entradas:</label>
                            <input type="text" class="form-control form-control-sm input-val">
                        </div>
                        <div class="col">
                            <label class="small font-weight-bold">Saída Esperada:</label>
                            <input type="text" class="form-control form-control-sm output-val">
                        </div>
                    </div>
                </div>
            `;
        }
    }

    carregarEstadoInicial();
});