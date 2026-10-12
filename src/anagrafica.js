import { formattaDataRugby, safeSet, callGAS, resolveUrlParams } from "./utils.js";

/**
 * TRASFORMATORE URL GOOGLE DRIVE (Versione Infallibile)
 * Prende un link di visualizzazione e lo trasforma in un'immagine reale.
 */
function getThumbnailUrl(driveUrl) {
    if (!driveUrl || driveUrl === "" || driveUrl === "undefined" || driveUrl === "null") {
        return "https://placehold.co/200x150?text=Nessun+Documento";
    }

    // Se è già un'anteprima locale Base64, caricala direttamente
    if (driveUrl.startsWith('data:')) return driveUrl;

    // Se non è un link Google Drive, caricalo come URL normale
    if (!driveUrl.includes('drive.google.com')) return driveUrl;

    try {
        // Estrazione ID: cerchiamo una stringa alfanumerica di almeno 25 caratteri
        const match = driveUrl.match(/[-\w]{25,}/);
        if (match && match[0]) {
            const fileId = match[0];
            // sz=w400 è la chiave: chiede a Google di generare il file immagine
            return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
        }
    } catch (e) {
        console.error("❌ Errore critico parsing URL Drive:", driveUrl, e);
    }

    return "https://placehold.co/200x150?text=Errore+Link";
}

/**
 * Utility per estrarre valori in modo tollerante (case-insensitive e underscore-safe)
 */
// Funzione di utilità per estrarre valori in modo tollerante
function getValue(obj, key) {
    if (!obj || !key) return "";

    // 1. Prova match esatto
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];

    // 2. Prova match "Agnostico" (rimuove spazi e underscore ovunque)
    const cleanSearch = key.toLowerCase().replace(/[\s_]/g, "");
    const realKey = Object.keys(obj).find(k => {
        return k.toLowerCase().replace(/[\s_]/g, "") === cleanSearch;
    });

    return realKey ? obj[realKey] : "";
}


/**
 * 1. DISEGNA LE BOLLE DELLA FAMIGLIA
 */
export function buildFamilyUI(membri) {
    const container = document.getElementById('family-selector');
    if (!container) return;

    container.innerHTML = membri.map((m, i) => {
        const ruolo = (m.Ruolo || "").toLowerCase();
        const nome = m.Nome || "Socio";
        const icon = ruolo.includes("atleta") ? "fa-running" : "fa-user-tie";
        const isDual = ruolo.includes("atleta") && (ruolo.includes("genitore") || ruolo.includes("tutore"));

        return `
            <div class="family-item" id="f-${i}" onclick="selectMember(${i})">
                <div class="avatar-circle shadow-sm" style="position:relative;">
                    <i class="fas ${icon}"></i>
                    ${isDual ? '<div class="dual-role-indicator shadow-sm"><i class="fas fa-user-tie"></i></div>' : ''}
                </div>
                <div class="family-name text-truncate small fw-bold mt-2">${nome}</div>
            </div>`;
    }).join('') + `
    <div class="family-item" onclick="alert('Funzione Aggiungi in arrivo')">
        <div class="avatar-circle shadow-sm" style="border: 2px dashed #ccc; color: #ccc;"><i class="fas fa-plus"></i></div>
    </div>`;
}

/**
 * 2. VALIDA UN SINGOLO MEMBRO (Per i bordi delle bolle)
 */
export function checkMemberValidation(index) {
    // Se index è -1, stiamo validando un nuovo inserimento (Wizard)
    const isWizard = (index === -1);

    let fullData, isAtleta, profile;

    if (isWizard) {
        // Logica semplificata per il Wizard
        const fields = document.querySelectorAll('#wiz-form-container .val-field');
        fullData = {};
        fields.forEach(f => {
            const id = f.getAttribute('data-id');
            fullData[id] = f.type === 'checkbox' ? f.checked : f.value;
        });
        isAtleta = (window.onboardingForcedRole === 'Atleta');
        profile = "ASSOCIATO";
    } else {
        // Logica standard per la Dashboard
        if (!window.globalData?.famiglia?.data[index]) return false;
        const m = window.globalData.famiglia.data[index];
        const idC = (m.IDContatto || "").toString().toLowerCase();
        fullData = { ...m, ...window.globalData.atleti[idC], ...window.globalData.taglieKit[idC], ...window.globalData.privacyData[idC] };
        isAtleta = (getValue(fullData, "Ruolo") || "").toLowerCase().includes("atleta");
        profile = isAtleta ? "ATLETA" : "ASSOCIATO";
    }

    const config = window.globalData.config[profile] || [];
    let isAllValid = true;
    config.forEach(conf => { if (isFieldMissing(conf, fullData, isAtleta)) isAllValid = false; });

    if (!isWizard) {
        const bubble = document.getElementById(`f-${index}`);
        if (bubble) {
            bubble.classList.remove('is-valid-member', 'is-invalid-member');
            bubble.classList.add(isAllValid ? 'is-valid-member' : 'is-invalid-member');
        }
    }
    return isAllValid;
}

/**
 * 3. VALIDA TUTTA LA FAMIGLIA ALL'AVVIO
 */
export function validateAllMembers() {
    if (window.globalData?.famiglia?.data) window.globalData.famiglia.data.forEach((_, i) => checkMemberValidation(i));
}

/**
 * 4. GESTISCE IL CLICK SULLA BOLLA
 */
