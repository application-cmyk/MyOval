import { formattaDataRugby, safeSet, callGAS } from "./utils.js";
import { resolveUrlParams } from "./utils.js"; // Importa la nuova utility

/**
 * Utility per estrarre valori in modo tollerante (case-insensitive e underscore-safe)
 */
function getValue(obj, key) {
    if (!obj || !key) return "";
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    const cleanSearch = key.toLowerCase().replace(/_/g, "");
    const realKey = Object.keys(obj).find(k => k.toLowerCase().replace(/_/g, "") === cleanSearch);
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
    if (!window.globalData || !window.globalData.famiglia || !window.globalData.famiglia.data[index]) {
        console.error("❌ Dati non pronti per l'indice:", index);
        return;
    }

    const memberBase = window.globalData.famiglia.data[index];
    const idC = (memberBase.IDContatto || "").toString().toLowerCase().trim();

    // --- LOGICA DI RICONOSCIMENTO GUIDATA DAL RUOLO ---
    // Leggiamo il ruolo e verifichiamo se contiene la parola "atleta"
    const ruoloStr = (getValue(memberBase, "Ruolo") || "").toLowerCase();
    const isAtleta = ruoloStr.includes("atleta");

    // Scelta del profilo di configurazione
    const profileTarget = isAtleta ? "ATLETA" : "ASSOCIATO";

    console.log(`%c 🎯 SELEZIONE: ${memberBase.Nome} `, "background: #1a2b3c; color: #fff; font-weight: bold;");
    console.log(`👤 Ruolo trovato: "${ruoloStr}"`);
    console.log(`✨ IsAtleta: ${isAtleta} | Profilo applicato: ${profileTarget}`);

    window.currentMemberIndex = index;
    window.currentProfileInUso = profileTarget;

    // --- MERGE DEI DATI ---
    // Recuperiamo i dati tecnici, kit e privacy per popolare i campi (se esistono)
    const tech = window.globalData.atleti[idC] || {};
    const kit = window.globalData.taglieKit[idC] || {};
    const priv = window.globalData.privacyData[idC] || {};
    const fullData = { ...memberBase, ...tech, ...kit, ...priv };

    // 1. Gestione visuale delle bolle
    document.querySelectorAll('.family-item').forEach(el => el.classList.remove('active'));
    const bubble = document.getElementById(`f-${index}`);
    if (bubble) bubble.classList.add('active');

    // 2. Aggiornamento Dashboard Superiore (Sommario)
    const fullNome = `${memberBase.Cognome || ''} ${memberBase.Nome || ''}`.toUpperCase();
    safeSet('ui-nome-completo', fullNome);
    safeSet('ui-ruolo', memberBase.Ruolo || "Socio");
    safeSet('ui-nascita', formattaDataRugby(memberBase.Data_Nascita));
    safeSet('ui-anagrafica-title', `ANAGRAFICA ${fullNome}`);

    // Gestione Pillole Tecniche (Stagione, Categoria, Tipo)
    const techHeader = document.getElementById('ui-tech-header');
    if (techHeader) {
        if (isAtleta) {
            techHeader.classList.remove('d-none');
            safeSet('ui-stagione', tech.Stagione || "-");
            safeSet('ui-categoria', tech.Categoria_Fed || tech.Categoria || "-");
            safeSet('ui-tipo', tech.Tipo || "-");
        } else {
            // Se non è atleta, nascondiamo l'intera riga tecnica
            techHeader.classList.add('d-none');
        }
    }

    // 3. Gestione Badge Stato (Box Giallo/Verde)
    const badge = document.getElementById('ui-badge-stato');
    if (badge) {
        if (isAtleta && tech.Stato_Tesseramento) {
            const st = tech.Stato_Tesseramento.toUpperCase();
            badge.innerText = st;
            badge.className = "badge-stato " + (st.includes("TESSERATO") ? "bg-success text-white" : "bg-warning text-dark");
            badge.classList.remove('d-none');
        } else {
            badge.classList.add('d-none');
        }
    }

    // 4. Disegno Badge Tesseramento (FIR, UISP...)
    if (typeof renderCodiciBadge === "function") {
        renderCodiciBadge(idC);
    }

    // 5. Rendering del Form Dinamico
    const config = window.globalData.config[profileTarget] || [];
    renderAnagraficaForm(fullData, config, isAtleta);

    // 6. GESTIONE TENDA CHIUSA DI DEFAULT
    const collapseEl = document.getElementById('profile-collapse-area');
    if (collapseEl && window.bootstrap) {
        const bsCollapse = window.bootstrap.Collapse.getOrCreateInstance(collapseEl);
        bsCollapse.hide();
    }
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

    if (!config || config.length === 0) {
        container.innerHTML = `<div class="p-2 text-center text-muted small">Configurazione non disponibile.</div>`;
        return;
    }

    const campiOrdinati = [...config].sort((a, b) => (a.ordine || 0) - (b.ordine || 0));

    // Usiamo g-2 invece di g-3 per ridurre lo spazio tra le colonne
    let html = '<div class="row g-2">';
    let lastSection = "";

    campiOrdinati.forEach(conf => {
        if (conf.visibile === false) return;

        // Filtro Atleta (Se il campo è tecnico e l'utente non è atleta, salta)
        const tDato = (conf.tipoDato || "").toLowerCase().trim();
        if (tDato.includes("atleti") && !isAtleta) return;

        // Sezione compatta
        if (conf.sezione !== lastSection) {
            lastSection = conf.sezione;
            html += `<div class="col-12"><div class="rm-section-title mt-2 mb-1" style="font-size:0.75rem; padding:4px 10px;">${lastSection}</div></div>`;
        }

        // Recupero valore e validazione
        const valore = getValue(memberData, conf.id);
        const missing = isFieldMissing(conf, memberData, isAtleta);
        const errorClass = missing ? "is-invalid" : "";
        const asterisco = (conf.required && !conf.readonly) ? '<span class="text-danger fw-bold">*</span>' : '';

        // Override opzioni (per Squadre nello Shop)
        let currentConf = { ...conf };
        if (optionsOverride && optionsOverride[conf.id]) {
            currentConf.opzioni = optionsOverride[conf.id];
        }

        const colSize = conf.larghezza || 4;
        const helpHtml = conf.sottotitolo ? `<span class="help-text" style="font-size:0.6rem;">${conf.sottotitolo}</span>` : "";

        html += `
            <div class="col-md-${colSize} col-12 mb-1">
                <label class="label-xs" style="font-size:0.65rem; margin-bottom:1px;">${conf.label}${asterisco}</label>
                ${generaInputHtml(currentConf, valore, errorClass)}
                ${helpHtml}
            </div>`;
    });

    html += '</div>';

    // Bottone Salva rimpicciolito (btn-sm)
    if (targetContainerId === 'anagrafica-form-content') {
        html += `
            <div class="d-flex justify-content-end mt-3 pt-2 border-top">
                <button class="btn btn-success btn-sm fw-bold px-4 shadow-sm" onclick="salvaSchedaAttiva()">
                    <i class="fas fa-save me-1"></i> SALVA MODIFICHE
                </button>
            </div>`;
    }

    container.innerHTML = html;

    // Ri-aggancio listener (Invariato)
    agganciaListenerValidazione(container);
}


