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
        const emailLabel = document.getElementById('user-email-display-visita');
        if (emailLabel) emailLabel.innerText = sharedData.userEmail || user.email;

        // Disegna bolle
        renderAtletiSelector();

        // Seleziona atleta attivo
        const initialId = sharedData.famiglia.data[sharedData.selectedMemberIndex]?.IDContatto;
        if (initialId) window.selezionaAtleta(initialId);

    } else {
        window.location.href = "index.html";
    }
});

function renderAtletiSelector() {
    const container = document.getElementById('atleti-selector');
    const atleti = sharedData.famiglia.data.filter(m => (m.Ruolo || "").toLowerCase().includes("atleta"));
    container.innerHTML = atleti.map(a => `
        <div class="family-item" id="f-${a.IDContatto}" onclick="window.selezionaAtleta('${a.IDContatto}')">
            <div class="avatar-circle"><i class="fas fa-running"></i></div>
            <div class="family-name text-truncate small fw-bold mt-2">${a.Nome}</div>
        </div>
    `).join('');
}

window.selezionaAtleta = (id) => {
    idSelezionato = id;
    document.querySelectorAll('.family-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`f-${id}`)?.classList.add('active');

    const a = sharedData.famiglia.data.find(x => x.IDContatto.toString() === id.toString());
    safeSet('nome-atleta-selezionato', `Per: ${a.Nome} ${a.Cognome}`);
    document.getElementById('status-message').innerHTML = '';
};

window.generaModuloPDF = async function () {
    const tipo = document.getElementById('tipoRichiesta').value;
    const accetto = document.getElementById('checkAccetto').checked;
    const status = document.getElementById('status-message');
    const overlay = document.getElementById('loading-overlay-visita');

    // 1. Validazione preliminare
    if (!idSelezionato) return alert("Per favore, seleziona un tesserato cliccando sulle icone in alto.");
    if (!accetto) return alert("È necessario accettare la dichiarazione d'impegno.");

    // 2. Recupero dati anagrafici dal magazzino di sessione
    const m = sharedData.famiglia.data.find(x => x.IDContatto.toString() === idSelezionato.toString());
    const idCPulito = idSelezionato.toString().toLowerCase().trim();

    // 3. Recupero Codice FIR (Ricerca incrociata tra Tabella Codici e Atleti)
    const tuttiICodici = sharedData.codici || [];
    const rigoFIR = tuttiICodici.find(c =>
        (c.ID_Contatto || c.IDContatto || "").toString().toLowerCase().trim() === idCPulito &&
        (c.Tipo_Tesseramento === "FIR" || c.Ente === "FIR")
    );

    // Se non lo trova nella tabella codici, prova a guardare nei dati tecnici (technical_data)
    const tech = sharedData.atleti[idCPulito] || {};
    const firFinale = rigoFIR ? rigoFIR.Codice : (tech.Codice_FIR || tech.FIR || "");

    if (!firFinale || firFinale === "" || firFinale === "null") {
        alert(`Attenzione: il tesserato ${m.Nome} non ha un codice FIR registrato. Impossibile generare il modulo visita.`);
        return;
    }

    // 4. Costruzione oggetto Atleta "Full" richiesto dalla libreria GAS
    const atletaMock = {
        IDContatto: idSelezionato,
        FIR: firFinale.toString().trim(),
        Nome: m.Nome || "",
        Cognome: m.Cognome || "",
        Natoa: m.Comune_Nascita || m.Comune_nascita || "",
        Natoil: m.Data_Nascita || "",
        NatoProvincia: m.Provincia_Nascita || "",
        ResidenteCittà: m.Comune_Residenza || m.Comune_residenza || "",
        ResidenteProvincia: m.Provincia_Residenza || "",
        ResidenteVia: m.Indirizzo_Residenza || "",
        CodiceFiscale: m.Codice_Fiscale || ""
    };

    console.log("🚀 Invio richiesta PDF a GAS per:", atletaMock.Nome, "FIR:", atletaMock.FIR);

    try {
        // Mostra caricamento
        if (overlay) {
            overlay.classList.remove('d-none');
            overlay.style.setProperty('display', 'flex', 'important');
        }

        // 5. CHIAMATA AL BRIDGE GAS
        const res = await callGAS("processaRichiestaModulo", {
            tipoRichiesta: tipo,
            atleta: atletaMock
        });

        // --- DIAGNOSTICA RISPOSTA ---
        console.log("📥 Risposta ricevuta dal server:", res);

        if (res && res.url) {
            console.log("✅ URL PDF Generato:", res.url);

            // Messaggio di successo con tasto di download manuale (se il popup viene bloccato)
            status.innerHTML = `
                <div class="alert alert-success border-0 shadow-sm p-4 mt-3 animate__animated animate__bounceIn">
                    <i class="fas fa-check-circle fa-2x mb-2 d-block"></i>
                    <h5 class="fw-bold">Documento generato con successo!</h5>
                    <p class="small mb-3">Il PDF si sta aprendo in una nuova scheda. Se non compare, clicca il tasto qui sotto.</p>
                    <a href="${res.url}" target="_blank" class="btn btn-success fw-bold rounded-pill px-4">
                       <i class="fas fa-file-download me-2"></i> SCARICA / APRI PDF
                    </a>
                </div>`;

            // Prova ad aprire il file automaticamente
            window.open(res.url, '_blank');

        } else {
            // Caso in cui GAS risponde successo ma senza URL
            console.error("⚠️ Errore: Il server non ha restituito l'URL del PDF", res);
            throw new Error("Il file è stato generato ma il link non è disponibile. Controlla la cartella Drive.");
        }

    } catch (err) {
        console.error("❌ Errore durante la generazione:", err);
        status.innerHTML = `
            <div class="alert alert-danger border-0 shadow-sm p-3 mt-3">
                <i class="fas fa-exclamation-triangle me-2"></i>
                <strong>Errore tecnico:</strong> ${err.message}
            </div>`;
    } finally {
        // Nascondi caricamento
        if (overlay) {
            overlay.classList.add('d-none');
            overlay.style.setProperty('display', 'none', 'important');
        }
    }
};
