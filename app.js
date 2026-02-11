// URL do JSON (relativo ao local do index.html)
const DATA_URL = 'base_mestre_deputados_completa.json?v=20';

// --- GOOGLE SHEETS API CONFIG ---
const CLIENT_ID = '960396956224-fu4qhhu6svqs7tps2ff3ogdv3bv7gprr.apps.googleusercontent.com';
const API_KEY = ''; // Not using API Key, using Client ID for OAuth
const SHEET_ID = '1xP7rn_rt_e3eFMLteEJQ4JoPFti6IQj98aLXvRPBXjU';
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets profile email';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let currentUser = null;
let hasSheetAccess = false;

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
        const errMsg = `Erro ao carregar dados: ${error.message}`;
        document.getElementById('deputyGrid').innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #ef4444;">
                <h3>${errMsg}</h3>
                <p>Verifique o arquivo JSON e o console do navegador (F12).</p>
            </div>
        `;
        alert(errMsg);
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
    
    // Interactions Logic
    const interacoes = dep.interacoes || [];
    
    content.innerHTML = `
        <div class="modal-profile-header">
            <img src="${status.urlFoto}" class="big-avatar">
            <div>
                <h2>${status.nomeEleitoral}</h2>
                <div style="margin-top:5px; color:var(--text-muted)">${status.nomeCivil || ''}</div>
                <div style="margin-top:10px; display:flex; align-items:center; gap:8px" id="modalActionButtons">
                    <span class="party">${status.siglaPartido} - ${status.siglaUf}</span>
                    ${hasSheetAccess ? `
                    <button class="btn-action" onclick="openInteractionModal()" style="background:rgba(59,130,246,0.1); color:#60a5fa; border-color:rgba(59,130,246,0.2)">
                         <i class="ph ph-plus"></i> Nova Interação
                    </button>` : ''}
                </div>
                <button class="btn-action" onclick="openExtraInfo()">
                    <i class="ph ph-list-dashes"></i> Ver Atuação (Frentes e Comissões)
                </button>
            </div>
        </div>
        
        <div class="section-block">
             <h3 style="display:flex; align-items:center; gap:8px"><i class="ph ph-chats-circle" style="color:var(--primary)"></i> Histórico de Interações</h3>
             <div class="interactions-container" id="interactions-container-dynamic">
                  <!-- Será preenchido via JS -->
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
                        <th width="65%">Beneficiários & Valores (E: Empenhado)</th>
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

    const closeHandler = (e) => {
        if (mLocInput && !mLocInput.contains(e.target) && !mLocDl.contains(e.target)) {
            mLocDl.classList.remove('active');
        }
    };
    document.addEventListener('click', closeHandler);

    if (initialYearFilter !== 'ALL' && years.has(parseInt(initialYearFilter))) {
        document.getElementById('mYear').value = initialYearFilter;
    }

    updateModalTable();
    overlay.classList.add('active');
    
    renderInteractions(interacoes);
    fetchInteractions(status.nomeEleitoral);
}