// Funzione helper per non appesantire il render
function agganciaListenerValidazione(container, targetContainerId) { // <--- Nome uniformato
    container.querySelectorAll('.val-field').forEach(el => {
        const validate = (e) => {
            const input = e.target;
            const fieldId = input.getAttribute('data-id');
            const isReq = input.hasAttribute('required');

            // Valore reale
            const currentVal = input.type === 'checkbox' ? input.checked : input.value;

            // Logica bordo rosso
            if (isReq) {
                const isEmpty = input.type === 'checkbox' ? !input.checked : (!input.value || input.value.trim() === "");
                if (isEmpty) {
                    input.classList.add('is-invalid');
                } else {
                    input.classList.remove('is-invalid');
                }
            }

            // --- FIX ERRORE: Aggiorna memoria locale solo se siamo nel portale principale ---
            if (targetContainerId === 'anagrafica-form-content') {
                if (window.globalData && window.globalData.famiglia.data[window.currentMemberIndex]) {
                    window.globalData.famiglia.data[window.currentMemberIndex][fieldId] = currentVal;
                    checkMemberValidation(window.currentMemberIndex);
                }
            }
        };

        el.addEventListener('input', validate);
        el.addEventListener('change', validate);
    });
}

/**
 * 6. GENERATORE INPUT
 */
