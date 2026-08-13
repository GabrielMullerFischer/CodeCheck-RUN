document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ltiToken = urlParams.get('ltik');
    const btnSubmit = document.getElementById('btnSubmit');

    if (btnSubmit) {
        btnSubmit.onclick = async () => {
            const resultDiv = document.getElementById('result');
            const codeInput = document.getElementById('editor');
            const code = codeInput ? codeInput.value : '';
            
            const activityIdMeta = document.querySelector('meta[name="activity-id"]');
            const activityId = activityIdMeta ? activityIdMeta.content.trim() : '';

            if (activityId !== "" && !activityId.includes("{{")) {
                resultDiv.innerHTML = '<div class="alert alert-info"><i class="fas fa-spinner fa-spin mr-2"></i> Aguardando correção...</div>';

                try {
                    const url = '/judge/submit' + (ltiToken ? `?ltik=${ltiToken}` : '');
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code, activityId })
                    });

                    const data = await res.json();

                    if (res.ok) {
                        if (data.status === 'Accepted') {
                            resultDiv.innerHTML = `<div class="alert alert-success"><strong>Correto!</strong></div>`;
                        } else if (data.status === 'Compilation Error') {
                            resultDiv.innerHTML = `
                                <div class="alert alert-warning">
                                    <strong>Erro de compilação:</strong><br>
                                    <pre class="bg-dark text-white p-2 mt-2">${data.details || ''}</pre>
                                </div>`;
                        } else if (data.status === 'Wrong Answer') {
                            resultDiv.innerHTML = `
                                <div class="alert alert-danger">
                                    <strong>${data.message || 'Resposta Incorreta'}</strong><br><br>
                                    <div class="small">
                                        <strong>Entrada do teste:</strong> [${data.input || ''}]<br>
                                        <strong>Sua saída:</strong> [${data.got || ''}]<br>
                                        <strong>Saída esperada:</strong> [${data.expected || ''}]
                                    </div>
                                </div>`;
                        } else if (data.status === 'Time Limit') {
                            resultDiv.innerHTML = `
                                <div class="alert alert-danger">
                                    <strong>${data.message || 'Tempo limite excedido'}</strong>
                                </div>`;
                        } else {
                            resultDiv.innerHTML = `<div class="alert alert-danger">Erro desconhecido.</div>`;
                        }
                    } else {
                        resultDiv.innerHTML = `<div class="alert alert-danger">${data.error || 'Erro ao processar submissão.'}</div>`;
                    }
                } catch (err) {
                    resultDiv.innerHTML = `<div class="alert alert-danger">Erro de conexão com o servidor.</div>`;
                }
            } else {
                resultDiv.innerHTML = `<div class="alert alert-danger">Erro crítico: O ID da atividade não foi carregado corretamente.</div>`;
            }
        };
    }
});