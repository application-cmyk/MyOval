import { callGAS, formatEuro, getThumbnailUrl} from "./utils.js";

// INIZIALIZZAZIONE GLOBALE SICURA
window.cart = window.cart || []; 
window.couponFeedbackHTML = "";
window.shopCatalog = window.shopCatalog || null;

console.log("🛒 Caricamento Modulo Shop...");

/**
 * FUNZIONE GLOBALE AGGANCIATA AL TASTO HTML
 */
window.handleIscrizioniClick = async function() {
    console.log("🛒 Avvio procedura apertura Shop...");

    // 1. Identificazione elementi UI
    const loader = document.getElementById('loading-overlay');
    const shopView = document.getElementById('shop-view');
    const dashboardView = document.getElementById('dashboard-view');

    // 2. MOSTRA LO SPINNER IMMEDIATAMENTE (Forzato)
    if (loader) {
        loader.style.setProperty('display', 'flex', 'important');
        const loaderText = loader.querySelector('h5');
        if (loaderText) loaderText.innerText = "Sincronizzazione Catalogo...";
    }

    // 3. Validazione bolle famiglia
    const bubbles = document.querySelectorAll('.family-item[id^="f-"]');
    const allValid = Array.from(bubbles).every(b => b.classList.contains('is-valid-member'));

    if (bubbles.length === 0 || !allValid) {
        if (loader) loader.style.setProperty('display', 'none', 'important'); // Nascondi se fallisce validazione
        alert("📢 ATTENZIONE: Completa le anagrafiche (bolle verdi) prima di procedere.");
        return;
    }

    try {
        const params = {
            email: window.globalData.userEmail,
            idFamiglia: window.globalData.idFamiglia,
            membri: window.globalData.famiglia.data,
            atleti: window.globalData.atleti
        };

        // Chiamata al ponte GAS (che richiede qualche secondo)
        const res = await callGAS("getShopPortalDataWithCart", params);
        
        if (!res || !res.success) throw new Error(res ? res.error : "Errore catalogo");

        window.shopCatalog = res;
        
        // Mappatura carrello... (tieni la logica esistente)
        window.cart = (res.persistedCart || []).map(item => ({
            idContatto: (item.ID_Contatto || item.idContatto || "").toString(),
            nomeMembro: item.Nome_Membro || item.nomeMembro || "",
            idArticolo: (item.ID_Articolo || item.idArticolo || "").toString(),
            nomeArticolo: item.Nome_Articolo || item.nomeArticolo || "",
            idCategoria: (item.ID_Categoria || item.idCategoria || "").toString(),
            metadati: item.Metadati_JSON || {},
            addedAt: item.Data_Aggiunta || Date.now(),
            prezzoBase: 0, finalPrice: 0, scontiDettaglio: []
        }));

        // Cambio vista
        if (dashboardView) {
            dashboardView.classList.add('d-none');
            dashboardView.style.setProperty('display', 'none', 'important');
        }
        
        if (shopView) {
            shopView.classList.remove('d-none');
            shopView.style.setProperty('display', 'block', 'important');
        }

        // Avvio logica shop
        window.recalculateCart();
        window.renderShopHome();

    } catch (e) {
        console.error("❌ Errore Shop:", e);
        alert("Impossibile caricare lo shop: " + e.message);
    } finally {
        // 4. NASCONDI LO SPINNER ALLA FINE
        if (loader) {
            loader.style.setProperty('display', 'none', 'important');
        }
    }
};

/**
 * MOTORE DI IDONEITÀ (Eligibility Engine)
 * Determina se un atleta può visualizzare/acquistare un determinato articolo
 */