function updateModalTable() {
    const term = document.getElementById('mSearch').value.toLowerCase();
    const year = document.getElementById('mYear').value;
    const func = document.getElementById('mFunc').value;
    const locTerm = document.getElementById('mLocInput').value.toLowerCase();
    
    const filtered = CURRENT_MODAL_EMENDAS.filter(em => {
        const matchYear = (year === 'ALL' || em.ano == year);
        const matchFunc = (func === 'ALL' || em.funcao === func);
        
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
    
    filtered.sort((a,b) => (b.ano - a.ano) || (parseMoney(b.valor_empenhado) - parseMoney(a.valor_empenhado)));

    let tEmp = 0, tPag = 0;

    const tbody = document.getElementById('modalTableBody');
    const tfoot = document.getElementById('modalTableFoot');
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:2rem">Nenhum resultado.</td></tr>';
        tfoot.innerHTML = '';
        return;
    }

    tbody.innerHTML = filtered.map(em => {
        const emp = parseMoney(em.valor_empenhado);
        const pag = parseMoney(em.valor_pago);
        const rap = parseMoney(em.rap_inscritos); // New Field
        
        tEmp += emp;
        tPag += pag;

        // --- Values Header (Merged) ---
        const totalEmpHtml = emp > 0 ? `<span style="color:#a3a3a3; font-size:0.75rem; margin-right:12px" title="Total Empenhado (da Emenda)">E: ${formatMoney(emp)}</span>` : '';
        const totalPagHtml = pag > 0 ? `<span style="color:var(--primary); font-weight:bold; font-size:0.75rem; margin-right:12px" title="Total Pago (da Emenda)">P: ${formatMoney(pag)}</span>` : '';
        
        // RAP Display Logic: Show only if significant (> 0)
        const totalRapHtml = rap > 0 ? `<span style="color:#fbbf24; font-size:0.75rem" title="Restos a Pagar Inscritos (RP)">RP: ${formatMoney(rap)}</span>` : '';

        const valuesHeader = `<div style="margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:flex-end; align-items:center">${totalEmpHtml}${totalPagHtml}${totalRapHtml}</div>`;

        // --- Beneficiaries List ---
        let beneficiariesHtml = '';
        
        if (em.beneficiarios && em.beneficiarios.length > 0) {
            const listItems = em.beneficiarios.map(b => {
                const bVal = b.valor ? formatMoney(b.valor) : null;
                
                let valDisplay = '';
                if(bVal) {
                    valDisplay = `<span style="color:#a3a3a3; margin-right:4px">E: ${bVal}</span>`;
                }
                
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05); padding:2px 0;">
                        <span style="font-size:0.75rem; color:#e5e7eb; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%">${b.nome}</span>
                        <div style="font-size:0.7rem; font-family:monospace; white-space:nowrap; display:flex; align-items:center">
                            ${valDisplay}
                        </div>
                    </div>
                `;
            }).join('');
            
            beneficiariesHtml = `
                <div style="max-height:100px; overflow-y:auto; padding-right:5px">${listItems}</div>
            `;
        } else {
            // Fallback: No beneficiaries list. 
            // Make it look like a list item for consistency.
            const fEmp = emp > 0 ? `<span style="color:#a3a3a3; margin-right:10px" title="Empenhado">E: ${formatMoney(emp)}</span>` : '';

            beneficiariesHtml = `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:2px 0;">
                    <span style="font-size:0.75rem; color:#e5e7eb; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%">${em.localidade || 'Localidade não informada'}</span>
                    <div style="font-size:0.7rem; font-family:monospace; white-space:nowrap; display:flex; align-items:center">
                        ${fEmp}
                    </div>
                </div>
            `;
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
        </tr>`;
    }).join('');
    
    tfoot.innerHTML = `
        <tr style="background:rgba(255,255,255,0.05); font-weight:bold">
            <td colspan="2" style="text-align:right; padding-right:1rem">TOTAIS GERAIS DO FILTRO</td>
            <td style="text-align:right">
                <span style="color:#a3a3a3; font-size:0.8rem; margin-right:12px">E: ${formatMoney(tEmp)}</span>
            </td>
        </tr>
    `;
}


/* --- Interaction Helpers --- */
/* --- Interaction Helpers (Sheets API) --- */

async function fetchInteractions(depName) {
    if (!gapiInited || !gisInited || !hasSheetAccess) return;

    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'A2:I', // Columns A to I, skipping header
        });

        const rows = response.result.values || [];
        
        // Filter rows for this deputy
        // Structure: [id, dep_nome, data, tipo, status, resumo, tags, user_email, timestamp]
        // Indices:    0       1       2     3      4       5      6       7          8
        
        const interactions = rows
            .map((row, index) => ({
                rowIndex: index + 2, // 1-based index + header offset
                id: row[0],
                deputado_nome: row[1],
                data_interacao: row[2],
                tipo_interacao: row[3],
                status: row[4],
                resumo: row[5],
                tags: row[6],
                user_email: row[7],
                timestamp: row[8]
            }))
            .filter(item => item.deputado_nome === depName);

        // Sort by date desc
        interactions.sort((a, b) => new Date(b.data_interacao) - new Date(a.data_interacao));
        
        // Update Modal
        if (CURRENT_DEPUTY_DATA && CURRENT_DEPUTY_DATA.ultimoStatus.nomeEleitoral === depName) {
             renderInteractions(interactions);
             CURRENT_DEPUTY_DATA.interacoes = interactions;
        }

    } catch (err) {
        console.error("Erro ao buscar interações no Sheets:", err);
    }
}

