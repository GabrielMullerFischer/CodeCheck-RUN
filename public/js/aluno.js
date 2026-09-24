document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ltiToken = urlParams.get('ltik') || document.querySelector('meta[name="ltik"]')?.content || '';
    const activityIdMeta = document.querySelector('meta[name="activity-id"]');
    const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';
    const listId = urlParams.get('listId') || '';
    const exerciseIdParam = urlParams.get('exerciseId') || '';
    const tituloEl = document.getElementById('nome-questao');
    const descEl = document.getElementById('descricao-questao');
    const containerExemplos = document.getElementById('container-exemplos-questao');
    const valTempoLimite = document.getElementById('val-tempo-limite');
    const infoTempoLimite = document.getElementById('info-tempo-limite');
    const navContainer = document.getElementById('container-nav-questoes');
    const btnAnterior = document.getElementById('btn-exercicio-anterior');
    const btnProximo = document.getElementById('btn-exercicio-proximo');
    const btnSubmit = document.getElementById('btnSubmit');
    const wrapperBtnSubmit = document.getElementById('wrapperBtnSubmit');
    const resultDiv = document.getElementById('result');
    const textareaEl = document.getElementById('editor');
    const selectTemaEditor = document.getElementById('select-tema-editor');
    const rankPos = document.getElementById('rank-minha-pos');
    const rankTempo = document.getElementById('rank-meu-tempo');
    const rankLiderNome = document.getElementById('rank-lider-nome');
    const rankLiderTempo = document.getElementById('rank-lider-tempo');
    const tbodyModalRanking = document.getElementById('tbody-modal-ranking');
    const selectAlunoExRanking = document.getElementById('select-aluno-ex-ranking');
    const tbodyAlunoRankingEx = document.getElementById('tbody-aluno-ranking-exercicio');
    const containerTop3 = document.getElementById('container-top3-placar');
    const badgeMinhaPos = document.getElementById('placar-minha-badge-geral');
    const boxMinhaPosDestaque = document.getElementById('box-minha-posicao-destaque');
    const labelMinhaPosGeral = document.getElementById('label-minha-pos-geral');
    const btnRestaurarCodigo = document.getElementById('btnRestaurarCodigo');
    const badgeTentativas = document.getElementById('badge-tentativas');
    const contadorTentativas = document.getElementById('contador-tentativas');
    const customInputStdin = document.getElementById('customInputStdin');
    const btnExecutarTesteCustom = document.getElementById('btnExecutarTesteCustom');
    const resultTesteCustom = document.getElementById('resultTesteCustom');
    const navHistoricoSubmissoes = document.getElementById('nav-historico-submissoes');
    const btnSubAnterior = document.getElementById('btnSubAnterior');
    const btnSubProximo = document.getElementById('btnSubProximo');
    const labelHistoricoSub = document.getElementById('labelHistoricoSub');
    const MODELO_PADRAO = '#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}';

    const rascunhosSessao = {};
    let listaExercicios = [];
    let indiceAtual = -1;
    let mapaStatusQuestoes = {};
    let mapaRankingsPorExercicio = {};

    let listaSubmissoesMeta = [];
    let indiceSubmissaoAtiva = -1;
    let linhaErroAtiva = null;
    let bloquearEventoChange = false;

    const cKeywords = [
        'int', 'float', 'double', 'char', 'void', 'return', 'printf', 'scanf',
        'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
        'struct', 'typedef', 'sizeof', 'main', 'include', 'NULL', 'const'
    ];

    if (window.CodeMirror) {
        CodeMirror.registerHelper("hint", "cCustomHint", function(cm) {
            const cur = cm.getCursor();
            const token = cm.getTokenAt(cur);
            const start = token.start;
            const end = cur.ch;
            const line = cur.line;
            const currentWord = token.string.trim();

            const list = [];
            if (currentWord.length >= 2) {
                cKeywords.forEach(k => {
                    if (k.startsWith(currentWord) && !list.includes(k)) list.push(k);
                });
                if (CodeMirror.hint.anyword) {
                    const anyword = CodeMirror.hint.anyword(cm);
                    if (anyword && anyword.list) {
                        anyword.list.forEach(w => {
                            if (!list.includes(w)) list.push(w);
                        });
                    }
                }
            }
            return {
                list: list,
                from: CodeMirror.Pos(line, start),
                to: CodeMirror.Pos(line, end)
            };
        });
    }

    const temaSalvo = localStorage.getItem('codecheck_editor_theme') || 'dracula';
    if (selectTemaEditor) selectTemaEditor.value = temaSalvo;

    const editorCM = CodeMirror.fromTextArea(textareaEl, {
        mode: 'text/x-csrc',
        theme: temaSalvo,
        lineNumbers: true,
        autoCloseBrackets: true,
        matchBrackets: true,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false,
        extraKeys: {
            "Ctrl-Space": "autocomplete"
        }
    });

    if (selectTemaEditor) {
        selectTemaEditor.addEventListener('change', () => {
            const novoTema = selectTemaEditor.value;
            editorCM.setOption('theme', novoTema);
            localStorage.setItem('codecheck_editor_theme', novoTema);
        });
    }

    editorCM.on("inputRead", (cm, change) => {
        if (change.text && change.text.length > 0 && /^[a-zA-Z_]$/.test(change.text[0])) {
            cm.showHint({
                hint: CodeMirror.hint.cCustomHint,
                completeSingle: false
            });
        }
    });

    editorCM.on('change', () => {
        removerDestaqueErro();
        if (!bloquearEventoChange && indiceSubmissaoAtiva !== -1) {
            indiceSubmissaoAtiva = -1;
            atualizarBotoesHistorico();
        }
    });

    function setCodigoNoEditor(codigo) {
        bloquearEventoChange = true;
        editorCM.setValue(codigo || '');
        bloquearEventoChange = false;
    }

    function posicionarCursorAposAspas() {
        setTimeout(() => {
            const totalLinhas = editorCM.lineCount();
            for (let i = 0; i < totalLinhas; i++) {
                const linhaTexto = editorCM.getLine(i);
                const pos = linhaTexto.indexOf('"');
                if (pos !== -1) {
                    editorCM.setCursor({ line: i, ch: pos + 1 });
                    editorCM.focus();
                    return;
                }
            }
            editorCM.setCursor({ line: 3, ch: 4 });
            editorCM.focus();
        }, 50);
    }

    function destacarLinhaNoEditor(numeroLinha) {
        removerDestaqueErro();
        if (!numeroLinha || numeroLinha < 1) return;
        linhaErroAtiva = numeroLinha - 1;
        editorCM.addLineClass(linhaErroAtiva, 'background', 'linha-erro-cm');
        editorCM.scrollIntoView({ line: linhaErroAtiva, ch: 0 }, 120);
    }

    function removerDestaqueErro() {
        if (linhaErroAtiva !== null) {
            editorCM.removeLineClass(linhaErroAtiva, 'background', 'linha-erro-cm');
            linhaErroAtiva = null;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function montarNavegacaoMoodle() {
        if (!navContainer) return;
        navContainer.innerHTML = '';

        listaExercicios.forEach((ex, index) => {
            const box = document.createElement('a');
            box.href = '#';
            
            const status = mapaStatusQuestoes[String(ex._id)];
            let statusClass = '';
            if (status === 'accepted') statusClass = 'status-accepted';
            else if (status === 'wrong') statusClass = 'status-wrong';

            box.className = `moodle-nav-box ${index === indiceAtual ? 'active' : ''} ${statusClass}`;
            box.innerHTML = `
                <span>${index + 1}</span>
                <div class="status-strip"></div>
            `;

            box.onclick = (e) => {
                e.preventDefault();
                selecionarQuestao(index);
            };

            navContainer.appendChild(box);
        });
    }

    function renderizarRankingAlunoPorExercicio() {
        if (!selectAlunoExRanking || !tbodyAlunoRankingEx) return;
        const exId = selectAlunoExRanking.value;
        const dadosEx = mapaRankingsPorExercicio[exId];

        tbodyAlunoRankingEx.innerHTML = '';

        if (!dadosEx || !dadosEx.ranking || dadosEx.ranking.length === 0) {
            tbodyAlunoRankingEx.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">Nenhum aluno acertou este exercício ainda.</td></tr>';
            return;
        }

        dadosEx.ranking.forEach((aluno, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-weight-bold">${idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : idx + 1))}</td>
                <td>${aluno.userName}</td>
                <td class="text-right font-weight-bold text-secondary">${aluno.executionTime} ms</td>
            `;
            tbodyAlunoRankingEx.appendChild(tr);
        });
    }

    function atualizarEstadoBotaoCompilar() {
        if (!btnSubmit) return;

        if (indiceSubmissaoAtiva !== -1) {
            btnSubmit.disabled = true;
            btnSubmit.style.pointerEvents = 'none';
            btnSubmit.classList.remove('btn-primary');
            btnSubmit.classList.add('btn-secondary');
            btnSubmit.style.opacity = '0.65';
            btnSubmit.innerHTML = '<i class="fas fa-play mr-2"></i> Compilar';

            if (wrapperBtnSubmit) {
                wrapperBtnSubmit.style.cursor = 'not-allowed';
                wrapperBtnSubmit.title = 'É necessário voltar para a compilação atual para poder compilar.';
            }
            return;
        }

        if (btnSubmit.dataset.esgotado === "true") {
            btnSubmit.disabled = true;
            btnSubmit.style.pointerEvents = 'none';
            btnSubmit.classList.remove('btn-primary');
            btnSubmit.classList.add('btn-secondary');
            btnSubmit.style.opacity = '0.65';
            btnSubmit.innerHTML = '<i class="fas fa-lock mr-2"></i> Limite Atingido';

            if (wrapperBtnSubmit) {
                wrapperBtnSubmit.style.cursor = 'not-allowed';
                wrapperBtnSubmit.title = 'Limite de tentativas atingido para este exercício.';
            }
            return;
        }

        btnSubmit.disabled = false;
        btnSubmit.style.pointerEvents = 'auto';
        btnSubmit.classList.remove('btn-secondary');
        btnSubmit.classList.add('btn-primary');
        btnSubmit.style.cursor = 'pointer';
        btnSubmit.style.opacity = '1';
        btnSubmit.removeAttribute('title');
        btnSubmit.innerHTML = '<i class="fas fa-play mr-2"></i> Compilar';

        if (wrapperBtnSubmit) {
            wrapperBtnSubmit.style.cursor = 'default';
            wrapperBtnSubmit.removeAttribute('title');
        }
    }

        function atualizarBotoesHistorico() {
        if (!navHistoricoSubmissoes) return;
        const total = listaSubmissoesMeta.length;

        if (total === 0) {
            navHistoricoSubmissoes.style.display = 'none';
            editorCM.setOption('readOnly', false);
            if (btnRestaurarCodigo) {
                btnRestaurarCodigo.innerHTML = '<i class="fas fa-undo-alt mr-1"></i> Restaurar main()';
                btnRestaurarCodigo.className = 'btn btn-sm btn-outline-secondary py-1 px-3 font-weight-bold shadow-sm';
                btnRestaurarCodigo.title = 'Voltar ao código padrão inicial';
            }
            atualizarEstadoBotaoCompilar();
            return;
        }

        navHistoricoSubmissoes.style.display = 'inline-flex';

        if (indiceSubmissaoAtiva === -1) {
            editorCM.setOption('readOnly', false);

            labelHistoricoSub.innerHTML = '<span class="text-dark"><i class="fas fa-pencil-alt mr-1 text-primary"></i> Rascunho Atual</span>';
            btnSubProximo.disabled = true;
            btnSubProximo.className = 'btn btn-outline-secondary px-2 font-weight-bold disabled';
            btnSubAnterior.disabled = false;
            btnSubAnterior.className = 'btn btn-outline-primary px-2 font-weight-bold';

            if (btnRestaurarCodigo) {
                btnRestaurarCodigo.innerHTML = '<i class="fas fa-undo-alt mr-1"></i> Restaurar main()';
                btnRestaurarCodigo.className = 'btn btn-sm btn-outline-secondary py-1 px-3 font-weight-bold shadow-sm';
                btnRestaurarCodigo.title = 'Voltar ao código padrão inicial';
            }
        } else {
            editorCM.setOption('readOnly', true);

            const sub = listaSubmissoesMeta[indiceSubmissaoAtiva];
            const badgeCor = sub.isAccepted ? 'text-success' : 'text-danger';
            const iconStatus = sub.isAccepted ? 'fa-check-circle' : 'fa-times-circle';

            labelHistoricoSub.innerHTML = `<span class="${badgeCor}"><i class="fas ${iconStatus} mr-1"></i> Envio ${indiceSubmissaoAtiva + 1}/${total}</span>`;
            
            btnSubAnterior.disabled = (indiceSubmissaoAtiva === 0);
            btnSubAnterior.className = `btn ${indiceSubmissaoAtiva === 0 ? 'btn-outline-secondary disabled' : 'btn-outline-primary'} px-2 font-weight-bold`;
            
            btnSubProximo.disabled = false;
            btnSubProximo.className = 'btn btn-outline-primary px-2 font-weight-bold';

            if (btnRestaurarCodigo) {
                btnRestaurarCodigo.innerHTML = '<i class="fas fa-file-import mr-1"></i> Usar este código no Rascunho';
                btnRestaurarCodigo.className = 'btn btn-sm btn-outline-primary py-1 px-3 font-weight-bold shadow-sm';
                btnRestaurarCodigo.title = 'Substituir seu rascunho atual por este código para continuar programando';
            }
        }

        atualizarEstadoBotaoCompilar();
    }

    function extrairLinhaErroGCC(log) {
        if (!log) return null;
        const match = log.match(/:(\d+):(?:\d+:)?\s*(?:fatal\s+)?error:/i);
        return match ? parseInt(match[1], 10) : null;
    }

    async function carregarLista() {
        try {
            let query = '';
            if (exerciseIdParam) {
                query = `exerciseId=${exerciseIdParam}`;
            } else if (listId) {
                query = `listId=${listId}`;
            } else {
                query = `activityId=${activityId}`;
            }

            const res = await fetch(`/judge/atividade/exercicios?${query}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();

            if (res.ok && data.success && data.lista && data.lista.exercises.length > 0) {
                listaExercicios = data.lista.exercises;
                await atualizarRankingEStatus();
                montarNavegacaoMoodle();
                await selecionarQuestao(0);
            }
        } catch (err) {
            console.error("Erro ao carregar lista de exercícios:", err);
        }
    }

    async function atualizarRankingEStatus() {
        const exercicioAtual = listaExercicios[indiceAtual];
        const exId = exercicioAtual ? exercicioAtual._id : (exerciseIdParam || '');

        try {
            const res = await fetch(`/judge/ranking?activityId=${activityId || 'preview'}&exerciseId=${exId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();

            if (!data.success) return;

            mapaStatusQuestoes = data.statusMeusExercicios || {};
            mapaRankingsPorExercicio = data.rankingPorExercicio || {};

            const bodyDepuracao = document.getElementById('body-depuracao-livre');
            const boxBloqueada = document.getElementById('box-depuracao-bloqueada');
            const badgeDepuracao = document.getElementById('badge-status-depuracao');

            if (data.isEvaluative && !exerciseIdParam) {
                if (bodyDepuracao) bodyDepuracao.style.display = 'none';
                if (boxBloqueada) boxBloqueada.style.display = 'block';
                if (badgeDepuracao) badgeDepuracao.style.display = 'inline-block';

                if (badgeTentativas && contadorTentativas) {
                    badgeTentativas.style.display = 'inline-block';
                    const tentativasFeitas = data.minhasTentativasEx || 0;
                    const limiteMax = data.maxAttempts || 3;
                    
                    const tentativasExibidas = Math.min(tentativasFeitas, limiteMax);
                    contadorTentativas.innerText = `${tentativasExibidas} / ${limiteMax}`;

                    if (tentativasFeitas >= limiteMax) {
                        badgeTentativas.className = "badge badge-danger p-2 mr-3 font-weight-bold";
                        badgeTentativas.innerHTML = `<i class="fas fa-ban mr-1"></i> Tentativas: ${limiteMax} / ${limiteMax}`;
                        if (btnSubmit) {
                            btnSubmit.dataset.esgotado = "true";
                        }
                    } else {
                        badgeTentativas.className = "badge badge-light border text-muted p-2 mr-3 font-weight-bold";
                        badgeTentativas.innerHTML = `<i class="fas fa-history mr-1"></i> Tentativas: <span id="contador-tentativas">${tentativasExibidas} / ${limiteMax}</span>`;
                        if (btnSubmit) {
                            btnSubmit.dataset.esgotado = "false";
                        }
                    }
                }
            } else {
                if (bodyDepuracao) bodyDepuracao.style.display = 'block';
                if (boxBloqueada) boxBloqueada.style.display = 'none';
                if (badgeDepuracao) badgeDepuracao.style.display = 'none';

                if (badgeTentativas) badgeTentativas.style.display = 'none';
                if (btnSubmit) {
                    btnSubmit.dataset.esgotado = "false";
                }
            }

            atualizarEstadoBotaoCompilar();

            if (data.exercicio.minhaPosicao) {
                rankPos.className = "badge badge-success p-2 font-weight-bold";
                rankPos.innerText = `#${data.exercicio.minhaPosicao} de ${data.exercicio.totalResolvidos}`;
                rankTempo.innerText = `Seu melhor tempo: ${data.exercicio.meuTempo} ms`;
            } else {
                rankPos.className = "badge badge-secondary p-2 font-weight-bold";
                rankPos.innerText = "Pendente";
                rankTempo.innerText = "Você ainda não acertou esta questão.";
            }

            if (data.exercicio.primeiroLugar) {
                rankLiderNome.innerText = data.exercicio.primeiroLugar.userName;
                rankLiderTempo.innerText = `Tempo: ${data.exercicio.primeiroLugar.executionTime} ms`;
            } else {
                rankLiderNome.innerText = "Nenhum aluno ainda";
                rankLiderTempo.innerText = "-";
            }

            if (containerTop3 && data.geral && data.geral.rankingCompleto) {
                const rankingCompleto = data.geral.rankingCompleto;
                const totalAlunos = data.geral.totalAlunos || rankingCompleto.length;
                const minhaPos = data.geral.minhaPosicaoGeral;

                if (badgeMinhaPos) {
                    if (minhaPos) {
                        badgeMinhaPos.className = "badge badge-primary p-1 font-weight-bold";
                        badgeMinhaPos.innerText = `Posição: #${minhaPos} de ${totalAlunos}`;
                    } else {
                        badgeMinhaPos.className = "badge badge-light border text-muted p-1 font-weight-bold";
                        badgeMinhaPos.innerText = "Posição: -";
                    }
                }

                containerTop3.innerHTML = '';

                if (rankingCompleto.length === 0) {
                    containerTop3.innerHTML = '<div class="text-center text-muted small py-2">Nenhum acerto registrado.</div>';
                } else {
                    const medalhas = ['🥇', '🥈', '🥉'];
                    const top3 = rankingCompleto.slice(0, 3);

                    top3.forEach((aluno, idx) => {
                        const isEu = (minhaPos === idx + 1);
                        const item = document.createElement('div');
                        item.className = `d-flex justify-content-between align-items-center py-1 border-bottom small ${isEu ? 'bg-light font-weight-bold rounded px-1' : ''}`;
                        item.innerHTML = `
                            <div class="text-truncate mr-2" style="max-width: 140px;">
                                <span class="mr-1">${medalhas[idx]}</span>
                                <span class="${isEu ? 'text-primary' : 'text-dark'}">${aluno.userName} ${isEu ? '(Você)' : ''}</span>
                            </div>
                            <div class="text-right text-nowrap">
                                <span class="badge badge-info mr-1">${aluno.totalResolvidos} ex</span>
                                <span class="text-muted font-weight-normal">${aluno.tempoTotalMs > 0 ? aluno.tempoTotalMs + 'ms' : '-'}</span>
                            </div>
                        `;
                        containerTop3.appendChild(item);
                    });
                }

                if (boxMinhaPosDestaque && labelMinhaPosGeral) {
                    if (minhaPos && minhaPos > 3) {
                        boxMinhaPosDestaque.style.display = 'block';
                        labelMinhaPosGeral.innerText = `#${minhaPos} de ${totalAlunos}`;
                    } else {
                        boxMinhaPosDestaque.style.display = 'none';
                    }
                }
            }

            if (tbodyModalRanking && data.geral && data.geral.rankingCompleto) {
                tbodyModalRanking.innerHTML = '';
                if (data.geral.rankingCompleto.length === 0) {
                    tbodyModalRanking.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Nenhum envio registrado.</td></tr>';
                } else {
                    data.geral.rankingCompleto.forEach((aluno, idx) => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td class="font-weight-bold">${idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : idx + 1))}</td>
                            <td>${aluno.userName}</td>
                            <td class="text-center"><span class="badge badge-info">${aluno.totalResolvidos}</span></td>
                            <td class="text-right text-muted">${aluno.tempoTotalMs > 0 ? aluno.tempoTotalMs + ' ms' : '-'}</td>
                        `;
                        tbodyModalRanking.appendChild(tr);
                    });
                }
            }

            if (selectAlunoExRanking) {
                selectAlunoExRanking.innerHTML = '';
                listaExercicios.forEach((ex, idx) => {
                    const opt = document.createElement('option');
                    opt.value = ex._id;
                    opt.innerText = `Exercício ${idx + 1}: ${ex.title}`;
                    if (String(ex._id) === String(exId)) opt.selected = true;
                    selectAlunoExRanking.appendChild(opt);
                });

                selectAlunoExRanking.onchange = renderizarRankingAlunoPorExercicio;
                renderizarRankingAlunoPorExercicio();
            }

            montarNavegacaoMoodle();
        } catch (e) {
            console.error("Erro ao atualizar ranking:", e);
        }
    }

    async function carregarRascunho(exerciseId) {
        if (rascunhosSessao[exerciseId] !== undefined) {
            setCodigoNoEditor(rascunhosSessao[exerciseId]);
            return;
        }

        try {
            const res = await fetch(`/judge/get-draft?activityId=${activityId || 'preview'}&exerciseId=${exerciseId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();
            const codigoCarregado = data.code || MODELO_PADRAO;
            setCodigoNoEditor(codigoCarregado);
            rascunhosSessao[exerciseId] = codigoCarregado;
        } catch {
            setCodigoNoEditor(MODELO_PADRAO);
            rascunhosSessao[exerciseId] = MODELO_PADRAO;
        }
    }

    async function carregarHistoricoSubmissoesExercicio(exerciseId) {
        if (!navHistoricoSubmissoes) return;
        indiceSubmissaoAtiva = -1;

        try {
            const res = await fetch(`/judge/aluno/submissoes?activityId=${activityId || 'preview'}&exerciseId=${exerciseId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();

            if (res.ok && data.success && data.submissoes && data.submissoes.length > 0) {
                listaSubmissoesMeta = data.submissoes;
                navHistoricoSubmissoes.style.display = 'inline-flex';
                atualizarBotoesHistorico();
            } else {
                listaSubmissoesMeta = [];
                navHistoricoSubmissoes.style.display = 'none';
                atualizarBotoesHistorico();
            }
        } catch {
            listaSubmissoesMeta = [];
            navHistoricoSubmissoes.style.display = 'none';
            atualizarBotoesHistorico();
        }
    }

    async function buscarCarregarCodigoSubmissao(subId) {
        setCodigoNoEditor("// Carregando submissão anterior...");
        try {
            const res = await fetch(`/judge/aluno/submissao-codigo?submissionId=${subId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();
            if (res.ok && data.success) {
                setCodigoNoEditor(data.code || '');
            } else {
                setCodigoNoEditor('// Erro ao carregar código desta submissão.');
            }
        } catch {
            setCodigoNoEditor('// Erro de conexão ao carregar código.');
        }
    }

    if (btnSubAnterior) {
        btnSubAnterior.onclick = async () => {
            const exAtual = listaExercicios[indiceAtual];
            if (!exAtual || listaSubmissoesMeta.length === 0) return;

            if (indiceSubmissaoAtiva === -1) {
                rascunhosSessao[exAtual._id] = editorCM.getValue();
                indiceSubmissaoAtiva = listaSubmissoesMeta.length - 1;
            } else if (indiceSubmissaoAtiva > 0) {
                indiceSubmissaoAtiva--;
            }

            atualizarBotoesHistorico();
            await buscarCarregarCodigoSubmissao(listaSubmissoesMeta[indiceSubmissaoAtiva]._id);
        };
    }

    if (btnSubProximo) {
        btnSubProximo.onclick = async () => {
            const exAtual = listaExercicios[indiceAtual];
            if (!exAtual) return;

            if (indiceSubmissaoAtiva < listaSubmissoesMeta.length - 1 && indiceSubmissaoAtiva !== -1) {
                indiceSubmissaoAtiva++;
                atualizarBotoesHistorico();
                await buscarCarregarCodigoSubmissao(listaSubmissoesMeta[indiceSubmissaoAtiva]._id);
            } else {
                indiceSubmissaoAtiva = -1;
                atualizarBotoesHistorico();
                setCodigoNoEditor(rascunhosSessao[exAtual._id] || '');
                posicionarCursorAposAspas();
            }
        };
    }

    async function selecionarQuestao(index) {
        if (index < 0 || index >= listaExercicios.length) return;

        if (indiceAtual !== -1 && listaExercicios[indiceAtual] && indiceSubmissaoAtiva === -1) {
            const exAnteriorId = listaExercicios[indiceAtual]._id;
            rascunhosSessao[exAnteriorId] = editorCM.getValue();
        }

        indiceAtual = index;
        const ex = listaExercicios[indiceAtual];

        if (tituloEl) tituloEl.innerText = ex.title;
        if (descEl) descEl.innerText = ex.description;

        if (valTempoLimite && infoTempoLimite) {
            if (ex.timeLimit) {
                valTempoLimite.innerText = `${ex.timeLimit} ms`;
                infoTempoLimite.style.display = 'inline-block';
            } else {
                infoTempoLimite.style.display = 'none';
            }
        }

        if (containerExemplos) {
            containerExemplos.innerHTML = '';
            const primeiroTeste = (ex.tests && ex.tests.length > 0) ? ex.tests[0] : null;

            if (!primeiroTeste) {
                containerExemplos.innerHTML = '<span class="text-muted small">Nenhum exemplo disponível.</span>';
            } else {
                containerExemplos.innerHTML = `
                    <div class="mb-3">
                        <label class="small font-weight-bold text-muted text-uppercase mb-1 d-block">
                            Entrada:
                        </label>
                        <pre class="p-2 border rounded text-dark pre-io">${escapeHtml(primeiroTeste.input || '(sem entrada)')}</pre>
                    </div>
                    <div>
                        <label class="small font-weight-bold text-muted text-uppercase mb-1 d-block">
                            Saída Esperada:
                        </label>
                        <pre class="p-2 border rounded text-dark pre-io">${escapeHtml(primeiroTeste.output || '')}</pre>
                    </div>
                `;
            }
        }

        if (resultDiv) resultDiv.innerHTML = '';
        if (resultTesteCustom) resultTesteCustom.innerHTML = '';

        removerDestaqueErro();

        await carregarRascunho(ex._id);
        await carregarHistoricoSubmissoesExercicio(ex._id);
        await atualizarRankingEStatus();

        if (btnAnterior) btnAnterior.disabled = (indiceAtual === 0);
        if (btnProximo) btnProximo.disabled = (indiceAtual === listaExercicios.length - 1);

        editorCM.refresh();
        posicionarCursorAposAspas();
    }

    if (btnAnterior) btnAnterior.onclick = () => selecionarQuestao(indiceAtual - 1);
    if (btnProximo) btnProximo.onclick = () => selecionarQuestao(indiceAtual + 1);

    if (btnExecutarTesteCustom) {
        btnExecutarTesteCustom.onclick = async () => {
            const code = editorCM.getValue();
            const input = customInputStdin ? customInputStdin.value : '';
            const exercicioAtual = listaExercicios[indiceAtual];

            if (!code) {
                alert("Digite algum código para testar.");
                return;
            }

            resultTesteCustom.innerHTML = '<div class="alert alert-info py-1 small mb-2"><i class="fas fa-spinner fa-spin mr-1"></i> Executando...</div>';
            btnExecutarTesteCustom.disabled = true;

            try {
                const res = await fetch('/judge/test-custom' + (ltiToken ? `?ltik=${ltiToken}` : ''), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        code,
                        input,
                        exerciseId: exercicioAtual ? exercicioAtual._id : '',
                        activityId: activityId || 'preview'
                    })
                });

                const data = await res.json();

                if (res.ok && data.success) {
                    let cardDica = '';
                    if (data.didacticHint) {
                        cardDica = `
                            <div class="alert alert-warning py-1 small mb-1">
                                <i class="fas fa-lightbulb mr-1"></i> ${data.didacticHint}
                            </div>
                        `;
                    }

                    if (data.status === 'Success') {
                        resultTesteCustom.innerHTML = `
                            <div class="alert alert-light border p-2 mb-2 small shadow-sm">
                                ${cardDica}
                                <div class="d-flex justify-content-between align-items-center mb-1">
                                    <span class="badge badge-success font-weight-bold">Saída Gerada:</span>
                                    <small class="text-muted">${data.executionTime} ms</small>
                                </div>
                                <pre class="bg-dark text-white p-2 rounded mb-0 pre-io">${escapeHtml(data.output) || '<em>(Sem saída gerada)</em>'}</pre>
                            </div>
                        `;
                    } else if (data.status === 'Compilation Error') {
                        const numLinha = extrairLinhaErroGCC(data.details);
                        if (numLinha) destacarLinhaNoEditor(numLinha);

                        resultTesteCustom.innerHTML = `
                            <div class="alert alert-warning p-2 mb-2 small">
                                ${cardDica}
                                <strong>Erro de Compilação:</strong><br>
                                <pre class="bg-dark text-white p-1 mt-1 rounded mb-0 pre-io">${escapeHtml(data.details)}</pre>
                            </div>
                        `;
                    } else {
                        resultTesteCustom.innerHTML = `
                            <div class="alert alert-danger p-2 mb-2 small">
                                ${cardDica}
                                <strong>${data.status}:</strong> ${escapeHtml(data.details) || 'Falha na execução.'}
                            </div>
                        `;
                    }
                } else {
                    resultTesteCustom.innerHTML = `<div class="alert alert-danger py-1 small mb-2">${data.error || 'Erro no teste.'}</div>`;
                }
            } catch {
                resultTesteCustom.innerHTML = `<div class="alert alert-danger py-1 small mb-2">Erro de conexão ao executar teste.</div>`;
            } finally {
                btnExecutarTesteCustom.disabled = false;
            }
        };
    }

    if (btnSubmit) {
        btnSubmit.onclick = async () => {
            if (indiceSubmissaoAtiva !== -1) {
                alert("É necessário voltar para a compilação atual para poder compilar.");
                return;
            }

            if (btnSubmit.dataset.esgotado === "true") return;

            const code = editorCM.getValue();
            const exercicioAtual = listaExercicios[indiceAtual];

            if (!exercicioAtual) return;

            rascunhosSessao[exercicioAtual._id] = code;

            resultDiv.innerHTML = '<div class="alert alert-info py-2"><i class="fas fa-spinner fa-spin mr-2"></i> Validando...</div>';
            btnSubmit.disabled = true;

            try {
                const url = '/judge/submit' + (ltiToken ? `?ltik=${ltiToken}` : '');
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        code, 
                        activityId: activityId || 'preview', 
                        listId, 
                        exerciseId: exercicioAtual._id 
                    })
                });

                const data = await res.json();

                if (res.ok) {
                    let cardDica = '';
                    if (data.didacticHint) {
                        cardDica = `
                            <div class="alert alert-warning py-2 mb-2">
                                <i class="fas fa-lightbulb text-warning mr-1"></i> <strong>Dica do Compilador:</strong> ${data.didacticHint}
                            </div>
                        `;
                    }

                    if (data.status === 'Accepted') {
                        resultDiv.innerHTML = `<div class="alert alert-success py-2"><i class="fas fa-check-circle mr-2"></i><strong>Correto!</strong> Tempo de execução: ${data.executionTime} ms</div>`;
                    } else if (data.status === 'Compilation Error') {
                        const numLinha = extrairLinhaErroGCC(data.details);
                        let badgeLinha = '';

                        if (numLinha) {
                            badgeLinha = `<div class="mb-2"><span class="badge badge-danger p-2 font-weight-bold" style="font-size: 0.88rem;"><i class="fas fa-exclamation-circle mr-1"></i> Erro encontrado na linha ${numLinha}</span></div>`;
                            destacarLinhaNoEditor(numLinha);
                        }

                        resultDiv.innerHTML = `
                            <div class="alert alert-warning py-2">
                                ${cardDica}
                                ${badgeLinha}
                                <strong>Erro de compilação:</strong><br>
                                <pre class="bg-dark text-white p-2 mt-2 rounded small pre-io">${escapeHtml(data.details)}</pre>
                            </div>`;
                    } else if (data.status === 'Wrong Answer') {
                        resultDiv.innerHTML = `
                            <div class="alert alert-danger py-2">
                                ${cardDica}
                                <strong>Resposta Incorreta</strong><br>
                                <div class="small mt-2">
                                    <div class="mb-1"><strong>Entrada:</strong></div>
                                    <pre class="p-2 border rounded text-dark pre-io">${escapeHtml(data.input) || '(sem entrada)'}</pre>
                                    <div class="mb-1 mt-2"><strong>Sua saída:</strong></div>
                                    <pre class="p-2 border rounded text-danger pre-io">${escapeHtml(data.got) || '(vazio)'}</pre>
                                    <div class="mb-1 mt-2"><strong>Saída Esperada:</strong></div>
                                    <pre class="p-2 border rounded text-success pre-io">${escapeHtml(data.expected)}</pre>
                                </div>
                            </div>`;
                    } else if (data.status === 'Time Limit') {
                        resultDiv.innerHTML = `
                            <div class="alert alert-danger py-2">
                                ${cardDica}
                                <strong>Tempo limite excedido.</strong> Verifique loops infinitos.
                            </div>`;
                    } else {
                        resultDiv.innerHTML = `
                            <div class="alert alert-danger py-2">
                                ${cardDica}
                                <strong>${data.status}:</strong> ${escapeHtml(data.details || data.message || 'Erro durante a execução.')}
                            </div>`;
                    }

                    await carregarHistoricoSubmissoesExercicio(exercicioAtual._id);
                    await atualizarRankingEStatus();
                } else {
                    resultDiv.innerHTML = `<div class="alert alert-danger py-2">${data.error || 'Erro ao processar submissão.'}</div>`;
                    await atualizarRankingEStatus();
                }
            } catch (err) {
                resultDiv.innerHTML = `<div class="alert alert-danger py-2">Erro de conexão com o servidor.</div>`;
            } finally {
                atualizarEstadoBotaoCompilar();
            }
        };
    }

    if (btnRestaurarCodigo) {
        btnRestaurarCodigo.onclick = () => {
            const exercicioAtual = listaExercicios[indiceAtual];
            if (!exercicioAtual) return;

            if (indiceSubmissaoAtiva !== -1) {
                const subAtual = listaSubmissoesMeta[indiceSubmissaoAtiva];
                const confirmar = confirm(`Deseja substituir seu Rascunho Atual pelo código do Envio ${indiceSubmissaoAtiva + 1}?`);
                if (!confirmar) return;

                rascunhosSessao[exercicioAtual._id] = editorCM.getValue();
                indiceSubmissaoAtiva = -1;
                atualizarBotoesHistorico();
                removerDestaqueErro();
                posicionarCursorAposAspas();
                return;
            }

            const confirmar = confirm("Deseja realmente restaurar para a estrutura inicial main()?");
            if (!confirmar) return;

            setCodigoNoEditor(MODELO_PADRAO);
            rascunhosSessao[exercicioAtual._id] = MODELO_PADRAO;
            indiceSubmissaoAtiva = -1;
            atualizarBotoesHistorico();

            removerDestaqueErro();
            posicionarCursorAposAspas();
        };
    }

    carregarLista();
});