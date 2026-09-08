import { auth, db } from "./firebase-config.js"; // Aggiunto db
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, doc, getDoc } from "firebase/firestore"; // Aggiunti questi
import { callGAS, formatEuro, getThumbnailUrl } from "./utils.js";
import { renderAnagraficaForm } from "./anagrafica.js";
import { listenToCart, addToFirestoreCart, removeFromFirestoreCart } from "./cart-service.js";
import { initPaypalCheckout, processBankTransferCheckout } from "./checkout-service.js";
import { checkSandboxMode } from "./paypal-config.js";

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
// Flag per evitare doppie inizializzazioni PayPal in questa pagina
let shopPaypalRendered = false;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const raw = sessionStorage.getItem('myoval_shared_data');
        if (!raw) { window.location.href = "index.html"; return; }
        window.globalData = JSON.parse(raw);

        const emailLabel = document.getElementById('user-email-display-shop');
        if (emailLabel) emailLabel.innerText = window.globalData.userEmail;

        await inizializzaShop();

        checkSandboxMode();
    } else {
        window.location.href = "index.html";
    }
});

async function inizializzaShop() {
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.style.setProperty('display', 'flex', 'important');

    try {
        console.log("🔥 Caricamento catalogo da Firestore...");

        // 1. Caricamento parallelo collezioni catalogo (Firestore)
        const [catSnap, artSnap, tarSnap, scoSnap] = await Promise.all([
            getDocs(collection(db, "shop_categories")),
            getDocs(collection(db, "shop_items")),
            getDocs(collection(db, "shop_rates")),
            getDocs(collection(db, "shop_discounts"))
        ]);

        // 2. ARRICCHIMENTO DATI FAMIGLIA (Unione con dati Tecnici/Atleti)
        // Usiamo window.globalData che è già stato popolato in onAuthStateChanged
        const membriRaw = Array.isArray(window.globalData.famiglia?.data)
            ? window.globalData.famiglia.data
            : (window.globalData.famiglia || []);

        const membriArricchiti = membriRaw.map(m => {
            const idRaw = (m.IDContatto || m.ID_Contatto || m.idcontatto || "").toString().toLowerCase().trim();
            const datiTecnici = window.globalData.atleti[idRaw] || {};
            return { ...m, ...datiTecnici };
        });

        // 3. CREAZIONE CATALOGO GLOBALE
        const articoli = artSnap.docs.map(d => ({ ID_Articolo: d.id, ...d.data() }));

        window.shopCatalog = {
            success: true,
            categorie: catSnap.docs.map(d => ({ ID_Categoria: d.id, ...d.data() })),
            articoli: articoli,
            tariffe: tarSnap.docs.map(d => ({ ID_Tariffa: d.id, ...d.data() })),
            sconti: scoSnap.docs.map(d => ({ ID_Sconto: d.id, ...d.data() })),
            famiglia: membriArricchiti
        };

        // 4. INTEGRAZIONE CARRELLO FIRESTORE (Real-time)
        // Sostituiamo callGAS("getUserCart") con il listener di Firestore
        const idFamiglia = window.globalData.idFamiglia || window.globalData.famiglia?.ID_Famiglia;

        console.log("📡 Avvio ascolto carrello Firestore per famiglia:", idFamiglia);

        listenToCart(idFamiglia, (firestoreItems) => {
            console.log("🛒 Aggiornamento carrello ricevuto da Firestore:", firestoreItems);

            // Mappiamo i dati di Firestore nel formato atteso dalle funzioni di Shop.js
            window.cart = (firestoreItems || []).map(item => {
                const artInfo = window.shopCatalog.articoli.find(a => a.ID_Articolo === item.skuId);

                return {
                    idUnivoco: item.idUnivoco, // Necessario per la rimozione
                    tipo: item.tipo || "ISCRIZIONE",
                    idContatto: item.idContatto,
                    nomeMembro: item.nomeMembro,
                    idArticolo: item.skuId,
                    nomeArticolo: item.nomeArticolo || (artInfo ? (artInfo.Titolo_Articolo || artInfo.Nome_Articolo) : "Articolo"),
                    idCategoria: item.idCategoria || (artInfo ? artInfo.ID_Categoria : ""),
                    metadati: item.metadati || {},
                    addedAt: item.dataAggiunta || Date.now(),
                    quantita: item.quantita || 1,
                    // Prezzi temporanei, verranno sovrascritti da recalculateCart()
                    prezzoBase: item.prezzoUnitario || 0,
                    finalPrice: item.totaleRiga || 0,
                    scontiDettaglio: []
                };
            });

            // 5. RICALCOLO SCONTI E RE-RENDERING UI
            // Ogni volta che Firestore cambia, ricalcoliamo gli sconti (fratelli, etc) e ridisegnamo il carrello
            window.recalculateCart();
        });

        // 6. RENDERING CATALOGO (Home dello shop)
        // Questo viene eseguito una sola volta all'avvio dopo il caricamento del catalogo
        window.renderShopHome();

    } catch (e) {
        console.error("❌ Errore critico inizializzazione Shop:", e);
        if (typeof mostraErroreBloccante === "function") {
            mostraErroreBloccante("Impossibile caricare il catalogo.");
        }
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

    // 1. Filtriamo solo le ISCRIZIONI
    const itemsIscrizioni = (window.cart || []).filter(item => item.tipo === "ISCRIZIONE");

    // RESET DEL FLAG: Ogni volta che ridisegnamo la UI, i vecchi bottoni spariscono
    shopPaypalRendered = false;

    if (itemsIscrizioni.length === 0) {
        container.style.setProperty('display', 'none', 'important');
        if (divider) divider.classList.add('d-none');
        if (countEl) countEl.innerText = "0";
        return;
    }

    // ... (Logica calcolo totale e adulti invariata) ...
    const total = itemsIscrizioni.reduce((s, i) => s + (parseFloat(i.finalPrice) || 0), 0);
    const membri = Array.isArray(window.shopCatalog.famiglia) ? window.shopCatalog.famiglia : (window.shopCatalog.famiglia?.data || []);
    const adulti = membri.filter(m => {
        const r = (m.Ruolo || "").toUpperCase();
        return r.includes("GENITORE") || r.includes("SOCIO") || r.includes("CONSIGLIERE");
    });

    // ... (Generazione htmlRows invariata) ...
    const htmlRows = itemsIscrizioni.map((item) => {
        const searchId = item.skuId || item.idArticolo;
        const artInfo = window.shopCatalog.articoli.find(a => a.ID_Articolo === searchId);
        const testoPrincipaleBold = artInfo?.Descrizione || item.nomeArticolo;
        const sottotitoloItalic = artInfo ? (artInfo.Titolo_Articolo || artInfo.Nome_Articolo) : "";
        const sctHtml = (item.scontiDettaglio || []).map(s => `<div class="text-success fw-bold text-nowrap" style="font-size: 9px;"><i class="fas fa-tag"></i> -${formatEuro(s.valore)}</div>`).join('');

        return `
        <tr style="border-bottom: 1px solid #f0f0f0;">
            <td class="ps-3 py-2" style="width: 45%;">
                <div class="fw-bold text-dark" style="font-size:13px; line-height: 1.1;">${testoPrincipaleBold}</div>
                ${sottotitoloItalic ? `<div class="text-muted mb-1" style="font-size: 9px; font-style: italic;">${sottotitoloItalic}</div>` : ''}
                <div style="font-size:10px;">Per: <span class="text-danger fw-bold">${item.nomeMembro}</span></div>
            </td>
            <td class="text-center text-muted d-none d-md-table-cell">${formatEuro(item.prezzoBase)}</td>
            <td class="text-center py-2">${sctHtml || '-'}</td>
            <td class="text-end py-2 pe-3"><div class="fw-bold text-dark">${formatEuro(item.finalPrice)}</div></td>
            <td class="text-center">
                <button class="btn btn-sm btn-link text-danger p-0" onclick="window.removeAndRefresh('${item.idUnivoco}')"><i class="fas fa-times-circle"></i></button>
            </td>
        </tr>`;
    }).join('');

    // 2. INIEZIONE HTML (Questo distrugge i vecchi bottoni PayPal)
    container.innerHTML = `
    <div class="card shadow-sm mb-3" style="border-radius: 12px; overflow: hidden; border: 1px solid #ddd;">
      <div class="p-2 bg-dark text-white d-flex justify-content-between align-items-center">
        <h6 class="mb-0 fw-bold small ms-2"><i class="fas fa-shopping-cart me-2 text-danger"></i>RIEPILOGO ISCRIZIONE</h6>
        <span class="badge bg-danger rounded-pill me-2" style="font-size:10px;">${itemsIscrizioni.length} Articoli</span>
      </div>
      <div class="table-responsive bg-white">
        <table class="table table-hover align-middle mb-0" style="table-layout: fixed; width: 100%;">
          <thead>
            <tr style="font-size: 9px; text-transform: uppercase; color: #999;">
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
      ${renderCartFooter(total, adulti)} 
    </div>`;

    container.classList.remove('d-none');
    container.style.display = 'block';
    if (divider) divider.classList.remove('d-none');
    if (countEl) countEl.innerText = itemsIscrizioni.length;

    // 3. RE-INIZIALIZZAZIONE PAYPAL
    // Chiamiamo il servizio solo se abbiamo articoli e non lo abbiamo appena fatto
    if (!shopPaypalRendered && itemsIscrizioni.length > 0) {
        shopPaypalRendered = true; // Lo blocchiamo subito
        const idFam = window.globalData.idFamiglia || window.globalData.famiglia?.ID_Famiglia;

        // Timeout minimo per essere sicuri che il div sia nel DOM
        setTimeout(() => {
            initPaypalCheckout(
                'paypal-button-container-shop',
                itemsIscrizioni,
                idFam,
                auth.currentUser.email,
                (details) => {
                    alert("Iscrizioni completate con successo! 🎉");
                    window.location.href = "index.html";
                }
            );
        }, 100);
    }
};

// Funzione di supporto per pulire il codice del footer
function renderCartFooter(total, adulti) {
    return `
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
                <input class="form-check-input" type="checkbox" id="f_detrazione_attiva" onchange="window.toggleDetrazioneUI(this.checked)" ${window.isDetrazioneActive ? 'checked' : ''} style="transform: scale(0.85); margin-right: 10px;">
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
            <small class="text-muted text-uppercase fw-bold d-block" style="font-size:9px; line-height: 1;">Totale iscrizioni:</small>
            <div class="h4 fw-bold text-danger mb-0">${formatEuro(total)}</div>
        </div>
        
        <div class="d-flex flex-column" style="width: 220px;">
            <!-- PULSANTE BONIFICO -->
            <button class="btn btn-bonifico mb-2" onclick="window.handleBonifico()">
                <i class="fas fa-university"></i> PAGA CON BONIFICO
            </button>
            
            <!-- CONTENITORE PAYPAL -->
            <div id="paypal-button-container-shop"></div>
        </div>
      </div>`;
}

window.updateCartUI = function () {
    // 1. Filtriamo il carrello globale per ottenere solo le Iscrizioni
    const itemsIscrizioni = (window.cart || []).filter(item => item.tipo === "ISCRIZIONE");

    // 2. Calcolo del totale (basato sui prezzi ricalcolati)
    const total = itemsIscrizioni.reduce((s, i) => s + (parseFloat(i.finalPrice) || 0), 0);

    // 3. Aggiorna il badge numerico del carrello (quello in alto a destra nell'icona)
    const countEl = document.getElementById('cart-count');
    if (countEl) {
        countEl.innerText = itemsIscrizioni.length;
    }

    // 4. Se la funzione di rendering della tabella esiste, la chiamiamo
    // per aggiornare la visualizzazione del carrello integrato
    if (typeof window.renderCartUI === "function") {
        window.renderCartUI();
    }

    console.log(`📊 UI Shop aggiornata: ${itemsIscrizioni.length} iscrizioni nel modulo.`);
};

window.openShopCategory = function (idCat) {
    if (!window.shopCatalog) return;

    // 1. TROVA LA CATEGORIA E IL SUO TIPO (es. TESSERAMENTO)
    const cat = window.shopCatalog.categorie.find(c => c.ID_Categoria === idCat);
    if (!cat) return;

    const tipoDellaCategoria = (cat.Tipo_Articolo || "").toUpperCase().trim();

    // 2. GESTIONE BREADCRUMB
    document.getElementById('shop-breadcrumb')?.classList.remove('d-none');
    const labelHome = document.getElementById('breadcrumb-label-home');
    if (labelHome) labelHome.innerText = "Torna al Catalogo";
    const labelCurrent = document.getElementById('breadcrumb-current');
    if (labelCurrent) labelCurrent.innerText = cat.Nome_Categoria;

    // 3. RECUPERO, ARRICCHIMENTO E DE-DUPLICAZIONE MEMBRI (FIX CRITICO)
    const membriRaw = Array.isArray(window.shopCatalog.famiglia)
        ? window.shopCatalog.famiglia
        : (window.shopCatalog.famiglia?.data || []);

    // Usiamo una mappa per assicurarci di avere un solo oggetto per ogni IDContatto
    const mappaMembriUnici = new Map();

    membriRaw.forEach(m => {
        const idRaw = m.IDContatto || m.ID_Contatto || m.idcontatto || m.id_contatto || "";
        const idKey = idRaw.toString().trim();

        if (!idKey || mappaMembriUnici.has(idKey)) return;

        // Recuperiamo i dati tecnici (Tipo: RINNOVO) usando l'ID minuscolo come chiave
        const datiTecnici = window.globalData.atleti[idKey.toLowerCase()] || {};

        // Creiamo l'oggetto arricchito
        const membroArricchito = { ...m, ...datiTecnici };
        mappaMembriUnici.set(idKey, membroArricchito);
    });

    const membriArricchiti = Array.from(mappaMembriUnici.values());
    console.log(`👨‍👩‍👧‍👦 Membri unici analizzati per idoneità: ${membriArricchiti.length}`);

    // 4. FILTRO ARTICOLI IDONEI
    const articoliIdonei = (window.shopCatalog.articoli || []).filter(a => {
        if (a.ID_Categoria !== idCat) return false;

        // Iniezione tipo categoria nell'articolo per attivare i filtri NUOVO/RINNOVO
        a.Tipo_Articolo = tipoDellaCategoria;

        // L'articolo è idoneo se ALMENO un membro della famiglia passa la checkEligibility
        return membriArricchiti.some(m => window.checkEligibility(a, m));
    });

    // 5. GENERAZIONE HTML
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
        html += '<div class="col-12 text-center p-5 text-muted">Nessun articolo disponibile per i componenti della tua famiglia.</div>';
    } else {
        articoliIdonei.forEach(art => {
            const lp = window.calculateLivePrice(art);
            const pDisp = lp.isValid ? formatEuro(lp.price) : `<span class="text-muted small">NON DISPONIBILE</span>`;

            const daAnni = parseInt(art.Da_Anni);
            const aAnni = parseInt(art.A_Anni);
            let natiString = "Aperto a tutti";
            if (!isNaN(daAnni) || !isNaN(aAnni)) {
                const min = Math.min(daAnni || 1900, aAnni || 1900);
                const max = Math.max(daAnni || 2100, aAnni || 2100);
                natiString = `Nati dal ${min} al ${max}`;
            }

            html += `
            <div class="col-12">
                <div class="card product-row-card shadow-sm" style="${!lp.isValid ? 'opacity:0.6' : ''}">
                    <div class="row align-items-center g-2">
                        <div class="col-7 ps-2">
                            <!-- MODIFICATO: Priorità alla Descrizione, poi Titolo, poi Nome -->
                            <h6 class="fw-bold mb-0" style="font-size:1rem; color:#1a2b3c;">
                                ${art.Descrizione || art.Titolo_Articolo || art.Nome_Articolo}
                            </h6>
                            <div class="nati-info" style="font-size: 0.75rem; color: #6c757d;">
                                <i class="far fa-calendar-alt me-1"></i> ${natiString}
                            </div>
                        </div>
                        <div class="col-3 text-end">
                            <div class="fw-bold text-danger" style="font-size:1.2rem; font-family: 'Roboto Mono', monospace;">
                                ${pDisp}
                            </div>
                            ${lp.isValid && lp.label !== "Quota Base" ?
                    `<small class="text-success fw-bold d-block" style="font-size:8px; line-height:1;">${lp.label}</small>` : ''}
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


window.removeAndRefresh = async function (idUnivoco) {
    // 1. Chiedi conferma all'utente
    if (!idUnivoco || !confirm("Sei sicuro di voler rimuovere questo articolo?")) return;

    // 2. Recupera l'ID Famiglia
    const idFam = window.globalData.idFamiglia || window.globalData.famiglia?.ID_Famiglia;

    if (!idFam) {
        console.error("❌ ID Famiglia non trovato in window.globalData");
        alert("Errore: sessione scaduta, ricarica la pagina.");
        return;
    }

    try {
        console.log("🗑️ Rimozione articolo da Firestore:", idUnivoco);

        // 3. Chiama il servizio Firestore (rimuove l'oggetto dall'array items)
        await removeFromFirestoreCart(idFam, idUnivoco);

        // NOTA: Non serve chiamare window.recalculateCart() o renderCartUI() manualmente.
        // Poiché in inizializzaShop abbiamo attivato listenToCart, Firestore
        // avviserà l'app del cambiamento e la UI si aggiornerà da sola in tempo reale.

    } catch (e) {
        console.error("❌ Errore durante la rimozione:", e);
        alert("Impossibile rimuovere l'articolo: " + e.message);
    }
};

/**
 * 1. MOTORE DI IDONEITÀ
 */
window.checkEligibility = function (art, atleta) {
    if (!art || !atleta) return false;

    // 1. FILTRO PUBBLICAZIONE
    // Gestisce sia il booleano nativo di Firestore che la stringa "TRUE"
    const isPubblicato = art.Pubblicato === true || art.Pubblicato === "TRUE";
    if (!isPubblicato) return false;

    // 2. FILTRO SESSO (Rigido)
    // Se l'articolo specifica M o F, l'atleta deve corrispondere. Se vuoto, è per tutti.
    const sessoRichiesto = (art.Sesso || "").toString().trim().toUpperCase();
    const sessoAtleta = (atleta.Sesso || "").toString().trim().toUpperCase();
    if (sessoRichiesto !== "" && sessoAtleta !== "" && sessoAtleta !== sessoRichiesto) {
        return false;
    }

    // 3. FILTRO ANNO DI NASCITA
    // Estrae l'anno a 4 cifre da qualsiasi formato di data (DD/MM/YYYY o YYYY-MM-DD)
    const dnRaw = (atleta.Data_Nascita || "").toString();
    const matchAnno = dnRaw.match(/\d{4}/);
    const annoAtleta = matchAnno ? parseInt(matchAnno[0]) : 0;

    const daAnni = parseInt(art.Da_Anni);
    const aAnni = parseInt(art.A_Anni);

    if (!isNaN(daAnni) || !isNaN(aAnni)) {
        const min = Math.min(daAnni || 1900, aAnni || 1900);
        const max = Math.max(daAnni || 2100, aAnni || 2100);

        if (annoAtleta > 0 && (annoAtleta < min || annoAtleta > max)) {
            return false; // Fuori fascia d'età
        }
    }

    // 4. FILTRO TESSERAMENTO (NUOVO / RINNOVO)
    // Il campo Tipo_Articolo viene iniettato dalla categoria in openShopCategory
    const tipoArticoloPadre = (art.Tipo_Articolo || "").toString().toUpperCase().trim();

    if (tipoArticoloPadre === 'TESSERAMENTO') {

        // Recuperiamo il profilo dell'atleta (Dall'anagrafica tecnica)
        // Usiamo "Tipo" (visto nei log) o "Tipo_Tecnico" come fallback
        const profiloAtleta = (atleta.Tipo || atleta.Tipo_Tecnico || "NUOVO").toString().toUpperCase().trim();

        // Recuperiamo il requisito dell'articolo (Da Firestore shop_items)
        const tipoRichiestoDallArticolo = (art.Tipo_Tesseramento || "NUOVO").toString().toUpperCase().trim();

        // LOG DI CONTROLLO (Solo per Tesseramento)
        console.log(`🔍 Verifica Tesseramento [${atleta.Nome}]: Profilo(${profiloAtleta}) vs Articolo(${tipoRichiestoDallArticolo})`);

        if (profiloAtleta !== tipoRichiestoDallArticolo) {
            return false; // Mismatch tra Nuovo/Rinnovo
        }
    }

    // Se è arrivato qui, l'atleta è idoneo
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

    // --- FIX 1: INIEZIONE TIPO CATEGORIA ---
    // Recuperiamo il tipo dalla categoria padre per attivare i filtri tecnici (TESSERAMENTO)
    const catPadre = window.shopCatalog.categorie.find(c => c.ID_Categoria === art.ID_Categoria);
    art.Tipo_Articolo = (catPadre?.Tipo_Articolo || "").toUpperCase().trim();

    // Visualizzazione Titolo
    const titleEl = document.getElementById('conf-titolo-articolo');
    if (titleEl) {
        const nomeDaMostrare = art.Descrizione || art.Titolo_Articolo || art.Nome_Articolo;
        titleEl.innerText = nomeDaMostrare.toUpperCase();
    }

    // Visualizzazione Prezzo
    const priceEl = document.getElementById('conf-display-prezzo');
    if (priceEl) priceEl.innerText = formatEuro(window.calculateLivePrice(art).price);

    const containerMembri = document.getElementById('conf-membri-list');
    if (containerMembri) {
        // --- FIX 2: RECUPERO, DE-DUPLICAZIONE E ARRICCHIMENTO ---
        const membriRaw = Array.isArray(window.shopCatalog.famiglia)
            ? window.shopCatalog.famiglia
            : (window.shopCatalog.famiglia?.data || []);

        const mappaMembriUnici = new Map();

        membriRaw.forEach(m => {
            const idRaw = m.IDContatto || m.ID_Contatto || m.idcontatto || m.id_contatto || "";
            const idKey = idRaw.toString().trim();

            if (!idKey || mappaMembriUnici.has(idKey)) return;

            // Agganciamo i dati tecnici (Tipo: RINNOVO)
            const datiTecnici = window.globalData.atleti[idKey.toLowerCase()] || {};
            mappaMembriUnici.set(idKey, { ...m, ...datiTecnici });
        });

        // --- FIX 3: FILTRO IDONEITÀ ---
        // Ora Federico (che è RINNOVO) passerà la checkEligibility per l'articolo RINNOVO
        const membriIdonei = Array.from(mappaMembriUnici.values())
            .filter(m => window.checkEligibility(art, m));

        if (membriIdonei.length === 0) {
            containerMembri.innerHTML = `<div class="text-muted small p-3 text-center">Nessun membro della famiglia è idoneo per questo articolo.</div>`;
        } else {
            containerMembri.innerHTML = membriIdonei.map(m => `
                <div class="member-card-wrapper">
                    <div class="d-flex align-items-center m-0">
                        <input class="form-check-input conf-membro-check" 
                               type="checkbox" 
                               value="${m.IDContatto || m.id_contatto}" 
                               id="m_${m.IDContatto || m.id_contatto}"
                               onchange="window.handleMemberToggle(this, '${m.IDContatto || m.id_contatto}')"
                               style="margin-left:0;">
                        <label class="fw-bold text-dark mb-0 ms-2" for="m_${m.IDContatto || m.id_contatto}" style="font-size: 0.85rem; cursor:pointer;">
                            ${m.Nome} ${m.Cognome}
                        </label>
                    </div>
                    <div id="personal-data-container-${m.IDContatto || m.id_contatto}" class="mt-2"></div>
                </div>`).join('');
        }
    }

    // Abilitazione bottone AGGIUNGI (inizialmente disattivato)
    const btnAdd = document.getElementById('btn-add-to-cart');
    if (btnAdd) btnAdd.disabled = true;

    // Apertura Modale
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
            if (!art) throw new Error("Nessun articolo selezionato.");

            // 1. Funzione di recupero valori dall'articolo (Tollerante)
            const getArtVal = (target) => {
                const cleanT = target.toLowerCase().replace(/[\s_]/g, "");
                const key = Object.keys(art).find(k => k.toLowerCase().replace(/[\s_]/g, "") === cleanT);
                return key ? art[key] : null;
            };

            // 2. Determiniamo Gruppo e Profilo dall'articolo
            const targetGruppo = (getArtVal("UI_Gruppo") || "ASSOCIATO").toUpperCase();
            const targetProfilo = (getArtVal("UI_Profilo") || "ASSOCIATO").toUpperCase();

            console.log(`🛠️ Shop: Caricamento Profilo [${targetGruppo} - ${targetProfilo}] per socio ${idContatto}`);

            const configCampi = window.globalData.config[targetProfilo] || [];

            // --- 3. LOGICA DI OVERRIDE MANUALE (SICURA) ---
            // Invece di aspettare che ui_config ci dica cosa fare, 
            // forziamo noi la lista squadre se l'articolo la possiede.
            const overrides = {};
            const squadreDallArticolo = getArtVal("Lista_Squadre");

            if (squadreDallArticolo) {
                // Creiamo l'array delle opzioni (es: ["Under 18", "Cadetti"])
                // Lo assegniamo sia a "Squadra" che a "Squadre" per coprire ogni ID possibile
                const listaArray = squadreDallArticolo.split(',').map(s => s.trim()).filter(Boolean);
                overrides["Squadra"] = listaArray;
                overrides["Squadre"] = listaArray;
                console.log("✅ Squadre forzate dall'articolo:", listaArray);
            }

            // --- 4. PREPARAZIONE DATI MEMBRO ---
            const idCPulito = idContatto.toString().toLowerCase().trim();
            const membri = Array.isArray(window.shopCatalog.famiglia) ? window.shopCatalog.famiglia : (window.shopCatalog.famiglia?.data || []);
            const mBase = membri.find(f => f.IDContatto.toString().toLowerCase().trim() === idCPulito);

            const fullMemberData = {
                ...mBase,
                ...(window.globalData.atleti[idCPulito] || {}),
                ...(window.globalData.taglieKit[idCPulito] || {}),
                ...(window.globalData.privacyData[idCPulito] || {})
            };

            // --- 5. RENDERING ---
            // Passiamo l'oggetto overrides che abbiamo costruito manualmente
            window.renderAnagraficaForm(fullMemberData, configCampi, true, containerId, overrides);

        } catch (e) {
            console.error("❌ Errore configuratore shop:", e);
            container.innerHTML = `<div class="text-danger small p-2">Errore caricamento: ${e.message}</div>`;
        }
    } else {
        container.innerHTML = "";
    }

    const btn = document.getElementById('btn-add-to-cart');
    if (btn) btn.disabled = (document.querySelectorAll('.conf-membro-check:checked').length === 0);
};

/**
 * 6. LOGICA PREZZI E CARRELLO
 */
window.calculateLivePrice = function (art) {
    const basePrice = parseFloat(art ? (art.Prezzo_Default || 0) : 0);
    const listinoNome = (art && art.Nome_Quota) ? art.Nome_Quota.toString().trim() : "";

    if (listinoNome === "") return { price: basePrice, label: "Quota Base", isValid: basePrice > 0 };

    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);

    const tariffe = (window.shopCatalog.tariffe || []).filter(t =>
        (t.Nome_Tariffa || t.Nome_Quota || "").toString().toUpperCase().trim() === listinoNome.toUpperCase()
    );

    const valid = tariffe.find(t => {
        // Firebase restituisce oggetti con metodo .toDate()
        const dal = t.Valido_Dal?.toDate ? t.Valido_Dal.toDate() : (t.Valido_Dal instanceof Date ? t.Valido_Dal : null);
        const al = t.Valido_Al?.toDate ? t.Valido_Al.toDate() : (t.Valido_Al instanceof Date ? t.Valido_Al : null);

        if (!dal || !al) return false;

        dal.setHours(0, 0, 0, 0);
        al.setHours(23, 59, 59, 999);

        return oggi >= dal && oggi <= al;
    });

    if (valid) {
        const prezzoFinale = parseFloat(valid.Prezzo || valid.Importo || 0);
        return { price: prezzoFinale, label: valid.Etichetta_Prezzo || "Tariffa Attiva", isValid: true };
    } else {
        return { price: 0, label: "CHIUSO", isValid: false };
    }
};

/**
 * 2. IL MOTORE DEGLI SCONTI (RECALCULATE CART)
 * Copiato e adattato dall'originale per gestire Fratelli e Soglie
 */
window.recalculateCart = function () {
    if (!window.cart || window.cart.length === 0) {
        window.appliedCouponCode = "";
        window.renderCartUI();
        return;
    }

    // --- FILTRIAMO SOLO LE ISCRIZIONI PER IL CALCOLO SCONTI ---
    const inscriptions = window.cart.filter(i => i.tipo === "ISCRIZIONE");

    // Reset prezzi solo per le iscrizioni
    inscriptions.forEach(item => {
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
        loader.querySelector('h5').innerText = "Sincronizzazione dati in corso...";
    }

    try {
        const idFam = window.globalData.idFamiglia || window.globalData.famiglia?.ID_Famiglia;
        const membri = window.shopCatalog.famiglia;

        for (const cb of checks) {
            const idC = cb.value;
            const containerMembro = document.getElementById(`personal-data-container-${idC}`);
            if (!containerMembro) continue;

            const memberRef = membri.find(f => (f.IDContatto || f.id_contatto || "").toString() === idC.toString());

            // --- 1. VALIDAZIONE E RACCOLTA DATI FORM ---
            const fields = containerMembro.querySelectorAll('.val-field');
            const updatePayload = {
                idContatto: idC,
                ID_Famiglia: idFam
            };
            const metaData = {};

            let isValid = true;
            fields.forEach(f => {
                const fieldId = f.getAttribute('data-id');
                if (!fieldId) return;
                const val = (f.type === 'checkbox') ? f.checked : f.value.trim();

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

            // --- 2. SALVATAGGIO ANAGRAFICA SU GOOGLE SHEETS (GAS) ---
            // Questo passaggio rimane perché aggiorna il database master anagrafico
            console.log(`📤 Sincronizzazione anagrafica GAS per ${idC}...`);
            await callGAS("salvaDatiMembro", { payload: updatePayload });

            // Aggiornamento memoria locale
            if (memberRef) {
                Object.assign(memberRef, updatePayload);
                const idCLow = idC.toLowerCase().trim();
                if (window.globalData.atleti[idCLow]) Object.assign(window.globalData.atleti[idCLow], updatePayload);
            }

            // --- 3. PREPARAZIONE E INVIO ARTICOLO A FIRESTORE ---
            const priceData = window.calculateLivePrice(art);

            const itemFirestore = {
                tipo: "ISCRIZIONE", // Identificatore per logiche differenziate
                idContatto: idC.toString(),
                nomeMembro: memberRef ? `${memberRef.Nome} ${memberRef.Cognome}` : "Socio",
                skuId: art.ID_Articolo.toString(),
                idCategoria: art.ID_Categoria,
                nomeArticolo: art.Titolo_Articolo || art.Nome_Articolo,
                prezzoUnitario: parseFloat(priceData.price),
                quantita: 1,
                totaleRiga: parseFloat(priceData.price),
                metadati: metaData, // Conserviamo taglie, squadre, etc.
                dataAggiunta: new Date().toISOString(),
                emailInserimento: auth.currentUser.email
            };

            console.log(`📤 Aggiunta ${itemFirestore.nomeArticolo} al carrello Firestore...`);
            await addToFirestoreCart(idFam, itemFirestore);
        }

        // --- 4. CHIUSURA E FEEDBACK ---
        // Nota: Non serve aggiornare window.cart o chiamare renderCartUI qui.
        // Il listener 'listenToCart' in inizializzaShop lo farà automaticamente 
        // non appena Firestore conferma la scrittura.

        const modal = bootstrap.Modal.getInstance(document.getElementById('modalConfiguratore'));
        if (modal) modal.hide();

        // Piccolo trucco: resettiamo il configuratore per il prossimo utilizzo
        document.querySelectorAll('.conf-membro-check').forEach(c => c.checked = false);

    } catch (e) {
        console.error("❌ Errore critico addToCart:", e);
        alert("Si è verificato un errore durante l'aggiunta al carrello: " + e.message);
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

window.handleBonifico = async () => {
    const itemsIscrizioni = (window.cart || []).filter(item => item.tipo === "ISCRIZIONE");
    const idFam = window.globalData.idFamiglia || window.globalData.famiglia?.ID_Famiglia;

    await processBankTransferCheckout(
        itemsIscrizioni,
        idFam,
        auth.currentUser.email,
        () => {
            alert("Ordine registrato! Effettua il bonifico e invia la ricevuta alla segreteria. 🎉");
            window.location.href = "index.html";
        }
    );
};
