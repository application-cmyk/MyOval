import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { callGAS, formatEuro, getThumbnailUrl } from "./utils.js";
import { renderAnagraficaForm } from "./anagrafica.js";

// --- STATO GLOBALE ---
window.shopCatalog = null;
window.cart = [];
window.currentArtForConf = null;
window.appliedCouponCode = "";
window.couponFeedbackHTML = "";
window.isDetrazioneActive = false;
window.selectedGenitoreId = "";
window.fiscalCF = "";
window.fiscalEmail = "";

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const raw = sessionStorage.getItem('myoval_shared_data');
        if (!raw) { window.location.href = "index.html"; return; }
        window.globalData = JSON.parse(raw);

        const emailLabel = document.getElementById('user-email-display-shop');
        if (emailLabel) emailLabel.innerText = window.globalData.userEmail;

        await inizializzaShop();
    } else {
        window.location.href = "index.html";
    }
});

async function inizializzaShop() {
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.style.setProperty('display', 'flex', 'important');

    try {
        const params = {
            email: window.globalData.userEmail,
            idFamiglia: window.globalData.idFamiglia,
            membri: window.globalData.famiglia.data,
            atleti: window.globalData.atleti
        };

        const res = await callGAS("getShopPortalDataWithCart", params);
        if (!res || !res.success) throw new Error(res ? res.error : "Errore catalogo");

        window.shopCatalog = res;

        // --- MAPPING CARRELLO CON RECUPERO TITOLO ARTICOLO ---
        window.cart = (res.persistedCart || []).map(item => {
            const artId = (item.ID_Articolo || item.idArticolo || "").toString();

            // Cerchiamo i dettagli dell'articolo nel catalogo scaricato per prendere il Titolo
            const artInfo = (res.articoli || []).find(a => a.ID_Articolo === artId);

            // Logica di priorità nome: Titolo Visualizzato -> Nome Tecnico -> Valore da Spreadsheet
            const nomeDaVisualizzare = artInfo ?
                (artInfo.Titolo_Articolo || artInfo.Nome_Articolo) :
                (item.Nome_Articolo || item.nomeArticolo || "Articolo");

            return {
                idContatto: (item.ID_Contatto || item.idcontatto || "").toString(),
                nomeMembro: item.Nome_Membro || item.nomemembro || "",
                idArticolo: artId,
                // --- APPLICAZIONE MODIFICA ---
                nomeArticolo: nomeDaVisualizzare,
                idCategoria: (item.ID_Categoria || item.idcategoria || "").toString(),
                metadati: item.Metadati_JSON || {},
                addedAt: item.Data_Aggiunta || Date.now(),
                prezzoBase: 0,
                finalPrice: 0,
                scontiDettaglio: []
            };
        });

        console.log(`🛒 Carrello sincronizzato con ${window.cart.length} articoli.`);

        window.recalculateCart();
        window.renderShopHome();

    } catch (e) {
        console.error("Errore inizializzazione:", e);
        alert("Errore: " + e.message);
    } finally {
        if (loader) loader.style.setProperty('display', 'none', 'important');
    }
}

/**
 * DISEGNA LA RICEVUTA DEL CARRELLO SOPRA IL CATALOGO
 */