window.checkEligibility = function(art, atleta) {
    // 0. Protezione: se mancano i dati, non è idoneo
    if (!art || !atleta) return false;

    // 1. STATO PUBBLICAZIONE
    // Se l'articolo non è "Live", nessuno lo vede
    if (art.Pubblicato !== true && art.Pubblicato !== "TRUE") return false;

    // 2. FILTRO ANNO DI NASCITA (Il "Setaccio" per età)
    const dnRaw = (atleta.Data_Nascita || "").toString();
    const match = dnRaw.match(/\d{4}/); // Estrae l'anno (es: 2014)
    const annoAtleta = match ? parseInt(match[0]) : 0;
    
    if (art.Da_Anni || art.A_Anni) {
        const min = Math.min(parseInt(art.Da_Anni || 1900), parseInt(art.A_Anni || 1900));
        const max = Math.max(parseInt(art.Da_Anni || 2100), parseInt(art.A_Anni || 2100));
        
        if (annoAtleta > 0) {
            if (annoAtleta < min || annoAtleta > max) return false;
        }
    }

    // 3. FILTRO SESSO (M, F o Entrambi)
    const sessoRichiesto = (art.Sesso || "").toString().trim().toUpperCase();
    const sessoAtleta = (atleta.Sesso || "").toString().trim().toUpperCase();
    if (sessoRichiesto !== "" && sessoAtleta !== "" && sessoAtleta !== sessoRichiesto) {
        return false;
    }

    // 4. LOGICA SPECIFICA PER TESSERAMENTO RUGBY
    if (art.Tipo_Articolo === 'TESSERAMENTO') {
        // A. Deve avere il ruolo "Atleta" nel profilo
        const ruolo = (atleta.Ruolo || "").toLowerCase();
        if (!ruolo.includes("atleta")) return false;

        // B. Verifica Nuovo vs Rinnovo
        // Il campo Tipo_Tecnico arriva dal JOIN fatto nel ponte GAS
        const profiloTecnico = (atleta.Tipo_Tecnico || "NUOVO").toUpperCase();
        const tipoArticolo = (art.Tipo_Tesseramento || "NUOVO").toUpperCase();
        
        if (profiloTecnico !== tipoArticolo) return false;
    }

    return true; // Se passa tutti i filtri, l'atleta può vedere il prodotto
};

/**
 * RENDER DELLE CATEGORIE
 */
window.renderShopHome = function() {
    // 1. Nascondiamo il breadcrumb nella home dello shop
    const breadcrumb = document.getElementById('shop-breadcrumb');
    if (breadcrumb) breadcrumb.classList.add('d-none');

    const container = document.getElementById('shop-content-area');
    if (!container) return;
    
    // 2. Definizione delle sezioni macro
    const sezioni = [
      { id: 'TESSERAMENTO', label: 'Stagione Rugby' },
      { id: 'CAMP', label: 'Camp Estivi e Clinic' },
      { id: 'SERVIZIO', label: 'Servizi Aggiuntivi' },
      { id: 'ATTIVITA', label: 'Corsi ed altre Attività Sportive' }
    ];

    let html = '<div class="animate__animated animate__fadeIn">';

    sezioni.forEach(s => {
      // Filtriamo le categorie che appartengono a questa sezione e che hanno 
      // almeno un articolo per cui almeno un membro della famiglia è idoneo
      const catFiltrate = window.shopCatalog.categorie.filter(c => {
        const isCorrectType = (c.Tipo_Articolo === s.id);
        const hasEligibleArticles = window.shopCatalog.articoli.some(a => 
            a.ID_Categoria === c.ID_Categoria && 
            window.shopCatalog.famiglia.some(m => window.checkEligibility(a, m))
        );
        return isCorrectType && hasEligibleArticles;
      });

      if (catFiltrate.length > 0) {
        // Titolo della sezione (es: STAGIONE RUGBY)
        html += `<div class="rm-section-title mt-4 mb-3">${s.label}</div>`;
        html += `<div class="d-flex flex-wrap gap-4 px-2">`;

        catFiltrate.forEach(cat => {
          // --- LOGICA VERSIONE 3: MINIATURA DIRETTA ---
          // Trasformiamo l'URL/ID di Drive in un link immagine visualizzabile
          const thumbUrl = getThumbnailUrl(cat.Immagine_URL);

          html += `
            <div class="category-tile" onclick="window.openShopCategory('${cat.ID_Categoria}')" style="cursor:pointer; width:110px; text-align:center;">
              <div class="tile-img-box shadow-sm mb-2" style="width:110px; height:110px; border-radius:15px; background:#fff; border:1px solid #ddd; overflow:hidden; display:flex; align-items:center; justify-content:center;">
                 <img src="${thumbUrl}" 
                      style="width:100%; height:100%; object-fit:cover;" 
                      onerror="this.src='https://placehold.co/150x150?text=Rugby'"
                      alt="${cat.Nome_Categoria}">
              </div>
              <div class="tile-name fw-bold" style="font-size:10px; text-transform:uppercase; color:var(--brand-dark);">${cat.Nome_Categoria}</div>
            </div>`;
        });
        html += `</div>`;
      }
    });

    container.innerHTML = html + '</div>';
    console.log("✅ Home Shop renderizzata con successo.");
};

/**
 * FUNZIONI PLACEHOLDER (Per evitare crash al primo avvio)
 */
