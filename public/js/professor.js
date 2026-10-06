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
    const tbodyAlunosProgresso = document.getElementById('tbody-alunos-progresso');
    const tbodyRanking = document.getElementById('tbody-ranking-turma');
    const containerBancoUniversal = document.getElementById('container-banco-universal');
    const containerBancoEx = document.getElementById('container-banco-exercicios-comunidade');

    const chkLimiteTentativas = document.getElementById('chk-limite-tentativas');
    const boxTentativas = document.getElementById('box-tentativas');
    const inputMaxTentativas = document.getElementById('input-max-tentativas');
    const chkTempoAtividade = document.getElementById('chk-tempo-atividade');
    const boxTempoAtividade = document.getElementById('box-tempo-atividade');
    const inputTempoAtividade = document.getElementById('input-tempo-atividade');

    const tabGerenciarLink = document.getElementById('tab-gerenciar-link');
    const tabListasLink = document.getElementById('tab-listas-link');
    const nomeAtividadeGerenciar = document.getElementById('nome-atividade-gerenciar');
    const btnEditarAtividadeAtiva = document.getElementById('btnEditarAtividadeAtiva');
    const btnPreview = document.getElementById('btnPreview');
    const btnDesvincularAtividade = document.getElementById('btnDesvincularAtividade');

    const selectProfExRanking = document.getElementById('select-prof-ex-ranking');
    const tbodyProfRankingEx = document.getElementById('tbody-prof-ranking-exercicio');
    const cardProfLiderEx = document.getElementById('card-prof-lider-ex');
    const profLiderNome = document.getElementById('prof-lider-nome');
    const profLiderTempo = document.getElementById('prof-lider-tempo');

    const btnAbrirModalNovoExercicio = document.getElementById('btnAbrirModalNovoExercicio');
    const chkDefinirTempo = document.getElementById('chk-definir-tempo-limite');
    const boxCampoTempo = document.getElementById('box-campo-tempo-limite');
    const labelMaxTempo = document.getElementById('label-max-tempo-limite');

    const modalBtnSalvarEdicaoLista = document.getElementById('modalBtnSalvarEdicaoLista');

    const modalAtivChkTentativas = document.getElementById('modal-ativ-chk-tentativas');
    const modalAtivBoxTentativas = document.getElementById('modal-ativ-box-tentativas');
    const modalAtivInputTentativas = document.getElementById('modal-ativ-input-tentativas');
    const modalAtivChkTempo = document.getElementById('modal-ativ-chk-tempo');
    const modalAtivBoxTempo = document.getElementById('modal-ativ-box-tempo');
    const modalAtivInputTempo = document.getElementById('modal-ativ-input-tempo');
    const btnSalvarConfigAtividadeModal = document.getElementById('btnSalvarConfigAtividadeModal');

    const modalConflitosImportacao = $('#modalResolverConflitosImportacao');
    const boxConflitoNomeLista = document.getElementById('boxConflitoNomeLista');
    const inputConflitoNomeLista = document.getElementById('inputConflitoNomeLista');
    const boxConflitoExercicios = document.getElementById('boxConflitoExercicios');
    const containerConflitosExercicios = document.getElementById('containerConflitosExercicios');
    const btnSalvarConflitosImportacao = document.getElementById('btnSalvarConflitosImportacao');
    let listaIdConflitoAtual = null;

    const modalRenomearEx = $('#modalRenomearExercicioImportado');
    const inputNomeExConflito = document.getElementById('inputNomeExercicioConflito');
    const btnConfirmarNovoNomeEx = document.getElementById('btnConfirmarNovoNomeExercicio');
    const msgConflitoEx = document.getElementById('msgConflitoExercicio');
    let exIdPendenteRenomear = null;

    const textareaInspecao = document.getElementById('modalInspecionarEditor');
    const selectTemaProf = document.getElementById('select-tema-editor-prof');
    const btnCopiarCodigoAluno = document.getElementById('btnCopiarCodigoAluno');

    const temaProfSalvo = localStorage.getItem('codecheck_prof_editor_theme') || 'dracula';
    if (selectTemaProf) selectTemaProf.value = temaProfSalvo;

    let editorInspecaoCM = null;
    if (textareaInspecao && window.CodeMirror) {
        editorInspecaoCM = CodeMirror.fromTextArea(textareaInspecao, {
            mode: 'text/x-csrc',
            theme: temaProfSalvo,
            lineNumbers: true,
            readOnly: false,
            indentUnit: 4,
            tabSize: 4
        });
    }

    if (selectTemaProf && editorInspecaoCM) {
        selectTemaProf.addEventListener('change', () => {
            const novoTema = selectTemaProf.value;
            editorInspecaoCM.setOption('theme', novoTema);
            localStorage.setItem('codecheck_prof_editor_theme', novoTema);
        });
    }

    if (btnCopiarCodigoAluno && editorInspecaoCM) {
        btnCopiarCodigoAluno.onclick = async () => {
            const codigo = editorInspecaoCM.getValue();
            if (!codigo || codigo.startsWith('//')) return;

            try {
                await navigator.clipboard.writeText(codigo);
                const textoOriginal = btnCopiarCodigoAluno.innerHTML;
                btnCopiarCodigoAluno.innerHTML = '<i class="fas fa-check text-success mr-1"></i> Copiado!';
                btnCopiarCodigoAluno.classList.remove('btn-outline-secondary');
                btnCopiarCodigoAluno.classList.add('btn-outline-success');
                mostrarToast("Código copiado para a área de transferência!", "success", 2000);

                setTimeout(() => {
                    btnCopiarCodigoAluno.innerHTML = textoOriginal;
                    btnCopiarCodigoAluno.classList.remove('btn-outline-success');
                    btnCopiarCodigoAluno.classList.add('btn-outline-secondary');
                }, 2000);
            } catch (err) {
                mostrarToast("Não foi possível copiar o código automaticamente.", "warning");
            }
        };
    }

    $('#modalHistoricoAluno').on('shown.bs.modal', () => {
        if (editorInspecaoCM) {
            editorInspecaoCM.refresh();
        }
    });

    let idListaAtivaVinculada = null;
    let listaAtivaObjeto = null;
    let dadosTurmaCarregados = [];
    let rankingPorExercicioCarregado = {};
    let submissaoAtivaParaCompilar = null;
    let alunoSelecionado = null;
    let listaExerciciosModal = [];
    let indiceExercicioModal = 0;
    let metricasGlobaisExercicios = [];
    let totalExerciciosAtividade = 0;
    let idExercicioParaExcluir = null;
    let maxExecutionTimeLimitMs = 120000;

    function formatarTextoTempoMaximo(ms) {
        if (!ms) return '';
        if (ms >= 3600000) {
            const h = (ms / 3600000).toFixed(1).replace('.0', '');
            return `Máximo permitido: ${ms.toLocaleString()} ms - equivalente a ${h} ${h === '1' ? 'hora' : 'horas'}`;
        } else if (ms >= 60000) {
            const m = (ms / 60000).toFixed(1).replace('.0', '');
            return `Máximo permitido: ${ms.toLocaleString()} ms - equivalente a ${m} ${m === '1' ? 'minuto' : 'minutos'}`;
        } else {
            const s = (ms / 1000).toFixed(1).replace('.0', '');
            return `Máximo permitido: ${ms.toLocaleString()} ms - equivalente a ${s} segundos`;
        }
    }

    document.addEventListener('wheel', (e) => {
        if (document.activeElement.type === 'number') {
            document.activeElement.blur();
        }
    });

    function mostrarToast(mensagem, tipo = 'success', duracao = 3500) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icones = {
            success: 'fa-check-circle',
            danger: 'fa-times-circle',
            warning: 'fa-exclamation-triangle'
        };

        const toast = document.createElement('div');
        toast.className = `toast-custom toast-${tipo}`;
        toast.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="fas ${icones[tipo] || 'fa-info-circle'} mr-2" style="font-size: 1.15rem;"></i>
                <span>${mensagem}</span>
            </div>
            <button type="button" style="background: none; border: none; color: inherit; opacity: 0.65; font-size: 1.3rem; cursor: pointer; line-height: 1; padding-left: 14px;">&times;</button>
        `;

        const fechar = () => {
            toast.style.animation = 'fadeOutToast 0.25s ease forwards';
            setTimeout(() => toast.remove(), 250);
        };

        toast.querySelector('button').onclick = fechar;
        container.appendChild(toast);
        setTimeout(fechar, duracao);
    }

    function confirmarAcao({
        titulo = 'Você tem certeza?',
        mensagem = 'Esta ação não poderá ser desfeita.',
        textoConfirmar = 'Confirmar',
        corConfirmar = 'btn-danger',
        icone = 'fa-exclamation-triangle text-danger'
    } = {}) {
        return new Promise((resolve) => {
            const modalEl = $('#modalConfirmacaoGenerica');
            document.getElementById('modalConfirmTitulo').innerText = titulo;
            document.getElementById('modalConfirmMensagem').innerText = mensagem;
            document.getElementById('modalConfirmIcone').innerHTML = `<i class="fas ${icone}"></i>`;

            const btnAcao = document.getElementById('btnModalConfirmAcao');
            btnAcao.className = `btn ${corConfirmar} px-4 font-weight-bold shadow-sm`;
            btnAcao.innerText = textoConfirmar;

            let confirmou = false;

            btnAcao.onclick = () => {
                confirmou = true;
                modalEl.modal('hide');
            };

            modalEl.off('hidden.bs.modal').on('hidden.bs.modal', () => {
                resolve(confirmou);
            });

            modalEl.modal('show');
        });
    }

    let modalOrigemRetorno = null;

    function exibirDetalhesExercicioModal(exerciseId, showImportButton = false, modalOrigem = null) {
        const exerciciosDasListas = [
            ...(window.minhasListasCache || []).flatMap(l => l.exercises || []),
            ...(window.listasComunidadeCache || []).flatMap(l => l.exercises || [])
        ];
        const todos = [
            ...(window.todosMeusExerciciosCache || []),
            ...(window.exerciciosComunidadeCache || []),
            ...exerciciosDasListas
        ];

        const ex = todos.find(e => e && String(e._id) === String(exerciseId));
        if (!ex) return;
        if (modalOrigem && $(modalOrigem).hasClass('show')) {
            modalOrigemRetorno = modalOrigem;
            $(modalOrigem).one('hidden.bs.modal', () => {
                abrirModalUnificado(ex, showImportButton, true);
            }).modal('hide');
            return;
        }

        modalOrigemRetorno = null;
        abrirModalUnificado(ex, showImportButton, false);
    }

    function abrirModalUnificado(ex, showImportButton, isRetornoParaLista) {
        document.getElementById('modalVerExTitulo').innerHTML = `<i class="fas fa-file-code text-primary mr-2"></i> ${ex.title}`;
        document.getElementById('modalVerExDescricao').innerText = ex.description || 'Sem descrição cadastrada.';
        document.getElementById('modalVerExTempoLimite').innerText = ex.timeLimit ? `${ex.timeLimit} ms` : 'Sem Limite';

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

        const btnFechar = document.getElementById('btnFecharModalVerEx');
        if (btnFechar) {
            if (isRetornoParaLista) {
                btnFechar.innerHTML = '<i class="fas fa-arrow-left mr-1"></i> Voltar';
            } else {
                btnFechar.innerText = 'Fechar';
            }
        }

        const btnImportar = document.getElementById('modalBtnCopiarExAberto');
        if (btnImportar) {
            btnImportar.style.display = showImportButton ? 'inline-block' : 'none';
            if (showImportButton) {
                btnImportar.onclick = () => {
                    modalOrigemRetorno = null;
                    $('#modalVerExercicioIndividual').modal('hide');
                    executarImportacaoExercicio(ex._id);
                };
            }
        }

        $('#modalVerExercicioIndividual').modal('show');
    }

    $('#modalVerExercicioIndividual').on('hidden.bs.modal', function () {
        if (modalOrigemRetorno) {
            const destino = modalOrigemRetorno;
            modalOrigemRetorno = null;
            setTimeout(() => {
                $(destino).modal('show');
            }, 50);
        }
    });

    if (chkLimiteTentativas && boxTentativas) {
        chkLimiteTentativas.addEventListener('change', () => {
            boxTentativas.style.display = chkLimiteTentativas.checked ? 'flex' : 'none';
        });
    }

    if (chkTempoAtividade && boxTempoAtividade) {
        chkTempoAtividade.addEventListener('change', () => {
            boxTempoAtividade.style.display = chkTempoAtividade.checked ? 'flex' : 'none';
        });
    }

    if (modalAtivChkTentativas && modalAtivBoxTentativas) {
        modalAtivChkTentativas.onchange = () => {
            modalAtivBoxTentativas.style.display = modalAtivChkTentativas.checked ? 'flex' : 'none';
        };
    }

    if (modalAtivChkTempo && modalAtivBoxTempo) {
        modalAtivChkTempo.onchange = () => {
            modalAtivBoxTempo.style.display = modalAtivChkTempo.checked ? 'flex' : 'none';
        };
    }

    if (chkDefinirTempo && boxCampoTempo) {
        chkDefinirTempo.addEventListener('change', () => {
            boxCampoTempo.style.display = chkDefinirTempo.checked ? 'block' : 'none';
            if (chkDefinirTempo.checked) {
                const inputTempo = document.getElementById('modal-tempo-limite');
                if (inputTempo && !inputTempo.value) inputTempo.value = '5000';
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

    async function carregarEstadoInicial(isInitialLoad = false) {
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
                if (labelMaxTempo) {
                    labelMaxTempo.innerText = formatarTextoTempoMaximo(maxExecutionTimeLimitMs);
                }
                const inputTempoEl = document.getElementById('modal-tempo-limite');
                if (inputTempoEl) {
                    inputTempoEl.max = maxExecutionTimeLimitMs;
                }
            }

            window.todosMeusExerciciosCache = data.meusExercicios || [];
            window.minhasListasCache = data.minhasListas || [];

            window.atividadeAtivaConfig = {
                isEvaluative: !!data.isEvaluative,
                maxAttempts: data.maxAttempts || 3,
                hasTimeLimit: !!data.hasTimeLimit,
                timeLimitMinutes: data.timeLimitMinutes || 60
            };

            renderizarMeusExercicios(data.meusExercicios || []);
            renderizarBancoExercicios(data.bancoUniversalExercicios || []);
            renderizarMinhasListas(data.minhasListas || []);
            renderizarBancoListas(data.bancoUniversalListas || []);

            if (chkLimiteTentativas) {
                chkLimiteTentativas.checked = !!data.isEvaluative;
                if (boxTentativas) boxTentativas.style.display = chkLimiteTentativas.checked ? 'flex' : 'none';
            }
            if (inputMaxTentativas) {
                inputMaxTentativas.value = data.maxAttempts || 3;
            }

            if (chkTempoAtividade) {
                chkTempoAtividade.checked = !!data.hasTimeLimit;
                if (boxTempoAtividade) boxTempoAtividade.style.display = chkTempoAtividade.checked ? 'flex' : 'none';
            }
            if (inputTempoAtividade) {
                inputTempoAtividade.value = data.timeLimitMinutes || 60;
            }

            if (idListaAtivaVinculada && listaAtivaObjeto) {
                if (tabGerenciarLink) {
                    tabGerenciarLink.classList.remove('disabled');
                    tabGerenciarLink.removeAttribute('title');
                }
                if (nomeAtividadeGerenciar) {
                    nomeAtividadeGerenciar.innerText = listaAtivaObjeto.title || 'Lista Vinculada';
                }
                
                if (isInitialLoad && window.$ && tabGerenciarLink) {
                    $(tabGerenciarLink).tab('show');
                }
                
                await carregarMetricasTurma();
            } else {
                if (tabGerenciarLink) {
                    tabGerenciarLink.classList.add('disabled');
                    tabGerenciarLink.setAttribute('title', 'Vincule uma lista primeiro para liberar esta aba');
                }
                
                if (isInitialLoad && window.$ && tabListasLink) {
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

        const listaOrdenada = [...meusEx].sort((a, b) => 
            (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        );

        listaOrdenada.forEach(ex => {
            const isPub = ex.isPublic !== false;
            const div = document.createElement('div');
            div.className = 'border-bottom p-2 d-flex justify-content-between align-items-center';
            div.innerHTML = `
                <div class="custom-control custom-checkbox text-truncate mr-2" style="overflow: visible; padding-left: 1.85rem;">
                    <input type="checkbox" class="custom-control-input chk-exercicio" id="ex_${ex._id}" value="${ex._id}">
                    <label class="custom-control-label cursor-pointer ml-1" for="ex_${ex._id}">
                        <strong>${ex.title}</strong>
                        ${ex.timeLimit ? `<span class="badge badge-light border ml-1">${ex.timeLimit} ms</span>` : ''}
                    </label>
                </div>
                <div class="text-nowrap d-flex align-items-center">
                    ${isPub 
                        ? '<span class="badge badge-info mr-2"><i class="fas fa-globe mr-1"></i>Público</span>' 
                        : '<span class="badge badge-privada mr-2"><i class="fas fa-lock mr-1"></i>Privado</span>'}
                    <button type="button" class="btn btn-outline-secondary btn-action-round mr-1 btn-ver-meu-ex shadow-sm" data-exid="${ex._id}" title="Ver enunciado e detalhes">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button type="button" class="btn btn-outline-info btn-action-round mr-1 btn-testar-ex shadow-sm" data-exid="${ex._id}" title="Testar no Modo Aluno">
                        <i class="fas fa-play"></i>
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

        containerExercicios.querySelectorAll('.btn-ver-meu-ex').forEach(btn => {
            btn.onclick = () => exibirDetalhesExercicioModal(btn.dataset.exid, false);
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
        const listaOrdenada = [...bancoEx].sort((a, b) => 
            (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        );
        window.exerciciosComunidadeCache = listaOrdenada;
        if (!containerBancoEx) return;
        containerBancoEx.innerHTML = '';

        if (listaOrdenada.length === 0) {
            containerBancoEx.innerHTML = '<p class="text-muted p-3 mb-0 text-center">Nenhum exercício compartilhado ainda.</p>';
            return;
        }

        listaOrdenada.forEach(ex => {
            const isOficial = ex.authorId === 'codecheck_oficial';
            const isPub = ex.isPublic !== false;
            const div = document.createElement('div');
            div.className = `border-bottom p-2 d-flex justify-content-between align-items-center ${isOficial ? 'bg-white' : ''}`;
            div.innerHTML = `
                <div class="text-truncate mr-2">
                    <strong class="text-dark">${ex.title}</strong>
                    ${ex.timeLimit ? `<span class="badge badge-light border ml-1">${ex.timeLimit} ms</span>` : ''}
                    ${isOficial 
                        ? '<span class="badge badge-primary font-weight-bold ml-2 shadow-sm"><i class="fas fa-certificate text-warning mr-1"></i>CodeCheck-RUN</span>'
                        : `<small class="text-muted ml-2"><i class="fas fa-user-edit mr-1"></i>${ex.authorName || 'Professor'}</small>`
                    }
                </div>
                <div class="text-nowrap d-flex align-items-center">
                    ${isPub 
                        ? '<span class="badge badge-info mr-2"><i class="fas fa-globe mr-1"></i>Público</span>' 
                        : '<span class="badge badge-privada mr-2"><i class="fas fa-lock mr-1"></i>Privado</span>'}
                    <button type="button" class="btn btn-outline-secondary btn-action-round mr-1 btn-ver-ex shadow-sm" data-exid="${ex._id}" title="Ver enunciado e detalhes">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button type="button" class="btn btn-outline-info btn-action-round mr-1 btn-testar-ex-comunidade shadow-sm" data-exid="${ex._id}" title="Testar no Modo Aluno">
                        <i class="fas fa-play"></i>
                    </button>
                    <button type="button" class="btn btn-outline-success btn-action-round btn-importar-ex shadow-sm" data-exid="${ex._id}" title="Importar para Meus Exercícios">
                        <i class="fas fa-file-import"></i>
                    </button>
                </div>
            `;
            containerBancoEx.appendChild(div);
        });

        containerBancoEx.querySelectorAll('.btn-testar-ex-comunidade').forEach(btn => {
            btn.onclick = () => abrirVisualizadorAluno(`exerciseId=${btn.dataset.exid}`);
        });

        containerBancoEx.querySelectorAll('.btn-ver-ex').forEach(btn => {
            btn.onclick = () => exibirDetalhesExercicioModal(btn.dataset.exid, true);
        });

        containerBancoEx.querySelectorAll('.btn-importar-ex').forEach(btn => {
            btn.onclick = async () => {
                const exerciseId = btn.dataset.exid;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                await executarImportacaoExercicio(exerciseId, null);
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-file-import"></i>';
            };
        });
    }

    async function executarImportacaoExercicio(exerciseId, customTitle = null) {
        try {
            const res = await fetch(`/judge/professor/exercicio/importar` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exerciseId, customTitle })
            });
            const data = await res.json();

            if (data.requiresNewTitle) {
                exIdPendenteRenomear = exerciseId;
                if (msgConflitoEx) {
                    msgConflitoEx.innerHTML = `Você já possui um exercício chamado <strong>"${data.currentTitle}"</strong> em Meus Exercícios. Digite um novo nome para esta cópia:`;
                }
                if (inputNomeExConflito) {
                    inputNomeExConflito.value = `${data.currentTitle} - Cópia`;
                }
                modalRenomearEx.modal('show');
                return;
            }

            if (res.ok && data.success) {
                mostrarToast("Exercício importado com sucesso!", "success");
                await carregarEstadoInicial();
            } else {
                mostrarToast(data.error || "Erro ao importar exercício.", "danger");
            }
        } catch (err) {
            mostrarToast("Erro de conexão ao importar exercício.", "danger");
        }
    }

    if (btnConfirmarNovoNomeEx) {
        btnConfirmarNovoNomeEx.onclick = async () => {
            const novoNome = inputNomeExConflito ? inputNomeExConflito.value.trim() : '';
            if (!novoNome) {
                mostrarToast("Digite um nome para o exercício.", "warning");
                return;
            }
            modalRenomearEx.modal('hide');
            if (exIdPendenteRenomear) {
                await executarImportacaoExercicio(exIdPendenteRenomear, novoNome);
                exIdPendenteRenomear = null;
            }
        };
    }

    function renderizarMinhasListas(minhasListas) {
        if (!containerListas) return;
        containerListas.innerHTML = '';

        if (minhasListas.length === 0) {
            containerListas.innerHTML = '<p class="text-muted p-3 mb-0 text-center">Você ainda não criou nenhuma lista. Crie uma na Aba "Criar Lista" ou importe do Banco Universal.</p>';
            return;
        }

        const listasOrdenadas = [...minhasListas].sort((a, b) => 
            (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        );
        listasOrdenadas.forEach(lista => {
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
                    <button type="button" class="btn btn-outline-info btn-action-round mr-1 btn-testar-minha-lista shadow-sm" data-listid="${lista._id}" title="Testar lista no Modo Aluno">
                        <i class="fas fa-play"></i>
                    </button>
                    <button type="button" class="btn btn-outline-primary btn-action-round mr-1 btn-editar-minha-lista shadow-sm" data-listid="${lista._id}" title="Editar esta lista">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button type="button" class="btn btn-outline-danger btn-action-round btn-excluir-minha-lista shadow-sm" data-listid="${lista._id}" title="Excluir esta lista">
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

    async function executarImportacaoLista(listId, customTitle = null, exerciseTitles = null) {
        try {
            const res = await fetch(`/judge/professor/lista/importar` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listId, customTitle, exerciseTitles })
            });
            const data = await res.json();

            if (data.requiresConflictResolution) {
                listaIdConflitoAtual = listId;

                if (data.listConflict) {
                    boxConflitoNomeLista.style.display = 'block';
                    inputConflitoNomeLista.value = `${data.currentListTitle} - Cópia`;
                } else {
                    boxConflitoNomeLista.style.display = 'none';
                    inputConflitoNomeLista.value = customTitle || data.currentListTitle;
                }

                if (data.conflictingExercises && data.conflictingExercises.length > 0) {
                    boxConflitoExercicios.style.display = 'block';
                    containerConflitosExercicios.innerHTML = '';
                    data.conflictingExercises.forEach(ex => {
                        const div = document.createElement('div');
                        div.className = 'card p-2 bg-light border';
                        div.innerHTML = `
                            <span class="small text-secondary mb-1">Exercício: <strong>${ex.title}</strong></span>
                            <input type="text" class="form-control form-control-sm font-weight-bold input-conflito-ex" data-exid="${ex.id}" value="${ex.title} - Cópia">
                        `;
                        containerConflitosExercicios.appendChild(div);
                    });
                } else {
                    boxConflitoExercicios.style.display = 'none';
                    containerConflitosExercicios.innerHTML = '';
                }

                modalConflitosImportacao.modal('show');
                return;
            }

            if (res.ok && data.success) {
                mostrarToast("Lista e exercícios importados com sucesso!", "success");
                await carregarEstadoInicial();
            } else {
                mostrarToast(data.error || "Erro ao importar lista.", "danger");
            }
        } catch (err) {
            mostrarToast("Erro de conexão ao importar lista.", "danger");
        }
    }

    if (btnSalvarConflitosImportacao) {
        btnSalvarConflitosImportacao.onclick = async () => {
            const novoTituloLista = inputConflitoNomeLista ? inputConflitoNomeLista.value.trim() : '';
            if (boxConflitoNomeLista.style.display !== 'none' && !novoTituloLista) {
                mostrarToast("Informe um título para a lista.", "warning");
                return;
            }

            const renames = {};
            const inputsEx = containerConflitosExercicios.querySelectorAll('.input-conflito-ex');
            for (const inp of inputsEx) {
                const val = inp.value.trim();
                if (!val) {
                    mostrarToast("Preencha o novo nome de todos os exercícios.", "warning");
                    return;
                }
                renames[inp.dataset.exid] = val;
            }

            modalConflitosImportacao.modal('hide');
            if (listaIdConflitoAtual) {
                await executarImportacaoLista(listaIdConflitoAtual, novoTituloLista, renames);
                listaIdConflitoAtual = null;
            }
        };
    }

    function renderizarBancoListas(listasComunidade) {
        const listasOrdenadas = [...listasComunidade].sort((a, b) => 
            (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        );
        window.listasComunidadeCache = listasOrdenadas;
        if (!containerBancoUniversal) return;
        containerBancoUniversal.innerHTML = '';

        if (listasOrdenadas.length === 0) {
            containerBancoUniversal.innerHTML = '<p class="text-muted p-3 mb-0 text-center">Nenhuma lista compartilhada por outros professores ainda.</p>';
            return;
        }

        listasOrdenadas.forEach(lista => {
            const isOficial = lista.authorId === 'codecheck_oficial';
            const isPub = lista.isPublic !== false;
            const div = document.createElement('div');
            div.className = `list-group-item list-group-item-action border-0 border-bottom d-flex justify-content-between align-items-center py-3 ${isOficial ? 'bg-white' : ''}`;
            div.innerHTML = `
                <div class="text-truncate mr-2">
                    <strong class="text-dark" style="font-size: 1.02rem;">${lista.title}</strong>
                    <span class="badge badge-light border text-muted ml-2">${lista.exercises ? lista.exercises.length : 0} exercícios</span>
                    ${isOficial 
                        ? '<span class="badge badge-primary font-weight-bold ml-2 shadow-sm"><i class="fas fa-certificate text-warning mr-1"></i>CodeCheck-RUN</span>'
                        : `<small class="text-muted ml-3"><i class="fas fa-user-edit mr-1"></i>${lista.authorName || 'Professor'}</small>`
                    }
                </div>
                <div class="text-nowrap d-flex align-items-center">
                    ${isPub 
                        ? '<span class="badge badge-info mr-3 font-weight-bold p-2"><i class="fas fa-globe mr-1"></i>Pública</span>' 
                        : '<span class="badge badge-privada mr-3 font-weight-bold p-2"><i class="fas fa-lock mr-1"></i>Privada</span>'}
                    <button type="button" class="btn btn-outline-secondary btn-action-round mr-1 btn-ver-lista shadow-sm" data-listid="${lista._id}" title="Ver exercícios da lista">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button type="button" class="btn btn-outline-success btn-action-round btn-importar-lista shadow-sm" data-listid="${lista._id}" title="Importar para Minhas Listas">
                        <i class="fas fa-file-import"></i>
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
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                await executarImportacaoLista(listId, null, null);
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-file-import"></i>';
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

        const containerExs = document.getElementById('modal-edit-lista-exercicios');
        containerExs.innerHTML = '';

        const idsNaLista = (lista.exercises || []).map(e => String(e._id || e));
        const todosExs = [...(window.todosMeusExerciciosCache || [])].sort((a, b) => 
            (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        );

        todosExs.forEach(ex => {
            const isChecked = idsNaLista.includes(String(ex._id));
            const div = document.createElement('div');
            div.className = 'd-flex justify-content-between align-items-center border-bottom py-2 px-2';
            div.innerHTML = `
                <div class="custom-control custom-checkbox text-truncate mr-2" style="overflow: visible; padding-left: 1.85rem;">
                    <input type="checkbox" class="custom-control-input chk-edit-lista-ex" id="edit_ex_${ex._id}" value="${ex._id}" ${isChecked ? 'checked' : ''}>
                    <label class="custom-control-label cursor-pointer ml-1" for="edit_ex_${ex._id}">
                        <strong>${ex.title}</strong>
                        ${ex.timeLimit ? `<span class="badge badge-light border ml-1 font-weight-normal">${ex.timeLimit} ms</span>` : ''}
                    </label>
                </div>
                <button type="button" class="btn btn-outline-secondary btn-action-round btn-ver-ex-modal shadow-sm" data-exid="${ex._id}" title="Ver enunciado do exercício" style="width: 32px; height: 32px; font-size: 0.95rem;">
                    <i class="fas fa-eye"></i>
                </button>
            `;
            containerExs.appendChild(div);
        });

        containerExs.querySelectorAll('.btn-ver-ex-modal').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                exibirDetalhesExercicioModal(btn.dataset.exid, false, '#modalEditarLista');
            };
        });

        $('#modalEditarLista').modal('show');
    }

    if (modalBtnSalvarEdicaoLista) {
        modalBtnSalvarEdicaoLista.onclick = async () => {
            const listId = document.getElementById('modal-edit-lista-id').value;
            const title = document.getElementById('modal-edit-lista-titulo').value.trim();
            const isPrivate = document.getElementById('modal-edit-lista-privada').checked;
            const exercises = Array.from(document.querySelectorAll('.chk-edit-lista-ex:checked')).map(c => c.value);

            if (!title) {
                mostrarToast("Informe um nome para a lista.", "warning");
                return;
            }
            if (exercises.length === 0) {
                mostrarToast("Selecione pelo menos um exercício.", "warning");
                return;
            }

            modalBtnSalvarEdicaoLista.disabled = true;
            modalBtnSalvarEdicaoLista.innerText = "Salvando...";

            try {
                const res = await fetch(`/judge/lista/${listId}` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, exercises, isPrivate })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    $('#modalEditarLista').modal('hide');
                    mostrarToast("Lista atualizada com sucesso!", "success");
                    await carregarEstadoInicial();
                } else {
                    mostrarToast(data.error || "Erro ao atualizar lista.", "danger");
                }
            } catch (e) {
                mostrarToast("Erro de conexão ao salvar lista.", "danger");
            } finally {
                modalBtnSalvarEdicaoLista.disabled = false;
                modalBtnSalvarEdicaoLista.innerText = "Salvar Alterações";
            }
        };
    }

    async function excluirLista(listId) {
        const confirmou = await confirmarAcao({
            titulo: 'Excluir Lista',
            mensagem: 'Deseja realmente excluir esta lista de atividades? Os exercícios vinculados serão preservados.',
            textoConfirmar: 'Excluir Lista',
            corConfirmar: 'btn-danger',
            icone: 'fa-trash-alt text-danger'
        });

        if (!confirmou) return;

        try {
            const res = await fetch(`/judge/lista/${listId}` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                method: 'DELETE'
            });
            const data = await res.json();
            if (res.ok && data.success) {
                mostrarToast("Lista excluída com sucesso!", "success");
                await carregarEstadoInicial();
            } else {
                mostrarToast(data.error || "Erro ao excluir lista.", "danger");
            }
        } catch (e) {
            mostrarToast("Erro de conexão ao excluir lista.", "danger");
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
                mostrarToast(removeFromAllLists ? "Exercício excluído completamente de todas as listas e do banco!" : "Exercício removido do seu banco pessoal.", "success");
                await carregarEstadoInicial();
            } else {
                mostrarToast(data.error || "Erro ao excluir exercício.", "danger");
            }
        } catch (e) {
            mostrarToast("Erro de conexão ao excluir exercício.", "danger");
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
            if (!idListaAtivaVinculada) {
                mostrarToast("Nenhuma atividade vinculada no momento.", "warning");
                return;
            }

            const cfg = window.atividadeAtivaConfig || {};
            if (modalAtivChkTentativas) {
                modalAtivChkTentativas.checked = !!cfg.isEvaluative;
                modalAtivBoxTentativas.style.display = cfg.isEvaluative ? 'flex' : 'none';
                modalAtivInputTentativas.value = cfg.maxAttempts || 3;
            }

            if (modalAtivChkTempo) {
                modalAtivChkTempo.checked = !!cfg.hasTimeLimit;
                modalAtivBoxTempo.style.display = cfg.hasTimeLimit ? 'flex' : 'none';
                modalAtivInputTempo.value = cfg.timeLimitMinutes || 60;
            }

            $('#modalEditarAtividade').modal('show');
        };
    }

    if (btnSalvarConfigAtividadeModal) {
        btnSalvarConfigAtividadeModal.onclick = async () => {
            const activityIdMeta = document.querySelector('meta[name="activity-id"]');
            const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';
            if (!activityId) return;

            btnSalvarConfigAtividadeModal.disabled = true;
            btnSalvarConfigAtividadeModal.innerText = "Salvando...";

            try {
                const res = await fetch(`/judge/atividade/config` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        activityId,
                        isEvaluative: modalAtivChkTentativas.checked,
                        maxAttempts: parseInt(modalAtivInputTentativas.value, 10) || 3,
                        hasTimeLimit: modalAtivChkTempo.checked,
                        timeLimitMinutes: parseInt(modalAtivInputTempo.value, 10) || 0
                    })
                });

                const data = await res.json();
                if (res.ok && data.success) {
                    $('#modalEditarAtividade').modal('hide');
                    mostrarToast("Regras da atividade salvas com sucesso!", "success");
                    await carregarEstadoInicial();
                } else {
                    mostrarToast(data.error || "Erro ao salvar regras.", "danger");
                }
            } catch (err) {
                mostrarToast("Erro de conexão ao salvar regras.", "danger");
            } finally {
                btnSalvarConfigAtividadeModal.disabled = false;
                btnSalvarConfigAtividadeModal.innerText = "Salvar Regras da Atividade";
            }
        };
    }

    if (btnPreview) {
        btnPreview.onclick = () => {
            if (!idListaAtivaVinculada) {
                mostrarToast("Nenhuma atividade vinculada no momento.", "warning");
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
                    mostrarToast("Informe um tempo limite válido (mínimo de 100 ms).", "warning");
                    return;
                }
                if (val > maxExecutionTimeLimitMs) {
                    mostrarToast(formatarTextoTempoMaximo(maxExecutionTimeLimitMs), "danger");
                    return;
                }
                timeLimit = val;
            }

            if (!title || !description) {
                mostrarToast("Preencha o título e a descrição do exercício.", "warning");
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
                        mostrarToast("Exercício atualizado com sucesso!", "success");
                    }
                } else {
                    mostrarToast(data.error || "Não autorizado", "danger");
                }
            } catch (err) {
                mostrarToast("Erro de conexão ao salvar exercício.", "danger");
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
                mostrarToast("Informe um nome para a nova lista.", "warning");
                return;
            }
            if (selecionados.length === 0) {
                mostrarToast("Selecione pelo menos um exercício para compor a lista.", "warning");
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
                    mostrarToast("Lista criada com sucesso!", "success");
                    nomeNovaLista.value = '';
                    const chkListaPrivada = document.getElementById('chk-lista-privada');
                    if (chkListaPrivada) chkListaPrivada.checked = false;
                    document.querySelectorAll('#container-exercicios-disponiveis .chk-exercicio').forEach(c => c.checked = false);
                    atualizarContador();
                    await carregarEstadoInicial();
                    if (window.$ && tabListasLink) $(tabListasLink).tab('show');
                } else {
                    mostrarToast(data.error || "Não autorizado", "danger");
                }
            } catch (err) {
                mostrarToast("Erro de conexão ao criar lista.", "danger");
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
                mostrarToast("Selecione uma lista de atividades primeiro.", "warning");
                return;
            }

            const isEvaluative = chkLimiteTentativas ? chkLimiteTentativas.checked : false;
            const maxAttempts = inputMaxTentativas ? parseInt(inputMaxTentativas.value, 10) || 3 : 3;
            const hasTimeLimit = chkTempoAtividade ? chkTempoAtividade.checked : false;
            const timeLimitMinutes = inputTempoAtividade ? parseInt(inputTempoAtividade.value, 10) || 0 : 0;

            async function executarVinculo(forcar = false) {
                btnVincularLista.disabled = true;
                btnVincularLista.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Submetendo...';
                try {
                    const res = await fetch(`/judge/atividade/vincular` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            activityId, 
                            listId: rad.value, 
                            isEvaluative, 
                            maxAttempts, 
                            hasTimeLimit, 
                            timeLimitMinutes, 
                            force: forcar 
                        })
                    });
                    const data = await res.json();
                    if (data.requiresConfirmation) {
                        const confirmou = await confirmarAcao({
                            titulo: 'Substituição de Lista Ativa',
                            mensagem: data.message,
                            textoConfirmar: 'Sim, Trocar Lista',
                            corConfirmar: 'btn-warning text-dark',
                            icone: 'fa-exclamation-triangle text-warning'
                        });

                        if (confirmou) {
                            await executarVinculo(true);
                        }
                        return;
                    }
                    if (res.ok && data.success) {
                        mostrarToast("Lista de atividades submetida com sucesso!", "success");
                        await carregarEstadoInicial();
                    } else {
                        mostrarToast(data.error || "Não autorizado", "danger");
                    }
                } catch (err) {
                    mostrarToast("Erro de conexão ao vincular atividade.", "danger");
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
            const itensExercicios = containerExercicios.querySelectorAll('.border-bottom');
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
                containerItem.style.setProperty('display', texto.includes(termo) ? 'flex' : 'none', 'important');
            });
        });
    }

    async function carregarMetricasTurma() {
        const activityIdMeta = document.querySelector('meta[name="activity-id"]');
        const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';
        if (!activityId) return;

        if (tbodyAlunosProgresso) {
            tbodyAlunosProgresso.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Carregando dados da turma...</td></tr>';
        }

        try {
            const res = await fetch(`/judge/professor/turma-metricas?activityId=${activityId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();

            if (!data.success) {
                if (tbodyAlunosProgresso) tbodyAlunosProgresso.innerHTML = `<tr><td colspan="4" class="text-center text-warning py-3">${data.message || 'Erro ao carregar dados.'}</td></tr>`;
                return;
            }

            dadosTurmaCarregados = data.ranking || [];
            metricasGlobaisExercicios = data.metricasExercicios || [];
            rankingPorExercicioCarregado = data.rankingPorExercicio || {};
            totalExerciciosAtividade = data.totalExercicios || metricasGlobaisExercicios.length || 0;

            if (tbodyAlunosProgresso) {
                tbodyAlunosProgresso.innerHTML = '';
                if (dadosTurmaCarregados.length === 0) {
                    tbodyAlunosProgresso.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Nenhum aluno realizou submissões nesta atividade ainda.</td></tr>';
                } else {
                    const alunosOrdemAlfabetica = [...dadosTurmaCarregados].sort((a, b) => 
                        (a.userName || '').localeCompare(b.userName || '', undefined, { sensitivity: 'base' })
                    );

                    alunosOrdemAlfabetica.forEach((aluno) => {
                        const tr = document.createElement('tr');
                        const todosCorretos = aluno.totalResolvidos === totalExerciciosAtividade && totalExerciciosAtividade > 0;
                        const badgeCor = todosCorretos ? 'badge-success' : (aluno.totalResolvidos > 0 ? 'badge-primary' : 'badge-secondary');

                        tr.innerHTML = `
                            <td>
                                <strong>${aluno.userName}</strong>
                            </td>
                            <td class="text-center">
                                <span class="badge ${badgeCor} font-weight-bold px-2 py-1" style="font-size: 0.85rem;">
                                    ${aluno.totalResolvidos} / ${totalExerciciosAtividade} corretos
                                </span>
                            </td>
                            <td class="text-center text-muted font-weight-bold">
                                ${aluno.totalTentativas} envios
                            </td>
                            <td class="text-right pr-4">
                                <button type="button" class="btn btn-sm btn-outline-primary btn-abrir-dossie py-0 px-2 font-weight-bold" data-userid="${aluno.userId}" title="Inspecionar código do aluno">
                                    <i class="fas fa-eye mr-1"></i> Ver Submissões
                                </button>
                            </td>
                        `;
                        tbodyAlunosProgresso.appendChild(tr);
                    });

                    tbodyAlunosProgresso.querySelectorAll('.btn-abrir-dossie').forEach(btn => {
                        btn.onclick = () => abrirDossieAluno(btn.dataset.userid);
                    });
                }
            }

            if (tbodyRanking) {
                tbodyRanking.innerHTML = '';
                if (dadosTurmaCarregados.length === 0) {
                    tbodyRanking.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Nenhum acerto registrado.</td></tr>';
                } else {
                    dadosTurmaCarregados.forEach((aluno, idx) => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td class="font-weight-bold">${idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : idx + 1))}</td>
                            <td><strong>${aluno.userName}</strong></td>
                            <td class="text-center font-weight-bold text-primary">${aluno.totalResolvidos}</td>
                            <td class="text-right text-muted">${aluno.tempoTotalMs > 0 ? aluno.tempoTotalMs + ' ms' : '-'}</td>
                        `;
                        tbodyRanking.appendChild(tr);
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
            tbodyProfRankingEx.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">Nenhum aluno acertou este exercício ainda.</td></tr>';
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
                <td class="text-right font-weight-bold text-secondary">${aluno.executionTime} ms</td>
            `;
            tbodyProfRankingEx.appendChild(tr);
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

                const code = editorInspecaoCM ? editorInspecaoCM.getValue() : document.getElementById('modalInspecionarEditor').value;
                const divResultado = document.getElementById('modalInspecionarResultado');
                const activityIdMeta = document.querySelector('meta[name="activity-id"]');
                const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';

                divResultado.innerHTML = '<div class="alert alert-info py-1 small"><i class="fas fa-spinner fa-spin mr-1"></i> Compilando...</div>';
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

        const boxPlacarAcertos = document.getElementById('box-placar-acertos');
        const boxPlacarErros = document.getElementById('box-placar-erros');
        if (boxPlacarAcertos) boxPlacarAcertos.innerText = acertosEx.length;
        if (boxPlacarErros) boxPlacarErros.innerText = errosEx.length;

        const labelArquivo = document.getElementById('labelInspecaoArquivo');
        const divResultado = document.getElementById('modalInspecionarResultado');
        const btnCompilar = document.getElementById('btnRecompilarCodigoAluno');
        
        if (editorInspecaoCM) {
            editorInspecaoCM.setValue('// Selecione um envio acima para carregar o código...');
        } else {
            document.getElementById('modalInspecionarEditor').value = '// Selecione um envio acima para carregar o código...';
        }
        
        divResultado.innerHTML = '';
        btnCompilar.disabled = true;
        if (btnCopiarCodigoAluno) btnCopiarCodigoAluno.disabled = true;
        submissaoAtivaParaCompilar = null;

        let idMelhorSubmissao = null;

        if (acertosEx.length > 0) {
            acertosEx.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            const menorTempo = Math.min(...acertosEx.map(s => s.executionTime));
            const candidatasMelhor = acertosEx.filter(s => s.executionTime === menorTempo);
            idMelhorSubmissao = candidatasMelhor[0]._id;
        }

        const tbodyAcertos = document.getElementById('tbody-modal-acertos');
        tbodyAcertos.innerHTML = '';
        if (acertosEx.length === 0) {
            tbodyAcertos.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-2">Nenhum acerto registrado para este exercício.</td></tr>';
        } else {
            acertosEx.forEach((sub) => {
                const tr = document.createElement('tr');
                const isMelhor = String(sub._id) === String(idMelhorSubmissao);
                const dataFormat = new Date(sub.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                tr.innerHTML = `
                    <td>
                        <span class="badge badge-success mr-1">Accepted</span>
                        ${isMelhor ? '<span class="badge badge-warning text-dark font-weight-bold"><i class="fas fa-star mr-1"></i>Melhor Tempo</span>' : ''}
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
            errosEx.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            errosEx.forEach((sub) => {
                const tr = document.createElement('tr');
                const dataFormat = new Date(sub.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                tr.innerHTML = `
                    <td>
                        <span class="badge badge-danger mr-1">${sub.status}</span>
                    </td>
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

            $('#modalHistoricoAluno tr').removeClass('table-active');
            $(this).closest('tr').addClass('table-active');

            labelArquivo.innerHTML = `<i class="fas fa-code mr-1"></i> Inspecionando: <strong>${exTitle}</strong>`;
            if (editorInspecaoCM) {
                editorInspecaoCM.setValue("// Carregando código do MinIO...");
            } else {
                document.getElementById('modalInspecionarEditor').value = "// Carregando código do MinIO...";
            }
            divResultado.innerHTML = '';
            submissaoAtivaParaCompilar = { exerciseId: exId };

            try {
                const res = await fetch(`/judge/professor/submissao-codigo` + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ codePath })
                });
                const d = await res.json();
                if (res.ok && d.success && d.code) {
                    if (editorInspecaoCM) {
                        editorInspecaoCM.setValue(d.code);
                        editorInspecaoCM.refresh();
                    } else {
                        document.getElementById('modalInspecionarEditor').value = d.code;
                    }
                    btnCompilar.disabled = false;
                    if (btnCopiarCodigoAluno) btnCopiarCodigoAluno.disabled = false;
                } else {
                    const msgErro = d.error ? `// ${d.error}` : "// Sem código gravado.";
                    if (editorInspecaoCM) {
                        editorInspecaoCM.setValue(msgErro);
                    } else {
                        document.getElementById('modalInspecionarEditor').value = msgErro;
                    }
                    btnCompilar.disabled = true;
                    if (btnCopiarCodigoAluno) btnCopiarCodigoAluno.disabled = true;
                }
            } catch (err) {
                if (editorInspecaoCM) {
                    editorInspecaoCM.setValue("// Erro de conexão ao buscar arquivo no MinIO.");
                } else {
                    document.getElementById('modalInspecionarEditor').value = "// Erro de conexão ao buscar arquivo no MinIO.";
                }
                btnCompilar.disabled = true;
                if (btnCopiarCodigoAluno) btnCopiarCodigoAluno.disabled = true;
            }
        });

        const btnAutoInspect = $('#modalHistoricoAluno .tab-pane.active .btn-carregar-codigo').first();
        if (btnAutoInspect.length > 0) {
            btnAutoInspect.click();
        }
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
        if (inputTempo) inputTempo.value = '5000';
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

            const confirmou = await confirmarAcao({
                titulo: 'Remover Submissão da Lista',
                mensagem: 'Deseja realmente desvincular esta lista desta atividade? Os alunos não terão mais acesso à atividade atual.',
                textoConfirmar: 'Remover Submissão',
                corConfirmar: 'btn-danger',
                icone: 'fa-unlink text-danger'
            });

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
                    mostrarToast("Submissão da lista removida com sucesso!", "success");
                    if (tabGerenciarLink) {
                        tabGerenciarLink.classList.add('disabled');
                        tabGerenciarLink.setAttribute('title', 'Vincule uma lista primeiro para liberar esta aba');
                    }
                    if (window.$&& tabListasLink) {$(tabListasLink).tab('show');
                    }
                    await carregarEstadoInicial(false);
                } else {
                    mostrarToast(data.error || "Erro ao remover submissão da lista.", "danger");
                }
            } catch (err) {
                mostrarToast("Erro de conexão ao desvincular atividade.", "danger");
            } finally {
                btnDesvincularAtividade.disabled = false;
                btnDesvincularAtividade.innerHTML = '<i class="fas fa-unlink mr-1"></i> Remover Submissão';
            }
        };
    }

    if (window.$) {$('a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
            if (e.target.id === 'tab-gerenciar-link' && idListaAtivaVinculada) {
                carregarMetricasTurma();
            }
        });
    }

    carregarEstadoInicial(true);
});