window.renderCartUI = function () {
    const container = document.getElementById('cart-integrated-container');
    const divider = document.getElementById('ui-shop-divider');
    const countEl = document.getElementById('cart-count');

    if (!container) return;

    // 1. Se il carrello è vuoto, nascondi tutto
    if (!window.cart || window.cart.length === 0) {
        container.style.setProperty('display', 'none', 'important');
        if (divider) divider.classList.add('d-none');
        if (countEl) countEl.innerText = "0";
        return;
    }

    // 2. Forza la visualizzazione
    container.classList.remove('d-none');
    container.style.setProperty('display', 'block', 'important');
    if (divider) divider.classList.remove('d-none');
    if (countEl) countEl.innerText = window.cart.length;

    // 3. Calcolo Totale e Filtro Adulti
    const total = window.cart.reduce((s, i) => s + (parseFloat(i.finalPrice) || 0), 0);
    const membri = Array.isArray(window.shopCatalog.famiglia)
        ? window.shopCatalog.famiglia
        : (window.shopCatalog.famiglia?.data || []);

    const adulti = membri.filter(m => {
        const r = (m.Ruolo || "").toUpperCase();
        return r.includes("GENITORE") || r.includes("SOCIO") || r.includes("CONSIGLIERE");
    });

    // 4. Generazione Righe con SCONTI AL CENTRO
    const htmlRows = window.cart.map((item, index) => {
        // Prepariamo l'HTML degli sconti
        const sctHtml = (item.scontiDettaglio || []).map(s => `
            <div class="text-success fw-bold text-nowrap" style="font-size: 9px;">
                <i class="fas fa-tag"></i> -${formatEuro(s.valore)}
                <div class="text-muted" style="font-size: 7px; font-weight: normal;">${s.nome}</div>
            </div>`).join('');

        let metaHtml = "";
        if (item.metadati) {
            if (item.metadati.squadra) metaHtml += `<span class="badge bg-light text-dark border me-1" style="font-size: 8px;">${item.metadati.squadra}</span>`;
            if (item.metadati.tagliaMaglia) metaHtml += `<small class="text-muted" style="font-size: 9px;">Kit: ${item.metadati.tagliaMaglia}</small>`;
        }

        return `
        <tr style="border-bottom: 1px solid #f0f0f0;">
            <!-- Colonna 1: Articolo e Beneficiario -->
            <td class="ps-3 py-2" style="width: 40%;">
                <div class="fw-bold text-dark" style="font-size:13px; line-height: 1.1;">${item.nomeArticolo}</div>
                <div style="font-size:10px;">Per: <span class="text-danger fw-bold">${item.nomeMembro}</span></div>
                <div class="mt-1">${metaHtml}</div>
            </td>

            <!-- Colonna 2: Prezzo Base (nascosto su mobile piccolo) -->
            <td class="text-center text-muted d-none d-md-table-cell" style="font-size:11px; width: 15%;">
                ${formatEuro(item.prezzoBase)}
            </td>

            <!-- Colonna 3: SCONTI (AL CENTRO) -->
            <td class="text-center py-2" style="width: 25%;">
                ${sctHtml || '<span class="text-muted" style="font-size: 10px;">-</span>'}
            </td>

            <!-- Colonna 4: Prezzo Finale -->
            <td class="text-end py-2 pe-3" style="width: 15%;">
                <div class="fw-bold text-dark" style="font-size:0.95rem;">${formatEuro(item.finalPrice)}</div>
            </td>

            <!-- Colonna 5: Azione -->
            <td class="text-center" style="width: 5%;">
                <button class="btn btn-sm btn-link text-danger p-0" onclick="window.removeAndRefresh(${index})">
                    <i class="fas fa-times-circle"></i>
                </button>
            </td>
        </tr>`;
    }).join('');

    // 5. Iniezione HTML Finale (Con Intestazioni Sottili per chiarezza colonne)
    container.innerHTML = `
    <div class="card shadow-sm mb-3" style="border-radius: 12px; overflow: hidden; border: 1px solid #ddd;">
      
      <div class="p-2 bg-dark text-white d-flex justify-content-between align-items-center">
        <h6 class="mb-0 fw-bold small ms-2"><i class="fas fa-shopping-cart me-2 text-danger"></i>RIEPILOGO ISCRIZIONE</h6>
        <span class="badge bg-danger rounded-pill me-2" style="font-size:10px;">${window.cart.length} Articoli</span>
      </div>
      
      <div class="table-responsive bg-white">
        <table class="table table-hover align-middle mb-0" style="table-layout: fixed; width: 100%;">
          <thead class="bg-light">
            <tr style="font-size: 9px; text-transform: uppercase; color: #999; border-bottom: 1px solid #eee;">
               <th class="ps-3 py-1">Beneficiario</th>
               <th class="text-center py-1 d-none d-md-table-cell">Listino</th>
               <th class="text-center py-1">Sconti</th>
               <th class="text-end pe-3 py-1">Totale</th>
               <th style="width: 40px;"></th>
            </tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </div>

      <!-- Area Coupon e Detrazione -->
      <div class="p-2 bg-white border-top">
        <div class="row g-2 align-items-center">
          <div class="col-md-5">
            <div class="input-group input-group-sm">
                <input type="text" id="cart_coupon_input" class="form-control form-control-sm" placeholder="Codice Coupon" value="${window.appliedCouponCode || ''}">
                <button class="btn btn-dark btn-sm fw-bold" onclick="window.applyCoupon()">APPLICA</button>
            </div>
            <div id="coupon_feedback">${window.couponFeedbackHTML || ''}</div>
          </div>
          <div class="col-md-7 border-start ps-3">
            <div class="form-check form-switch m-0 d-flex align-items-center">
                <input class="form-check-input" type="checkbox" id="f_detrazione_attiva" 
                       onchange="window.toggleDetrazioneUI(this.checked)" 
                       ${window.isDetrazioneActive ? 'checked' : ''} 
                       style="transform: scale(0.85); margin-right: 10px;">
                <label class="form-check-label fw-bold text-dark" for="f_detrazione_attiva" style="font-size: 11px;">Detrazione fiscale (730)</label>
            </div>
            <div id="detrazione-fields-ui" class="${window.isDetrazioneActive ? '' : 'd-none'} mt-1">
                <select id="f_genitore_detrazione" class="form-select form-select-sm" style="font-size: 10px;" onchange="window.autoFillFiscalData(this.value)">
                    <option value="">Intesta la ricevuta a...</option>
                    ${adulti.map(a => `<option value="${a.IDContatto}" ${window.selectedGenitoreId == a.IDContatto ? 'selected' : ''}>${a.Cognome} ${a.Nome}</option>`).join('')}
                </select>
            </div>
          </div>
        </div>
      </div>

      <div class="p-2 bg-light border-top d-flex justify-content-between align-items-center">
        <div class="ps-2">
            <small class="text-muted text-uppercase fw-bold d-block" style="font-size:9px; line-height: 1;">Totale da pagare:</small>
            <div class="h4 fw-bold text-danger mb-0" style="font-family: monospace;">${formatEuro(total)}</div>
        </div>
        <button class="btn btn-success fw-bold px-4 py-2 rounded-pill shadow-sm" style="font-size: 11px; letter-spacing: 0.5px;" onclick="window.checkout()">
          CONFERMA E PROCEDI <i class="fas fa-arrow-right ms-1"></i>
        </button>
      </div>
    </div>`;
};