export async function selectMember(index) {
    console.group("🔍 DIAGNOSI SELEZIONE MEMBRO");

    if (!window.globalData || !window.globalData.famiglia || !window.globalData.famiglia.data[index]) {
        console.error("❌ Dati globali non pronti per l'indice:", index);
        console.groupEnd();
        return;
    }

    const m = window.globalData.famiglia.data[index];
    // Pulizia ID: fondamentale per il match con la mappa atleti
    const idC = (m.IDContatto || "").toString().toLowerCase().trim();
    window.currentMemberIndex = index;

    console.log("👤 Membro selezionato:", m.Nome, m.Cognome, "(ID:", idC, ")");

    // 1. DETERMINAZIONE RUOLO
    const ruoloStr = (getValue(m, "Ruolo") || "").toLowerCase();
    const isAtleta = ruoloStr.includes("atleta");
    console.log("🏃 IsAtleta (da ruolo):", isAtleta);

    // 2. RECUPERO DATI TECNICI (Il punto critico)
    // Vediamo cosa c'è in tutta la mappa degli atleti
    console.log("📋 Mappa Atleti globale:", window.globalData.atleti);

    const tech = window.globalData.atleti[idC] || {};
    console.log("📊 Dati tecnici trovati per questo ID:", tech);

    const kit = window.globalData.taglieKit[idC] || {};
    const priv = window.globalData.privacyData[idC] || {};
    const fullData = { ...m, ...tech, ...kit, ...priv };

    // --- AGGIUNGI QUESTI LOG DIAGNOSTICI ---
    console.group(`🔍 Verifica Merge per ID: "${idC}"`);
    console.log("👕 Taglie trovate (kit):", kit);
    console.log("🔒 Privacy trovata (priv):", priv);
    console.log("🧩 fullData contiene Taglia_Tshirt?:", fullData.Taglia_Tshirt);
    console.log("🧩 fullData contiene Privacy_ASR_1?:", fullData.Privacy_ASR_1);
    console.groupEnd();

    // 3. UI: Gestione Bolle
    document.querySelectorAll('.family-item').forEach(el => el.classList.remove('active'));
    const bubble = document.getElementById(`f-${index}`);
    if (bubble) bubble.classList.add('active');

    // 4. AGGIORNAMENTO TESTI BASE
    safeSet('ui-nome-completo', `${getValue(m, "Cognome")} ${getValue(m, "Nome")}`.toUpperCase());
    safeSet('ui-ruolo', getValue(m, "Ruolo") || "Socio");
    safeSet('ui-nascita', formattaDataRugby(getValue(m, "Data_Nascita")));
    safeSet('ui-anagrafica-title', `ANAGRAFICA ${getValue(m, "Nome")}`.toUpperCase());

    // 5. AGGIORNAMENTO BOX GRIGI (STAGIONE, CATEGORIA, TIPO)
    const techHeader = document.getElementById('ui-tech-header');
    if (techHeader) {
        if (isAtleta) {
            console.log("✨ Riempimento box tecnici...");
            techHeader.classList.remove('d-none');

            const stag = getValue(tech, "Stagione");
            const cat = getValue(tech, "Categoria_Fed") || getValue(tech, "Categoria");
            const tipo = getValue(tech, "Tipo");

            console.log(`📝 Valori estratti -> Stag: ${stag}, Cat: ${cat}, Tipo: ${tipo}`);

            safeSet('ui-stagione', stag || "-");
            safeSet('ui-categoria', cat || "-");
            safeSet('ui-tipo', tipo || "-");
        } else {
            console.log("🚫 Membro non atleta: nascondo box tecnici.");
            techHeader.classList.add('d-none');
        }
    } else {
        console.error("❌ Elemento 'ui-tech-header' non trovato nell'HTML!");
    }

    // 6. BADGE STATO (IL BOX GIALLO/VERDE)
    const badge = document.getElementById('ui-badge-stato');
    if (badge) {
        const statoVal = getValue(tech, "Stato_Tesseramento");
        console.log("🏷️ Stato Tesseramento rilevato:", statoVal);

        if (isAtleta && statoVal && statoVal !== "") {
            badge.innerText = statoVal.toUpperCase();
            // Verde se tesserato, Giallo altrimenti
            if (statoVal.toUpperCase().includes("TESSERATO")) {
                badge.className = "badge-stato bg-success text-white";
            } else {
                badge.className = "badge-stato bg-warning text-dark";
            }
            badge.classList.remove('d-none');
        } else {
            badge.classList.add('d-none');
        }
    } else {
        console.error("❌ Elemento 'ui-badge-stato' non trovato nell'HTML!");
    }

    // 7. Badge Codici FIR/UISP
    if (typeof renderCodiciBadge === "function") renderCodiciBadge(idC);

    // 8. Rendering Form
    const profileTarget = isAtleta ? "ATLETA" : "ASSOCIATO";
    const config = window.globalData.config[profileTarget] || [];
    renderAnagraficaForm(fullData, config, isAtleta);

    // 9. Gestione Tenda
    const collapseEl = document.getElementById('profile-collapse-area');
    if (collapseEl && window.bootstrap) {
        window.bootstrap.Collapse.getOrCreateInstance(collapseEl).hide();
    }

    console.groupEnd();
}

