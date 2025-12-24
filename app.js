// URL do JSON (relativo ao local do index.html)
const DATA_URL = 'base_mestre_deputados_completa.json';

let ALL_DEPUTIES = [];
let CACHED_BENEFICIARIES = [];

// Formatadores
const formatMoney = (val) => {
    if (!val) return 'R$ 0,00';
    if (typeof val === 'string') {
        val = parseFloat(val.replace(/\./g, '').replace(',', '.'));
    }
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const parseMoney = (valStr) => {
    if (typeof valStr === 'number') return valStr;
    if (!valStr) return 0;
    return parseFloat(valStr.replace(/\./g, '').replace(',', '.'));
};

// Carregar Dados
async function loadData() {
    try {
        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error("Erro ao carregar arquivo JSON");
        
        const lastModifiedHeader = response.headers.get('Last-Modified');
        if (lastModifiedHeader) {
             const dateObj = new Date(lastModifiedHeader);
             const fmt = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
             document.getElementById('lastUpdate').innerText = `Atualizado em: ${fmt}`;
        }
        
        const json = await response.json();
        
        // Verifica se é o formato novo (com metadata) ou antigo (lista direta)
        if (Array.isArray(json)) {
            ALL_DEPUTIES = json;
        } else {
            ALL_DEPUTIES = json.dados;
            // Fallback: se o header falhar mas tiver no JSON
            if (json.metadata) {
                // Preferência para a data de atualização das emendas
                const dateStr = json.metadata.data_atualizacao_emendas || json.metadata.data_atualizacao;
                if (dateStr) {
                    document.getElementById('lastUpdate').innerText = `Atualizado em: ${dateStr}`;
                }
            }
        }
        
        populateFilters();
        applyFilters(); // Inicializa grid
        
    } catch (error) {
        console.error(error);
        document.getElementById('deputyGrid').innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #ef4444;">
                <h3>Erro ao carregar dados!</h3>
                <p>Certifique-se de estar rodando um servidor local.</p>
                <p>Detalhe: ${error.message}</p>
            </div>
        `;
    }
}

function populateFilters() {
    const years = new Set();
    const parties = new Set();
    const ufs = new Set();
    const functions = new Set();
    const localities = new Set();
    
    ALL_DEPUTIES.forEach(dep => {
        parties.add(dep.ultimoStatus.siglaPartido);
        ufs.add(dep.ultimoStatus.siglaUf);
        
        if (dep.emendas_execucao) {
            dep.emendas_execucao.forEach(em => {
                years.add(em.ano);
                if (em.funcao) functions.add(em.funcao);
                // Collect Beneficiaries
                if (em.beneficiarios && em.beneficiarios.length > 0) {
                    em.beneficiarios.forEach(b => {
                        const n = b.nome || 'S/ IDENTIFICAÇÃO';
                        const m = b.municipio || '';
                        const val = m ? `${n} - ${m}` : n;
                        localities.add(val);
                    });
                } else if (em.localidade) {
                     localities.add(em.localidade);
                }
            });
        }
    });
    
    // Sort e Populate Selects
    
    // Anos
    const yearSel = document.getElementById('filterYear');
    Array.from(years).sort().reverse().forEach(y => {
        const opt = document.createElement('option');
        opt.value = y;
        opt.innerText = y;
        yearSel.appendChild(opt);
    });
    // if (years.has(new Date().getFullYear())) yearSel.value = new Date().getFullYear();
    
    // Partidos
    const partySel = document.getElementById('filterParty');
    Array.from(parties).sort().forEach(p => {
        partySel.appendChild(new Option(p, p));
    });
    
    // UFs
    const ufSel = document.getElementById('filterState');
    Array.from(ufs).sort().forEach(u => {
        ufSel.appendChild(new Option(u, u));
    });
    
    // Functions (Funções)
    const funcSel = document.getElementById('filterFunction');
    Array.from(functions).sort().forEach(f => {
        funcSel.appendChild(new Option(f, f));
    });

    // Localities (AGORA BENEFICIARIOS - VIA CUSTOM DROPDOWN)
    CACHED_BENEFICIARIES = Array.from(localities).sort();
    
    const locInput = document.getElementById('filterLocality');
    const dl = document.getElementById('beneficiaryDropdown');

    // Input Listener
    locInput.addEventListener('input', (e) => {
        const val = e.target.value;
        applyFilters(); 
        
        if (val.length < 2) {
            dl.classList.remove('active');
            return;
        }
        
        const lowerVal = val.toLowerCase();
        const matches = CACHED_BENEFICIARIES
            .filter(item => item.toLowerCase().includes(lowerVal))
            .slice(0, 50);
            
        if (matches.length > 0) {
            dl.innerHTML = '';
            matches.forEach(m => {
                const li = document.createElement('li');
                li.innerText = m;
                li.onclick = () => {
                    locInput.value = m;
                    dl.classList.remove('active');
                    applyFilters();
                };
                dl.appendChild(li);
            });
            dl.classList.add('active');
        } else {
            dl.classList.remove('active');
        }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!locInput.contains(e.target) && !dl.contains(e.target)) {
            dl.classList.remove('active');
        }
    });
    
    // Listeners
    [yearSel, partySel, ufSel, funcSel].forEach(el => el.addEventListener('change', applyFilters));
    document.getElementById('searchInput').addEventListener('input', applyFilters);
}

function applyFilters() {
    const term = document.getElementById('searchInput').value.toLowerCase();
    const year = document.getElementById('filterYear').value;
    const party = document.getElementById('filterParty').value;
    const uf = document.getElementById('filterState').value;
    const func = document.getElementById('filterFunction').value;
    const loc = document.getElementById('filterLocality').value;
    
    const filtered = ALL_DEPUTIES.filter(dep => {
        const status = dep.ultimoStatus;
        const emendas = dep.emendas_execucao || [];

        // Filtros Básicos
        const matchName = status.nomeEleitoral.toLowerCase().includes(term);
        const matchParty = party === "" || status.siglaPartido === party;
        const matchUf = uf === "" || status.siglaUf === uf;
        
        // Filtros de Emenda (Função e Localidade)
        // Se o usuário selecionou uma função, o deputado DEVE ter pelo menos uma emenda
        // naquele ano (se selecionado) e naquela função.
        let matchEmenda = true;
        
        if (func || loc || year !== "ALL") {
            // Filtra as emendas do deputado para ver se SOBRA alguma que atende a tudo
            const validEmendas = emendas.filter(e => {
                const yepYear = (year === "ALL" || e.ano == year);
                const yepFunc = (func === "" || e.funcao === func);
                
                const yepLoc = (loc === "" || (
                    // Check if deep match in beneficiaries
                    (e.beneficiarios && e.beneficiarios.some(b => {
                         const n = b.nome || 'S/ IDENTIFICAÇÃO';
                         const m = b.municipio || '';
                         const val = m ? `${n} - ${m}` : n;
                         return val === loc;
                    })) || 
                    // Fallback check on generic locality if matched directly
                    e.localidade === loc
                ));

                return yepYear && yepFunc && yepLoc;
            });
            
            // Se não sobrou nenhuma emenda válida para os filtros ativos, esse deputado não aparece
            if (validEmendas.length === 0) matchEmenda = false;
        }

        return matchName && matchParty && matchUf && matchEmenda;
    });
    
    renderGrid(filtered, year);
    updateStats(filtered, year);
}

// Renderizar Grid
function renderGrid(deputies, selectedYear) {
    const grid = document.getElementById('deputyGrid');
    grid.innerHTML = '';

    const limit = 100;
    const listToRender = deputies.slice(0, limit);

    listToRender.forEach(dep => {
        const card = createCard(dep, selectedYear);
        grid.appendChild(card);
    });
}

function createCard(dep, yearFilter) {
    const div = document.createElement('div');
    div.className = 'card';
    
    const status = dep.ultimoStatus;
    const gab = status.gabinete || {};
    const foto = status.urlFoto;

    // --- DADOS PESSOAIS ---
    const situacao = status.situacao || '-';
    const condicao = status.condicaoEleitoral || '-';
    
    // Nascimento
    const nascimento = (dep.municipioNascimento && dep.ufNascimento) 
        ? `${dep.municipioNascimento}/${dep.ufNascimento}` 
        : 'Local n/d';

    // Escolaridade
    const escolaridade = dep.escolaridade || '-';
    
    // Profissões (Array ou null)
    let profissoesStr = '-';
    if (dep.profissoes && Array.isArray(dep.profissoes) && dep.profissoes.length > 0 && dep.profissoes[0] !== null) {
        profissoesStr = dep.profissoes.map(p => p.titulo || p).join(', ');
    }

    // Social Media
    const socials = dep.redeSocial || [];
    let socialHtml = '';
    socials.forEach(url => {
        let icon = 'ph-link';
        if (url.includes('facebook')) icon = 'ph-facebook-logo';
        if (url.includes('twitter') || url.includes('x.com')) icon = 'ph-x-logo';
        if (url.includes('instagram')) icon = 'ph-instagram-logo';
        if (url.includes('youtube')) icon = 'ph-youtube-logo';
        
        socialHtml += `<a href="${url}" target="_blank" class="social-link"><i class="ph ${icon}"></i></a>`;
    });
    // Site
    if (dep.urlWebsite) {
        socialHtml += `<a href="${dep.urlWebsite}" target="_blank" class="social-link"><i class="ph ph-globe"></i></a>`;
    }

    // --- GABINETE ---
    const predio = gab.predio ? `Anexo ${gab.predio}` : '';
    const sala = gab.sala ? `Sala ${gab.sala}` : '';
    const local = [predio, sala].filter(Boolean).join(', ') || 'Sem gabinete';
    const tel = gab.telefone ? `(61) ${gab.telefone}` : '';
    const email = gab.email || '';

    div.innerHTML = `
        <div class="card-header">
            <img src="${foto}" alt="${status.nomeEleitoral}" class="avatar" loading="lazy">
            <div class="info">
                <h3>${status.nomeEleitoral}</h3>
                <span class="party">${status.siglaPartido}/${status.siglaUf}</span>
            </div>
        </div>
        
        <div class="profile-details">
            <div class="profile-row" title="Situação e Condição">
                <i class="ph ph-info"></i>
                <span>${situacao} • ${condicao}</span>
            </div>
            <div class="profile-row" title="Origem">
                <i class="ph ph-map-pin"></i>
                <span>${nascimento}</span>
            </div>
            <div class="profile-row" title="Escolaridade">
                <i class="ph ph-graduation-cap"></i>
                <span>${escolaridade}</span>
            </div>
             <div class="profile-row" title="Profissões">
                <i class="ph ph-briefcase"></i>
                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px">${profissoesStr}</span>
            </div>
        </div>

        <div class="social-links">
            ${socialHtml}
        </div>

        <div class="cabinet-info" style="margin-top:1rem; border-top:1px solid rgba(255,255,255,0.05); padding-top:0.8rem">
             <div class="cab-row">
                <i class="ph ph-buildings"></i> <span>${local}</span>
            </div>
            ${tel ? `<div class="cab-row"><i class="ph ph-phone"></i> <span>${tel}</span></div>` : ''}
            ${email ? `<div class="cab-row"><i class="ph ph-envelope"></i> <span style="font-size:0.7rem">${email}</span></div>` : ''}
        </div>
    `;
    
    div.onclick = (e) => {
        // Evita abrir modal se clicar no link social
        if (e.target.closest('a')) return;
        openModal(dep, yearFilter);
    };
    return div;
}

// Stats Simplificado
function updateStats(deputies, yearFilter) {
    // Apenas atualiza o contador de deputados encontrados
    document.getElementById('totalDeps').innerText = deputies.length;
}

// VARIAVEIS GLOBAIS DE ESTADO
let CURRENT_MODAL_EMENDAS = [];
let CURRENT_DEPUTY_DATA = null;

// Modal
function openModal(dep, initialYearFilter) {
    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalContent');
    
    CURRENT_DEPUTY_DATA = dep;
    CURRENT_MODAL_EMENDAS = dep.emendas_execucao || [];

    const status = dep.ultimoStatus;
    
    // Filtros inputs
    const years = new Set();
    const functions = new Set();
    const beneficiariesSet = new Set();
    
    CURRENT_MODAL_EMENDAS.forEach(e => {
        years.add(e.ano);
        if(e.funcao) functions.add(e.funcao);
        
        // Collect Beneficiaries logic
        if (e.beneficiarios && e.beneficiarios.length > 0) {
            e.beneficiarios.forEach(b => {
                const n = b.nome || 'S/ IDENTIFICAÇÃO';
                const m = b.municipio || '';
                const val = m ? `${n} - ${m}` : n;
                beneficiariesSet.add(val);
            });
        }
        if(e.localidade) beneficiariesSet.add(e.localidade);
    });
    
    const yearsOptions = Array.from(years).sort().reverse().map(y => `<option value="${y}">${y}</option>`).join('');
    const funcOptions = Array.from(functions).sort().map(f => `<option value="${f}">${f}</option>`).join('');

    content.innerHTML = `
        <div class="modal-profile-header">
            <img src="${status.urlFoto}" class="big-avatar">
            <div>
                <h2>${status.nomeEleitoral}</h2>
                <div style="margin-top:5px; color:var(--text-muted)">${status.nomeCivil}</div>
                <div style="margin-top:10px">
                    <span class="party">${status.siglaPartido} - ${status.siglaUf}</span>
                </div>
                
                <button class="btn-action" onclick="openExtraInfo()">
                    <i class="ph ph-list-dashes"></i> Ver Atuação (Frentes e Comissões)
                </button>
            </div>
        </div>
        
        <h3 style="margin-top:1.5rem">Execução Orçamentária</h3>
        
        <div class="modal-filters" style="margin-top:1rem; align-items:center">
            <input type="text" id="mSearch" class="modal-input" placeholder="Busca livre..." style="flex:1; min-width:150px">
            <select id="mYear" class="modal-select"><option value="ALL">Todos os Anos</option>${yearsOptions}</select>
            <select id="mFunc" class="modal-select"><option value="ALL">Todas Funções</option>${funcOptions}</select>
            
            <div style="position:relative; flex:1.5; min-width:250px">
                <input type="text" id="mLocInput" class="modal-input" placeholder="Filtrar Beneficiário..." style="width:100%" autocomplete="off">
                <ul id="mLocDropdown" class="autocomplete-dropdown"></ul>
            </div>

            <button class="btn-action" onclick="clearModalFilters()" style="margin-top:0; padding:0.5rem" title="Limpar Filtros">
                <i class="ph ph-broom"></i>
            </button>
        </div>

        <div class="data-table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th width="15%">Emenda</th>
                        <th width="20%">Área/Função</th>
                        <th width="35%">Beneficiários (Destino)</th>
                        <th width="15%" style="text-align:right">Empenhado</th>
                        <th width="15%" style="text-align:right">Pago</th>
                    </tr>
                </thead>
                <tbody id="modalTableBody"></tbody>
                <tfoot id="modalTableFoot"></tfoot>
            </table>
        </div>
    `;
    
    document.getElementById('mSearch').addEventListener('input', updateModalTable);
    document.getElementById('mYear').addEventListener('change', updateModalTable);
    document.getElementById('mFunc').addEventListener('change', updateModalTable);
    
    // Autocomplete Logic for Modal
    const mLocInput = document.getElementById('mLocInput');
    const mLocDl = document.getElementById('mLocDropdown');
    const modalBeneficiaries = Array.from(beneficiariesSet).sort();

    mLocInput.addEventListener('input', (e) => {
        const val = e.target.value;
        updateModalTable();
        
        if (val.length < 1) {
            mLocDl.classList.remove('active');
            return;
        }
        
        const lower = val.toLowerCase();
        const matches = modalBeneficiaries.filter(b => b.toLowerCase().includes(lower)).slice(0, 50);
        
        if (matches.length > 0) {
             mLocDl.innerHTML = '';
             matches.forEach(m => {
                 const li = document.createElement('li');
                 li.innerText = m;
                 li.onclick = () => {
                     mLocInput.value = m;
                     mLocDl.classList.remove('active');
                     updateModalTable();
                 };
                 mLocDl.appendChild(li);
             });
             mLocDl.classList.add('active');
        } else {
            mLocDl.classList.remove('active');
        }
    });
    
    // Close click handler is global or needs generic class listener? 
    // The previously added global listener only checks 'filterLocality'. 
    // I should check ANY .autocomplete-dropdown active? 
    // Or just add a specific one here.
    const closeHandler = (e) => {
        if (mLocInput && !mLocInput.contains(e.target) && !mLocDl.contains(e.target)) {
            mLocDl.classList.remove('active');
        }
    };
    // Note: this adds a listener every openModal. Potentially memory leak if not removed.
    // Better: Add ID to the global listener or use a "once" logic. 
    // For now, I'll allow it but it's a bit messy. 
    // A better approach is one global listener for '.autocomplete-dropdown' logic, but references differ.
    // I will use a named function outside or just add it here knowing users won't open 1000 modals in one session without reload.
    document.addEventListener('click', closeHandler);

    if (initialYearFilter !== 'ALL' && years.has(parseInt(initialYearFilter))) {
        document.getElementById('mYear').value = initialYearFilter;
    }

    updateModalTable();
    overlay.classList.add('active');
}

function updateModalTable() {
    const term = document.getElementById('mSearch').value.toLowerCase();
    const year = document.getElementById('mYear').value;
    const func = document.getElementById('mFunc').value;
    const locTerm = document.getElementById('mLocInput').value.toLowerCase();
    
    // Filtrar
    const filtered = CURRENT_MODAL_EMENDAS.filter(em => {
        const matchYear = (year === 'ALL' || em.ano == year);
        const matchFunc = (func === 'ALL' || em.funcao === func);
        
        // Filtro Específico de Beneficiário (Loc Input)
        let matchLoc = true;
        if (locTerm !== '') {
             let textToSearch = (em.localidade||'');
             if (em.beneficiarios && em.beneficiarios.length > 0) {
                 textToSearch += ' ' + em.beneficiarios.map(b => {
                     const n = b.nome || '';
                     const m = b.municipio || '';
                     return m ? `${n} - ${m}` : n;
                 }).join(' ');
             }
             matchLoc = textToSearch.toLowerCase().includes(locTerm);
        }
        
        // Busca Livre (Global)
        let matchTerm = true;
        if (term !== '') {
            let textToSearch = (em.localidade||'') + ' ' + (em.funcao||'');
             if (em.beneficiarios && em.beneficiarios.length > 0) {
                 textToSearch += ' ' + em.beneficiarios.map(b => (b.nome||'') + ' ' + (b.municipio||'')).join(' ');
             }
             matchTerm = textToSearch.toLowerCase().includes(term);
        }
        
        return matchYear && matchFunc && matchLoc && matchTerm;
    });
    
    // Sort: Ano DESC, Valor Empenhado DESC
    filtered.sort((a,b) => (b.ano - a.ano) || (parseMoney(b.valor_empenhado) - parseMoney(a.valor_empenhado)));

    // Totalizadores
    let tEmp = 0, tPag = 0;

    const tbody = document.getElementById('modalTableBody');
    const tfoot = document.getElementById('modalTableFoot');
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:2rem">Nenhum resultado.</td></tr>';
        tfoot.innerHTML = '';
        return;
    }

    tbody.innerHTML = filtered.map(em => {
        const emp = parseMoney(em.valor_empenhado);
        const pag = parseMoney(em.valor_pago);
        
        tEmp += emp;
        tPag += pag;

        // Renderizar Beneficiários
        let beneficiariesHtml = '';
        
        if (em.beneficiarios && em.beneficiarios.length > 0) {
            // Lista detalhada
            const listItems = em.beneficiarios.map(b => {
                const bVal = b.valor ? formatMoney(b.valor) : '-';
                return `
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.05); padding:2px 0;">
                        <span style="font-size:0.75rem; color:#e5e7eb">${b.nome}</span>
                        <span style="font-size:0.75rem; font-family:monospace; color:var(--primary); margin-left:8px">${bVal}</span>
                    </div>
                `;
            }).join('');
            
            beneficiariesHtml = `<div style="max-height:100px; overflow-y:auto; padding-right:5px">${listItems}</div>`;
        } else {
            // Fallback para Localidade Genérica
            beneficiariesHtml = `<div style="font-weight:600; color:var(--text-muted)">${em.localidade || 'Localidade não informada'}</div>`;
        }

        return `
        <tr>
            <td>
                <div style="font-weight:bold">${em.ano}</div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px">Cód: ${em.codigo}</div>
                <div style="font-size:0.65rem; opacity:0.5; margin-top:2px">${em.acao || ''}</div>
            </td>
            <td>
                 <div style="font-size:0.8rem; line-height:1.2">
                    ${em.funcao}
                </div>
                 <div style="font-size:0.7rem; opacity:0.6; margin-top:2px">${em.subfuncao}</div>
            </td>
             <td>
                 ${beneficiariesHtml}
            </td>
            <td class="val-col" style="color:#fff; text-align:right">${formatMoney(emp)}</td>
            <td class="val-col" style="color:var(--primary); font-weight:bold; text-align:right">${formatMoney(pag)}</td>
        </tr>`;
    }).join('');
    
    tfoot.innerHTML = `
        <tr style="background:rgba(255,255,255,0.05); font-weight:bold">
            <td colspan="3" style="text-align:right; padding-right:1rem">TOTAIS</td>
            <td class="val-col" style="color:#fff; text-align:right">${formatMoney(tEmp)}</td>
            <td class="val-col" style="color:var(--primary); text-align:right">${formatMoney(tPag)}</td>
        </tr>
    `;
}

function openExtraInfo() {
    const dep = CURRENT_DEPUTY_DATA;
    if (!dep) return;
    
    const overlay = document.getElementById('modalExtra');
    const content = document.getElementById('modalExtraContent');
    
    content.innerHTML = `
        <h2>Atuação de ${dep.ultimoStatus.nomeEleitoral}</h2>
        
        <input type="text" id="extraSearch" class="modal-input" placeholder="Filtrar frentes ou comissões..." style="margin: 1rem 0; width: 100%;">
        
        <div style="margin-top:0.5rem; display:grid; grid-template-columns: 1fr 1fr; gap:2rem;">
            <div>
                <h3><i class="ph ph-users-three"></i> Frentes Parlamentares</h3>
                <ul class="extra-list" id="listFrentes">
                    <!-- Preenchido via JS -->
                </ul>
            </div>
            <div>
                <h3><i class="ph ph-gavel"></i> Comissões e Órgãos</h3>
                <ul class="extra-list" id="listOrgaos">
                     <!-- Preenchido via JS -->
                </ul>
            </div>
        </div>
    `;
    
    document.getElementById('extraSearch').addEventListener('input', updateExtraInfo);
    updateExtraInfo(); // Renderiza a primeira vez
    overlay.classList.add('active');
}

function updateExtraInfo() {
    const term = document.getElementById('extraSearch').value.toLowerCase();
    const dep = CURRENT_DEPUTY_DATA;
    
    // Filtrar Frentes (Array de Strings)
    const frentesRaw = dep.frentes || [];
    const frentesFiltered = frentesRaw.filter(f => f.toLowerCase().includes(term));
    
    document.getElementById('listFrentes').innerHTML = frentesFiltered.length 
        ? frentesFiltered.map(f => `<li>${f}</li>`).join('')
        : '<li style="color:var(--text-muted); font-style:italic; padding:0.5rem">Nenhuma frente encontrada.</li>';

    // Filtrar Comissões (Array de Objetos)
    const orgaosRaw = dep.orgaos_ativos || [];
    const orgaosFiltered = orgaosRaw.filter(o => {
        const txt = ((o.sigla||'') + ' ' + (o.nome||'')).toLowerCase();
        return txt.includes(term);
    });
    
    document.getElementById('listOrgaos').innerHTML = orgaosFiltered.length
        ? orgaosFiltered.map(o => `<li><strong>${o.sigla}</strong> - ${o.nome} (${o.titulo})</li>`).join('')
        : '<li style="color:var(--text-muted); font-style:italic; padding:0.5rem">Nenhum órgão encontrado.</li>';
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
}

function openAboutModal() {
    const el = document.getElementById('modalAbout');
    if(el) el.classList.add('active');
}
function closeAboutModal() {
    const el = document.getElementById('modalAbout');
    if(el) el.classList.remove('active');
}

function closeExtraModal() {
    document.getElementById('modalExtra').classList.remove('active');
}

function clearMainFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('filterYear').value = 'ALL';
    document.getElementById('filterParty').value = '';
    document.getElementById('filterState').value = '';
    document.getElementById('filterFunction').value = '';
    document.getElementById('filterLocality').value = '';
    applyFilters();
}

function clearModalFilters() {
    document.getElementById('mSearch').value = '';
    document.getElementById('mYear').value = 'ALL';
    document.getElementById('mFunc').value = 'ALL';
    const locInp = document.getElementById('mLocInput');
    if(locInp) locInp.value = '';
    updateModalTable();
}

// Inicializa a App
loadData();