function generaInputHtml(conf, valore, errorClass = "") {
    const tipo = (conf.tipoInput || "testo").toLowerCase();
    const commonClass = `form-control form-control-sm val-field shadow-none ${errorClass}`;
    const selectClass = `form-select form-select-sm val-field shadow-none ${errorClass}`;
    const ro = conf.readonly ? "readonly disabled style='background-color: #f8f9fa; cursor: not-allowed;'" : "";
    const rq = conf.required ? "required" : "";
    const v = (valore === null || valore === undefined) ? "" : valore;

    switch (tipo) {
        case "lista":
            const options = Array.isArray(conf.opzioni) ? conf.opzioni : [];
            let optionsHtml = `<option value="">-</option>`;

            // Il valore dell'anagrafica pulito (es. "U18, Cadetti" -> "u18, cadetti")
            const valAnagrafica = v.toString().toLowerCase().trim();

            options.forEach(o => {
                const optStr = o.toString().trim();
                const optLower = optStr.toLowerCase();
                let isSelected = "";

                // --- LOGICA RICHIESTA ---
                // 1. Se la lista fornita dall'articolo ha solo 1 opzione, viene assegnata automaticamente
                if (options.length === 1) {
                    isSelected = "selected";
                }
                // 2. Se Matilde ha già quella squadra in anagrafica (anche tra tante), pre-seleziona
                else if (valAnagrafica !== "" && valAnagrafica.includes(optLower)) {
                    isSelected = "selected";
                }

                optionsHtml += `<option value="${optStr}" ${isSelected}>${optStr}</option>`;
            });

            return `<select class="${selectClass}" data-id="${conf.id}" ${conf.readonly ? 'disabled' : ''} ${rq}>${optionsHtml}</select>`;

        case "data":
            let ds = "";
            if (v) {
                const s = v.toString();
                if (s.includes('/')) {
                    const p = s.split('/');
                    if (p.length === 3) ds = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
                } else { ds = s.split('T')[0]; }
            }
            return `<input type="date" class="${commonClass}" data-id="${conf.id}" value="${ds}" ${ro} ${rq}>`;

        case "switch":
        case "checkbox":
            const isChecked = forceBool(v);

            return `
        <div class="form-check form-switch">
            <input class="form-check-input val-field ${errorClass}" 
                   type="checkbox" 
                   role="switch" 
                   data-id="${conf.id}" 
                   ${isChecked ? 'checked' : ''} 
                   ${conf.readonly ? 'disabled' : ''} 
                   ${conf.required ? 'required' : ''}
                   style="float: none; margin-left: 0;">
        </div>`;

        case "immagine":
            const imgErr = errorClass ? "img-invalid" : "";
            // Usa getThumbnailUrl se definita in utils.js
            const thumb = (typeof getThumbnailUrl === "function") ? getThumbnailUrl(v) : v;
            return `
                <div class="d-flex align-items-center gap-2">
                    <img src="${thumb || 'https://placehold.co/40x40?text=Doc'}" 
                         id="prev_${conf.id}" class="img-doc-preview shadow-sm ${imgErr}" 
                         style="width:40px;height:40px;border-radius:6px;object-fit:contain;" 
                         onclick="window.open('${v}','_blank')">
                    <input type="hidden" class="val-field ${errorClass}" data-id="${conf.id}" id="val_${conf.id}" value="${v}" ${rq}>
                </div>`;

        default:
            return `<input type="text" class="${commonClass}" data-id="${conf.id}" value="${v}" placeholder="..." ${ro} ${rq}>`;
    }
}