window.closeShop = function() {
    console.log("🏠 Chiusura Shop e ritorno alla Home");
    
    const shopView = document.getElementById('shop-view');
    const dashboardView = document.getElementById('dashboard-view');

    if (shopView) {
        shopView.classList.add('d-none');
        shopView.style.display = 'none';
    }

    if (dashboardView) {
        dashboardView.classList.remove('d-none');
        dashboardView.style.display = 'block';
    }

    // Forza lo scroll in alto per vedere le bolle
    window.scrollTo(0, 0);
};

/**
 * Calcola i prezzi finali e applica le regole di sconto (fratelli, coupon, ecc.)
 */
window.recalculateCart = function() {
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
 * RENDER ARTICOLI CATEGORIA
 */
window.openShopCategory = function(idCat) {
    const cat = window.shopCatalog.categorie.find(c => c.ID_Categoria === idCat);
    if (!cat) return;

    // Gestione Breadcrumb
    const breadcrumb = document.getElementById('shop-breadcrumb');
    const breadcrumbCurrent = document.getElementById('breadcrumb-current');
    if (breadcrumb) breadcrumb.classList.remove('d-none');
    if (breadcrumbCurrent) breadcrumbCurrent.innerText = cat.Nome_Categoria;
    
    // Filtro articoli idonei per almeno un membro della famiglia
    const articoliIdonei = window.shopCatalog.articoli.filter(a => 
        a.ID_Categoria === idCat && 
        window.shopCatalog.famiglia.some(m => window.checkEligibility(a, m))
    );

    const container = document.getElementById('shop-content-area');
    if (articoliIdonei.length === 0) {
        container.innerHTML = `<div class="alert alert-light text-center p-5 border shadow-sm" style="border-radius:15px;">
            <i class="fas fa-info-circle fa-2x mb-3 text-muted"></i><br>
            Nessun articolo disponibile per questa categoria in base all'età o al ruolo dei componenti della tua famiglia.
        </div>`;
        return;
    }

    let html = '<div class="row g-3 animate__animated animate__fadeIn">';
    articoliIdonei.forEach(art => {
        const lp = window.calculateLivePrice(art);
        
        // --- LOGICA DI BLOCCO ---
        const prezzoDisplay = lp.isValid ? formatEuro(lp.price) : `<span class="text-muted small" style="font-size:0.8rem">NON DISPONIBILE</span>`;
        const btnDisabled = lp.isValid ? '' : 'disabled';
        const btnClass = lp.isValid ? 'btn-danger' : 'btn-outline-secondary';
        const btnText = lp.isValid ? 'ACQUISTA' : 'CHIUSO';

        html += `
            <div class="col-12">
                <div class="card product-row-card shadow-sm border-0 p-3 mb-2" style="border-radius:15px; ${!lp.isValid ? 'opacity: 0.7;' : ''}">
                    <div class="row align-items-center">
                        <div class="col-md-7">
                            <h6 class="fw-bold mb-1 ${!lp.isValid ? 'text-muted' : 'text-dark'}">${art.Nome_Articolo}</h6>
                            <div class="badge bg-light text-danger border small" style="font-size:10px;">
                                ${window.renderTechnicalDetails(art)}
                            </div>
                        </div>
                        <div class="col-md-3 text-end">
                            <div class="price-tag-shop" style="font-size:1.4rem; color:${lp.isValid ? 'var(--brand)' : '#ccc'}; font-weight:800;">
                                ${prezzoDisplay}
                            </div>
                            <small class="${lp.isValid ? 'text-success' : 'text-muted'} fw-bold" style="font-size:9px; text-transform:uppercase;">
                                ${lp.label}
                            </small>
                        </div>
                        <div class="col-md-2 text-end">
                            <button class="btn ${btnClass} fw-bold w-100 py-2 shadow-sm rounded-pill" 
                                    onclick="window.startConfigurator('${art.ID_Articolo}')"
                                    ${btnDisabled}>
                                ${btnText}
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
    });
    container.innerHTML = html + '</div>';
};

/**
 * CALCOLO PREZZO LIVE (Gestisce i listini a tempo e promozioni)
 */
window.calculateLivePrice = function(art) {
    const basePrice = parseFloat(art ? (art.Prezzo_Default || 0) : 0);
    const listinoNome = (art && art.Nome_Quota) ? art.Nome_Quota.toString().trim() : "";

    // Se l'articolo NON richiede un listino dinamico, usiamo il prezzo base
    if (listinoNome === "") {
        const hasBasePrice = !isNaN(basePrice) && basePrice > 0;
        return { 
            price: basePrice, 
            label: "Quota Base", 
            isDynamic: false, 
            isValid: hasBasePrice // Valido solo se il prezzo base è definito
        };
    }

    // Se richiede un listino, cerchiamo la tariffa valida per OGGI
    const oggi = new Date();
    const oggiInt = (oggi.getFullYear() * 10000) + ((oggi.getMonth() + 1) * 100) + oggi.getDate();

    const tariffe = (window.shopCatalog.tariffe || []).filter(t => {
        const nTar = (t.Nome_Tariffa || "").toString().toUpperCase().trim();
        return nTar === listinoNome.toUpperCase();
    });

    const tariffaValida = tariffe.find(t => {
        if (!t.Valido_Dal || !t.Valido_Al) return false;
        const dDal = new Date(t.Valido_Dal);
        const dAl = new Date(t.Valido_Al);
        if (isNaN(dDal.getTime()) || isNaN(dAl.getTime())) return false;
        
        const dalInt = (dDal.getFullYear() * 10000) + ((dDal.getMonth() + 1) * 100) + dDal.getDate();
        const alInt = (dAl.getFullYear() * 10000) + ((dAl.getMonth() + 1) * 100) + dAl.getDate();
        return oggiInt >= dalInt && oggiInt <= alInt;
    });

    if (tariffaValida) {
        return { 
            price: parseFloat(tariffaValida.Prezzo || 0), 
            label: "Tariffa Attiva", 
            isDynamic: true,
            isValid: true 
        };
    }

    // --- CASO ERRORE: Listino richiesto ma nessuna tariffa valida trovata per oggi ---
    return { 
        price: 0, 
        label: "ISCRIZIONI CHIUSE", 
        isDynamic: true,
        isValid: false // Segnaliamo che la selezione deve essere negata
    };
};

window.calculateLivePriceOLD = function(art) {
    const basePrice = parseFloat(art ? (art.Prezzo_Default || 0) : 0);
    const listinoNome = (art && art.Nome_Quota) ? art.Nome_Quota.toString().trim() : "";

    if (listinoNome === "") {
        return { price: basePrice, label: "Quota Base", isDynamic: false };
    }

    // Confronto date numerico per evitare bug di fuso orario
    const oggi = new Date();
    const oggiInt = (oggi.getFullYear() * 10000) + ((oggi.getMonth() + 1) * 100) + oggi.getDate();

    const tariffe = (window.shopCatalog.tariffe || []).filter(t => {
        const nTar = (t.Nome_Tariffa || "").toString().toUpperCase().trim();
        return nTar === listinoNome.toUpperCase();
    });

    const tariffaValida = tariffe.find(t => {
        if (!t.Valido_Dal || !t.Valido_Al) return false;
        const dDal = new Date(t.Valido_Dal);
        const dAl = new Date(t.Valido_Al);
        if (isNaN(dDal.getTime()) || isNaN(dAl.getTime())) return false;
        
        const dalInt = (dDal.getFullYear() * 10000) + ((dDal.getMonth() + 1) * 100) + dDal.getDate();
        const alInt = (dAl.getFullYear() * 10000) + ((dAl.getMonth() + 1) * 100) + dAl.getDate();
        return oggiInt >= dalInt && oggiInt <= alInt;
    });

    if (tariffaValida) {
        return { 
            price: parseFloat(tariffaValida.Prezzo || 0), 
            label: "Promozione Attiva", 
            isDynamic: true 
        };
    }

    return { price: basePrice, label: "Quota Base", isDynamic: false };
};

/**
 * FORMATTA DETTAGLI TECNICI SOTTO IL NOME ARTICOLO
 */
window.renderTechnicalDetails = function(art) {
    let d = [];
    if (art.Stagione) d.push(art.Stagione);
    if (art.Area) d.push(art.Area);
    if (art.Da_Anni) {
        const min = Math.min(art.Da_Anni, art.A_Anni);
        const max = Math.max(art.Da_Anni, art.A_Anni);
        d.push("Nati: " + min + "/" + max);
    }
    return d.join(' • ');
};

/**
 * APRE IL MODALE DI CONFIGURAZIONE ACQUISTO
 */
window.startConfigurator = function(idArt) {
    // Cerchiamo l'articolo nel catalogo caricato
    const art = window.shopCatalog.articoli.find(a => a.ID_Articolo === idArt);
    if (!art) return;
    
    window.currentArtForConf = art;

    // Reset UI Modale
    document.getElementById('conf-titolo-articolo').innerText = art.Nome_Articolo;
    document.getElementById('btn-add-to-cart').disabled = true;
    
    const lp = window.calculateLivePrice(art);
    document.getElementById('conf-display-prezzo').innerText = formatEuro(lp.price);

    const containerMembri = document.getElementById('conf-membri-list');
    
    // Filtriamo la famiglia per chi è idoneo a questo articolo
    // Nota: window.shopCatalog.famiglia è l'array di oggetti tornato da GAS
    containerMembri.innerHTML = window.shopCatalog.famiglia
        .filter(m => window.checkEligibility(art, m))
        .map(m => `
            <div class="p-3 border rounded-4 mb-2 bg-white shadow-sm animate__animated animate__fadeIn">
                <div class="form-check d-flex align-items-center">
                    <input class="form-check-input conf-membro-check me-3" 
                           type="checkbox" 
                           value="${m.IDContatto}" 
                           id="m_${m.IDContatto}" 
                           onchange="window.handleMemberToggle(this, '${m.IDContatto}')"
                           style="width: 22px; height: 22px;">
                    <label class="form-check-label fw-bold text-dark flex-grow-1" for="m_${m.IDContatto}">
                        ${m.Cognome} ${m.Nome}
                        <div class="text-muted small fw-normal">${m.Ruolo}</div>
                    </label>
                </div>
                <!-- Area per Squadra e Taglie (si apre al check) -->
                <div id="personal-data-container-${m.IDContatto}" class="mt-2"></div>
            </div>
        `).join('');

    // Apertura Modale via Bootstrap (Safe mode per IDX)
    if (window.bootstrap) {
        const modalEl = document.getElementById('modalConfiguratore');
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
};

/**
 * Gestisce l'attivazione di un membro nel configuratore
 */
window.handleMemberToggle = function(checkbox, idContatto) {
    const container = document.getElementById('personal-data-container-' + idContatto);
    
    if (checkbox.checked) {
        const membro = window.shopCatalog.famiglia.find(f => f.IDContatto.toString() === idContatto.toString());
        container.innerHTML = window.renderTaglieBlock(membro, window.currentArtForConf);
    } else {
        container.innerHTML = "";
    }
    
    // Abilita il tasto "Aggiungi al carrello" solo se c'è almeno un selezionato
    const selezionati = document.querySelectorAll('.conf-membro-check:checked').length;
    const btnAdd = document.getElementById('btn-add-to-cart');
    if (btnAdd) btnAdd.disabled = (selezionati === 0);
};

/**
 * Disegna i selettori di Squadra e Taglie se richiesti dall'articolo
 */
window.renderTaglieBlock = function(membro, art) {
    const lists = window.shopCatalog.taglieLists || { tshirt: [], pant: [], calz: [] };
    
    // Funzione helper per gestire i flag dello Spreadsheet (possono essere booleani o stringhe "true")
    const isTrue = v => (v === true || v === "true" || v === "TRUE" || v === "SÌ" || v === "SI");
    
    let html = '<div class="p-3 border border-danger border-opacity-25 rounded-4 bg-light animate__animated animate__fadeIn"><div class="row g-2">';
    
    // 1. Selettore Squadra (se definito nell'articolo)
    if (art.Lista_Squadre && art.Lista_Squadre.trim() !== "") {
        const squadre = art.Lista_Squadre.split(',').map(s => s.trim());
        html += `
            <div class="col-12 mb-2">
                <label class="fw-bold small text-danger">SQUADRA / CATEGORIA</label>
                <select class="form-select form-select-sm f-squadra" data-id="${membro.IDContatto}">
                    <option value="">- Seleziona Squadra -</option>
                    ${squadre.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
            </div>`;
    }

    // 2. Selettori Taglie Kit
    if (isTrue(art.Richiedi_Maglietta)) {
        html += `
            <div class="col-4">
                <label class="small fw-bold">T-SHIRT</label>
                <select class="form-select form-select-sm f-taglia-maglia" data-id="${membro.IDContatto}">
                    <option value="">-</option>
                    ${lists.tshirt.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
            </div>`;
    }

    if (isTrue(art.Richiedi_Pantaloni)) {
        html += `
            <div class="col-4">
                <label class="small fw-bold">PANT.</label>
                <select class="form-select form-select-sm f-taglia-panta" data-id="${membro.IDContatto}">
                    <option value="">-</option>
                    ${lists.pant.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
            </div>`;
    }

    if (isTrue(art.Richiedi_Calze)) {
        html += `
            <div class="col-4">
                <label class="small fw-bold">CALZE</label>
                <select class="form-select form-select-sm f-taglia-calze" data-id="${membro.IDContatto}">
                    <option value="">-</option>
                    ${lists.calz.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
            </div>`;
    }

    return html + '</div></div>';
};

/**
 * Raccoglie le selezioni dal configuratore e salva gli articoli nel carrello (Spreadsheet)
 */
window.addToCart = async function() {
    const art = window.currentArtForConf;
    const checks = document.querySelectorAll('.conf-membro-check:checked');
    const itemsToAdd = [];

    // Protezione: se per qualche motivo window.cart è sparito, lo ricreiamo
    if (!Array.isArray(window.cart)) window.cart = [];

    // 1. RACCOLTA DATI E VALIDAZIONE
    for (const cb of checks) {
        const idC = cb.value;
        const m = window.shopCatalog.famiglia.find(f => f.IDContatto.toString() === idC.toString());
        const meta = {};
        
        // Validazione Squadra
        const sEl = document.querySelector(`.f-squadra[data-id="${idC}"]`);
        if (sEl && !sEl.value) return alert(`Scegli la squadra per ${m.Nome}`);
        if (sEl) meta.squadra = sEl.value;
        
        // Validazione Taglie
        const mEl = document.querySelector(`.f-taglia-maglia[data-id="${idC}"]`);
        if (mEl && !mEl.value) return alert(`Scegli taglia T-shirt per ${m.Nome}`);
        if (mEl) meta.tagliaMaglia = mEl.value;

        const pEl = document.querySelector(`.f-taglia-panta[data-id="${idC}"]`);
        if (pEl) meta.tagliaPanta = pEl.value;
        
        const cEl = document.querySelector(`.f-taglia-calze[data-id="${idC}"]`);
        if (cEl) meta.tagliaCalze = cEl.value;

        itemsToAdd.push({
            email: window.globalData.userEmail,
            idContatto: idC,
            nomeMembro: `${m.Nome} ${m.Cognome}`,
            ruoloMembro: m.Ruolo,
            idArticolo: art.ID_Articolo,
            idCategoria: art.ID_Categoria,
            nomeArticolo: art.Nome_Articolo,
            prezzoBase: window.calculateLivePrice(art).price,
            metadati: meta,
            addedAt: Date.now()
        });
    }

    if (itemsToAdd.length === 0) return;

    const loader = document.getElementById('loading-overlay');
    if (loader) loader.style.display = 'flex';

    try {
        // 2. INVIO AL SERVER (GAS)
        await Promise.all(itemsToAdd.map(item => callGAS("addToCartPersist", item)));

        // 3. AGGIORNAMENTO LOCALE (Qui avveniva l'errore)
        itemsToAdd.forEach(i => {
            window.cart.push({
                ...i,
                finalPrice: i.prezzoBase,
                scontiDettaglio: []
            });
        });

        // 4. RICALCOLO E AGGIORNAMENTO UI
        // Assicurati che queste funzioni siano definite (anche come placeholder)
        if (typeof window.recalculateCart === "function") window.recalculateCart();
        if (typeof window.renderCartUI === "function") window.renderCartUI();

        const modalEl = document.getElementById('modalConfiguratore');
        if (window.bootstrap) {
            window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        }

        alert("✅ Iscrizioni aggiunte correttamente!");

    } catch (e) {
        console.error("❌ Errore durante l'aggiunta:", e);
        alert("Errore: " + e.message);
    } finally {
        if (loader) loader.style.display = 'none';
    }
};

/**
 * RENDER CARRELLO INTEGRATO
 * Visualizza il riepilogo costi, coupon e dati per detrazione 730
 */
window.renderCartUI = function() {
    const container = document.getElementById('cart-integrated-container');
    if (!container) return;

    // 1. Gestione Carrello Vuoto
    if (!window.cart || window.cart.length === 0) {
        container.classList.add('d-none');
        container.style.display = 'none';
        window.updateCartUI(); 
        return;
    }

    // 2. Mostra il contenitore
    container.classList.remove('d-none');
    container.style.display = 'block';

    // 3. Calcolo Totale e Filtro Adulti per Detrazione
    const totaleGenerale = window.cart.reduce((s, i) => s + (i.finalPrice || 0), 0);
    
    // Assicuriamoci di leggere correttamente l'array famiglia
    const listaMembri = window.shopCatalog.famiglia.data || window.shopCatalog.famiglia || [];
    const adulti = listaMembri.filter(m => {
        const r = (m.Ruolo || "").toUpperCase();
        return r.includes("GENITORE") || r.includes("SOCIO") || r.includes("CONSIGLIERE");
    });

    // 4. Generazione Righe Tabella
    const htmlRows = window.cart.map((item, index) => {
        const scontiHtml = (item.scontiDettaglio || []).map(s => `
            <div class="mb-1">
                <span class="discount-label">
                    <i class="fas fa-tag me-1"></i>${s.nome}: -${formatEuro(s.valore)}
                </span>
            </div>`).join('');

        let metaHtml = "";
        if (item.metadati) {
            if (item.metadati.squadra) metaHtml += `<span class="badge bg-light text-dark border me-1" style="font-size:9px;">${item.metadati.squadra}</span>`;
            if (item.metadati.tagliaMaglia) metaHtml += `<small class="text-muted" style="font-size:10px;">Kit: ${item.metadati.tagliaMaglia}</small>`;
        }

        return `
            <tr>
                <td class="ps-4 py-3">
                    <div class="fw-bold text-dark" style="font-size:14px;">${item.nomeArticolo}</div>
                    <div class="small">Per: <span class="fw-bold text-danger">${item.nomeMembro}</span></div>
                    <div class="mt-1">${metaHtml}</div>
                </td>
                <td class="text-center text-muted">${formatEuro(item.prezzoBase)}</td>
                <td>${scontiHtml || '<small class="text-muted italic" style="font-size:10px;">Nessuno</small>'}</td>
                <td class="text-end fw-bold text-dark pe-4" style="font-size:1.1rem;">${formatEuro(item.finalPrice)}</td>
                <td class="text-center pe-3">
                    <button class="btn btn-sm btn-outline-danger border-0" onclick="window.removeAndRefresh(${index})">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>`;
    }).join('');

    // 5. Template Finale
    container.innerHTML = `
    <div class="cart-integrated-card shadow-sm mb-5 animate__animated animate__fadeIn" style="border-radius: 15px; overflow: hidden; border: 1px solid #eee;">
      <div class="p-3 bg-dark text-white d-flex justify-content-between align-items-center">
        <h6 class="mb-0 fw-bold"><i class="fas fa-shopping-cart me-2 text-danger"></i>RIEPILOGO ISCRIZIONE</h6>
        <span class="badge bg-danger rounded-pill">${window.cart.length} Articoli</span>
      </div>
      
      <div class="table-responsive bg-white">
        <table class="table table-hover align-middle mb-0">
          <thead class="bg-light">
            <tr style="font-size: 10px; text-transform: uppercase; color: #888;">
              <th class="ps-4 py-3">Articolo / Beneficiario</th>
              <th class="text-center">Prezzo Base</th>
              <th>Sconti</th>
              <th class="text-end">Totale</th>
              <th style="width: 50px;"></th>
            </tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
      </div>

      <div class="p-3 bg-white border-top">
          <div class="col-md-5">
            <label class="fw-bold small text-muted mb-2 text-uppercase">Codice Coupon</label>
            <div class="input-group input-group-sm">
              <input type="text" id="cart_coupon_input" class="form-control" placeholder="Inserisci codice..." 
                     value="${window.appliedCouponCode || ''}">
              <button class="btn btn-dark fw-bold" type="button" onclick="window.applyCoupon()">APPLICA</button>
            </div>
            <!-- Visualizza il messaggio di feedback (Successo o Errore) salvato globalmente -->
            <div id="coupon_feedback" class="mt-1">
              ${window.couponFeedbackHTML || ''}
            </div>
          </div>

          <!-- Sezione Detrazione -->
          <div class="col-md-7 border-start">
            <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" id="f_detrazione_attiva" 
                       onchange="window.toggleDetrazioneUI(this.checked)" 
                       ${window.isDetrazioneActive ? 'checked' : ''}>
                <label class="form-check-label fw-bold small text-dark" for="f_detrazione_attiva">Richiedo ricevuta per detrazione fiscale (730)</label>
            </div>
            <div id="detrazione-fields-ui" class="${window.isDetrazioneActive ? '' : 'd-none'}">
                <div class="row g-2">
                   <div class="col-md-12">
                     <select id="f_genitore_detrazione" class="form-select form-select-sm" onchange="window.autoFillFiscalData(this.value)">
                        <option value="">-- Intesta la ricevuta a... --</option>
                        ${adulti.map(a => `<option value="${a.IDContatto}" ${window.selectedGenitoreId == a.IDContatto ? 'selected' : ''}>${a.Cognome} ${a.Nome}</option>`).join('')}
                     </select>
                   </div>
                   <div class="col-md-6">
                     <input type="text" id="f_detrazione_cf" class="form-control form-control-sm bg-light" placeholder="Codice Fiscale" readonly value="${window.fiscalCF || ''}">
                   </div>
                   <div class="col-md-6">
                     <input type="text" id="f_detrazione_email" class="form-control form-control-sm bg-light" placeholder="Email" readonly value="${window.fiscalEmail || ''}">
                   </div>
                </div>
            </div>
          </div>
        </div>
      </div>

      <div class="p-3 bg-light border-top d-flex justify-content-between align-items-center">
        <div class="ps-3">
          <small class="text-muted text-uppercase fw-bold d-block" style="font-size:10px;">Importo Totale</small>
          <div class="h3 fw-bold text-danger mb-0">${formatEuro(totaleGenerale)}</div>
        </div>
        <button class="btn btn-success fw-bold px-5 py-3 shadow-sm" style="border-radius:12px;" onclick="window.checkout()">
          CONFERMA E PROCEDI AL PAGAMENTO <i class="fas fa-arrow-right ms-2"></i>
        </button>
      </div>
    </div>`;

    window.updateCartUI();
};

window.toggleDetrazioneUI = function(show) {
    window.isDetrazioneActive = show;
    const fields = document.getElementById('detrazione-fields-ui');
    if (fields) {
        if (show) fields.classList.remove('d-none');
        else fields.classList.add('d-none');
    }
};

window.autoFillFiscalData = function(idContatto) {
    window.selectedGenitoreId = idContatto;
    const listaMembri = window.shopCatalog.famiglia.data || window.shopCatalog.famiglia || [];
    const genitore = listaMembri.find(f => f.IDContatto.toString() === idContatto.toString());
    if (genitore) {
        window.fiscalCF = genitore.Codice_Fiscale || "";
        window.fiscalEmail = genitore.Email || "";
        document.getElementById('f_detrazione_cf').value = window.fiscalCF;
        document.getElementById('f_detrazione_email').value = window.fiscalEmail;
    }
};

window.updateCartUI = function() {
    const total = window.cart.reduce((s, i) => s + (i.finalPrice || 0), 0);
    const countEl = document.getElementById('cart-count');
    if (countEl) countEl.innerText = window.cart.length;
};

/**
 * Rimuove un articolo dal carrello (sia locale che Spreadsheet)
 */
window.removeAndRefresh = async function(index) {
    const item = window.cart[index];
    if (!item) return;

    if (!confirm(`Vuoi davvero rimuovere "${item.nomeArticolo}" per ${item.nomeMembro}?`)) return;

    const loader = document.getElementById('loading-overlay');
    if (loader) {
        loader.style.display = 'flex';
        const txt = loader.querySelector('h5');
        if (txt) txt.innerText = "Aggiornamento carrello...";
    }

    try {
        // 1. Chiamata al ponte GAS per rimuovere la riga dallo Spreadsheet
        // Assicurati che nel tuo .gs esista l'azione "removeFromCartPersist"
        await callGAS("removeFromCartPersist", { 
            idContatto: item.idContatto, 
            idArticolo: item.idArticolo,
            email: window.globalData.userEmail
        });

        // 2. Rimozione dalla memoria locale
        window.cart.splice(index, 1);

        // 3. Ricalcolo Sconti (fondamentale per le soglie)
        window.recalculateCart();

        // 4. Aggiornamento UI
        window.renderCartUI();
        
        console.log("✅ Articolo rimosso con successo.");

    } catch (e) {
        console.error("Errore rimozione:", e);
        alert("Si è verificato un errore durante la rimozione: " + e.message);
    } finally {
        if (loader) loader.style.display = 'none';
    }
};

/**
 * Tenta di applicare il codice coupon inserito dall'utente
 */
/**
 * Tenta di applicare il codice coupon inserito dall'utente
 */
window.applyCoupon = function() {
    const input = document.getElementById('cart_coupon_input');
    if (!input) return;

    const code = input.value.trim().toUpperCase();
    
    if (!code) {
        window.appliedCouponCode = "";
        window.couponFeedbackHTML = "";
        window.recalculateCart();
        return;
    }

    const scontoTrovato = (window.shopCatalog.sconti || []).find(s => 
        (s.Codice_Coupon || "").toString().trim().toUpperCase() === code &&
        (s.Attivo === true || s.Attivo === "TRUE" || s.Attivo === "VERO")
    );

    if (scontoTrovato) {
        window.appliedCouponCode = code;
        window.couponFeedbackHTML = `
            <div class="alert alert-success py-1 px-2 mt-2 small fw-bold animate__animated animate__pulse">
                <i class="fas fa-check-circle me-1"></i> Coupon "${code}" applicato!
            </div>`;
    } else {
        window.appliedCouponCode = ""; // Reset se sbagliato
        window.couponFeedbackHTML = `
            <div class="alert alert-danger py-1 px-2 mt-2 small fw-bold animate__animated animate__shakeX">
                <i class="fas fa-times-circle me-1"></i> Coupon non valido o scaduto.
            </div>`;
    }

    // Ora ricalcoliamo: la renderCartUI userà window.couponFeedbackHTML
    window.recalculateCart();
};
