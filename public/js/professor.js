document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ltiToken = urlParams.get('ltik') || document.querySelector('meta[name="ltik"]')?.content || '';

    const setupProfessor = document.getElementById('setup-professor');
    const areaPreview = document.getElementById('area-preview');
    const iframeAluno = document.getElementById('iframe-aluno');
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
    const inputBuscaLista = document.getElementById('input-busca-lista');
    const inputBuscaExercicio = document.getElementById('input-busca-exercicio');
    const inputBuscaBancoUniversal = document.getElementById('input-busca-banco-universal');
    const inputBuscaBancoEx = document.getElementById('input-busca-banco-ex');
    const btnAtualizarTurma = document.getElementById('btnAtualizarTurma');
    const containerTaxas = document.getElementById('container-taxas-exercicios');
    const tbodyRanking = document.getElementById('tbody-ranking-turma');
    const containerBancoUniversal = document.getElementById('container-banco-universal');
    const containerBancoEx = document.getElementById('container-banco-exercicios-comunidade');
    const chkLimiteTentativas = document.getElementById('chk-limite-tentativas');
    const boxTentativas = document.getElementById('box-tentativas');
    const inputMaxTentativas = document.getElementById('input-max-tentativas');
    const chkDefinirTempo = document.getElementById('chk-definir-tempo-limite');
    const boxCampoTempo = document.getElementById('box-campo-tempo-limite');
    const labelMaxTempo = document.getElementById('label-max-tempo-limite');
    const tabGerenciarLink = document.getElementById('tab-gerenciar-link');
    const tabListasLink = document.getElementById('tab-listas-link');
    const nomeAtividadeGerenciar = document.getElementById('nome-atividade-gerenciar');
    const btnEditarAtividadeAtiva = document.getElementById('btnEditarAtividadeAtiva');
    const btnPreview = document.getElementById('btnPreview');
    const circleTaxaAcerto = document.getElementById('circle-taxa-acerto');
    const circleTempoMedio = document.getElementById('circle-tempo-medio');
    const btnAbrirModalNovoExercicio = document.getElementById('btnAbrirModalNovoExercicio');
    const modalEditChkLimite = document.getElementById('modal-edit-chk-limite-tentativas');
    const modalEditBoxTentativas = document.getElementById('modal-edit-box-tentativas');
    const modalEditInputMaxTentativas = document.getElementById('modal-edit-input-max-tentativas');
    const modalBtnSalvarEdicaoLista = document.getElementById('modalBtnSalvarEdicaoLista');
    const btnDesvincularAtividade = document.getElementById('btnDesvincularAtividade');

    const selectProfExRanking = document.getElementById('select-prof-ex-ranking');
    const tbodyProfRankingEx = document.getElementById('tbody-prof-ranking-exercicio');
    const cardProfLiderEx = document.getElementById('card-prof-lider-ex');
    const profLiderNome = document.getElementById('prof-lider-nome');
    const profLiderTempo = document.getElementById('prof-lider-tempo');

    let idListaAtivaVinculada = null;
    let listaAtivaObjeto = null;
    let dadosTurmaCarregados = [];
    let rankingPorExercicioCarregado = {};
    let submissaoAtivaParaCompilar = null;
    let alunoSelecionado = null;
    let listaExerciciosModal = [];
    let indiceExercicioModal = 0;
    let metricasGlobaisExercicios = [];
    let idExercicioParaExcluir = null;
    let maxExecutionTimeLimitMs = 7200000;

    if (chkLimiteTentativas && boxTentativas) {
        chkLimiteTentativas.addEventListener('change', () => {
            boxTentativas.style.display = chkLimiteTentativas.checked ? 'flex' : 'none';
        });
    }

    if (modalEditChkLimite && modalEditBoxTentativas) {
        modalEditChkLimite.addEventListener('change', () => {
            modalEditBoxTentativas.style.display = modalEditChkLimite.checked ? 'flex' : 'none';
        });
    }

    if (chkDefinirTempo && boxCampoTempo) {
        chkDefinirTempo.addEventListener('change', () => {
            boxCampoTempo.style.display = chkDefinirTempo.checked ? 'block' : 'none';
            if (chkDefinirTempo.checked) {
                const inputTempo = document.getElementById('modal-tempo-limite');
                if (inputTempo && !inputTempo.value) inputTempo.value = '1000';
            }
        });
    }

    if (btnAbrirModalNovoExercicio) {
        btnAbrirModalNovoExercicio.onclick = () => {
            limparModalNovoExercicio();
            document.getElementById('modalExercicioTituloCabecalho').innerHTML = '<i class="fas fa-plus-circle mr-2"></i> Cadastrar Novo Exercício';
            $('#modalNovoExercicio').modal('show');
        };
    }

    function atualizarContador() {
        const selecionados = containerExercicios ? containerExercicios.querySelectorAll('.chk-exercicio:checked').length : 0;
        if (contadorEl) {
            contadorEl.innerHTML = `<i class="fas fa-check-square mr-1"></i> ${selecionados} ${selecionados === 1 ? 'exercício selecionado' : 'exercícios selecionados'}`;
        }
    }

    function abrirVisualizadorAluno(paramsQuery) {
        if (setupProfessor) setupProfessor.style.display = 'none';
        if (areaPreview) areaPreview.style.display = 'block';
        const targetUrl = `/?mode=preview&${paramsQuery}` + (ltiToken ? `&ltik=${ltiToken}` : '');
        if (iframeAluno) iframeAluno.src = targetUrl;
    }

    async function carregarEstadoInicial() {
        const activityIdMeta = document.querySelector('meta[name="activity-id"]');
        const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';
        try {
            const res = await fetch(`/judge/professor/dados?activityId=${activityId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();
            if (!res.ok || !data.success) return;

            idListaAtivaVinculada = data.listaVinculadaId || null;
            listaAtivaObjeto = data.listaVinculada || null;

            if (data.maxExecutionTimeLimitMs) {
                maxExecutionTimeLimitMs = data.maxExecutionTimeLimitMs;
                const horas = (maxExecutionTimeLimitMs / 3600000).toFixed(1).replace('.0', '');
                if (labelMaxTempo) {
                    labelMaxTempo.innerText = `Máximo permitido: ${maxExecutionTimeLimitMs.toLocaleString()} ms - equivalente a ${horas} horas`;
                }
            }

            window.todosMeusExerciciosCache = data.meusExercicios || [];
            window.minhasListasCache = data.minhasListas || [];

            renderizarMeusExercicios(data.meusExercicios || []);
            renderizarBancoExercicios(data.bancoUniversalExercicios || []);
            renderizarMinhasListas(data.minhasListas || []);
            renderizarBancoListas(data.bancoUniversal || data.bancoUniversalListas || []);

            const tentativasSalvas = data.maxAttempts ? parseInt(data.maxAttempts, 10) : 3;
            if (chkLimiteTentativas) {
                chkLimiteTentativas.checked = !!data.isEvaluative;
                if (boxTentativas) {
                    boxTentativas.style.display = chkLimiteTentativas.checked ? 'flex' : 'none';
                }
            }
            if (inputMaxTentativas) {
                inputMaxTentativas.value = tentativasSalvas;
            }

            if (idListaAtivaVinculada && listaAtivaObjeto) {
                if (tabGerenciarLink) {
                    tabGerenciarLink.classList.remove('disabled');
                    tabGerenciarLink.removeAttribute('title');
                }
                if (nomeAtividadeGerenciar) {
                    nomeAtividadeGerenciar.innerText = listaAtivaObjeto.title || 'Lista Vinculada';
                }
                
                if (window.$ && tabGerenciarLink) {
                    $(tabGerenciarLink).tab('show');
                }
                
                await carregarMetricasTurma();
            } else {
                if (tabGerenciarLink) {
                    tabGerenciarLink.classList.add('disabled');
                    tabGerenciarLink.setAttribute('title', 'Vincule uma lista primeiro para liberar esta aba');
                }
                
                if (window.$ && tabListasLink) {
                    $(tabListasLink).tab('show');
                }
            }

        } catch (err) {
            console.error("Erro ao carregar listas do banco:", err);
        }
    }

    function renderizarMeusExercicios(meusEx) {
        if (!containerExercicios) return;
        containerExercicios.innerHTML = '';
        if (meusEx.length === 0) {
            containerExercicios.innerHTML = '<p class="text-muted p-2 mb-0">Nenhum exercício cadastrado ainda.</p>';
            atualizarContador();
            return;
        }

        meusEx.forEach(ex => {
            const isPub = ex.isPublic !== false;
            const div = document.createElement('div');
            div.className = 'custom-control custom-checkbox border-bottom p-2 pl-4 d-flex justify-content-between align-items-center';
            div.innerHTML = `
                <div class="text-truncate mr-2">
                    <input type="checkbox" class="custom-control-input chk-exercicio" id="ex_${ex._id}" value="${ex._id}">
                    <label class="custom-control-label cursor-pointer ml-2" for="ex_${ex._id}">
                        <strong>${ex.title}</strong>
                        ${ex.timeLimit ? `<span class="badge badge-light border ml-1">${ex.timeLimit} ms</span>` : ''}
                    </label>
                </div>
                <div class="text-nowrap d-flex align-items-center">
                    ${isPub 
                        ? '<span class="badge badge-info mr-2"><i class="fas fa-globe mr-1"></i>Público</span>' 
                        : '<span class="badge badge-privada mr-2"><i class="fas fa-lock mr-1"></i>Privado</span>'}
                    <button type="button" class="btn btn-outline-info btn-sm mr-2 font-weight-bold btn-testar-ex shadow-sm" data-exid="${ex._id}" title="Testar este exercício no Modo Aluno">
                        <i class="fas fa-play mr-1"></i> Testar
                    </button>
                    <button type="button" class="btn btn-outline-primary btn-action-round mr-1 btn-editar-ex shadow-sm" data-exid="${ex._id}" title="Editar este exercício">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button type="button" class="btn btn-outline-danger btn-action-round btn-excluir-ex shadow-sm" data-exid="${ex._id}" title="Excluir este exercício">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `;
            containerExercicios.appendChild(div);
        });

        containerExercicios.querySelectorAll('.btn-testar-ex').forEach(btn => {
            btn.onclick = () => abrirVisualizadorAluno(`exerciseId=${btn.dataset.exid}`);
        });
        containerExercicios.querySelectorAll('.btn-editar-ex').forEach(btn => {
            btn.onclick = () => abrirModalEditarExercicio(btn.dataset.exid);
        });
        containerExercicios.querySelectorAll('.btn-excluir-ex').forEach(btn => {
            btn.onclick = () => solicitarExclusaoExercicio(btn.dataset.exid);
        });

        atualizarContador();
    }

    function renderizarBancoExercicios(bancoEx) {
        window.exerciciosComunidadeCache = bancoEx;
        if (!containerBancoEx) return;
        containerBancoEx.innerHTML = '';

        if (bancoEx.length === 0) {
            containerBancoEx.innerHTML = '<p class="text-muted p-3 mb-0 text-center">Nenhum exercício compartilhado ainda.</p>';
            return;
        }

        bancoEx.forEach(ex => {
            const isPub = ex.isPublic !== false;
            const div = document.createElement('div');
            div.className = 'border-bottom p-2 d-flex justify-content-between align-items-center';
            div.innerHTML = `
                <div class="text-truncate mr-2">
                    <strong class="text-dark">${ex.title}</strong>
                    ${ex.timeLimit ? `<span class="badge badge-light border ml-1">${ex.timeLimit} ms</span>` : ''}
                    <small class="text-muted ml-2"><i class="fas fa-user-edit mr-1"></i>${ex.authorName || 'Professor'}</small>
                </div>
                <div class="text-nowrap d-flex align-items-center">
                    ${isPub 
                        ? '<span class="badge badge-info mr-2"><i class="fas fa-globe mr-1"></i>Público</span>' 
                        : '<span class="badge badge-privada mr-2"><i class="fas fa-lock mr-1"></i>Privado</span>'}
                    <button type="button" class="btn btn-outline-info btn-sm mr-2 font-weight-bold btn-testar-ex-comunidade shadow-sm" data-exid="${ex._id}" title="Testar no Modo Aluno">
                        <i class="fas fa-play mr-1"></i> Testar
                    </button>
                    <button type="button" class="btn btn-outline-secondary btn-sm py-1 px-2 mr-1 btn-ver-ex font-weight-bold" data-exid="${ex._id}">
                        <i class="fas fa-eye mr-1"></i> Ver
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-success font-weight-bold btn-importar-ex py-1 px-2" data-exid="${ex._id}">
                        <i class="fas fa-file-import mr-1"></i> Importar
                    </button>
                </div>
            `;
            containerBancoEx.appendChild(div);
        });

        containerBancoEx.querySelectorAll('.btn-testar-ex-comunidade').forEach(btn => {
            btn.onclick = () => abrirVisualizadorAluno(`exerciseId=${btn.dataset.exid}`);
        });

        containerBancoEx.querySelectorAll('.btn-ver-ex').forEach(btn => {
            btn.onclick = () => {
                const ex = (window.exerciciosComunidadeCache || []).find(e => String(e._id) === String(btn.dataset.exid));
                if (!ex) return;

                document.getElementById('modalVerExTitulo').innerHTML = `<i class="fas fa-file-code text-primary mr-2"></i> ${ex.title}`;
                document.getElementById('modalVerExAutor').innerText = ex.authorName || 'Outro Professor';
                document.getElementById('modalVerExDescricao').innerText = ex.description || 'Sem descrição cadastrada.';
                const badgeTempo = document.getElementById('modalVerExTempoLimite');
                if (badgeTempo) badgeTempo.innerText = ex.timeLimit ? `${ex.timeLimit} ms` : 'Sem Limite';

                const containerTeste = document.getElementById('modalVerExTeste');
                if (ex.tests && ex.tests.length > 0) {
                    const t = ex.tests[0];
                    containerTeste.innerHTML = `
                        <div class="row">
                            <div class="col-md-6 mb-1 mb-md-0">
                                <strong class="d-block text-muted">Entrada:</strong>
                                <pre class="bg-light p-2 border rounded mb-0 text-dark" style="font-size: 0.85rem;">${t.input ? t.input : '<em>(Vazio)</em>'}</pre>
                            </div>
                            <div class="col-md-6">
                                <strong class="d-block text-muted">Saída Esperada:</strong>
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
                        alert(impExData.error || "Erro ao copiar exercício.");
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-file-import mr-1"></i> Importar';
                    }
                } catch (err) {
                    alert("Erro de conexão ao copiar exercício.");
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-file-import mr-1"></i> Importar';
                }
            };
        });
    }

    function renderizarMinhasListas(minhasListas) {
        if (!containerListas) return;
        containerListas.innerHTML = '';

        if (minhasListas.length === 0) {
            containerListas.innerHTML = '<p class="text-muted p-3 mb-0 text-center">Você ainda não criou nenhuma lista. Crie uma na Aba "Criar Lista" ou importe do Banco Universal.</p>';
            return;
        }

        minhasListas.forEach(lista => {
            const isVinculada = idListaAtivaVinculada && (String(lista._id) === String(idListaAtivaVinculada));
            const isPub = lista.isPublic !== false;
            const div = document.createElement('div');
            div.className = 'list-group-item list-group-item-action border-0 border-bottom d-flex justify-content-between align-items-center py-3';

            div.innerHTML = `
                <div class="custom-control custom-radio mr-2" style="overflow: visible; padding-left: 1.85rem; margin-left: 4px;">
                    <input type="radio" id="lista_${lista._id}" name="listaSelecionada" class="custom-control-input" value="${lista._id}" ${isVinculada ? 'checked' : ''}>
                    <label class="custom-control-label font-weight-bold" for="lista_${lista._id}">
                        <span style="font-size: 1.02rem;">${lista.title}</span>
                        <span class="badge badge-light border text-muted ml-2">${lista.exercises ? lista.exercises.length : 0} exercícios</span>
                        ${isVinculada ? '<span class="badge badge-success ml-2 font-weight-bold"><i class="fas fa-check-circle mr-1"></i>Ativa</span>' : ''}
                    </label>
                </div>
                <div class="text-nowrap d-flex align-items-center">
                    ${isPub 
                        ? '<span class="badge badge-info mr-3 font-weight-bold p-2"><i class="fas fa-globe mr-1"></i>Pública</span>' 
                        : '<span class="badge badge-privada mr-3 font-weight-bold p-2"><i class="fas fa-lock mr-1"></i>Privada</span>'}
                    <button type="button" class="btn btn-outline-info btn-sm mr-2 font-weight-bold btn-testar-minha-lista shadow-sm" data-listid="${lista._id}" title="Testar esta lista no Modo Aluno">
                        <i class="fas fa-play mr-1"></i> Testar
                    </button>
                    <button type="button" class="btn btn-outline-primary btn-action-round mr-2 btn-editar-minha-lista shadow-sm" data-listid="${lista._id}" title="Editar esta lista de atividades">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button type="button" class="btn btn-outline-danger btn-action-round btn-excluir-minha-lista shadow-sm" data-listid="${lista._id}" title="Excluir esta lista de atividades">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `;

            if (isVinculada) {
                containerListas.prepend(div);
            } else {
                containerListas.appendChild(div);
            }
        });

        containerListas.querySelectorAll('.btn-testar-minha-lista').forEach(btn => {
            btn.onclick = () => abrirVisualizadorAluno(`listId=${btn.dataset.listid}`);
        });
        containerListas.querySelectorAll('.btn-editar-minha-lista').forEach(btn => {
            btn.onclick = () => abrirModalEditarLista(btn.dataset.listid);
        });
        containerListas.querySelectorAll('.btn-excluir-minha-lista').forEach(btn => {
            btn.onclick = () => excluirLista(btn.dataset.listid);
        });
    }

    function renderizarBancoListas(listasComunidade) {
        window.listasComunidadeCache = listasComunidade;
        if (!containerBancoUniversal) return;
        containerBancoUniversal.innerHTML = '';

        if (listasComunidade.length === 0) {
            containerBancoUniversal.innerHTML = '<p class="text-muted p-3 mb-0 text-center">Nenhuma lista compartilhada por outros professores ainda.</p>';
            return;
        }

        listasComunidade.forEach(lista => {
            const isPub = lista.isPublic !== false;
            const div = document.createElement('div');
            div.className = 'list-group-item list-group-item-action border-0 border-bottom d-flex justify-content-between align-items-center py-3';
            div.innerHTML = `
                <div class="text-truncate mr-2">
                    <strong class="text-dark" style="font-size: 1.02rem;">${lista.title}</strong>
                    <span class="badge badge-light border text-muted ml-2">${lista.exercises ? lista.exercises.length : 0} exercícios</span>
                    <small class="text-muted ml-3"><i class="fas fa-user-edit mr-1"></i>${lista.authorName || 'Professor'}</small>
                </div>
                <div class="text-nowrap d-flex align-items-center">
                    ${isPub 
                        ? '<span class="badge badge-info mr-3 font-weight-bold p-2"><i class="fas fa-globe mr-1"></i>Pública</span>' 
                        : '<span class="badge badge-privada mr-3 font-weight-bold p-2"><i class="fas fa-lock mr-1"></i>Privada</span>'}
                    <button type="button" class="btn btn-outline-secondary btn-sm py-1 px-3 mr-2 btn-ver-lista font-weight-bold shadow-sm" data-listid="${lista._id}">
                        <i class="fas fa-eye mr-1"></i> Ver Exercícios
                    </button>
                    <button type="button" class="btn btn-outline-success btn-sm py-1 px-3 font-weight-bold btn-importar-lista shadow-sm" data-listid="${lista._id}">
                        <i class="fas fa-file-import mr-1"></i> Importar
                    </button>
                </div>
            `;
            containerBancoUniversal.appendChild(div);
        });

        containerBancoUniversal.querySelectorAll('.btn-ver-lista').forEach(btn => {
            btn.onclick = () => abrirModalVerListaComunidade(btn.dataset.listid);
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
                        alert(impData.error || "Erro ao importar lista.");
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

    function abrirModalVerListaComunidade(listId) {
        const lista = (window.listasComunidadeCache || []).find(l => String(l._id) === String(listId));
        if (!lista) return;

        document.getElementById('modalVerListaTitulo').innerHTML = `<i class="fas fa-list-alt text-primary mr-2"></i> ${lista.title}`;
        document.getElementById('modalVerListaAutor').innerText = lista.authorName || 'Professor';
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
                    <div class="card-header bg-white py-2 font-weight-bold text-dark d-flex justify-content-between align-items-center">
                        <span><strong>#${idx + 1}</strong> - ${ex.title}</span>
                        ${ex.timeLimit ? `<span class="badge badge-light border">${ex.timeLimit} ms</span>` : ''}
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
    }

    function abrirModalEditarLista(listId) {
        const lista = (window.minhasListasCache || []).find(l => String(l._id) === String(listId));
        if (!lista) return;

        document.getElementById('modal-edit-lista-id').value = lista._id;
        document.getElementById('modal-edit-lista-titulo').value = lista.title;
        document.getElementById('modal-edit-lista-privada').checked = (lista.isPublic === false);

        const isVinculada = idListaAtivaVinculada && (String(lista._id) === String(idListaAtivaVinculada));
        const isEval = isVinculada ? (chkLimiteTentativas && chkLimiteTentativas.checked) : (lista.isEvaluative || false);
        const maxAtt = isVinculada && inputMaxTentativas ? (parseInt(inputMaxTentativas.value, 10) || 3) : (lista.maxAttempts || 3);

        if (modalEditChkLimite) modalEditChkLimite.checked = isEval;
        if (modalEditInputMaxTentativas) modalEditInputMaxTentativas.value = maxAtt;
        if (modalEditBoxTentativas) modalEditBoxTentativas.style.display = isEval ? 'flex' : 'none';

        const containerExs = document.getElementById('modal-edit-lista-exercicios');
        containerExs.innerHTML = '';

        const idsNaLista = (lista.exercises || []).map(e => String(e._id || e));
        const todosExs = window.todosMeusExerciciosCache || [];

        todosExs.forEach(ex => {
            const isChecked = idsNaLista.includes(String(ex._id));
            const div = document.createElement('div');
            div.className = 'custom-control custom-checkbox border-bottom py-1 pl-4';
            div.innerHTML = `
                <input type="checkbox" class="custom-control-input chk-edit-lista-ex" id="edit_ex_${ex._id}" value="${ex._id}" ${isChecked ? 'checked' : ''}>
                <label class="custom-control-label cursor-pointer ml-1" for="edit_ex_${ex._id}">
                    <strong>${ex.title}</strong>
                    ${ex.timeLimit ? `<span class="badge badge-light border ml-1">${ex.timeLimit} ms</span>` : ''}
                </label>
            `;
            containerExs.appendChild(div);
        });

        $('#modalEditarLista').modal('show');
    }

    if (modalBtnSalvarEdicaoLista) {
        modalBtnSalvarEdicaoLista.onclick = async () => {
            const listId = document.getElementById('modal-edit-lista-id').value;
            const title = document.getElementById('modal-edit-lista-titulo').value.trim();
            const isPrivate = document.getElementById('modal-edit-lista-privada').checked;
            const exercises = Array.from(document.querySelectorAll('.chk-edit-lista-ex:checked')).map(c => c.value);
            const isEvaluative = modalEditChkLimite ? modalEditChkLimite.checked : false;
            const maxAttempts = modalEditInputMaxTentativas ? parseInt(modalEditInputMaxTentativas.value, 10) || 3 : 3;

            const activityIdMeta = document.querySelector('meta[name="activity-id"]');
            const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';

            if (!title) {
                alert("Informe um nome para a lista.");
                return;
            }
            if (exercises.length === 0) {
                alert("Selecione pelo menos um exercício.");
                return;
            }

            modalBtnSalvarEdicaoLista.disabled = true;
            modalBtnSalvarEdicaoLista.innerText = "Salvando...";

            try {
                const res = await fetch(`/judge/lista/${listId}` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        title, 
                        exercises, 
                        isPrivate, 
                        isEvaluative, 
                        maxAttempts, 
                        activityId 
                    })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    alert("Lista atualizada com sucesso!");
                    $('#modalEditarLista').modal('hide');
                    await carregarEstadoInicial();
                } else {
                    alert(data.error || "Erro ao atualizar lista.");
                }
            } catch (e) {
                alert("Erro de conexão ao salvar lista.");
            } finally {
                modalBtnSalvarEdicaoLista.disabled = false;
                modalBtnSalvarEdicaoLista.innerText = "Salvar Alterações";
            }
        };
    }

    async function excluirLista(listId) {
        if (!confirm("Deseja realmente excluir esta lista de atividades?")) return;
        try {
            const res = await fetch(`/judge/lista/${listId}` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                method: 'DELETE'
            });
            const data = await res.json();
            if (res.ok && data.success) {
                alert("Lista excluída com sucesso!");
                await carregarEstadoInicial();
            } else {
                alert(data.error || "Erro ao excluir lista.");
            }
        } catch (e) {
            alert("Erro de conexão ao excluir lista.");
        }
    }

    function abrirModalEditarExercicio(exerciseId) {
        const ex = (window.todosMeusExerciciosCache || []).find(e => String(e._id) === String(exerciseId));
        if (!ex) return;

        limparModalNovoExercicio();

        document.getElementById('modalExercicioTituloCabecalho').innerHTML = '<i class="fas fa-pencil-alt mr-2"></i> Editar Exercício';
        document.getElementById('modal-exercicio-id').value = ex._id;
        document.getElementById('modal-titulo').value = ex.title;
        document.getElementById('modal-desc').value = ex.description;
        document.getElementById('modal-exercicio-privado').checked = (ex.isPublic === false);

        if (ex.timeLimit) {
            document.getElementById('chk-definir-tempo-limite').checked = true;
            document.getElementById('box-campo-tempo-limite').style.display = 'block';
            document.getElementById('modal-tempo-limite').value = ex.timeLimit;
        } else {
            document.getElementById('chk-definir-tempo-limite').checked = false;
            document.getElementById('box-campo-tempo-limite').style.display = 'none';
            document.getElementById('modal-tempo-limite').value = '1000';
        }

        const containerTestes = document.getElementById('modal-container-testes');
        containerTestes.innerHTML = '';
        if (ex.tests && ex.tests.length > 0) {
            ex.tests.forEach((t, i) => {
                const div = document.createElement('div');
                div.className = 'teste-item border rounded p-2 mb-2 bg-light position-relative';
                div.innerHTML = `
                    <button type="button" class="close position-absolute" style="top: 4px; right: 10px; z-index: 10;" onclick="this.closest('.teste-item').remove()">&times;</button>
                    <span class="badge badge-secondary mb-2 font-weight-bold">Caso de Teste #${i + 1}</span>
                    <div class="row">
                        <div class="col-md-6 mb-2 mb-md-0">
                            <label class="small font-weight-bold text-muted mb-1">Entrada:</label>
                            <textarea class="form-control form-control-sm input-val font-monospace" rows="3">${t.input || ''}</textarea>
                        </div>
                        <div class="col-md-6">
                            <label class="small font-weight-bold text-muted mb-1">Saída Esperada:</label>
                            <textarea class="form-control form-control-sm output-val font-monospace" rows="3">${t.output || ''}</textarea>
                        </div>
                    </div>
                `;
                containerTestes.appendChild(div);
            });
        }

        $('#modalNovoExercicio').modal('show');
    }

    function solicitarExclusaoExercicio(exerciseId) {
        idExercicioParaExcluir = exerciseId;
        const ex = (window.todosMeusExerciciosCache || []).find(e => String(e._id) === String(exerciseId));
        const labelNome = document.getElementById('labelNomeExcluirExercicio');
        if (labelNome) {
            labelNome.innerText = `Exercício: ${ex ? ex.title : '-'}`;
        }
        $('#modalConfirmExcluirExercicio').modal('show');
    }

    async function executarExclusaoExercicio(removeFromAllLists) {
        if (!idExercicioParaExcluir) return;
        try {
            const res = await fetch(`/judge/exercicio/${idExercicioParaExcluir}?removeFromAllLists=${removeFromAllLists}` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                method: 'DELETE'
            });
            const data = await res.json();
            if (res.ok && data.success) {
                $('#modalConfirmExcluirExercicio').modal('hide');
                alert(removeFromAllLists ? "Exercício excluído completamente de todas as listas e do banco!" : "Exercício removido do seu banco pessoal. As listas existentes foram preservadas!");
                await carregarEstadoInicial();
            } else {
                alert(data.error || "Erro ao excluir exercício.");
            }
        } catch (e) {
            alert("Erro de conexão ao excluir exercício.");
        } finally {
            idExercicioParaExcluir = null;
        }
    }

    const btnExcluirApenasMeuBanco = document.getElementById('btnExcluirApenasMeuBanco');
    if (btnExcluirApenasMeuBanco) {
        btnExcluirApenasMeuBanco.onclick = () => executarExclusaoExercicio(false);
    }

    const btnExcluirDeTodasAsListas = document.getElementById('btnExcluirDeTodasAsListas');
    if (btnExcluirDeTodasAsListas) {
        btnExcluirDeTodasAsListas.onclick = () => executarExclusaoExercicio(true);
    }

    if (btnEditarAtividadeAtiva) {
        btnEditarAtividadeAtiva.onclick = () => {
            if (idListaAtivaVinculada) {
                abrirModalEditarLista(idListaAtivaVinculada);
            }
        };
    }

    if (btnPreview) {
        btnPreview.onclick = () => {
            if (!idListaAtivaVinculada) {
                alert("Nenhuma atividade vinculada no momento.");
                return;
            }
            abrirVisualizadorAluno(`listId=${idListaAtivaVinculada}`);
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
            const count = modalContainerTestes.querySelectorAll('.teste-item').length + 1;
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
                <span class="badge badge-secondary mb-2 font-weight-bold">Caso de Teste #${count}</span>
                <div class="row">
                    <div class="col-md-6 mb-2 mb-md-0">
                        <label class="small font-weight-bold text-muted mb-1">Entrada:</label>
                        <textarea class="form-control form-control-sm input-val font-monospace" rows="3" placeholder="Digite cada valor ou linha separada por Enter..."></textarea>
                    </div>
                    <div class="col-md-6">
                        <label class="small font-weight-bold text-muted mb-1">Saída Esperada:</label>
                        <textarea class="form-control form-control-sm output-val font-monospace" rows="3" placeholder="Digite a saída esperada..."></textarea>
                    </div>
                </div>
            `;
            modalContainerTestes.appendChild(div);
        };
    }

    if (modalBtnSalvarEx) {
        modalBtnSalvarEx.onclick = async () => {
            const editId = document.getElementById('modal-exercicio-id')?.value;
            const title = document.getElementById('modal-titulo')?.value.trim();
            const description = document.getElementById('modal-desc')?.value.trim();
            const isPrivate = document.getElementById('modal-exercicio-privado')?.checked || false;
            const chkDefinirTempoEl = document.getElementById('chk-definir-tempo-limite');
            
            let timeLimit = null;
            if (chkDefinirTempoEl && chkDefinirTempoEl.checked) {
                const val = parseInt(document.getElementById('modal-tempo-limite')?.value, 10);
                if (isNaN(val) || val < 100) {
                    alert("Informe um tempo limite válido (mínimo de 100 ms).");
                    return;
                }
                if (val > maxExecutionTimeLimitMs) {
                    const horas = (maxExecutionTimeLimitMs / 3600000).toFixed(1).replace('.0', '');
                    alert(`O tempo limite configurado ultrapassa o teto máximo permitido pelo sistema (${maxExecutionTimeLimitMs.toLocaleString()} ms - ${horas}h). Ajuste para um valor menor ou igual.`);
                    return;
                }
                timeLimit = val;
            }

            if (!title || !description) {
                alert("Preencha o título e a descrição do exercício.");
                return;
            }

            const tests = [];
            document.querySelectorAll('#modal-container-testes .teste-item').forEach(item => {
                const input = item.querySelector('.input-val').value;
                const output = item.querySelector('.output-val').value;
                if (output.trim() !== '') tests.push({ input, output });
            });

            modalBtnSalvarEx.disabled = true;
            modalBtnSalvarEx.innerText = "Salvando...";

            const url = editId ? `/judge/exercicio/${editId}` : `/judge/exercicio`;
            const method = editId ? 'PUT' : 'POST';

            try {
                const res = await fetch(url + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, description, tests, isPrivate, timeLimit })
                });
                const data = await res.json();

                if (res.ok && data.success) {
                    $('#modalNovoExercicio').modal('hide');
                    limparModalNovoExercicio();
                    await carregarEstadoInicial();

                    if (!editId && data.exercicio && data.exercicio._id) {
                        const labelTitulo = document.getElementById('modalSucessoTituloExercicio');
                        if (labelTitulo) labelTitulo.innerText = `"${data.exercicio.title}" salvo com sucesso!`;
                        
                        const btnModalTestar = document.getElementById('btnModalSucessoTestarEx');
                        if (btnModalTestar) {
                            btnModalTestar.onclick = () => {
                                $('#modalSucessoExercicio').modal('hide');
                                abrirVisualizadorAluno(`exerciseId=${data.exercicio._id}`);
                            };
                        }
                        $('#modalSucessoExercicio').modal('show');
                    } else {
                        alert("Exercício atualizado com sucesso!");
                    }
                } else {
                    alert(data.error || "Não autorizado");
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

    if (btnSalvarNovaLista) {
        btnSalvarNovaLista.onclick = async () => {
            const title = nomeNovaLista?.value.trim();
            const selecionados = Array.from(document.querySelectorAll('#container-exercicios-disponiveis .chk-exercicio:checked')).map(c => c.value);
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
                    document.querySelectorAll('#container-exercicios-disponiveis .chk-exercicio').forEach(c => c.checked = false);
                    atualizarContador();
                    await carregarEstadoInicial();
                    $('#tab-listas-link').tab('show');
                } else {
                    alert(data.error || "Não autorizado");
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
                alert("Selecione uma lista de atividades primeiro.");
                return;
            }

            const isEvaluative = chkLimiteTentativas ? chkLimiteTentativas.checked : false;
            const maxAttempts = inputMaxTentativas ? parseInt(inputMaxTentativas.value, 10) || 3 : 3;

            async function executarVinculo(forcar = false) {
                btnVincularLista.disabled = true;
                btnVincularLista.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Submetendo...';
                try {
                    const res = await fetch(`/judge/atividade/vincular` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ activityId, listId: rad.value, isEvaluative, maxAttempts, force: forcar })
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
                        alert("Lista de atividades submetida com sucesso!");
                        await carregarEstadoInicial();
                    } else {
                        alert(data.error || "Não autorizado");
                    }
                } catch (err) {
                    alert("Erro de conexão ao vincular atividade.");
                } finally {
                    btnVincularLista.disabled = false;
                    btnVincularLista.innerHTML = '<i class="fas fa-check-circle mr-2"></i> Submeter Lista de Atividades';
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
                item.style.setProperty('display', texto.includes(termo) ? 'flex' : 'none', 'important');
            });
        });
    }

    if (inputBuscaExercicio && containerExercicios) {
        inputBuscaExercicio.addEventListener('input', () => {
            const termo = inputBuscaExercicio.value.trim().toLowerCase();
            const itensExercicios = containerExercicios.querySelectorAll('.custom-checkbox');
            itensExercicios.forEach(containerItem => {
                const texto = containerItem.textContent.toLowerCase();
                containerItem.style.display = texto.includes(termo) ? '' : 'none';
            });
        });
    }

    if (inputBuscaBancoUniversal && containerBancoUniversal) {
        inputBuscaBancoUniversal.addEventListener('input', () => {
            const termo = inputBuscaBancoUniversal.value.trim().toLowerCase();
            const itens = containerBancoUniversal.querySelectorAll('.list-group-item');
            itens.forEach(item => {
                const texto = item.textContent.toLowerCase();
                item.style.setProperty('display', texto.includes(termo) ? 'flex' : 'none', 'important');
            });
        });
    }

    if (inputBuscaBancoEx && containerBancoEx) {
        inputBuscaBancoEx.addEventListener('input', () => {
            const termo = inputBuscaBancoEx.value.trim().toLowerCase();
            const itens = containerBancoEx.querySelectorAll('.border-bottom');
            itens.forEach(item => {
                const texto = item.textContent.toLowerCase();
                item.style.setProperty('display', texto.includes(termo) ? 'flex' : 'none', 'important');
            });
        });
    }

    async function carregarMetricasTurma() {
        const activityIdMeta = document.querySelector('meta[name="activity-id"]');
        const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';
        if (!activityId) return;

        if (tbodyRanking) {
            tbodyRanking.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando dados da turma...</td></tr>';
        }

        try {
            const res = await fetch(`/judge/professor/turma-metricas?activityId=${activityId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();

            if (!data.success) {
                if (tbodyRanking) tbodyRanking.innerHTML = `<tr><td colspan="3" class="text-center text-warning py-3">${data.message || 'Erro ao carregar dados.'}</td></tr>`;
                return;
            }

            dadosTurmaCarregados = data.ranking || [];
            metricasGlobaisExercicios = data.metricasExercicios || [];
            rankingPorExercicioCarregado = data.rankingPorExercicio || {};

            if (circleTaxaAcerto) {
                circleTaxaAcerto.innerText = `${data.taxaGeralAcertos || 0}%`;
            }
            if (circleTempoMedio) {
                circleTempoMedio.innerText = data.tempoMedioMs > 0 ? `${data.tempoMedioMs} ms` : '-';
            }

            if (containerTaxas) {
                containerTaxas.innerHTML = '';
                data.metricasExercicios.forEach(m => {
                    const row = document.createElement('div');
                    row.className = 'border-bottom py-1 small d-flex justify-content-between align-items-center';
                    row.innerHTML = `
                        <span class="text-truncate mr-2 font-weight-bold" style="max-width: 180px;" title="${m.title}">${m.title}</span>
                        <span>
                            <span class="badge ${m.taxaAcerto >= 70 ? 'badge-success' : (m.taxaAcerto >= 40 ? 'badge-warning' : 'badge-danger')}">${m.taxaAcerto}%</span>
                            <span class="text-muted ml-1">(${m.alunosQueResolveram}/${m.totalEnvios})</span>
                        </span>
                    `;
                    containerTaxas.appendChild(row);
                });
            }

            if (tbodyRanking) {
                tbodyRanking.innerHTML = '';
                if (dadosTurmaCarregados.length === 0) {
                    tbodyRanking.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-4">Nenhum aluno realizou submissões nesta atividade ainda.</td></tr>';
                } else {
                    dadosTurmaCarregados.forEach((aluno) => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>
                                <strong>${aluno.userName}</strong>
                            </td>
                            <td class="text-center font-weight-bold text-secondary">
                                ${aluno.tempoTotalMs > 0 ? `${aluno.tempoTotalMs} ms` : (aluno.totalResolvidos > 0 ? '< 1 ms' : '-')}
                            </td>
                            <td class="text-right pr-4">
                                <button type="button" class="btn btn-sm btn-outline-primary btn-abrir-dossie py-0 px-2 font-weight-bold" data-userid="${aluno.userId}" title="Inspecionar código do aluno">
                                    <i class="fas fa-eye mr-1"></i> Ver
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

            if (selectProfExRanking) {
                selectProfExRanking.innerHTML = '';
                metricasGlobaisExercicios.forEach((m, idx) => {
                    const opt = document.createElement('option');
                    opt.value = m.exerciseId;
                    opt.innerText = `Exercício ${idx + 1}: ${m.title}`;
                    selectProfExRanking.appendChild(opt);
                });

                selectProfExRanking.onchange = renderizarRankingPorExercicio;
                renderizarRankingPorExercicio();
            }

        } catch (e) {
            console.error("Erro ao carregar dados da turma:", e);
        }
    }

    function renderizarRankingPorExercicio() {
        if (!selectProfExRanking || !tbodyProfRankingEx) return;
        const exId = selectProfExRanking.value;
        const dadosEx = rankingPorExercicioCarregado[exId];

        tbodyProfRankingEx.innerHTML = '';

        if (!dadosEx || !dadosEx.ranking || dadosEx.ranking.length === 0) {
            if (cardProfLiderEx) cardProfLiderEx.style.display = 'none';
            tbodyProfRankingEx.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Nenhum aluno acertou este exercício ainda.</td></tr>';
            return;
        }

        if (dadosEx.lider && cardProfLiderEx && profLiderNome && profLiderTempo) {
            cardProfLiderEx.style.display = 'flex';
            profLiderNome.innerText = dadosEx.lider.userName;
            profLiderTempo.innerText = dadosEx.lider.executionTime;
        } else if (cardProfLiderEx) {
            cardProfLiderEx.style.display = 'none';
        }

        dadosEx.ranking.forEach((aluno, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-weight-bold">${idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : idx + 1))}</td>
                <td><strong>${aluno.userName}</strong></td>
                <td class="text-center font-weight-bold text-secondary">${aluno.executionTime} ms</td>
                <td class="text-right pr-3">
                    <button type="button" class="btn btn-sm btn-outline-primary btn-abrir-dossie py-0 px-2 font-weight-bold" data-userid="${aluno.userId}">
                        <i class="fas fa-eye mr-1"></i> Ver
                    </button>
                </td>
            `;
            tbodyProfRankingEx.appendChild(tr);
        });

        tbodyProfRankingEx.querySelectorAll('.btn-abrir-dossie').forEach(btn => {
            btn.onclick = () => abrirDossieAluno(btn.dataset.userid);
        });
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
                        <button type="button" class="btn btn-xs btn-outline-primary py-0 px-2 btn-carregar-codigo font-weight-bold" 
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
                        <button type="button" class="btn btn-xs btn-outline-danger py-0 px-2 btn-carregar-codigo font-weight-bold" 
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
                const res = await fetch(`/judge/professor/submissao-codigo?codePath=${encodeURIComponent(codePath)}` + (ltiToken ? `?ltik=${ltiToken}` : ''));
                const d = await res.json();
                editor.value = d.code || "// Sem código gravado.";
                btnCompilar.disabled = false;
            } catch (err) {
                editor.value = "// Erro ao buscar arquivo no MinIO.";
            }
        });
    }

    function limparModalNovoExercicio() {
        const inputId = document.getElementById('modal-exercicio-id');
        const inputTitulo = document.getElementById('modal-titulo');
        const inputDesc = document.getElementById('modal-desc');
        const inputTempo = document.getElementById('modal-tempo-limite');
        const containerTestes = document.getElementById('modal-container-testes');
        const chkPrivado = document.getElementById('modal-exercicio-privado');
        const chkDefinirTempoEl = document.getElementById('chk-definir-tempo-limite');
        const boxCampoTempoEl = document.getElementById('box-campo-tempo-limite');

        if (inputId) inputId.value = '';
        if (inputTitulo) inputTitulo.value = '';
        if (inputDesc) inputDesc.value = '';
        if (inputTempo) inputTempo.value = '1000';
        if (chkPrivado) chkPrivado.checked = false;
        if (chkDefinirTempoEl) chkDefinirTempoEl.checked = false;
        if (boxCampoTempoEl) boxCampoTempoEl.style.display = 'none';

        if (containerTestes) {
            containerTestes.innerHTML = `
                <div class="teste-item border rounded p-2 mb-2 bg-light position-relative">
                    <span class="badge badge-secondary mb-2 font-weight-bold">Caso de Teste #1</span>
                    <div class="row">
                        <div class="col-md-6 mb-2 mb-md-0">
                            <label class="small font-weight-bold text-muted mb-1">Entrada:</label>
                            <textarea class="form-control form-control-sm input-val font-monospace" rows="3" placeholder="Digite cada valor ou linha separada por Enter..."></textarea>
                        </div>
                        <div class="col-md-6">
                            <label class="small font-weight-bold text-muted mb-1">Saída Esperada:</label>
                            <textarea class="form-control form-control-sm output-val font-monospace" rows="3" placeholder="Digite a saída esperada..."></textarea>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    if (btnDesvincularAtividade) {
        btnDesvincularAtividade.onclick = async () => {
            const activityIdMeta = document.querySelector('meta[name="activity-id"]');
            const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';

            const confirmou = confirm("Deseja realmente remover a submissão desta lista e desvinculá-la desta atividade?");
            if (!confirmou) return;

            btnDesvincularAtividade.disabled = true;
            btnDesvincularAtividade.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Removendo...';

            try {
                const res = await fetch(`/judge/atividade/desvincular` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ activityId })
                });
                const data = await res.json();

                if (res.ok && data.success) {
                    alert("Submissão da lista removida com sucesso!");
                    await carregarEstadoInicial();
                } else {
                    alert(data.error || "Erro ao remover submissão da lista.");
                }
            } catch (err) {
                alert("Erro de conexão ao desvincular atividade.");
            } finally {
                btnDesvincularAtividade.disabled = false;
                btnDesvincularAtividade.innerHTML = '<i class="fas fa-unlink mr-1"></i> Remover Submissão';
            }
        };
    }

    carregarEstadoInicial();
});