/**
 * 7. GESTORE UPLOAD (GOOGLE DRIVE)
 */
window.handleFileUpload = async function (input, fieldId, label) {
    const file = input.files[0];
    if (!file) return;

    const spinner = document.getElementById(`spin_${fieldId}`);
    const preview = document.getElementById(`prev_${fieldId}`);
    const hiddenInput = document.getElementById(`val_${fieldId}`);
    const member = window.globalData.famiglia.data[window.currentMemberIndex];

    try {
        // 1. MOSTRA ANTEPRIMA LOCALE IMMEDIATA (Feedback istantaneo)
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async (e) => {
            const base64Data = e.target.result;

            // Facciamo vedere l'immagine all'utente SUBITO
            if (preview) {
                preview.src = base64Data;
                preview.style.opacity = "0.5"; // La mettiamo un po' sbiadita mentre carica
            }
            if (spinner) spinner.classList.remove('d-none');

            // Costruiamo il nome file professionale
            const cognome = (member.Cognome || "Socio").trim().toUpperCase();
            const nome = (member.Nome || "").trim().toUpperCase();
            const idSocio = member.IDContatto || "000";
            const tipoDoc = label.replace(/\s+/g, '_').toUpperCase();
            const extension = file.name.split('.').pop();
            const filename = `${tipoDoc} - ${cognome} ${nome} (${idSocio}) - ${Date.now()}.${extension}`;

            try {
                // 2. INVIO AL SERVER
                const res = await callGAS("uploadDocumento", {
                    base64: base64Data,
                    filename: filename
                });

                if (res && res.url) {
                    if (hiddenInput) {
                        hiddenInput.value = res.url;
                        // Forziamo l'aggiornamento manuale del valore nel campo
                        hiddenInput.setAttribute('value', res.url);
                    }
                    if (preview) preview.src = getThumbnailUrl(res.url);

                    // --- SINCRONIZZAZIONE CACHE IMMEDIATA ---
                    const idC = member.IDContatto.toString().toLowerCase();

                    // Aggiorniamo il campo ovunque possa trovarsi
                    member[fieldId] = res.url; // Aggiorna anagrafica
                    if (window.globalData.atleti[idC]) window.globalData.atleti[idC][fieldId] = res.url;
                    if (window.globalData.taglieKit[idC]) window.globalData.taglieKit[idC][fieldId] = res.url;
                    if (window.globalData.privacyData[idC]) window.globalData.privacyData[idC][fieldId] = res.url;

                    // Ricalcola subito la validazione
                    checkMemberValidation(window.currentMemberIndex);
                    alert("✅ Immagine pronta. Ricorda di cliccare SALVA in fondo per confermare.");
                }
            } catch (err) {
                alert("❌ Errore caricamento: " + err.message);
                if (preview) preview.src = "https://placehold.co/150x150?text=Errore";
            } finally {
                if (spinner) spinner.classList.add('d-none');
            }
        };
    } catch (e) {
        console.error("Errore FileReader:", e);
    }
};

/**
 * Utility per trasformare i link Drive in miniature visualizzabili nel browser
 */
function getThumbnailUrl(driveUrl) {
    if (!driveUrl || driveUrl === "") return "https://placehold.co/400x250?text=Nessun+Documento";
    const match = driveUrl.match(/[-\w]{25,}/);
    return match ? `https://drive.google.com/thumbnail?id=${match[0]}&sz=w400` : driveUrl;
}

// Utility per controllare se un valore è mancante (per lo stile immagine)
function isMissingStyle(val, conf) {
    if (!conf.required || conf.readonly) return false;
    return (!val || val.toString().trim() === "" || val === "01/01/1900");
}

