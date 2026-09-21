document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ltiToken = urlParams.get('ltik') || document.querySelector('meta[name="ltik"]')?.content || '';
    const activityIdMeta = document.querySelector('meta[name="activity-id"]');
    const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';
    const listId = urlParams.get('listId') || '';
    const tituloEl = document.getElementById('nome-questao');
    const descEl = document.getElementById('descricao-questao');
    const exemploEl = document.getElementById('exemplo-questao');
    const valTempoLimite = document.getElementById('val-tempo-limite');
    const navContainer = document.getElementById('container-nav-questoes');
    const btnAnterior = document.getElementById('btn-exercicio-anterior');
    const btnProximo = document.getElementById('btn-exercicio-proximo');
    const btnSubmit = document.getElementById('btnSubmit');
    const resultDiv = document.getElementById('result');
    const codeInput = document.getElementById('editor');
    const rankPos = document.getElementById('rank-minha-pos');
    const rankTempo = document.getElementById('rank-meu-tempo');
    const rankLiderNome = document.getElementById('rank-lider-nome');
    const rankLiderTempo = document.getElementById('rank-lider-tempo');
    const tbodyModalRanking = document.getElementById('tbody-modal-ranking');
    const btnRestaurarCodigo = document.getElementById('btnRestaurarCodigo');
    const badgeTentativas = document.getElementById('badge-tentativas');
    const contadorTentativas = document.getElementById('contador-tentativas');
    const rascunhosSessao = {};
    let listaExercicios = [];
    let indiceAtual = -1;
    let mapaStatusQuestoes = {};

    // Carrega a lista de exercícios
    async function carregarLista() {
        try {
            const query = listId ? `listId=${listId}` : `activityId=${activityId}`;
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

    // Navegação lateral
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

    // Ranking e status das questões
    async function atualizarRankingEStatus() {
        const exercicioAtual = listaExercicios[indiceAtual];
        const exId = exercicioAtual ? exercicioAtual._id : '';

        try {
            const res = await fetch(`/judge/ranking?activityId=${activityId}&exerciseId=${exId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();

            if (!data.success) return;

            mapaStatusQuestoes = data.statusMeusExercicios || {};

            if (data.isEvaluative) {
                if (badgeTentativas && contadorTentativas) {
                    badgeTentativas.style.display = 'inline-block';
                    const tentativasFeitas = data.minhasTentativasEx || 0;
                    const limiteMax = data.maxAttempts || 3;
                    contadorTentativas.innerText = `${tentativasFeitas} / ${limiteMax}`;

                    if (tentativasFeitas >= limiteMax) {
                        badgeTentativas.className = "badge badge-danger p-2 mr-3 font-weight-bold";
                        if (btnSubmit) {
                            btnSubmit.disabled = true;
                            btnSubmit.dataset.esgotado = "true";
                            btnSubmit.title = "Limite de tentativas atingido para este exercício.";
                        }
                    } else {
                        badgeTentativas.className = "badge badge-light border text-muted p-2 mr-3 font-weight-bold";
                        if (btnSubmit) {
                            btnSubmit.dataset.esgotado = "false";
                            btnSubmit.disabled = false;
                            btnSubmit.removeAttribute('title');
                        }
                    }
                }
            } else {
                if (badgeTentativas) badgeTentativas.style.display = 'none';
                if (btnSubmit) {
                    btnSubmit.dataset.esgotado = "false";
                    btnSubmit.disabled = false;
                    btnSubmit.removeAttribute('title');
                }
            }

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

            if (tbodyModalRanking && data.geral.rankingCompleto) {
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

            montarNavegacaoMoodle();
        } catch (e) {
            console.error("Erro ao atualizar ranking:", e);
        }
    }

    // Buscar rascunho do exercício atual
    async function carregarRascunho(exerciseId) {
        if (!codeInput) return;

        if (rascunhosSessao[exerciseId] !== undefined) {
            codeInput.value = rascunhosSessao[exerciseId];
            return;
        }

        try {
            const res = await fetch(`/judge/get-draft?activityId=${activityId}&exerciseId=${exerciseId}` + (ltiToken ? `&ltik=${ltiToken}` : ''));
            const data = await res.json();
            const codigoCarregado = data.code || '#include <stdio.h>\n\nint main() {\n    return 0;\n}';
            codeInput.value = codigoCarregado;
            rascunhosSessao[exerciseId] = codigoCarregado;
        } catch {
            const modeloPadrao = '#include <stdio.h>\n\nint main() {\n    return 0;\n}';
            codeInput.value = modeloPadrao;
            rascunhosSessao[exerciseId] = modeloPadrao;
        }
    }

    // Trocar exercício selecionado
    async function selecionarQuestao(index) {
        if (index < 0 || index >= listaExercicios.length) return;

        if (indiceAtual !== -1 && listaExercicios[indiceAtual] && codeInput) {
            const exAnteriorId = listaExercicios[indiceAtual]._id;
            rascunhosSessao[exAnteriorId] = codeInput.value;
        }

        indiceAtual = index;
        const ex = listaExercicios[indiceAtual];

        if (tituloEl) tituloEl.innerText = ex.title;
        if (descEl) descEl.innerText = ex.description;
        if (valTempoLimite) valTempoLimite.innerText = `${ex.timeLimit || 1000} ms`;
        if (exemploEl) {
            exemploEl.innerText = ex.tests?.length 
                ? `Entrada(s): ${ex.tests[0].input || '(vazio)'} | Saída: ${ex.tests[0].output}` 
                : 'Sem exemplos.';
        }
        if (resultDiv) resultDiv.innerHTML = '';

        const overlay = document.getElementById('overlay-linha-erro');
        if (overlay) overlay.remove();

        await carregarRascunho(ex._id);
        await atualizarRankingEStatus();

        if (btnAnterior) btnAnterior.disabled = (indiceAtual === 0);
        if (btnProximo) btnProximo.disabled = (indiceAtual === listaExercicios.length - 1);
    }

    if (btnAnterior) btnAnterior.onclick = () => selecionarQuestao(indiceAtual - 1);
    if (btnProximo) btnProximo.onclick = () => selecionarQuestao(indiceAtual + 1);

    // Submissão de código
    if (btnSubmit) {
        function extrairLinhaErroGCC(log) {
            if (!log) return null;
            const match = log.match(/:(\d+):(?:\d+:)?\s*(?:fatal\s+)?error:/i);
            return match ? parseInt(match[1], 10) : null;
        }

        function removerDestaqueErro() {
            const overlay = document.getElementById('overlay-linha-erro');
            if (overlay) overlay.remove();
        }

        function destacarLinhaNoTextarea(textarea, numeroLinha) {
            if (!textarea || !numeroLinha || numeroLinha < 1) return;
            removerDestaqueErro();

            const linhas = textarea.value.split('\n');
            if (numeroLinha > linhas.length) return;

            const style = window.getComputedStyle(textarea);
            const paddingTop = parseFloat(style.paddingTop) || 10;
            const fontSize = parseFloat(style.fontSize) || 15;
            let lineHeight = parseFloat(style.lineHeight);
            if (isNaN(lineHeight)) lineHeight = fontSize * 1.5;

            let start = 0;
            for (let i = 0; i < numeroLinha - 1; i++) {
                start += linhas[i].length + 1;
            }
            textarea.focus();
            textarea.setSelectionRange(start, start);
            textarea.scrollTop = Math.max(0, (numeroLinha - 3) * lineHeight);

            textarea.parentElement.style.position = 'relative';

            const overlay = document.createElement('div');
            overlay.id = 'overlay-linha-erro';
            overlay.className = 'overlay-linha-erro';

            const reposicionar = () => {
                const top = textarea.offsetTop + paddingTop + (numeroLinha - 1) * lineHeight - textarea.scrollTop;
                overlay.style.top = `${top}px`;
                overlay.style.left = `${textarea.offsetLeft + 10}px`;
                overlay.style.width = `${textarea.clientWidth - 20}px`;
                overlay.style.height = `${lineHeight}px`;

                const foraDeVisao = top < textarea.offsetTop || top > (textarea.offsetTop + textarea.clientHeight - lineHeight);
                overlay.style.display = foraDeVisao ? 'none' : 'block';
            };

            reposicionar();
            textarea.parentElement.appendChild(overlay);
            textarea.onscroll = reposicionar;
        }

        if (codeInput) {
            codeInput.addEventListener('input', removerDestaqueErro);
            codeInput.addEventListener('mousedown', removerDestaqueErro);
        }
        btnSubmit.onclick = async () => {
            const code = codeInput ? codeInput.value : '';
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
                        activityId, 
                        listId, 
                        exerciseId: exercicioAtual._id 
                    })
                });

                const data = await res.json();

                if (res.ok) {
                    if (data.status === 'Accepted') {
                        resultDiv.innerHTML = `<div class="alert alert-success py-2"><i class="fas fa-check-circle mr-2"></i><strong>Correto!</strong> Tempo de execução: ${data.executionTime} ms</div>`;
                    } else if (data.status === 'Compilation Error') {
                        const numLinha = extrairLinhaErroGCC(data.details);
                        let badgeLinha = '';

                        if (numLinha) {
                            badgeLinha = `<div class="mb-2"><span class="badge badge-danger p-2 font-weight-bold" style="font-size: 0.88rem;"><i class="fas fa-exclamation-circle mr-1"></i> Erro encontrado na linha ${numLinha}</span></div>`;
                            destacarLinhaNoTextarea(codeInput, numLinha);
                        }

                        resultDiv.innerHTML = `
                            <div class="alert alert-warning py-2">
                                ${badgeLinha}
                                <strong>Erro de compilação:</strong><br>
                                <pre class="bg-dark text-white p-2 mt-2 rounded small">${data.details || ''}</pre>
                            </div>`;
                    } else if (data.status === 'Wrong Answer') {
                        resultDiv.innerHTML = `
                            <div class="alert alert-danger py-2">
                                <strong>${data.message || 'Resposta Incorreta'}</strong><br>
                                <div class="small mt-1">
                                    <strong>Entrada:</strong> [${data.input || ''}] | <strong>Sua saída:</strong> [${data.got || ''}] | <strong>Esperada:</strong> [${data.expected || ''}]
                                </div>
                            </div>`;
                    } else if (data.status === 'Time Limit') {
                        resultDiv.innerHTML = `<div class="alert alert-danger py-2"><strong>Tempo limite excedido.</strong> Verifique loops infinitos.</div>`;
                    } else {
                        resultDiv.innerHTML = `<div class="alert alert-danger py-2">Erro: ${data.error || 'Erro desconhecido'}</div>`;
                    }

                    await atualizarRankingEStatus();
                } else {
                    resultDiv.innerHTML = `<div class="alert alert-danger py-2">${data.error || 'Erro ao processar submissão.'}</div>`;
                    await atualizarRankingEStatus();
                }
            } catch (err) {
                resultDiv.innerHTML = `<div class="alert alert-danger py-2">Erro de conexão com o servidor.</div>`;
            } finally {
                btnSubmit.disabled = btnSubmit.dataset.esgotado === "true";
            }
        };
    }

    if (btnRestaurarCodigo) {
        btnRestaurarCodigo.onclick = () => {
            const exercicioAtual = listaExercicios[indiceAtual];
            if (!exercicioAtual || !codeInput) return;

            const confirmar = confirm("Deseja realmente restaurar para main()?");
            if (!confirmar) return;

            const modeloPadrao = '#include <stdio.h>\n\nint main() {\n    return 0;\n}';
            codeInput.value = modeloPadrao;
            rascunhosSessao[exercicioAtual._id] = modeloPadrao;

            const overlay = document.getElementById('overlay-linha-erro');
            if (overlay) overlay.remove();

            codeInput.focus();
        };
    }

    carregarLista();
});