window.updateCartUI = function () {
    const total = window.cart.reduce((s, i) => s + (i.finalPrice || 0), 0);
    const countEl = document.getElementById('cart-count');
    if (countEl) countEl.innerText = window.cart.length;
};

/**
 * RENDER ARTICOLI DELLA CATEGORIA SELEZIONATA
 */
window.openShopCategory = function (idCat) {
    if (!window.shopCatalog) return;
    const cat = window.shopCatalog.categorie.find(c => c.ID_Categoria === idCat);
    if (!cat) return;

    document.getElementById('shop-breadcrumb')?.classList.remove('d-none');
    const labelHome = document.getElementById('breadcrumb-label-home');
    if (labelHome) labelHome.innerText = "Torna al Catalogo";
    const labelCurrent = document.getElementById('breadcrumb-current');
    if (labelCurrent) labelCurrent.innerText = cat.Nome_Categoria;

    const membri = Array.isArray(window.shopCatalog.famiglia) ? window.shopCatalog.famiglia : (window.shopCatalog.famiglia?.data || []);
    const articoliIdonei = (window.shopCatalog.articoli || []).filter(a =>
        a.ID_Categoria === idCat && membri.some(m => window.checkEligibility(a, m))
    );

    const container = document.getElementById('shop-content-area');

    let html = `
        <div class="mb-4 animate__animated animate__fadeIn">
            <button class="btn btn-outline-secondary btn-sm rounded-pill px-3 shadow-sm mb-3" 
                    onclick="window.renderShopHome()" 
                    style="font-size: 0.7rem; font-weight: bold; border: 1px solid #cbd5e0;">
                <i class="fas fa-th-large me-2"></i> TORNA AL CATALOGO
            </button>
            <h3 class="fw-bold text-dark mb-4 ms-1">${cat.Nome_Categoria}</h3>
        </div>
        <div class="row g-2 animate__animated animate__fadeIn">`;

    if (articoliIdonei.length === 0) {
        html += '<div class="col-12 text-center p-5 text-muted">Nessun articolo disponibile.</div>';
    } else {
        articoliIdonei.forEach(art => {
            const lp = window.calculateLivePrice(art);
            const pDisp = lp.isValid ? formatEuro(lp.price) : `<span class="text-muted small">NON DISPONIBILE</span>`;

            // Logica per calcolare la fascia d'età
            const minAnno = Math.min(parseInt(art.Da_Anni || 1900), parseInt(art.A_Anni || 1900));
            const maxAnno = Math.max(parseInt(art.Da_Anni || 2100), parseInt(art.A_Anni || 2100));
            const natiString = (art.Da_Anni || art.A_Anni) ? `Nati dal ${minAnno} al ${maxAnno}` : "Aperto a tutti";

            html += `
            <div class="col-12">
                <div class="card product-row-card shadow-sm" style="${!lp.isValid ? 'opacity:0.6' : ''}">
                    <div class="row align-items-center g-2">
                        <div class="col-7 ps-2">
                            <!-- 1. Visualizziamo Titolo_Articolo -->
                            <h6 class="fw-bold mb-0" style="font-size:1rem; color:#1a2b3c;">${art.Titolo_Articolo || art.Nome_Articolo}</h6>
                            <!-- 2. Aggiungiamo info Nati dal/al -->
                            <div class="nati-info"><i class="far fa-calendar-alt me-1"></i> ${natiString}</div>
                        </div>
                        <div class="col-3 text-end">
                            <div class="fw-bold text-danger" style="font-size:1.2rem; font-family: 'Roboto Mono', monospace;">${pDisp}</div>
                            ${lp.isDynamic && lp.isValid ? `<small class="text-success fw-bold d-block" style="font-size:8px; line-height:1;">${lp.label}</small>` : ''}
                        </div>
                        <div class="col-2 text-end pe-2">
                            <button class="btn btn-danger btn-sm rounded-pill fw-bold" 
                                    style="font-size:10px; padding: 8px 20px !important;" 
                                    onclick="window.startConfigurator('${art.ID_Articolo}')" 
                                    ${!lp.isValid ? 'disabled' : ''}>
                                ${lp.isValid ? 'ACQUISTA' : 'CHIUSO'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
        });
    }

    container.innerHTML = html + '</div>';

    // 4. FOCUS IN ALTO
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

/**
 * 3. FIX: AGGANCIO GLOBALE FUNZIONI UI
 */
window.toggleDetrazioneUI = function (show) {
    window.isDetrazioneActive = show;
    window.renderCartUI(); // Ridisegna per mostrare/nascondere i campi
};

window.autoFillFiscalData = function (id) {
    const membri = Array.isArray(window.shopCatalog.famiglia) ? window.shopCatalog.famiglia : (window.shopCatalog.famiglia.data || []);
    const g = membri.find(m => m.IDContatto.toString() === id.toString());
    if (g) {
        window.selectedGenitoreId = id;
        window.fiscalCF = g.Codice_Fiscale || "";
        window.fiscalEmail = g.Email || "";
        window.renderCartUI();
    }
};

window.applyCoupon = function () {
    const code = document.getElementById('cart_coupon_input')?.value.trim().toUpperCase();
    if (!code) { window.appliedCouponCode = ""; window.couponFeedbackHTML = ""; window.recalculateCart(); return; }
    const match = (window.shopCatalog.sconti || []).find(s => (s.Codice_Coupon || "").toUpperCase() === code && (s.Attivo === true || s.Attivo === "TRUE"));
    if (match) {
        window.appliedCouponCode = code;
        window.couponFeedbackHTML = `<div class="text-success small fw-bold mt-1">Coupon applicato!</div>`;
    } else {
        window.appliedCouponCode = "";
        window.couponFeedbackHTML = `<div class="text-danger small fw-bold mt-1">Codice non valido.</div>`;
    }
    window.recalculateCart();
};


window.removeAndRefresh = async function (index) {
    const item = window.cart[index];
    if (!item || !confirm("Rimuovere l'articolo?")) return;
    try {
        await callGAS("removeFromCartPersist", { idContatto: item.idContatto, idArticolo: item.idArticolo, email: window.globalData.userEmail });
        window.cart.splice(index, 1);
        window.recalculateCart();
    } catch (e) { alert(e.message); }
};


/**
 * 1. MOTORE DI IDONEITÀ
 */
window.checkEligibility = function (art, atleta) {
    if (!art || !atleta) return false;
    if (art.Pubblicato !== true && art.Pubblicato !== "TRUE") return false;

    const dnRaw = (atleta.Data_Nascita || "").toString();
    const match = dnRaw.match(/\d{4}/);
    const annoAtleta = match ? parseInt(match[0]) : 0;

    if (art.Da_Anni || art.A_Anni) {
        const min = Math.min(parseInt(art.Da_Anni || 1900), parseInt(art.A_Anni || 1900));
        const max = Math.max(parseInt(art.Da_Anni || 2100), parseInt(art.A_Anni || 2100));
        if (annoAtleta > 0 && (annoAtleta < min || annoAtleta > max)) return false;
    }

    const sessoReq = (art.Sesso || "").toString().trim().toUpperCase();
    const sessoAtl = (atleta.Sesso || "").toString().trim().toUpperCase();
    if (sessoReq !== "" && sessoAtl !== "" && sessoAtl !== sessoReq) return false;

    if (art.Tipo_Articolo === 'TESSERAMENTO') {
        const ruolo = (atleta.Ruolo || "").toLowerCase();
        if (!ruolo.includes("atleta")) return false;
        const profiloTecnico = (atleta.Tipo_Tecnico || "NUOVO").toUpperCase();
        const tipoArticolo = (art.Tipo_Tesseramento || "NUOVO").toUpperCase();
        if (profiloTecnico !== tipoArticolo) return false;
    }
    return true;
};


/**
 * 3. RENDER HOME (CATEGORIE)
 */
window.renderShopHome = function () {
    const breadcrumb = document.getElementById('shop-breadcrumb');
    if (breadcrumb) breadcrumb.classList.add('d-none');

    const container = document.getElementById('shop-content-area');
    if (!container || !window.shopCatalog) return;

    const membri = Array.isArray(window.shopCatalog.famiglia)
        ? window.shopCatalog.famiglia
        : (window.shopCatalog.famiglia?.data || []);

    const sezioni = [
        { id: 'TESSERAMENTO', label: 'Stagione Rugby' },
        { id: 'CAMP', label: 'Camp Estivi e Clinic' },
        { id: 'SERVIZIO', label: 'Servizi Aggiuntivi' },
        { id: 'ATTIVITA', label: 'Corsi ed altre Attività Sportive' }
    ];

    let html = '<div class="animate__animated animate__fadeIn">';

    sezioni.forEach(s => {
        const catFiltrate = (window.shopCatalog.categorie || []).filter(c =>
            c.Tipo_Articolo === s.id &&
            (window.shopCatalog.articoli || []).some(a =>
                a.ID_Categoria === c.ID_Categoria &&
                membri.some(m => window.checkEligibility(a, m))
            )
        );

        if (catFiltrate.length > 0) {
            // Titolo sezione
            html += `<div class="rm-section-title mt-4 mb-2">${s.label}</div>`;

            // --- NUOVO CONTENITORE COMPATTO ---
            html += `<div class="shop-category-container">`;

            catFiltrate.forEach(cat => {
                const thumb = getThumbnailUrl(cat.Immagine_URL);
                html += `
                <div class="category-tile text-center" onclick="window.openShopCategory('${cat.ID_Categoria}')">
                    <div class="tile-img-box shadow-sm">
                        <img src="${thumb}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='https://placehold.co/90x90?text=Rugby'">
                    </div>
                    <div class="tile-name fw-bold text-uppercase">${cat.Nome_Categoria}</div>
                </div>`;
            });
            html += `</div>`; // Chiude shop-category-container
        }
    });

    container.innerHTML = html + '</div>';
};

/**
 * 5. CONFIGURATORE ACQUISTO
 */
window.startConfigurator = function (idArt) {
    const art = window.shopCatalog.articoli.find(a => a.ID_Articolo === idArt);
    if (!art) return;
    window.currentArtForConf = art;

    // 1. Visualizzazione Titolo Leggibile
    const titleEl = document.getElementById('conf-titolo-articolo');
    if (titleEl) titleEl.innerText = (art.Titolo_Articolo || art.Nome_Articolo).toUpperCase();

    const priceEl = document.getElementById('conf-display-prezzo');
    if (priceEl) priceEl.innerText = formatEuro(window.calculateLivePrice(art).price);

    const containerMembri = document.getElementById('conf-membri-list');
    if (containerMembri) {
        const membri = Array.isArray(window.shopCatalog.famiglia)
            ? window.shopCatalog.famiglia
            : (window.shopCatalog.famiglia?.data || []);

        containerMembri.innerHTML = membri
            .filter(m => window.checkEligibility(art, m))
            .map(m => `
        <div class="member-card-wrapper">
            <!-- Layout Flex pulito senza margini negativi -->
            <div class="d-flex align-items-center m-0">
                <input class="form-check-input conf-membro-check" 
                       type="checkbox" 
                       value="${m.IDContatto}" 
                       id="m_${m.IDContatto}"
                       onchange="window.handleMemberToggle(this, '${m.IDContatto}')"
                       style="margin-left:0;">
                <label class="fw-bold text-dark mb-0" for="m_${m.IDContatto}" style="font-size: 0.85rem; cursor:pointer;">
                    ${m.Nome} ${m.Cognome}
                </label>
            </div>
            <!-- Contenitore dati anagrafici/tecnici -->
            <div id="personal-data-container-${m.IDContatto}" class="mt-2"></div>
        </div>`).join('');
    }

    const modalEl = document.getElementById('modalConfiguratore');
    if (modalEl && window.bootstrap) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
};

/**
 * GESTISCE IL RENDERING DEI CAMPI (Con Lista Squadre Dinamica)
 */
window.handleMemberToggle = function (checkbox, idContatto) {
    const containerId = `personal-data-container-${idContatto}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    if (checkbox.checked) {
        try {
            const art = window.currentArtForConf;

            // 1. Funzione di recupero tollerante per i campi dell'articolo
            const getArtVal = (target) => {
                const cleanTarget = target.toLowerCase().replace(/_/g, "");
                const foundKey = Object.keys(art).find(k => k.toLowerCase().replace(/_/g, "") === cleanTarget);
                const val = (foundKey && art[foundKey]) ? art[foundKey].toString().trim() : null;
                return (val === "" || val === "null" || val === "undefined") ? null : val;
            };

            const targetGruppo = getArtVal("UI_Gruppo");
            const targetProfilo = getArtVal("UI_Profilo");

            // --- LOGICA RICHIESTA: Se mancano i puntamenti UI, non mostriamo il form ---
            if (!targetGruppo || !targetProfilo) {
                console.log(`ℹ️ Articolo "${art.Nome_Articolo}" non richiede form anagrafico.`);
                container.innerHTML = ""; // Contenitore vuoto
            } else {
                // --- PROCEDIAMO CON IL RENDERING DINAMICO ---
                const targetProfiloUpper = targetProfilo.toUpperCase();
                const configCampi = window.globalData.config[targetProfiloUpper] || [];

                if (configCampi.length === 0) {
                    console.warn(`⚠️ Configurazione [${targetProfiloUpper}] non trovata.`);
                    container.innerHTML = "";
                } else {
                    const idCPulito = idContatto.toString().toLowerCase().trim();
                    const membri = Array.isArray(window.shopCatalog.famiglia) ? window.shopCatalog.famiglia : (window.shopCatalog.famiglia?.data || []);
                    const mBase = membri.find(f => f.IDContatto.toString() === idContatto.toString());

                    // Merge Dati (Anagrafica + Tecnici + Kit + Privacy)
                    const fullMemberData = {
                        ...mBase,
                        ...(window.globalData.atleti[idCPulito] || {}),
                        ...(window.globalData.taglieKit[idCPulito] || {}),
                        ...(window.globalData.privacyData[idCPulito] || {})
                    };

                    // Gestione Override Squadre (Articolo:Lista_Squadre)
                    const overrides = {};
                    configCampi.forEach(conf => {
                        if (typeof conf.opzioni === "string" && conf.opzioni.startsWith("Articolo:")) {
                            const colonnaArt = conf.opzioni.split(":")[1];
                            const valoreGrezzo = art[colonnaArt] || art[colonnaArt.replace(/_/g, " ")] || "";
                            if (valoreGrezzo) {
                                overrides[conf.id] = valoreGrezzo.split(',').map(s => s.trim()).filter(Boolean);
                            }
                        }
                    });

                    console.log(`📤 Rendering form [${targetProfiloUpper}] per ${mBase.Nome}`);
                    window.renderAnagraficaForm(fullMemberData, configCampi, true, containerId, overrides);
                }
            }

        } catch (e) {
            console.error("❌ Errore nel caricamento del form membro:", e);
        }
    } else {
        container.innerHTML = "";
    }

    // Gestione stato tasto "AGGIUNGI"
    const selezionati = document.querySelectorAll('.conf-membro-check:checked').length;
    const btnAdd = document.getElementById('btn-add-to-cart');
    if (btnAdd) btnAdd.disabled = (selezionati === 0);
};

/**
 * 6. LOGICA PREZZI E CARRELLO
 */
window.calculateLivePrice = function (art) {
    const basePrice = parseFloat(art ? (art.Prezzo_Default || 0) : 0);
    const listinoNome = (art && art.Nome_Quota) ? art.Nome_Quota.toString().trim() : "";
    if (listinoNome === "") return { price: basePrice, label: "Quota Base", isValid: basePrice > 0 };

    const oggi = new Date();
    const oggiInt = (oggi.getFullYear() * 10000) + ((oggi.getMonth() + 1) * 100) + oggi.getDate();
    const tariffe = (window.shopCatalog.tariffe || []).filter(t => t.Nome_Tariffa?.toUpperCase() === listinoNome.toUpperCase());
    const valid = tariffe.find(t => {
        const d = new Date(t.Valido_Dal); const a = new Date(t.Valido_Al);
        const di = (d.getFullYear() * 10000) + ((d.getMonth() + 1) * 100) + d.getDate();
        const ai = (a.getFullYear() * 10000) + ((a.getMonth() + 1) * 100) + a.getDate();
        return oggiInt >= di && oggiInt <= ai;
    });
    return valid ? { price: parseFloat(valid.Prezzo), label: "Tariffa Attiva", isValid: true } : { price: 0, label: "CHIUSO", isValid: false };
};

/**
 * 2. IL MOTORE DEGLI SCONTI (RECALCULATE CART)
 * Copiato e adattato dall'originale per gestire Fratelli e Soglie
 */
window.recalculateCart = function () {
    if (!window.cart || window.cart.length === 0) {
        window.appliedCouponCode = "";
        window.renderCartUI(); // Pulisce la UI
        return;
    }

    // 1. Reset prezzi base dagli articoli del catalogo
    window.cart.forEach(item => {
        const artInfo = window.shopCatalog.articoli.find(a => a.ID_Articolo === item.idArticolo);
        if (artInfo) {
            const priceData = window.calculateLivePrice(artInfo);
            item.prezzoBase = priceData.price;
        }
        item.finalPrice = parseFloat(item.prezzoBase || 0);
        item.scontiDettaglio = [];
    });

    // 2. Applicazione Regole Sconto (Setaccio)
    const regole = (window.shopCatalog.sconti || [])
        .filter(r => r.Attivo === true)
        .sort((a, b) => (parseInt(a.Priorita) || 10) - (parseInt(b.Priorita) || 10));

    regole.forEach(regola => {
        // Controllo Coupon
        const codeReq = (regola.Codice_Coupon || "").toString().trim().toUpperCase();
        if (codeReq !== "" && codeReq !== (window.appliedCouponCode || "").toUpperCase()) return;

        // Filtro categorie merceologiche dello sconto
        const fCat = (regola.Filtro_Cat_Merciol || "").toString().split(',').map(s => s.trim());

        const righePapabili = window.cart.filter(item => {
            if (fCat.length > 0 && fCat[0] !== "" && !fCat.includes(item.idCategoria)) return false;
            // Altri filtri (es. Ruolo)
            return true;
        });

        const soglia = parseInt(regola.Trigger_Soglia) || 1;
        if (righePapabili.length >= soglia) {
            // Applica lo sconto
            righePapabili.forEach(rigo => {
                const tipo = (regola.Tipo_Valore || "").toString().toUpperCase();
                const valoreSconto = parseFloat(regola.Valore) || 0;
                let calcolo = (tipo.includes("PERC") || tipo === "%") ? (rigo.finalPrice * (valoreSconto / 100)) : valoreSconto;

                rigo.finalPrice = Math.max(0, rigo.finalPrice - calcolo);
                rigo.scontiDettaglio.push({ nome: regola.Nome_Sconto, valore: calcolo });
            });
        }
    });

    window.renderCartUI();
};

/**
 * --- AGGIUNTA AL CARRELLO E AGGIORNAMENTO ANAGRAFICA ---
 * Raccoglie i dati dal modale, aggiorna lo Spreadsheet e salva l'articolo.
 */
window.addToCart = async function () {
    const art = window.currentArtForConf;
    if (!art) return;

    const checks = document.querySelectorAll('.conf-membro-check:checked');
    if (checks.length === 0) return alert("Seleziona almeno un componente della famiglia.");

    const loader = document.getElementById('loading-overlay');
    if (loader) {
        loader.style.setProperty('display', 'flex', 'important');
        loader.querySelector('h5').innerText = "Salvataggio anagrafica e aggiornamento carrello...";
    }

    try {
        const itemsToAdd = [];
        const membri = Array.isArray(window.shopCatalog.famiglia)
            ? window.shopCatalog.famiglia
            : (window.shopCatalog.famiglia?.data || []);

        for (const cb of checks) {
            const idC = cb.value;
            const containerMembro = document.getElementById(`personal-data-container-${idC}`);
            if (!containerMembro) continue;

            const memberRef = membri.find(f => f.IDContatto.toString() === idC.toString());

            // --- RACCOLTA DATI DAL FORM DEL MODALE ---
            const fields = containerMembro.querySelectorAll('.val-field');
            const updatePayload = {
                idContatto: idC,
                ID_Famiglia: window.globalData.idFamiglia
            };
            const metaData = {};

            let isValid = true;
            fields.forEach(f => {
                const fieldId = f.getAttribute('data-id');
                if (!fieldId) return;

                // Gestione specifica per checkbox/switch
                const val = (f.type === 'checkbox') ? f.checked : f.value.trim();

                // Validazione obbligatorietà
                if (f.hasAttribute('required') && (val === "" || val === false)) {
                    f.classList.add('is-invalid');
                    isValid = false;
                } else {
                    f.classList.remove('is-invalid');
                }

                updatePayload[fieldId] = val;
                metaData[fieldId] = val;
            });

            if (!isValid) {
                if (loader) loader.style.display = 'none';
                alert(`⚠️ Compila tutti i campi obbligatori per ${memberRef ? memberRef.Nome : 'il socio'}.`);
                return;
            }

            // A. SALVATAGGIO IN ANAGRAFICA (GAS) - Chiamata bloccante
            console.log(`📤 Salvataggio dati tecnici per ${idC}...`, updatePayload);
            const saveRes = await callGAS("salvaDatiMembro", { payload: updatePayload });
            if (!saveRes.success) console.warn("Salvataggio anagrafica parziale o fallito lato server.");

            // B. AGGIORNA MEMORIA LOCALE (per coerenza dashboard)
            if (memberRef) {
                Object.assign(memberRef, updatePayload);
                const idCLow = idC.toLowerCase();
                if (window.globalData.atleti[idCLow]) Object.assign(window.globalData.atleti[idCLow], updatePayload);
                if (window.globalData.taglieKit[idCLow]) Object.assign(window.globalData.taglieKit[idCLow], updatePayload);
                if (window.globalData.privacyData[idCLow]) Object.assign(window.globalData.privacyData[idCLow], updatePayload);
            }

            // C. PREPARA ITEM PER CARRELLO
            itemsToAdd.push({
                email: window.globalData.userEmail,
                idContatto: idC,
                nomeMembro: memberRef ? `${memberRef.Nome} ${memberRef.Cognome}` : "Socio",
                idArticolo: art.ID_Articolo,
                idCategoria: art.ID_Categoria,
                // --- FIX: Salviamo il Titolo ---
                nomeArticolo: art.Titolo_Articolo || art.Nome_Articolo,
                prezzoBase: window.calculateLivePrice(art).price,
                metadati: metaData,
                addedAt: Date.now()
            });
        }

        // 3. SALVATAGGIO NEL CARRELLO PERSISTENTE (GAS)
        await Promise.all(itemsToAdd.map(item => callGAS("addToCartPersist", item)));

        // 4. AGGIORNAMENTO UI
        itemsToAdd.forEach(i => window.cart.push({ ...i, finalPrice: i.prezzoBase, scontiDettaglio: [] }));
        window.recalculateCart();
        window.renderCartUI();

        // Chiusura modale
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalConfiguratore'));
        if (modal) modal.hide();

        alert("✅ Dati salvati e articolo aggiunto al carrello!");

    } catch (e) {
        console.error("❌ Errore critico in addToCart:", e);
        alert("Si è verificato un errore: " + e.message);
    } finally {
        if (loader) loader.style.display = 'none';
    }
};

/**
 * --- NAVIGAZIONE ---
 */
window.closeShop = () => {
    // Pulizia sessione (opzionale) e ritorno alla home
    window.location.href = "index.html";
};

// Se hai un pulsante di checkout, aggiungi anche questo:
window.checkout = async function () {
    if (window.cart.length === 0) return;

    // Recupero dati detrazione se attiva
    const infoOrdine = {
        detrazioneAttiva: window.isDetrazioneActive,
        nomeGenitore: "",
        cfGenitore: window.fiscalCF || "",
        emailGenitore: window.fiscalEmail || ""
    };

    if (window.isDetrazioneActive) {
        const sel = document.getElementById('f_genitore_detrazione');
        if (!sel || !sel.value) return alert("Seleziona a chi intestare la ricevuta per la detrazione.");
        infoOrdine.nomeGenitore = sel.options[sel.selectedIndex].text;
    }

    if (!confirm("Confermi l'invio dell'ordine? Verrai contattato dalla segreteria per il pagamento.")) return;

    const loader = document.getElementById('loading-overlay');
    if (loader) loader.style.setProperty('display', 'flex', 'important');

    try {
        // Chiamata al ponte GAS per processare l'ordine finale
        const res = await callGAS("processaOrdineCompleto", {
            carrello: window.cart,
            infoOrdine: infoOrdine
        });

        if (res.success) {
            alert("🎉 Ordine registrato con successo! Numero Ordine: " + res.numOrdine);
            window.cart = [];
            window.location.href = "index.html";
        } else {
            throw new Error(res.error);
        }
    } catch (e) {
        alert("Errore durante il checkout: " + e.message);
    } finally {
        if (loader) loader.style.setProperty('display', 'none', 'important');
    }
};
