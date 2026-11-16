(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.FuncaoC = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const TIPOS_C_BASE = [
        'unsigned long long int', 'unsigned long long', 'long long int', 'long long',
        'unsigned long int', 'unsigned long', 'long int', 'long',
        'unsigned short int', 'unsigned short', 'short int', 'short',
        'unsigned int', 'unsigned char', 'unsigned',
        'double', 'float', 'char', 'int', 'void'
    ];

    function limparComentarios(codigo) {
        return String(codigo || '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
    }

    function normalizarTipoBase(raw) {
        let t = String(raw || '').replace(/\s+/g, ' ').trim();
        for (const base of TIPOS_C_BASE) {
            if (t === base || t === `const ${base}`) {
                return t.replace(/^const\s+/, '').trim();
            }
        }
        return t.replace(/^const\s+/, '').trim();
    }

    function parsearParametro(paramStr) {
        const raw = String(paramStr || '').trim();
        if (!raw) return null;

        const isConst = /\bconst\b/.test(raw);
        let semConst = raw.replace(/\bconst\b/g, '').replace(/\s+/g, ' ').trim();

        // 1. Matriz de tamanho fixo: tipo nome[][COLUNAS] ou tipo nome[LINHAS][COLUNAS]
        const matchMatrizFixa = semConst.match(/^([a-zA-Z_][\w\s\*]*?)\s*\b([a-zA-Z_]\w*)\s*\[\s*(\d*)\s*\]\s*\[\s*(\d+)\s*\]$/);
        if (matchMatrizFixa) {
            const baseType = normalizarTipoBase(matchMatrizFixa[1]);
            const name = matchMatrizFixa[2].trim();
            const maxRows = matchMatrizFixa[3] ? parseInt(matchMatrizFixa[3], 10) : 0;
            const cols = parseInt(matchMatrizFixa[4], 10);
            return {
                name,
                type: baseType,
                kind: 'matrix',
                matrixKind: 'fixed',
                cols,
                maxRows,
                isConst
            };
        }

        // 2. Matriz como ponteiro de ponteiro: tipo **nome ou tipo* *nome
        if (/\*\s*\*/.test(semConst)) {
            const matchMatrizPtr = semConst.match(/^([a-zA-Z_][\w\s]*?)\s*\*\s*\*\s*([a-zA-Z_]\w*)$/);
            if (matchMatrizPtr) {
                const baseType = normalizarTipoBase(matchMatrizPtr[1]);
                const name = matchMatrizPtr[2].trim();
                return {
                    name,
                    type: baseType,
                    kind: 'matrix',
                    matrixKind: 'pointer',
                    isConst
                };
            }
            return { invalid: true, raw };
        }

        // 3. Vetor com colchetes: tipo nome[] ou tipo nome[TAMANHO]
        const matchVetor = semConst.match(/^([a-zA-Z_][\w\s\*]*?)\s*\b([a-zA-Z_]\w*)\s*\[\s*(\d*)\s*\]$/);
        if (matchVetor) {
            const baseType = normalizarTipoBase(matchVetor[1]);
            const name = matchVetor[2].trim();
            const fixedLen = matchVetor[3] ? parseInt(matchVetor[3], 10) : 0;
            const kind = baseType === 'char' ? 'string' : 'vector';
            return {
                name,
                type: baseType,
                kind,
                fixedLen,
                isConst
            };
        }

        // 4. Ponteiro simples: tipo *nome ou tipo* nome
        if (/\*/.test(semConst)) {
            const matchPtr = semConst.match(/^([a-zA-Z_][\w\s]*?)\s*\*\s*([a-zA-Z_]\w*)$/);
            if (matchPtr) {
                const baseType = normalizarTipoBase(matchPtr[1]);
                const name = matchPtr[2].trim();
                const kind = baseType === 'char' ? 'string' : 'vector';
                return {
                    name,
                    type: baseType,
                    kind,
                    isConst
                };
            }
            return { invalid: true, raw };
        }

        // 5. Escalar simples: tipo nome
        const matchEscalar = semConst.match(/^([a-zA-Z_][\w\s]*?)\s*\b([a-zA-Z_]\w*)$/);
        if (matchEscalar) {
            const baseType = normalizarTipoBase(matchEscalar[1]);
            const name = matchEscalar[2].trim();
            return {
                name,
                type: baseType,
                kind: 'scalar',
                isConst
            };
        }

        return { invalid: true, raw };
    }

    function formatarParametroLimpo(p) {
        const c = p.isConst ? 'const ' : '';
        if (p.kind === 'string') {
            return p.fixedLen ? `${c}char ${p.name}[${p.fixedLen}]` : `${c}char ${p.name}[]`;
        }
        if (p.kind === 'vector') {
            return p.fixedLen ? `${c}${p.type} ${p.name}[${p.fixedLen}]` : `${c}${p.type} ${p.name}[]`;
        }
        if (p.kind === 'matrix') {
            if (p.matrixKind === 'fixed') {
                return p.maxRows ? `${c}${p.type} ${p.name}[${p.maxRows}][${p.cols}]` : `${c}${p.type} ${p.name}[][${p.cols}]`;
            }
            return `${c}${p.type} **${p.name}`;
        }
        return `${c}${p.type} ${p.name}`;
    }

    function testarLinhaAssinatura(linhaBruta) {
        const isLocked = /^\s*(?:\*\*\*|###)/.test(linhaBruta);
        const semPrefixo = String(linhaBruta || '').replace(/^\s*(?:\*\*\*|###)\s*/, '').trim();
        if (!semPrefixo || semPrefixo.startsWith('#')) return null;

        const candidata = semPrefixo.replace(/\{[\s\S]*$/, '').replace(/;+\s*$/, '').trim();
        const match = candidata.match(/^([a-zA-Z_][\w\s\*]*?)\s*\b([a-zA-Z_]\w*)\s*\(([^)]*)\)$/);
        if (!match) return null;

        const returnType = match[1].replace(/\s+/g, ' ').trim();
        const funcName = match[2].trim();
        if (funcName === 'main') return null;

        if (returnType === 'void') {
            return {
                valido: false,
                isVoid: true,
                error: 'Funções com retorno void devem ser configuradas no Modo Main Personalizada.'
            };
        }

        const paramsRaw = match[3].trim();
        const params = [];

        if (paramsRaw && paramsRaw !== 'void') {
            const parts = paramsRaw.split(',');
            for (const part of parts) {
                const parsed = parsearParametro(part);
                if (!parsed || parsed.invalid) {
                    return {
                        valido: false,
                        invalidParam: part.trim()
                    };
                }
                params.push(parsed);
            }
        }

        const temArrays = params.some(p => p.kind === 'vector' || p.kind === 'matrix' || p.kind === 'string');
        const cleanSignature = `${returnType} ${funcName}(${params.map(formatarParametroLimpo).join(', ')})`;

        return {
            valido: true,
            isLocked,
            returnType,
            funcName,
            params,
            temArrays,
            cleanSignature
        };
    }

    function parsearAssinatura(assinaturaOuTemplate) {
        const texto = String(assinaturaOuTemplate || '').replace(/\r/g, '');
        if (!texto.trim()) return { valido: false };

        const linhas = texto.split('\n');
        const candidatos = [];
        let erroParametro = null;
        let erroVoid = false;
        let emComentarioBloco = false;
        let nivelChaves = 0;

        for (const linhaOriginal of linhas) {
            let linhaLimpa = '';
            for (let i = 0; i < linhaOriginal.length; i++) {
                if (!emComentarioBloco && linhaOriginal[i] === '/' && linhaOriginal[i + 1] === '*') {
                    emComentarioBloco = true;
                    i++;
                } else if (emComentarioBloco && linhaOriginal[i] === '*' && linhaOriginal[i + 1] === '/') {
                    emComentarioBloco = false;
                    i++;
                } else if (!emComentarioBloco && linhaOriginal[i] === '/' && linhaOriginal[i + 1] === '/') {
                    break;
                } else if (!emComentarioBloco) {
                    linhaLimpa += linhaOriginal[i];
                }
            }

            if (nivelChaves === 0 && linhaLimpa.trim()) {
                const res = testarLinhaAssinatura(linhaLimpa);
                if (res) {
                    if (res.invalidParam) {
                        erroParametro = res.invalidParam;
                    } else if (res.isVoid) {
                        erroVoid = true;
                    } else if (res.valido) {
                        candidatos.push(res);
                    }
                }
            }

            for (const ch of linhaLimpa) {
                if (ch === '{') nivelChaves++;
                else if (ch === '}') nivelChaves = Math.max(0, nivelChaves - 1);
            }
        }

        if (candidatos.length > 0) {
            return candidatos.find(c => c.isLocked) || candidatos[0];
        }
        if (erroParametro) {
            return { valido: false, invalidParam: erroParametro };
        }
        if (erroVoid) {
            return { valido: false, isVoid: true };
        }
        return { valido: false };
    }

    function parametrosDeSaida(sig) {
        if (!sig || !Array.isArray(sig.params)) return [];
        return sig.params.filter(p => !p.isConst && (p.kind === 'vector' || p.kind === 'matrix' || p.kind === 'string'));
    }

    function extrairTokensEntrada(texto, numParams) {
        const str = String(texto || '').trim();
        if (!str) return [];

        const linhas = str.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (linhas.length === numParams) {
            return linhas;
        }

        const tokens = [];
        let i = 0;
        const n = str.length;

        while (i < n && tokens.length < numParams) {
            while (i < n && (str[i] === ' ' || str[i] === '\t' || str[i] === '\r' || str[i] === '\n')) {
                i++;
            }
            if (i >= n) break;

            if (str[i] === '{' || str[i] === '[') {
                const openCh = str[i];
                const closeCh = openCh === '{' ? '}' : ']';
                let depth = 0;
                const start = i;
                while (i < n) {
                    if (str[i] === openCh) depth++;
                    else if (str[i] === closeCh) {
                        depth--;
                        if (depth === 0) {
                            i++;
                            break;
                        }
                    }
                    i++;
                }
                tokens.push(str.substring(start, i).trim());
            } else if (str[i] === '"' || str[i] === "'") {
                const q = str[i];
                const start = i;
                i++;
                while (i < n && str[i] !== q) {
                    if (str[i] === '\\') i++;
                    i++;
                }
                if (i < n) i++;
                tokens.push(str.substring(start, i).trim());
            } else {
                const start = i;
                while (i < n && str[i] !== '\n' && str[i] !== '\r') {
                    i++;
                }
                tokens.push(str.substring(start, i).trim());
            }
        }

        return tokens;
    }

    function extrairNumeros(raw) {
        if (!raw) return [];
        const matches = String(raw).match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
        return matches ? matches : [];
    }

    function converterParaStdin(inputStr, sig) {
        if (!sig || !Array.isArray(sig.params) || sig.params.length === 0) {
            return { ok: true, stdin: String(inputStr || '') };
        }

        const tokens = extrairTokensEntrada(inputStr, sig.params.length);
        const linhasStdin = [];

        for (let idx = 0; idx < sig.params.length; idx++) {
            const p = sig.params[idx];
            const token = tokens[idx] !== undefined ? tokens[idx] : '';

            if (p.kind === 'scalar') {
                const val = token.trim();
                linhasStdin.push(val !== '' ? val : '0');
            } else if (p.kind === 'string') {
                let conteudo = token.trim();
                if ((conteudo.startsWith('"') && conteudo.endsWith('"')) || (conteudo.startsWith("'") && conteudo.endsWith("'"))) {
                    conteudo = conteudo.slice(1, -1);
                }
                linhasStdin.push(String(conteudo.length));
                linhasStdin.push(conteudo);
            } else if (p.kind === 'vector') {
                const numeros = extrairNumeros(token);
                linhasStdin.push(String(numeros.length));
                linhasStdin.push(numeros.join(' '));
            } else if (p.kind === 'matrix') {
                const matchesLinhas = token.match(/\{([^{}]+)\}|\[([^\[\]]+)\]/g);
                if (matchesLinhas && matchesLinhas.length > 0) {
                    const linhasMatriz = matchesLinhas.map(l => extrairNumeros(l));
                    const rows = linhasMatriz.length;
                    const cols = linhasMatriz[0] ? linhasMatriz[0].length : (p.cols || 0);

                    if (p.matrixKind === 'fixed' && p.cols && cols !== p.cols) {
                        return {
                            ok: false,
                            erro: `A matriz "${p.name}" deve ter exatamente ${p.cols} colunas (recebeu ${cols})`
                        };
                    }

                    linhasStdin.push(`${rows} ${cols}`);
                    linhasMatriz.forEach(nums => {
                        linhasStdin.push(nums.join(' '));
                    });
                } else {
                    const todosNumeros = extrairNumeros(token);
                    const cols = p.cols || (todosNumeros.length > 0 ? todosNumeros.length : 1);
                    const rows = Math.ceil(todosNumeros.length / cols) || 1;
                    linhasStdin.push(`${rows} ${cols}`);
                    for (let r = 0; r < rows; r++) {
                        const fatia = todosNumeros.slice(r * cols, (r + 1) * cols);
                        linhasStdin.push(fatia.join(' '));
                    }
                }
            }
        }

        return {
            ok: true,
            stdin: linhasStdin.join('\n') + '\n'
        };
    }

    function formatarEntradaExibicao(inputStr, sig) {
        if (!sig || !Array.isArray(sig.params) || sig.params.length === 0) {
            return String(inputStr || '');
        }

        const tokens = extrairTokensEntrada(inputStr, sig.params.length);
        return sig.params.map((p, idx) => {
            const val = tokens[idx] !== undefined ? tokens[idx] : '';
            return `${p.name} = ${val}`;
        }).join('\n');
    }

    return {
        parsearAssinatura,
        parametrosDeSaida,
        converterParaStdin,
        formatarEntradaExibicao
    };
}));