/**
 * DISEGNA IL FORM DINAMICO NEL DETTAGLIO PROFILO, NEL WIZARD O NELLO SHOP
 * @param {Object} memberData - Dati del socio (uniti)
 * @param {Array} config - Array campi del profilo
 * @param {Boolean} isAtleta - Flag per il filtro tecnico
 * @param {String} targetContainerId - ID del div di destinazione
 * @param {Object} optionsOverride - (Nuovo) Oggetto per sovrascrivere le liste (es: { "Squadra": ["U14", "U16"] })
 */
export function renderAnagraficaForm(memberData, config, isAtleta, targetContainerId = 'anagrafica-form-content', optionsOverride = null) {
    const container = document.getElementById(targetContainerId);
    if (!container) return;

    const campiOrdinati = [...config].sort((a, b) => (a.ordine || 0) - (b.ordine || 0));
    let html = '<div class="row g-2">', lastSection = "";

    campiOrdinati.forEach(conf => {
        if (!conf.visibile) return;
        const tDato = (conf.tipoDato || "").toLowerCase();
        if (tDato.includes("atleti") && !isAtleta) return;

        if (conf.sezione !== lastSection) {
            lastSection = conf.sezione;
            html += `<div class="col-12"><div class="rm-section-title mt-2 mb-1" style="font-size:0.75rem; padding:4px 10px;">${lastSection}</div></div>`;
        }

        const valore = getValue(memberData, conf.id);
        const errorClass = isFieldMissing(conf, memberData, isAtleta) ? "is-invalid" : "";
        const asterisco = (conf.required && !conf.readonly) ? '<span class="text-danger fw-bold">*</span>' : '';

        let currentConf = { ...conf };
        if (optionsOverride && optionsOverride[conf.id]) {
            currentConf.opzioni = optionsOverride[conf.id];
        }

        // --- APPLICAZIONE LARGHEZZA (col-md-X) ---
        const colSize = currentConf.larghezza || 4;
        console.log("CONFIG ORIGINALE:", config.find(c => c.id === 'IDContatto'));

        html += `
            <div class="col-md-${colSize} col-12 mb-1">
                <label class="label-xs" style="font-size:0.65rem; margin-bottom:1px;">${currentConf.label}${asterisco}</label>
                ${generaInputHtml(currentConf, valore, errorClass, memberData)}
                <!-- --- VISUALIZZAZIONE SOTTOTITOLO --- -->
                ${currentConf.sottotitolo ? `<span class="help-text" style="font-size:0.6rem; display:block; color:#888; font-style:italic;">${currentConf.sottotitolo}</span>` : ""}
            </div>`;
    });

    html += '</div>';
    if (targetContainerId === 'anagrafica-form-content') {
        html += '<div class="d-flex justify-content-end mt-3 pt-2 border-top"><button class="btn btn-success btn-sm fw-bold px-4 shadow-sm" onclick="salvaSchedaAttiva()">SALVA MODIFICHE</button></div>';
    }
    container.innerHTML = html;
    agganciaListenerValidazione(container, targetContainerId);
}


// Funzione helper per non appesantire il render
function agganciaListenerValidazione(container, targetId) {
    container.querySelectorAll('.val-field, .multi-check-part').forEach(el => {
        const validate = (e) => {
            const input = e.target;
            if (input.classList.contains('multi-check-part')) {
                const parent = input.closest('.multi-list-container');
                const fId = parent.getAttribute('data-id');
                const hiddenInp = document.getElementById(`val_${fId}`);
                const vals = Array.from(parent.querySelectorAll('.multi-check-part:checked')).map(i => i.value);
                if (hiddenInp) {
                    hiddenInp.value = vals.join(', ');
                    hiddenInp.dispatchEvent(new Event('input', { bubbles: true }));
                }
                return;
            }
            const fieldId = input.getAttribute('data-id');
            const isReq = input.hasAttribute('required');
            const currentVal = input.type === 'checkbox' ? input.checked : input.value;
            if (isReq) {
                const empty = input.type === 'checkbox' ? !input.checked : !input.value.trim();
                if (empty) input.classList.add('is-invalid'); else input.classList.remove('is-invalid');
                const mCont = container.querySelector(`.multi-list-container[data-id="${fieldId}"]`);
                if (mCont) { if (empty) mCont.style.borderColor = "#dc3545"; else mCont.style.borderColor = "#ced4da"; }
            }
            if (targetId === 'anagrafica-form-content' && window.globalData) {
                window.globalData.famiglia.data[window.currentMemberIndex][fieldId] = currentVal;
                checkMemberValidation(window.currentMemberIndex);
            }
        };
        el.addEventListener('input', validate);
        el.addEventListener('change', validate);
    });
}

/**
 * 6. GENERATORE INPUT
 */
/**
 * Generatore di input HTML con log diagnostici avanzati per la risoluzione dinamica
 */
/**
 * Generatore di input HTML con log diagnostici avanzati per la risoluzione dinamica
 */
