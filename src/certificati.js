import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { callGAS, safeSet, formattaDataRugby } from "./utils.js";

// Definiamo sharedData a livello di modulo (visibile a tutte le funzioni nel file)
let sharedData = null;
let idSelezionato = null;

/**
 * 1. ASCOLTATORE AUTENTICAZIONE E CARICAMENTO SESSIONE
 */
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Recupero il pacchetto dati dal sessionStorage
        const raw = sessionStorage.getItem('myoval_shared_data');

        if (!raw) {
            console.error("❌ Dati sessione non trovati");
            window.location.href = "index.html";
            return;
        }

        try {
            // --- FIX: Rimuoviamo 'const' o 'let' qui sotto per assegnare alla variabile globale ---
            sharedData = JSON.parse(raw);
            console.log("📦 Dati sessione caricati:", sharedData);

            // 2. SINCRONIZZAZIONE NAVBAR (Logo statico + Email dinamica)
            const emailLabel = document.getElementById('user-email-display-cert');
            if (emailLabel) emailLabel.innerText = sharedData.userEmail || user.email;

            // Il logo è caricato staticamente nell'HTML (logo-as-rugby-milano.png)

            // 3. AVVIO LOGICA UI
            if (sharedData.famiglia && sharedData.famiglia.data) {
                renderAtletiSelector();

                // Seleziona l'atleta che era attivo nella dashboard
                const initialId = sharedData.famiglia.data[sharedData.selectedMemberIndex]?.IDContatto;
                if (initialId) {
                    window.selezionaAtleta(initialId);
                }
            }
        } catch (e) {
            console.error("❌ Errore durante il parsing dei dati:", e);
            window.location.href = "index.html";
        }

    } else {
        // Non loggato: torna al login
        window.location.href = "index.html";
    }
});

/**
 * 4. DISEGNA LE BOLLE DEI TESSERATI (Solo Atleti)
 */
function renderAtletiSelector() {
    const container = document.getElementById('atleti-selector');
    if (!container || !sharedData) return;

    // Filtriamo per mostrare solo chi ha "atleta" nel ruolo
    const atleti = sharedData.famiglia.data.filter(m =>
        (m.Ruolo || "").toLowerCase().includes("atleta")
    );

    container.innerHTML = atleti.map(a => {
        const id = (a.IDContatto || "").toString();
        return `
            <div class="family-item" id="f-${id}" onclick="window.selezionaAtleta('${id}')">
                <div class="avatar-circle">
                    <i class="fas fa-running"></i>
                </div>
                <div class="family-name text-truncate small fw-bold mt-2">${a.Nome}</div>
            </div>`;
    }).join('');
}

/**
 * 5. GESTISCE LA SELEZIONE DELL'ATLETA
 */
window.selezionaAtleta = (id) => {
    // Protezione contro sharedData nullo
    if (!sharedData || !sharedData.famiglia) return;

    idSelezionato = id;

    // Estetica bolle
    document.querySelectorAll('.family-item').forEach(el => el.classList.remove('active'));
    const bubble = document.getElementById(`f-${id}`);
    if (bubble) bubble.classList.add('active');

    // Recupero dati dell'atleta selezionato
    const a = sharedData.famiglia.data.find(x => x.IDContatto.toString() === id.toString());
    if (a) {
        safeSet('nome-atleta-selezionato', `Per: ${a.Nome} ${a.Cognome}`);
    }

    // Pulisce eventuali messaggi precedenti
    const statusMsg = document.getElementById('status-message');
    if (statusMsg) statusMsg.innerHTML = '';
};

/**
 * 4. LOGICA UPLOAD (Bridge GAS)
 */
window.avviaUpload = function () {
    const fileEl = document.getElementById('fileInput');
    const scadenzaEl = document.getElementById('scadenzaInput');
    const btn = document.getElementById('btnUpload');
    const overlay = document.getElementById('upload-overlay');

    if (!idSelezionato) return alert("Seleziona un tesserato");
    if (!scadenzaEl.value || !fileEl.files[0]) return alert("Data scadenza e file obbligatori");

    const file = fileEl.files[0];
    const datiAtleta = sharedData.famiglia.data.find(x => x.IDContatto.toString() === idSelezionato.toString());
    // Cerchiamo il codice FIR (che abbiamo caricato nella atletiMap in portal.js)
    const techInfo = sharedData.atleti[idSelezionato.toString().toLowerCase()] || {};

    overlay.classList.remove('d-none');
    overlay.style.display = 'flex';
    btn.disabled = true;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async (e) => {
        const fileObject = {
            idFamiglia: sharedData.idFamiglia,
            idContatto: idSelezionato,
            nomeTesserato: `${datiAtleta.Cognome} ${datiAtleta.Nome}`,
            fileName: file.name,
            mimeType: file.type,
            data: e.target.result.split(',')[1], // Base64 puro
            scadenza: scadenzaEl.value,
            codiceFIR: techInfo.FIR || ""
        };

        try {
            // Chiamata al ponte GAS (che deve gestire 'handleUploadCertificato')
            const res = await callGAS("handleUploadCertificato", fileObject);

            document.getElementById('status-message').innerHTML = `
                <div class="alert alert-success shadow-sm border-0 p-3">
                    <i class="fas fa-check-circle me-2"></i> ${res.message}
                </div>`;
            document.getElementById('uploadForm').reset();
        } catch (err) {
            document.getElementById('status-message').innerHTML = `
                <div class="alert alert-danger shadow-sm border-0 p-3">
                    <i class="fas fa-times-circle me-2"></i> Errore: ${err.message}
                </div>`;
        } finally {
            overlay.classList.add('d-none');
            overlay.style.display = 'none';
            btn.disabled = false;
        }
    };
};