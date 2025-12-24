// URL do JSON (relativo ao local do index.html)
const DATA_URL = 'base_mestre_deputados_completa.json';

let ALL_DEPUTIES = [];

// Formatadores
const formatMoney = (val) => {
    if (!val) return 'R$ 0,00';
    if (typeof val === 'string') {
        val = parseFloat(val.replace(/\./g, '').replace(',', '.'));
    }
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const parseMoney = (valStr) => {
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
            if (!lastModifiedHeader && json.metadata && json.metadata.data_atualizacao) {
                document.getElementById('lastUpdate').innerText = `Atualizado em: ${json.metadata.data_atualizacao}`;
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
                // Simplificar localidade (às vezes vem 'SAO PAULO (UF)' ou municípicios)
                // Vamos pegar tudo para ser genérico por enquanto
                if (em.localidade) localities.add(em.localidade);
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
    if (years.has(new Date().getFullYear())) yearSel.value = new Date().getFullYear();
    
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

    // Localities (Destinos)
    const locSel = document.getElementById('filterLocality');
    Array.from(localities).sort().forEach(l => {
        locSel.appendChild(new Option(l, l));
    });
    
    // Listeners
    [yearSel, partySel, ufSel, funcSel, locSel].forEach(el => el.addEventListener('change', applyFilters));
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
                const yepLoc = (loc === "" || e.localidade === loc);
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
    const localities = new Set();
    
    CURRENT_MODAL_EMENDAS.forEach(e => {
        years.add(e.ano);
        if(e.funcao) functions.add(e.funcao);
        if(e.localidade) localities.add(e.localidade);
    });
    
    const yearsOptions = Array.from(years).sort().reverse().map(y => `<option value="${y}">${y}</option>`).join('');
    const funcOptions = Array.from(functions).sort().map(f => `<option value="${f}">${f}</option>`).join('');
    const locOptions = Array.from(localities).sort().map(l => `<option value="${l}">${l}</option>`).join('');

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
        
        <div class="modal-filters" style="margin-top:1rem">
            <input type="text" id="mSearch" class="modal-input" placeholder="Busca livre..." style="flex:1; min-width:150px">
            <select id="mYear" class="modal-select"><option value="ALL">Todos os Anos</option>${yearsOptions}</select>
            <select id="mFunc" class="modal-select"><option value="ALL">Todas Funções</option>${funcOptions}</select>
            <select id="mLoc" class="modal-select" style="max-width:200px"><option value="ALL">Todas Localidades</option>${locOptions}</select>
        </div>

        <div class="data-table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th width="10%">Ano / Cód.</th>
                        <th width="20%">Função</th>
                        <th width="25%">Localidade</th>
                        <th>Empenhado</th>
                        <th>Liquidado</th>
                        <th>Pago</th>
                        <th>RP Inscritos</th>
                        <th>RP Cancelados</th>
                        <th>RP Pagos</th>
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
    document.getElementById('mLoc').addEventListener('change', updateModalTable);

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
    const loc = document.getElementById('mLoc').value;
    
    // Filtrar
    const filtered = CURRENT_MODAL_EMENDAS.filter(em => {
        const matchYear = (year === 'ALL' || em.ano == year);
        const matchFunc = (func === 'ALL' || em.funcao === func);
        const matchLoc = (loc === 'ALL' || em.localidade === loc);
        const matchTerm = term === '' || (em.localidade||'').toLowerCase().includes(term) || (em.funcao||'').toLowerCase().includes(term);
        return matchYear && matchFunc && matchLoc && matchTerm;
    });
    
    // Sort: Ano DESC, Valor Empenhado DESC
    filtered.sort((a,b) => (b.ano - a.ano) || (parseMoney(b.valor_empenhado) - parseMoney(a.valor_empenhado)));

    // Totalizadores
    let tEmp = 0, tLiq = 0, tPag = 0;
    let tRpInsc = 0, tRpCanc = 0, tRpPago = 0;

    const tbody = document.getElementById('modalTableBody');
    const tfoot = document.getElementById('modalTableFoot');
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:2rem">Nenhum resultado.</td></tr>';
        tfoot.innerHTML = '';
        return;
    }

    tbody.innerHTML = filtered.map(em => {
        const emp = parseMoney(em.valor_empenhado);
        const liq = parseMoney(em.valor_liquidado);
        const pag = parseMoney(em.valor_pago);
        const rpInsc = parseMoney(em.valor_resto_inscrito);
        const rpCanc = parseMoney(em.valor_resto_cancelado);
        const rpPago = parseMoney(em.valor_resto_pago);
        
        tEmp += emp;
        tLiq += liq;
        tPag += pag;
        tRpInsc += rpInsc;
        tRpCanc += rpCanc;
        tRpPago += rpPago;

        return `
        <tr>
            <td>
                <div>${em.ano}</div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px">${em.codigo}</div>
            </td>
            <td>
                 <div style="font-size:0.75rem; color:var(--text-muted); line-height:1.2">
                    ${em.funcao}<br>
                    <span style="font-size:0.7rem; opacity:0.7">${em.subfuncao}</span>
                </div>
                 <div style="font-size:0.65rem; opacity:0.5; margin-top:2px">${em.tipo}</div>
            </td>
             <td>
                 <div style="font-weight:600">${em.localidade || 'N/A'}</div>
            </td>
            <td class="val-col" style="color:#fff">${formatMoney(emp)}</td>
            <td class="val-col" style="color:#d1d5db">${formatMoney(liq)}</td>
            <td class="val-col" style="color:var(--primary)">${formatMoney(pag)}</td>
            <td class="val-col" style="color:#fcd34d">${formatMoney(rpInsc)}</td>
            <td class="val-col" style="color:#f87171">${formatMoney(rpCanc)}</td>
            <td class="val-col" style="color:#4ade80">${formatMoney(rpPago)}</td>
        </tr>`;
    }).join('');
    
    tfoot.innerHTML = `
        <tr style="background:rgba(255,255,255,0.05); font-weight:bold">
            <td colspan="3">TOTAIS</td>
            <td class="val-col" style="color:#fff">${formatMoney(tEmp)}</td>
            <td class="val-col" style="color:#d1d5db">${formatMoney(tLiq)}</td>
            <td class="val-col" style="color:var(--primary)">${formatMoney(tPag)}</td>
            <td class="val-col" style="color:#fcd34d">${formatMoney(tRpInsc)}</td>
            <td class="val-col" style="color:#f87171">${formatMoney(tRpCanc)}</td>
            <td class="val-col" style="color:#4ade80">${formatMoney(tRpPago)}</td>
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

// Inicializa a App
loadData();