function generaInputHtml(conf, valore, errorClass = "", memberData = {}, optionsOverride = null) {
    const fieldId = conf.id || conf.name || "campo-senza-id";
    const fieldLabel = conf.label || conf.titolo || fieldId;

    const tipo = (conf.tipoInput || "testo").toLowerCase().trim();

    // Helper di conversione booleana
    const parseBoolean = (val) => {
        if (typeof forceBool === "function") return forceBool(val);
        if (typeof val === "boolean") return val;
        if (typeof val === "string") {
            const s = val.trim().toLowerCase();
            return s === "true" || s === "si" || s === "sì" || s === "1" || s === "yes";
        }
        if (typeof val === "number") return val === 1;
        return false;
    };

    // Cerchiamo tutte le possibili varianti di readonly
    const rawRo = conf.readonly ?? conf.readOnly ?? conf.ReadOnly ?? conf["Read Only"] ?? conf.readonly_ ?? conf.solaLettura ?? conf.disabilitato;
    const isReadOnly = parseBoolean(rawRo);

    const rawRq = conf.required ?? conf.Required ?? conf["Required"];
    const isRequired = parseBoolean(rawRq);

    // Costanti grafiche e attributi
    const roStyle = "background-color: #f8f9fa; cursor: not-allowed;";
    const commonClass = `form-control form-control-sm val-field shadow-none ${errorClass}`;
    const selectClass = `form-select form-select-sm val-field shadow-none ${errorClass}`;
    const ro = isReadOnly ? `readonly disabled style='${roStyle}'` : "";
    const rq = isRequired ? "required" : "";
    const v = (valore === null || valore === undefined) ? "" : valore;

    // 1. Inizializziamo le opzioni dal campo config
    let options = Array.isArray(conf.opzioni) ? conf.opzioni : [];

    // --- LOGICA DINAMICA ARTICOLO ---
    if (typeof conf.opzioni === "string" && conf.opzioni.toUpperCase().startsWith("ARTICOLO:")) {
        if (optionsOverride && optionsOverride[conf.id]) {
            options = optionsOverride[conf.id];
        } else {
            const targetCol = conf.opzioni.split(":")[1];
            const areaAtl = (getValue(memberData, "Area")).toUpperCase().trim();
            const catAtl = (getValue(memberData, "Categoria_Fed") || getValue(memberData, "Categoria")).toUpperCase().trim();
            const tipoAtl = (getValue(memberData, "Tipo")).toUpperCase().trim();

            const article = (window.globalData.articoli || []).find(a =>
                (a.Tipo_Articolo === "TESSERAMENTO") &&
                (a.Area || "").toUpperCase().trim() === areaAtl &&
                (a.Categoria_Federale || a.Categoria_Fed || "").toUpperCase().trim() === catAtl &&
                (a.Tipo_Tesseramento || a.Tipo || "").toUpperCase().trim() === tipoAtl
            );

            if (article && article[targetCol]) {
                options = article[targetCol].split(',').map(s => s.trim()).filter(Boolean);
            } else {
                options = [];
            }
        }
    }

    // --- RENDERING HTML ---
    switch (tipo) {
        case "multi-lista":
            const currentSelected = v.toString().toLowerCase().split(',').map(s => s.trim());
            const bgContainer = isReadOnly ? '#f8f9fa' : '#fff';
            let multiHtml = `<div class="multi-list-container ${errorClass}" data-id="${conf.id}" style="border: 1px solid #ced4da; padding: 10px; border-radius: 8px; background: ${bgContainer}; max-height: 150px; overflow-y: auto;">`;

            if (options.length === 0) {
                multiHtml += `<div class="small text-muted italic p-1">Nessuna opzione disponibile per la categoria.</div>`;
            }

            options.forEach((o, idx) => {
                const optStr = o.toString().trim();
                const isChecked = (options.length === 1 || currentSelected.includes(optStr.toLowerCase())) ? "checked" : "";

                multiHtml += `
                    <div class="d-flex align-items-center mb-1">
                        <input type="checkbox" class="multi-check-part me-2" id="chk_${conf.id}_${idx}" value="${optStr}" ${isChecked} ${isReadOnly ? 'disabled' : ''} style="width:16px; height:16px; ${isReadOnly ? 'cursor:not-allowed;' : ''}">
                        <label class="small mb-0" for="chk_${conf.id}_${idx}" style="${isReadOnly ? 'cursor:not-allowed;' : 'cursor:pointer;'} flex-grow: 1;">${optStr}</label>
                    </div>`;
            });
            return multiHtml + `</div><input type="hidden" class="val-field" data-id="${conf.id}" id="val_${conf.id}" value="${v}" ${rq}>`;

        case "lista":
            let opts = `<option value="">-</option>`;
            const valAnag = v.toString().toLowerCase().trim();
            options.forEach(o => {
                const optStr = o.toString().trim();
                const isSel = (options.length === 1 || (valAnag !== "" && valAnag.includes(optStr.toLowerCase()))) ? "selected" : "";
                opts += `<option value="${optStr}" ${isSel}>${optStr}</option>`;
            });
            return `<select class="${selectClass}" data-id="${conf.id}" ${isReadOnly ? `disabled style='${roStyle}'` : ''} ${rq}>${opts}</select>`;

        case "switch":
        case "checkbox":
            // Helper robusto locale per il controllo booleano
            const checkAttivo = (val) => {
                if (val === true || val === 1) return true;
                if (typeof val === "string") {
                    const s = val.trim().toLowerCase();
                    return s === "true" || s === "si" || s === "sì" || s === "1" || s === "vero";
                }
                if (typeof forceBool === "function") return forceBool(val);
                return false;
            };

            const isChecked = checkAttivo(v);

            // --- 🔍 LOG DIAGNOSTICO SWITCH/PRIVACY ---
            console.group(`🔘 RENDERING SWITCH: [${conf.id}] - "${conf.label || ''}"`);
            console.log("1. Valore grezzo ricevuto dal record:", valore);
            console.log("2. Valore normalizzato (v):", v, `(tipo: ${typeof v})`);
            console.log("3. Esito calcolo 'checked':", isChecked ? "🟩 ACCESO (checked)" : "⬜ SPENTO (non checked)");
            console.groupEnd();

            return `
                <div class="form-check form-switch pt-1">
                    <input class="form-check-input val-field ${errorClass}" 
                           type="checkbox" 
                           role="switch" 
                           data-id="${conf.id}" 
                           ${isChecked ? 'checked' : ''} 
                           ${isReadOnly ? 'disabled style="cursor:not-allowed;"' : ''} 
                           ${rq}>
                </div>`;

        case "data":
            let ds = v.toString().includes('/') ? v.split('/').reverse().join('-') : v.split('T')[0];
            return `<input type="date" class="${commonClass}" data-id="${conf.id}" value="${ds}" ${ro} ${rq}>`;

        case "immagine":
            const imgErr = errorClass ? "img-invalid" : "";
            const thumb = typeof getThumbnailUrl === "function" ? getThumbnailUrl(v) : v;

            return `
                <div class="d-flex align-items-center gap-2" id="container_${conf.id}">
                    <div class="position-relative">
                        <img src="${thumb}" 
                             id="prev_${conf.id}" 
                             class="img-doc-preview shadow-sm ${imgErr}" 
                             onclick="window.open('${v}','_blank')"
                             title="Clicca per visualizzare" style="cursor: pointer;">
                
                        ${!isReadOnly ? `
                            <label for="file_${conf.id}" class="btn btn-outline-danger btn-xs p-1 position-absolute" 
                                   style="bottom: -5px; right: -5px; font-size:8px; border-radius:10px; background:white; line-height:1; box-shadow: 0 2px 4px rgba(0,0,0,0.1); cursor:pointer;">
                                CARICA
                            </label>
                            <input type="file" id="file_${conf.id}" class="d-none" accept="image/*,application/pdf" 
                                   onchange="handleFileUpload(this, '${conf.id}', '${conf.label}')">
                        ` : ''}
                    </div>
            
                    <div id="spin_${conf.id}" class="spinner-border spinner-border-sm text-danger d-none ms-1"></div>
                    <input type="hidden" class="val-field ${errorClass}" data-id="${conf.id}" id="val_${conf.id}" value="${v}" ${rq}>
                </div>`;

        default:
            return `<input type="text" class="${commonClass}" data-id="${conf.id}" value="${v}" placeholder="..." ${ro} ${rq}>`;
    }
}
// Funzione helper per pulizia HTML multi-lista

