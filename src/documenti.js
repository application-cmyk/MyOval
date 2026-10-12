import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { callGAS, safeSet } from "./utils.js";

let sharedData = null;
let idSelezionato = null;

onAuthStateChanged(auth, (user) => {
    if (user) {
        const raw = sessionStorage.getItem('myoval_shared_data');
        if (!raw) { window.location.href = "index.html"; return; }

        sharedData = JSON.parse(raw);

        // Sincronizzazione Navbar
        const emailLabel = document.getElementById('user-email-display-docs');
        if (emailLabel) emailLabel.innerText = sharedData.userEmail || user.email;

        // Disegna le bolle per la famiglia
        renderAtletiSelector();

        // Seleziona di default il membro attivo nella home
        const initialId = sharedData.famiglia.data[sharedData.selectedMemberIndex]?.IDContatto;
        if (initialId) window.selezionaAtleta(initialId);

    } else {
        window.location.href = "index.html";
    }
});

function renderAtletiSelector() {
    const container = document.getElementById('atleti-selector');
    if (!container || !sharedData) return;

    container.innerHTML = sharedData.famiglia.data.map(a => `
        <div class="family-item" id="f-${a.IDContatto}" onclick="window.selezionaAtleta('${a.IDContatto}')">
            <div class="avatar-circle shadow-sm">
                <i class="fas ${(a.Ruolo || "").toLowerCase().includes("atleta") ? 'fa-running' : 'fa-user-tie'}"></i>
            </div>
            <div class="family-name text-truncate small fw-bold mt-2">${a.Nome}</div>
        </div>
    `).join('');
}

window.selezionaAtleta = async (id) => {
    idSelezionato = id;
    document.querySelectorAll('.family-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`f-${id}`)?.classList.add('active');

    const a = sharedData.famiglia.data.find(x => x.IDContatto.toString() === id.toString());
    safeSet('label-atleta-selezionato', `${a.Nome} ${a.Cognome}`);

    // Avvia caricamento documenti da GAS
    fetchDocumenti(id);
};

async function fetchDocumenti(idContatto) {
    const tbody = document.getElementById('docs-table-body');
    const status = document.getElementById('status-message');

    tbody.innerHTML = '';
    status.innerHTML = '<div class="spinner-border text-danger spinner-border-sm"></div><p class="text-muted small mt-2">Ricerca documenti...</p>';

    try {
        const docs = await callGAS("getDocumentiAtleta", {
            idFamiglia: sharedData.idFamiglia,
            idContatto: idContatto
        });

        // --- AGGIUNGI QUESTO LOG ---
        console.log("Dati ricevuti da GAS per i documenti:", docs);
        // ---------------------------

        status.innerHTML = '';

        if (!docs || docs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-5 text-muted italic">Nessun documento trovato per questo tesserato.</td></tr>';
            return;
        }

        tbody.innerHTML = docs.map(doc => `
            <tr class="animate__animated animate__fadeIn">
                <td><i class="fas fa-file-pdf text-danger me-2"></i><strong>${doc.nomeFile}</strong></td>
                <td class="text-center"><span class="badge bg-light text-danger border">${doc.scadenza}</span></td>
                <td class="text-center small text-muted">${doc.caricato}</td>
                <td class="text-end">
                    <a href="${doc.link}" target="_blank" class="btn btn-sm btn-outline-danger rounded-pill px-3 fw-bold">
                        <i class="fas fa-eye me-1"></i> VEDI
                    </a>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        status.innerHTML = `<div class="alert alert-danger small p-2">Errore recupero dati: ${e.message}</div>`;
    }
}
