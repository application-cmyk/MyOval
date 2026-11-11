import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { callGAS, safeSet } from "./utils.js";

let sharedData = null;
let atletaSelezionato = null;
let listaAllenamentiCache = [];

onAuthStateChanged(auth, (user) => {
    if (user) {
        const raw = sessionStorage.getItem('myoval_shared_data');
        if (!raw) { window.location.href = "index.html"; return; }

        sharedData = JSON.parse(raw);

        // Email Navbar
        const emailLabel = document.getElementById('user-email-display-presenze');
        if (emailLabel) emailLabel.innerText = sharedData.userEmail || user.email;

        // Disegna le bolle SOLO per chi è "Atleta"
        renderAtletiSelector();

    } else {
        window.location.href = "index.html";
    }
});

function renderAtletiSelector() {
    const container = document.getElementById('atleti-selector');
    if (!container || !sharedData?.famiglia?.data) return;

    // FILTRO RIGOROSO: Solo i membri che sono Atleti
    const soloAtleti = sharedData.famiglia.data.filter(m => {
        const ruolo = (m.Ruolo || m.ruolo || "").toString().toLowerCase();
        return ruolo.includes("atleta");
    });

    if (soloAtleti.length === 0) {
        container.innerHTML = `<div class="text-muted small italic p-3">Nessun atleta associato a questo nucleo familiare.</div>`;
        return;
    }

    container.innerHTML = soloAtleti.map(a => `
        <div class="family-item" id="f-${a.IDContatto}" onclick="window.selezionaAtleta('${a.IDContatto}')">
            <div class="avatar-circle shadow-sm">
                <i class="fas fa-running text-danger"></i>
            </div>
            <div class="family-name text-truncate small fw-bold mt-2">${a.Nome}</div>
        </div>
    `).join('');

    // Seleziona automaticamente il primo atleta disponibile
    if (soloAtleti.length > 0) {
        window.selezionaAtleta(soloAtleti[0].IDContatto);
    }
}