async function deleteInteraction(rowIndex) {
    if (!confirm("Tem certeza que deseja excluir esta interação (ação permanente)?")) return;
    
    // rowIndex is the actual 1-based row number in the sheet
    // deleteDimension 'startIndex' is 0-based, inclusive. 'endIndex' is exclusive.
    // So to delete row N (1-based), we need index N-1.
    
    const indexToDelete = rowIndex - 1;

    try {
        const batchUpdateRequest = {
            requests: [{
                deleteDimension: {
                    range: {
                        sheetId: 0, // Assuming first sheet (GID 0). If user changed it, this breaks. 
                        // TODO: Better to fetch sheet ID or use clear logic. 
                        // For safety/simplicity in this MVP, let's just CLEAR the row content to avoid shifting issues if concurrent?
                        // No, delete is better for clean data. Let's assume GID 0.
                        dimension: 'ROWS',
                        startIndex: indexToDelete,
                        endIndex: indexToDelete + 1
                    }
                }
            }]
        };

        await gapi.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: SHEET_ID,
            resource: batchUpdateRequest
        });

        // Refresh
        if (CURRENT_DEPUTY_DATA) {
            fetchInteractions(CURRENT_DEPUTY_DATA.ultimoStatus.nomeEleitoral);
        }
        
    } catch (e) {
        console.error("Erro ao deletar:", e);
        alert("Erro ao excluir. Verifique permissões ou se a planilha mudou.");
    }
}