/**
 * 8. SALVATAGGIO SCHEDA (Via GAS Bridge)
 */
window.salvaSchedaAttiva = async function () {
    const btn = document.querySelector('button[onclick="salvaSchedaAttiva()"]');
    const originalText = btn.innerHTML;

    // Recuperiamo il membro attuale
    const member = window.globalData.famiglia.data[window.currentMemberIndex];
    const idC = member.IDContatto;

    try {
        // UI: Loading
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>SALVATAGGIO IN CORSO...';

        // 1. RACCOLTA DATI
        const fields = document.querySelectorAll('.val-field');
        // Includiamo l'ID_Famiglia affinché GAS possa creare nuove righe correttamente
        const payload = {
            idContatto: member.IDContatto,
            ID_Famiglia: window.globalData.idFamiglia
        };

        fields.forEach(f => {
            const id = f.getAttribute('data-id');
            const val = f.type === 'checkbox' ? f.checked : f.value;
            payload[id] = val;

            // Sincronizza tutta la memoria locale per evitare "bolle rosse" post-salvataggio
            const idC = member.IDContatto.toString().toLowerCase();
            member[id] = val;
            if (window.globalData.atleti[idC]) window.globalData.atleti[idC][id] = val;
            if (window.globalData.taglieKit[idC]) window.globalData.taglieKit[idC][id] = val;
            if (window.globalData.privacyData[idC]) window.globalData.privacyData[idC][id] = val;
        });

        console.log("📤 Invio payload a GAS:", payload);

        // 3. CHIAMATA AL PONTE
        const res = await callGAS("salvaDatiMembro", { payload: payload });

        if (res && res.success) {
            alert("✅ Dati salvati con successo nello Spreadsheet!");

            // 4. RE-VALIDAZIONE BOLLE
            // Se l'utente ha riempito i campi mancanti, la bolla deve diventare verde
            if (typeof checkMemberValidation === "function") {
                checkMemberValidation(window.currentMemberIndex);
            }
        }

    } catch (error) {
        console.error("Errore durante il salvataggio:", error);
        alert("❌ Errore di salvataggio: " + error.message);
    } finally {
        // Ripristino pulsante
        btn.disabled = false;
        btn.innerHTML = originalText;
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
    const tDato = (conf.tipoDato || "").toLowerCase();
    if (tDato.includes("atleti") && !isAtleta) return false;

    if (conf.required) {
        const val = getValue(memberData, conf.id);

        // --- LOGICA SPECIFICA PER CHECKBOX/SWITCH ---
        if (conf.tipoInput === "switch" || conf.tipoInput === "checkbox") {
            // È "mancante" se non è spuntata (quindi se forceBool è false)
            return !forceBool(val);
        }

        // Logica per campi testo/data
        const vStr = (val !== null && val !== undefined) ? val.toString().trim() : "";
        return (vStr === "" || vStr === "01/01/1900" || vStr === "1900-01-01");
    }
    return false;
}

/**
 * Converte qualunque valore proveniente da GAS/Spreadsheet in Booleano reale
 */
function parseBool(val) {
    if (val === true || val === 1) return true;
    if (typeof val === "string") {
        const s = val.toUpperCase().trim();
        return s === "TRUE" || s === "SÌ" || s === "SI" || s === "ON" || s === "1";
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
        return s === "SÌ" || s === "SI" || s === "VERO" || s === "TRUE" || s === "1";
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

    // Ordiniamo la lista prima di disegnarla
    const listaOrdinata = [...lista].sort((a, b) => a.ordine - b.ordine);

    container.innerHTML = listaOrdinata.map((f, index) => {
        const icona = f.tipo === 'IFRAME' ? 'fa-window-maximize' : 'fa-external-link-alt';

        // Usiamo un indice per recuperare i dati dall'array globale ed evitare problemi di apici nell'URL
        return `
            <div class="col-6 col-md-4">
                <div class="service-btn-compact h-100 animate__animated animate__fadeIn" 
                     onclick="selectAndExecFunzione(${index})" 
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