window.selezionaAtleta = async (id) => {
    id = id.toString();
    document.querySelectorAll('.family-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`f-${id}`)?.classList.add('active');

    // 1. Dati anagrafici (Nome e Cognome)
    const membroFamiglia = sharedData.famiglia.data.find(x => (x.IDContatto || x.id || "").toString() === id);
    if (membroFamiglia) {
        atletaSelezionato = membroFamiglia;
        safeSet('label-atleta-selezionato', `${membroFamiglia.Nome} ${membroFamiglia.Cognome}`);
    }

    // 2. Scheda Atleta da sharedData.atleti
    let datiAtleta = null;
    if (sharedData.atleti) {
        if (sharedData.atleti[id]) {
            datiAtleta = sharedData.atleti[id];
        } else if (Array.isArray(sharedData.atleti)) {
            datiAtleta = sharedData.atleti.find(a => (a.IDContatto || a.id || "").toString() === id);
        } else if (sharedData.atleti.data && Array.isArray(sharedData.atleti.data)) {
            datiAtleta = sharedData.atleti.data.find(a => (a.IDContatto || a.id || "").toString() === id);
        }
    }

    // 3. Lettura diretta di Categoria_Fed
    const categoria = (datiAtleta && datiAtleta.Categoria_Fed)
        ? datiAtleta.Categoria_Fed.toString().trim()
        : (membroFamiglia?.Categoria_Fed || "N.D.");

    console.log(`🏉 [ATLETA SELEZIONATO] ID: ${id} | Categoria_Fed: "${categoria}"`);

    safeSet('label-categoria-atleta', `Categoria: ${categoria}`);

    // 4. Caricamento allenamenti
    await fetchAllenamentiAtleta(id, categoria);
};

async function fetchAllenamentiAtleta(idContatto, categoria) {
    const container = document.getElementById('allenamenti-list-container'); // <-- ID CORRETTO
    const status = document.getElementById('status-message');

    if (container) container.innerHTML = '';
    if (status) status.innerHTML = '<div class="spinner-border text-danger spinner-border-sm"></div><p class="text-muted small mt-2">Caricamento sessioni di allenamento...</p>';

    try {
        const res = await callGAS("GetAllenamentiPerAtleta", {
            idContatto: idContatto,
            categoria: categoria,
            email: sharedData.userEmail,
            env: sharedData.environment
        });

        if (status) status.innerHTML = '';

        if (!res || !res.success || !res.allenamenti || res.allenamenti.length === 0) {
            if (container) {
                container.innerHTML = `
                    <div class="card p-4 text-center border-0 bg-light text-muted" style="border-radius: 10px;">
                        <i class="fas fa-calendar-times fs-3 mb-2 text-secondary"></i>
                        <span>Nessun allenamento programmato per la categoria <strong>"${categoria}"</strong>.</span>
                    </div>`;
            }
            return;
        }

        listaAllenamentiCache = res.allenamenti;
        renderTabellaAllenamenti(listaAllenamentiCache);

    } catch (e) {
        console.error("Errore recupero allenamenti:", e);
        if (status) status.innerHTML = `<div class="alert alert-danger small p-2">Errore nel caricamento: ${e.message}</div>`;
    }
}

function renderTabellaAllenamenti(allenamenti) {
    const container = document.getElementById('allenamenti-list-container');
    if (!container) return;

    const adesso = new Date();
    const giorniSettimana = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

    container.innerHTML = allenamenti.map(all => {
        const dataIso = all.dataAllenamento; // YYYY-MM-DD
        const isPresente = (all.mioStato || "").toUpperCase().includes("P");

        // Calcolo giorno della settimana e data formattata
        const pData = dataIso.split('-');
        const dataObj = new Date(parseInt(pData[0], 10), parseInt(pData[1], 10) - 1, parseInt(pData[2], 10));
        const nomeGiorno = giorniSettimana[dataObj.getDay()] || "";
        const dataFormatted = `${nomeGiorno} ${pData[2]}/${pData[1]}/${pData[0]}`;

        // Calcolo Scadenza
        const rawLimite = all.dataOraLimite ? all.dataOraLimite.replace(" ", "T") : "";
        let dataLimiteObj = null;
        if (rawLimite) dataLimiteObj = new Date(rawLimite);

        const isScaduto = dataLimiteObj ? (adesso > dataLimiteObj) : false;
        const isAperto = (all.stato || "Aperto").toLowerCase() === "aperto";
        const isRegConsentita = (all.registrazioneAtleta || "SI").toUpperCase() === "SI";

        // Testo Scadenza compatto
        let limiteHtml = "";
        if (rawLimite) {
            const oraStr = rawLimite.split('T')[1] || "";
            limiteHtml = `<span class="${isScaduto ? 'text-danger fw-bold' : 'text-muted'}" style="font-size: 11px;">
                <i class="far fa-clock me-1"></i>Limite: ${oraStr}
            </span>`;
        }

        // =========================================================================
        // ENTITÀ UNICA: STATO + AZIONE FUSI INSIEME
        // =========================================================================
        let entitaStatoAzioneHtml = "";

        if (!isAperto) {
            entitaStatoAzioneHtml = `
                <span class="badge bg-secondary py-2 px-3 fw-normal" style="font-size: 11px;">
                    <i class="fas fa-lock me-1"></i>Chiuso
                </span>`;
        } else if (!isRegConsentita) {
            entitaStatoAzioneHtml = `
                <span class="badge bg-warning text-dark py-2 px-3 fw-normal" style="font-size: 11px;">
                    <i class="fas fa-pause-circle me-1"></i>Non attiva
                </span>`;
        } else if (isScaduto) {
            entitaStatoAzioneHtml = `
                <span class="badge bg-light text-muted border py-2 px-3 fw-normal" style="font-size: 11px;">
                    <i class="fas fa-clock me-1"></i>Scaduto
                </span>`;
        } else {
            // Allenamento aperto e valido per registrarsi
            if (isPresente) {
                // Già presente -> Bottone Verde
                entitaStatoAzioneHtml = `
                    <button class="btn btn-sm btn-success fw-bold px-3 py-2 shadow-sm d-flex align-items-center gap-1 rounded-pill" 
                        id="btn-pres-${dataIso}"
                        style="font-size: 12px; min-width: 105px; justify-content: center;"
                        onclick="window.togglePresenzaAtleta('${dataIso}', false)"
                        title="Clicca per annullare la presenza">
                    <i class="fas fa-check-circle"></i>
                    <span>PRESENTE</span>
                    <i class="fas fa-times ms-1 text-white-50" style="font-size: 10px;"></i>
                </button>`;
            } else {
                // Non registrato -> Bottone Outline
                entitaStatoAzioneHtml = `
                    <button class="btn btn-sm btn-outline-success fw-bold px-3 py-2 shadow-sm d-flex align-items-center gap-1 rounded-pill" 
                            id="btn-pres-${dataIso}"
                            style="font-size: 12px; min-width: 105px; justify-content: center;"
                            onclick="window.togglePresenzaAtleta('${dataIso}', true)">
                        <i class="fas fa-plus-circle"></i>
                        <span>CI SARÒ</span>
                </button>`;
            }
        }

        return `
            <div class="card border shadow-sm p-3 bg-white" style="border-radius: 10px;">
                <div class="d-flex align-items-center justify-content-between">
                    
                    <!-- A SINISTRA: DATA E SCADENZA -->
                    <div>
                        <div class="fw-bold text-dark" style="font-size: 14.5px; line-height: 1.2;">
                            ${dataFormatted}
                        </div>
                        <div class="d-flex align-items-center gap-2 mt-1">
                            <span class="badge bg-light text-secondary border px-1" style="font-size: 9.5px;">${all.categoria}</span>
                            ${limiteHtml}
                        </div>
                    </div>

                    <!-- A DESTRA: ENTITÀ UNICA (STATO / AZIONE) -->
                    <div class="flex-shrink-0 ms-2">
                        ${entitaStatoAzioneHtml}
                    </div>

                </div>
            </div>
        `;
    }).join('');
}

// Azione al click di "CI SARÒ" o "Annulla Presenza"
window.togglePresenzaAtleta = async (dataIso, impostaPresente) => {
    if (!atletaSelezionato) return;

    const idAtl = (atletaSelezionato.IDContatto || "").toString();

    // 1. RECUPERO SCHEDA ATLETA COMPLETA (Categoria, Area, Squadra)
    let schedaAtleta = null;
    if (sharedData.atleti) {
        if (sharedData.atleti[idAtl]) schedaAtleta = sharedData.atleti[idAtl];
        else if (Array.isArray(sharedData.atleti)) schedaAtleta = sharedData.atleti.find(x => (x.IDContatto || "").toString() === idAtl);
    }

    const catReale = (schedaAtleta && (schedaAtleta.Categoria_Fed || schedaAtleta.Categoria))
        ? (schedaAtleta.Categoria_Fed || schedaAtleta.Categoria).toString().trim()
        : (atletaSelezionato.Categoria_Fed || atletaSelezionato.Categoria || "UNDER 18");

    const areaReale = (schedaAtleta && schedaAtleta.Area) ? schedaAtleta.Area : (atletaSelezionato.Area || "GIOVANILI");
    const squadReale = (schedaAtleta && schedaAtleta.Squadra) ? schedaAtleta.Squadra : (atletaSelezionato.Squadra || catReale);

    // 2. Attivazione Spinner
    const btn = document.getElementById(`btn-pres-${dataIso}`);
    let oldBtnHtml = "";
    if (btn) {
        oldBtnHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>`;
    }

    try {
        const res = await callGAS("RegistraPresenzaAtletaAutonoma", {
            idAtleta: idAtl,
            nomeAtleta: `${atletaSelezionato.Cognome} ${atletaSelezionato.Nome}`,
            categoria: catReale,       // es. "UNDER 18"
            area: areaReale,           // es. "GIOVANILI"
            squadra: squadReale,       // es. "UNDER 18"
            dataAllenamento: dataIso,
            presente: impostaPresente,
            userEmail: sharedData.userEmail || "", // SOLO EMAIL SENZA PREFISSI
            env: sharedData.environment
        });

        if (res && res.success) {
            const el = listaAllenamentiCache.find(x => x.dataAllenamento === dataIso);
            if (el) {
                el.mioStato = impostaPresente ? "P" : "";
            }
            renderTabellaAllenamenti(listaAllenamentiCache);
        } else {
            throw new Error(res?.error || "Errore durante il salvataggio.");
        }

    } catch (err) {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = oldBtnHtml;
        }
        alert("⚠️ " + err.message);
    }
};