function renderInteractions(interacoes) {
    const container = document.getElementById('interactions-container-dynamic');
    if (!container) return;

    if (!hasSheetAccess) {
        container.innerHTML = `
            <div style="text-align:center; padding: 2rem; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
                <i class="ph ph-lock" style="font-size: 2rem; color: var(--primary); margin-bottom: 1rem; display: block;"></i>
                <div style="font-weight: 600; margin-bottom: 0.5rem;">Acesso Restrito a Servidores Específicos do IFMG</div>
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">
                    Faça login com uma conta Google autorizada para visualizar e incluir interações.
                </p>
                ${!currentUser ? `
                <button onclick="handleAuthClick()" class="btn-action" style="margin: 0 auto; background: var(--primary); color: white; border: none;">
                    <i class="ph-bold ph-google-logo"></i> Entrar com Google
                </button>` : `<p style="color: #ef4444; font-size: 0.75rem;">Sua conta atual (${currentUser.email}) não tem permissão de acesso.</p>`}
            </div>
        `;
        return;
    }

    if (!interacoes || interacoes.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem; font-style:italic">Nenhuma interação registrada.</div>';
        return;
    }

    const rows = interacoes.map(i => `
        <div class="interaction-card" style="position:relative">
            <div class="int-header">
                <span class="int-date"><i class="ph ph-calendar-blank"></i> ${formatDate(i.data_interacao)}</span>
                <div style="display:flex; gap:8px; align-items:center">
                    <span class="int-badge">${i.tipo_interacao}</span>
                    <span class="int-status status-${(i.status||'').toLowerCase().replace(' ', '')}">${i.status}</span>
                    ${i.rowIndex ? `<button onclick="deleteInteraction(${i.rowIndex})" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:4px; font-size:1.1rem; line-height:0" title="Excluir"><i class="ph ph-trash"></i></button>` : ''}
                </div>
            </div>
            <div class="int-resumo">${i.resumo}</div>
            ${i.tags ? `<div class="int-tags"><i class="ph ph-tag"></i> ${i.tags}</div>` : ''}
            <div style="font-size:0.6rem; color:rgba(255,255,255,0.2); margin-top:4px; text-align:right">
                Por: ${i.user_email || 'Desconhecido'}
            </div>
        </div>
    `).join('');
    
    container.innerHTML = rows;
}

function formatDate(dateStr) {
    if(!dateStr) return '';
    // If YYYY-MM-DD
    if (dateStr.includes('-')) {
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    }
    return dateStr;
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

// --- Interaction Form Logic ---
function openInteractionModal() {
    if (!CURRENT_DEPUTY_DATA) return;
    
    if (!currentUser) {
        alert("Você precisa fazer login com o Google para adicionar interações.");
        handleAuthClick();
        return;
    }

    const dep = CURRENT_DEPUTY_DATA.ultimoStatus;
    
    document.getElementById('intModalTitle').innerText = `Nova Interação: ${dep.nomeEleitoral}`;
    document.getElementById('intDepName').value = dep.nomeEleitoral;
    
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('intDate').value = today;
    document.getElementById('intResumo').value = '';
    document.getElementById('intTags').value = '';
    
    document.getElementById('modalInteraction').classList.add('active');
}

function closeInteractionModal() {
    document.getElementById('modalInteraction').classList.remove('active');
}


// Handle Form Submit (Sheets API)
const intForm = document.getElementById('interactionForm');
if (intForm) {
    intForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!gapiInited || !tokenClient) {
            alert("API do Google não inicializada.");
            return;
        }

        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        
        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Salvando...';
            
            const depName = document.getElementById('intDepName').value;
            const dataInt = document.getElementById('intDate').value;
            const tipo = document.getElementById('intType').value;
            const status = document.getElementById('intStatus').value;
            const resumo = document.getElementById('intResumo').value;
            const tags = document.getElementById('intTags').value;
            
            const newId = Date.now().toString(); // Simple ID
            const userEmail = currentUser ? currentUser.email : 'Unknown';
            const timestamp = new Date().toISOString();

            // Values to append
            // Order: id, deputado_nome, data, tipo, status, resumo, tags, user_email, timestamp
            const values = [
                [newId, depName, dataInt, tipo, status, resumo, tags, userEmail, timestamp]
            ];
            
            const resource = {
                values: values,
            };

            await gapi.client.sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: 'A1', // Appends to the table found starting at A1
                valueInputOption: 'USER_ENTERED',
                resource: resource,
            });
            
            alert("Interação salva com sucesso!");
            closeInteractionModal();
            
            // Refresh
            fetchInteractions(depName);
            
        } catch (err) {
            console.error(err);
            alert("Erro ao salvar no Google Sheets: " + JSON.stringify(err));
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });
}

// --- Google Auth & Sheets API Logic ---

// --- Google Auth & Sheets API Logic ---

// Wrapper callbacks called by the stubs in index.html
window.onGapiLoaded = function() {
    gapi.load('client', initializeGapiClient);
}

window.onGisLoaded = function() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
            if (resp.error) {
                throw resp;
            }
            console.log("Token recebido.");
            fetchUserInfo(resp.access_token);
        },
    });
    gisInited = true;
    checkAuthStatus();
}

// Check if they loaded before we defined these
if(window.gapiInitedFlag) window.onGapiLoaded();
if(window.gisInitedFlag) window.onGisLoaded();

async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: [DISCOVERY_DOC],
        });
        gapiInited = true;
        checkAuthStatus();
    } catch (err) {
        console.error("Erro ao inicializar GAPI:", err);
    }
}

function checkAuthStatus() {
    if (gapiInited && gisInited) {
        renderAuthButton();
    }
}

function renderAuthButton() {
    const container = document.getElementById('authContainer');
    if (!container) return; // Guard clause

    if (!currentUser || !currentUser.name) {
        container.innerHTML = `
            <button onclick="handleAuthClick()" class="btn-action" style="margin:0; background: var(--primary); color:white; border:none;">
                <i class="ph-bold ph-google-logo"></i> Entrar com Google
            </button>
        `;
    } else {
        container.innerHTML = `
            <div class="user-info">
                   <img src="${currentUser.picture || 'https://ui-avatars.com/api/?name='+currentUser.name}" class="user-avatar" alt="User" onerror="this.style.display='none'">
                   <span>${currentUser.name}</span>
            </div>
            <button onclick="handleSignoutClick()" class="btn-action" style="margin:0; padding: 4px 8px; font-size: 0.75rem;">
                Sair
            </button>
        `;
    }
}

function handleAuthClick() {
    tokenClient.requestAccessToken({prompt: 'consent'});
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken('');
            currentUser = null;
            hasSheetAccess = false;
            renderAuthButton();
        });
    } else {
        // Fallback para limpar estado mesmo sem token válido
        currentUser = null;
        hasSheetAccess = false;
        renderAuthButton();
    }
}

async function fetchUserInfo(accessToken) {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        
        if (!res.ok) {
             throw new Error("Failed to fetch user info: " + res.status);
        }
        
        const data = await res.json();
        currentUser = data;
        
        // Agora verifica se TEM ACESSO à planilha específica
        await verifySheetAccess();
        
    } catch (e) {
        console.error("Erro ao buscar info do usuário", e);
        currentUser = null;
        hasSheetAccess = false;
        renderAuthButton();
    }
}

async function verifySheetAccess() {
    try {
        // Tenta buscar apenas os metadados da planilha para validar acesso
        const response = await gapi.client.sheets.spreadsheets.get({
            spreadsheetId: SHEET_ID,
            fields: 'spreadsheetId' // Economiza banda, só queremos saber se o 403 acontece
        });
        
        if (response.result.spreadsheetId === SHEET_ID) {
            hasSheetAccess = true;
            console.log("Acesso à planilha verificado com sucesso.");
        }
    } catch (err) {
        console.warn("Usuário logado mas sem acesso à planilha:", err);
        hasSheetAccess = false;
        
        // Se der erro de permissão (403), avisamos o usuário
        if (err.status === 403) {
            alert("Acesso Negado: Sua conta Google não tem permissão para acessar a base de dados de interações. Entre em contato com o administrador.");
            // Opcional: Deslogar automaticamente ou apenas manter estado restrito
            // handleSignoutClick(); 
        }
    } finally {
        renderAuthButton();
        
        // REFRESH AUTOMÁTICO DO MODAL SE ESTIVER ABERTO
        if (hasSheetAccess && CURRENT_DEPUTY_DATA) {
            console.log("Atualizando modal após login...");
            const dep = CURRENT_DEPUTY_DATA;
            const status = dep.ultimoStatus;
            
            // 1. Atualiza botões de ação (Nova Interação)
            const actionBtns = document.getElementById('modalActionButtons');
            if (actionBtns) {
                actionBtns.innerHTML = `
                    <span class="party">${status.siglaPartido} - ${status.siglaUf}</span>
                    <button class="btn-action" onclick="openInteractionModal()" style="background:rgba(59,130,246,0.1); color:#60a5fa; border-color:rgba(59,130,246,0.2)">
                         <i class="ph ph-plus"></i> Nova Interação
                    </button>
                `;
            }
            
            // 2. Busca e renderiza interações
            fetchInteractions(status.nomeEleitoral);
        }
    }
}