/**
 * 7. GESTORE UPLOAD (GOOGLE DRIVE)
 */
window.handleFileUpload = async function (input, fieldId, label) {
    const file = input.files[0];
    if (!file) return;

    // Riferimenti agli elementi della pagina
    const spinner = document.getElementById(`spin_${fieldId}`);
    const preview = document.getElementById(`prev_${fieldId}`);
    const hiddenInput = document.getElementById(`val_${fieldId}`);
    const member = window.globalData.famiglia.data[window.currentMemberIndex];

    try {
        // Mostra lo spinner
        if (spinner) spinner.classList.remove('d-none');

        const reader = new FileReader();
        reader.readAsDataURL(file);

        reader.onload = async (e) => {
            const base64Full = e.target.result; // Contiene "data:image/png;base64,..."

            // Anteprima locale immediata per l'utente (sbiadita)
            if (preview) {
                preview.src = base64Full;
                preview.style.opacity = "0.4";
            }

            // Costruzione nome file professionale per Drive
            const cognome = (member.Cognome || "Socio").trim().toUpperCase();
            const nome = (member.Nome || "").trim().toUpperCase();
            const idSocio = member.IDContatto || "000";
            const ext = file.name.split('.').pop();
            const filename = `${label.toUpperCase()} - ${cognome} ${nome} (${idSocio}) - ${Date.now()}.${ext}`;

            try {
                // --- CHIAMATA AL PONTE GAS ---
                // Spediamo base64 pulito (senza prefisso) e mimeType separato per risolvere l'errore newBlob
                const res = await callGAS("uploadDocumento", {
                    base64: base64Full.split(',')[1],
                    mimeType: file.type,
                    filename: filename
                });

                if (res && res.url) {
                    // TRASFORMAZIONE URL: Converte link visualizzazione in miniatura reale
                    const finalThumbUrl = getThumbnailUrl(res.url);

                    if (preview) {
                        preview.src = finalThumbUrl; // Carica la miniatura Google
                        preview.style.opacity = "1"; // Torna nitida
                        preview.style.borderColor = "#28a745"; // Bordo verde conferma
                        // Aggiorna il click affinché apra il file originale
                        preview.onclick = () => window.open(res.url, '_blank');
                    }

                    // Salva l'URL originale nel campo nascosto per la funzione SALVA
                    if (hiddenInput) {
                        hiddenInput.value = res.url;
                        // Notifica il sistema per la validazione delle bolle
                        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    // --- AGGIORNAMENTO CACHE LOCALE ---
                    const idCLow = idSocio.toString().toLowerCase().trim();
                    member[fieldId] = res.url;

                    // Aggiorna anche le mappe tecniche se presenti
                    if (window.globalData.atleti[idCLow]) window.globalData.atleti[idCLow][fieldId] = res.url;
                    if (window.globalData.privacyData[idCLow]) window.globalData.privacyData[idCLow][fieldId] = res.url;

                    // Aggiorna la valigia sessionStorage per non perdere il dato tornando indietro
                    sessionStorage.setItem('myoval_shared_data', JSON.stringify(window.globalData));

                    alert("✅ Immagine caricata correttamente!\n\nRicorda di cliccare SALVA in fondo per confermare.");
                }
            } catch (err) {
                console.error("Errore bridge:", err);
                alert("❌ Errore caricamento: " + err.message);
                if (preview) preview.src = "https://placehold.co/150x150?text=Errore+Upload";
            } finally {
                // Nascondi lo spinner
                if (spinner) spinner.classList.add('d-none');
            }
        };
    } catch (e) {
        if (spinner) spinner.classList.add('d-none');
    }
};

/**
* 8. SALVATAGGIO SCHEDA (Via GAS Bridge)
*/

window.salvaSchedaAttiva = async function () {
    // 1. Recupero riferimenti e membro attuale
    const index = window.currentMemberIndex;
    const member = window.globalData.famiglia.data[index];
    const idFam = window.globalData.idFamiglia;

    if (!member) return alert("Errore: nessun membro selezionato.");

    // --- PROTEZIONE DI SICUREZZA ID FAMIGLIA ---
    // Se l'ID Famiglia è uguale all'ID Contatto (e lungo come un FIR), blocchiamo per evitare danni allo Spreadsheet
    if (idFam && idFam.length > 5 && idFam === member.IDContatto) {
        console.error("❌ Blocco sicurezza: ID Famiglia corrotto rilevato (corrisponde al FIR).");
        alert("⚠️ Si è verificato un problema con l'ID Famiglia. Per sicurezza il salvataggio è sospeso. Ricarica la pagina (F5).");
        return;
    }

    const btn = document.querySelector('button[onclick="salvaSchedaAttiva()"]');
    const originalText = btn ? btn.innerHTML : "SALVA MODIFICHE";

    try {
        // 2. UI: Stato di caricamento
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>SALVATAGGIO...';
        }

        // 3. RACCOLTA DATI DAI CAMPI .val-field
        const fields = document.querySelectorAll('.val-field');

        // Prepariamo il payload per GAS
        const updateData = {
            idContatto: member.IDContatto,
            ID_Famiglia: idFam // Necessario per creare righe mancanti in Taglie/Privacy
        };

        const idCLow = member.IDContatto.toString().toLowerCase().trim();

        fields.forEach(f => {
            const id = f.getAttribute('data-id');
            if (!id) return;

            // Leggiamo il valore corretto (booleano per checkbox, testo per gli altri)
            const val = f.type === 'checkbox' ? f.checked : f.value;

            // Popoliamo il pacchetto per il server
            updateData[id] = val;

            // --- AGGIORNAMENTO MEMORIA LOCALE (Sincronizzazione Totale) ---
            // 1. Aggiorna l'oggetto nella lista famiglia
            member[id] = val;

            // 2. Aggiorna i "cassetti" tecnici se il campo appartiene a quelli
            if (window.globalData.atleti[idCLow]) window.globalData.atleti[idCLow][id] = val;
            if (window.globalData.taglieKit[idCLow]) window.globalData.taglieKit[idCLow][id] = val;
            if (window.globalData.privacyData[idCLow]) window.globalData.privacyData[idCLow][id] = val;
        });

        console.log(`📤 Invio aggiornamento a GAS per ${member.Nome}:`, updateData);

        // 4. CHIAMATA AL PONTE GAS
        const res = await callGAS("salvaDatiMembro", { payload: updateData });

        if (res && res.success) {
            // --- 5. AGGIORNAMENTO CACHE DI SESSIONE (La valigia) ---
            // Salviamo lo stato globale aggiornato nel sessionStorage
            // Questo garantisce che tornando dallo Shop o ricaricando, i dati siano già pronti
            sessionStorage.setItem('myoval_shared_data', JSON.stringify(window.globalData));

            // 6. RE-VALIDAZIONE UI
            // Ricalcola se la bolla deve essere VERDE o ROSSA dopo le modifiche
            if (typeof checkMemberValidation === "function") {
                checkMemberValidation(index);
            }

            alert("✅ Dati salvati con successo nello Spreadsheet!");
        } else {
            throw new Error(res ? res.error : "Il server Google non ha risposto correttamente.");
        }

    } catch (error) {
        console.error("❌ Errore durante il salvataggio:", error);
        alert("⚠️ Errore durante il salvataggio: " + error.message);
    } finally {
        // 7. UI: Ripristino pulsante
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};


/**
 * Disegna la lista dei codici di tesseramento (FIR, UISP...)
 */
function renderCodiciBadge(idSocio) {
    const container = document.getElementById('ui-codici-list');
    if (!container) return;

    if (!window.globalData.codici || window.globalData.codici.length === 0) {
        container.innerHTML = "";
        return;
    }

    // Filtriamo i codici per il socio selezionato (confronto IDContatto)
    const codiciMembro = window.globalData.codici.filter(c => {
        const idCampo = c.ID_Contatto || c.IDContatto || "";
        return idCampo.toString().toLowerCase() === idSocio.toString().toLowerCase();
    });

    if (codiciMembro.length === 0) {
        container.innerHTML = "";
        return;
    }

    // Generazione HTML Badge
    container.innerHTML = codiciMembro.map(c => {
        const ente = c.Tipo_Tesseramento || c.Ente || "INFO";
        const codice = c.Codice || "-";

        return `
            <div class="registration-badge animate__animated animate__fadeInRight mb-1">
                <div class="reg-type" style="background:#1a2b3c; color:white; padding:2px 8px; font-size:10px; font-weight:800; border-radius:4px 0 0 4px;">${ente}</div>
                <div class="reg-val" style="background:white; color:#a00000; padding:2px 10px; font-size:11px; font-weight:800; border:1px solid #dee2e6; border-left:none; border-radius:0 4px 4px 0; font-family:monospace;">${codice}</div>
            </div>`;
    }).join('');
}

/**
 * Funzione CORE per decidere se un campo è mancante
 */
function isFieldMissing(conf, memberData, isAtleta) {
    if (!conf.visibile || conf.readonly) return false;
    if (conf.tipoDato?.toLowerCase().includes("atleti") && !isAtleta) return false;
    if (conf.required) {
        const val = getValue(memberData, conf.id);
        if (conf.tipoInput === "switch" || conf.tipoInput === "checkbox" || conf.tipoInput === "multi-lista") return !forceBool(val);
        const vStr = val ? val.toString().trim() : "";
        return (vStr === "" || vStr === "01/01/1900");
    }
    return false;
}



/**
 * Forza qualunque valore (SÌ, VERO, TRUE, 1) a diventare un booleano Javascript true/false
 */
function forceBool(val) {
    if (val === true || val === 1 || val === "true" || val === "TRUE") return true;
    if (typeof val === "string") {
        const s = val.toUpperCase().trim();
        return s === "TRUE" || s === "SÌ" || s === "SI" || s === "VERO" || s === "ON" || s === "1";
    }
    return false;
}

/**
 * Gestore universale per il lancio delle funzionalità
 */
window.execFunzione = function (link, tipo, titolo) {
    if (!link || link === "undefined" || link === "") {
        console.error("❌ Errore: URL non configurato per", titolo);
        alert("Configurazione URL mancante per questo servizio.");
        return;
    }

    const tipoPuro = (tipo || "IFRAME").toString().toUpperCase().trim();

    // 1. RECUPERO DATI PER I SEGNAPOSTO (<EMAIL>, <FAMIGLIA>, <CONTATTO>)
    const selectedMember = window.globalData.famiglia.data[window.currentMemberIndex];
    const params = {
        email: window.globalData.userEmail,
        idFamiglia: window.globalData.idFamiglia,
        idContatto: selectedMember ? selectedMember.IDContatto : ""
    };

    // 2. RISOLUZIONE SEGNAPOSTO
    let finalUrl = resolveUrlParams(link, params);

    // --- 3. LOGICA ANTI-MULTILOGIN E STABILIZZAZIONE URL ---

    // A. Rimuoviamo il prefisso organizzativo (es. /a/rugbymilano.it/) 
    // Spesso causa redirect infiniti negli Iframe
    finalUrl = finalUrl.replace(/\/a\/macros\/[^\/]+\//, "/macros/");

    // B. Rimuoviamo identificativi di sessione locale (es. /u/0/ o /u/1/)
    // Trasforma l'URL in un indirizzo "Canonico"
    finalUrl = finalUrl.replace(/\/u\/\d+\//, "/");

    // C. Aggiungiamo i parametri di stabilità per Google
    const separator = finalUrl.includes('?') ? '&' : '?';

    // Forza Google a usare la sessione attiva corrente (authuser=0)
    if (!finalUrl.includes('authuser')) {
        finalUrl += `${separator}authuser=0`;
    }

    // Suggerisce il dominio Hosted (hd) per ridurre i check di sicurezza inutili
    if (!finalUrl.includes('hd=')) {
        finalUrl += `&hd=rugbymilano.it`;
    }

    // --- LOG DI DIAGNOSTICA ---
    console.group(`🚀 LANCIO SERVIZIO: ${titolo}`);
    console.log("🔗 URL Originale:", link);
    console.log("🛠️ URL Stabilizzato:", finalUrl);
    console.log("🏷️ Tipo Rilevato:", tipoPuro);
    console.groupEnd();

    if (tipo === "REDIRECT") {
        console.log("📦 Impacchettamento dati per app satellite...");

        // Creiamo il pacchetto prendendo tutto quello che abbiamo in globalData
        const dataToPass = {
            ...window.globalData,
            selectedMemberIndex: window.currentMemberIndex
        };

        // Salvataggio nel sessionStorage
        sessionStorage.setItem('myoval_shared_data', JSON.stringify(dataToPass));

        console.log("🚀 Reindirizzamento a:", link);
        window.location.href = link;
    }

    // 4. ESECUZIONE LANCIO
    else if (tipoPuro === "EXTERNAL" || tipoPuro === "URL") {
        // --- CASO ESTERNO: Nuova Scheda ---
        window.open(finalUrl, '_blank');
    } else {
        // --- CASO INTERNO: Iframe (service-view) ---
        const dashboard = document.getElementById('dashboard-view');
        const serviceView = document.getElementById('service-view');
        const iframe = document.getElementById('service-iframe');
        const titleLabel = document.getElementById('service-title');

        if (dashboard && serviceView && iframe) {
            // Nascondiamo la dashboard centrale
            dashboard.style.setProperty('display', 'none', 'important');

            // Mostriamo l'area servizio a tutto schermo
            serviceView.classList.remove('d-none');
            serviceView.style.setProperty('display', 'flex', 'important');

            if (titleLabel) titleLabel.innerText = titolo;

            // Carichiamo l'URL stabilizzato nell'Iframe
            console.log("📡 Iniezione URL nell'Iframe...");
            iframe.src = finalUrl;

            // Portiamo la pagina in cima
            window.scrollTo(0, 0);
        } else {
            console.error("❌ Elementi dell'interfaccia Iframe non trovati!");
            // Fallback d'emergenza in caso di errore UI
            window.open(finalUrl, '_blank');
        }
    }
};

/**
 * CHIUSURA SERVIZIO: Torna alla dashboard e pulisce l'Iframe
 */
window.closeService = function () {
    const dashboard = document.getElementById('dashboard-view');
    const serviceView = document.getElementById('service-view');
    const iframe = document.getElementById('service-iframe');

    if (serviceView) {
        serviceView.classList.add('d-none');
        serviceView.style.setProperty('display', 'none', 'important');
    }

    if (dashboard) {
        dashboard.classList.remove('d-none');
        dashboard.style.setProperty('display', 'block', 'important');
    }

    if (iframe) {
        iframe.src = "about:blank"; // Libera la memoria del browser
    }
};

window.execFunzioneOLD = function (link, tipo, titolo) {
    if (!link || link === "undefined") {
        alert("Configurazione URL mancante per: " + titolo);
        return;
    }

    // 1. Prepariamo i dati per i segnaposto
    const selectedMember = window.globalData.famiglia.data[window.currentMemberIndex];
    const params = {
        email: window.globalData.userEmail,
        idFamiglia: window.globalData.idFamiglia,
        idContatto: selectedMember ? selectedMember.IDContatto : ""
    };

    // 2. Risolviamo l'URL (sostituisce <EMAIL>, <FAMIGLIA>, <CONTATTO>)
    const finalUrl = resolveUrlParams(link, params);

    console.log(`🚀 Lancio Servizio: ${titolo} | URL Risolto: ${finalUrl}`);

    if (tipo === "EXTERNAL" || tipo === "URL") {
        window.open(finalUrl, '_blank');
    } else {
        const dashboard = document.getElementById('dashboard-view');
        const serviceView = document.getElementById('service-view');
        const iframe = document.getElementById('service-iframe');
        const titleLabel = document.getElementById('service-title');

        if (dashboard && serviceView && iframe) {
            dashboard.classList.add('d-none');
            serviceView.classList.remove('d-none');
            if (titleLabel) titleLabel.innerText = titolo;
            iframe.src = finalUrl;
            window.scrollTo(0, 0);
        }
    }
};

/**
 * Funzione per generare i bottoni nel box
 */
export function buildFunzioniUI(lista) {
    const container = document.getElementById('funzioni-container');
    if (!container) return;

    if (!lista || lista.length === 0) {
        container.innerHTML = '<div class="col-12 text-center text-muted small py-3">Nessun servizio disponibile.</div>';
        return;
    }

    // 1. ORDINAMENTO: Ora f.ordine esiste e contiene il numero di config_access
    const listaOrdinata = [...lista].sort((a, b) => (a.ordine || 0) - (b.ordine || 0));

    // 2. SINCRONIZZAZIONE: Salviamo la lista ordinata nei dati globali
    window.globalData.funzioni = listaOrdinata;

    // 3. RENDERING: Usiamo l'indice (index) per chiamare la funzione di lancio
    container.innerHTML = listaOrdinata.map((f, index) => {
        const icona = f.tipo === 'IFRAME' ? 'fa-window-maximize' : 'fa-external-link-alt';

        return `
            <div class="col-6 col-md-4">
                <div class="service-btn-compact h-100 animate__animated animate__fadeIn" 
                     onclick="window.selectAndExecFunzione(${index})" 
                     style="cursor:pointer">
                    <i class="fas ${icona} text-danger me-2" style="font-size: 0.8rem;"></i>
                    <span class="fw-bold text-dark" style="font-size: 0.7rem; text-transform: uppercase;">${f.nome}</span>
                </div>
            </div>`;
    }).join('');
}

// Rendiamo le funzioni globali per l'HTML
window.buildFunzioniUI = buildFunzioniUI;
window.closeService = function () {
    document.getElementById('service-view').classList.add('d-none');
    document.getElementById('service-view').style.display = 'none';
    document.getElementById('dashboard-view').classList.remove('d-none');
    document.getElementById('dashboard-view').style.display = 'block';
    document.getElementById('service-iframe').src = "about:blank";
};

/**
 * Funzione intermedia per recuperare i dati corretti prima del lancio
 */
window.selectAndExecFunzione = function (index) {
    const funz = window.globalData.funzioni[index];
    if (funz) {
        // Passiamo i dati puliti alla funzione di lancio
        window.execFunzione(funz.link, funz.tipo, funz.nome);
    } else {
        console.error("❌ Indice funzione non trovato in globalData:", index);
    }
};

// ESPOSIZIONE GLOBALE (Aggiungi questa riga se manca)
window.renderAnagraficaForm = renderAnagraficaForm;
window.selectMember = selectMember;
window.salvaSchedaAttiva = salvaSchedaAttiva;
window.buildFamilyUI = buildFamilyUI;
window.buildFunzioniUI = (l) => { /* logic */ };
