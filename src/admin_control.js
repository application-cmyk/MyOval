import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, doc, getDoc, query, where } from "firebase/firestore";

// 1. VERIFICA SICUREZZA ACCESSO
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const staffSnap = await getDoc(doc(db, "staff_roles", user.email.toLowerCase().trim()));
        if (!staffSnap.exists()) {
            alert("Area riservata allo Staff.");
            window.location.href = "index.html";
        }
    } else {
        window.location.href = "index.html";
    }
});

// 2. LOGICA DI RICERCA
document.getElementById('btn-cerca').addEventListener('click', async () => {
    const input = document.getElementById('inp-ricerca').value.toLowerCase().trim();
    if (input.length < 2) return alert("Inserisci l'email completa o l'ID Famiglia.");

    const container = document.getElementById('risultati-ricerca');
    container.innerHTML = `<div class="text-center p-4"><div class="spinner-border text-danger"></div></div>`;

    try {
        let accountsTrovati = [];

        if (input.includes('@')) {
            // CASO A: RICERCA PER EMAIL
            const docRef = doc(db, "accounts", input);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                accountsTrovati.push({ email: snap.id, ...snap.data() });
            }
        } else {
            // CASO B: RICERCA PER ID FAMIGLIA
            // Cerchiamo tutti gli account che hanno lo stesso ID_Famiglia (es. marito e moglie)
            const q = query(collection(db, "accounts"), where("ID_Famiglia", "==", input));
            const qSnap = await getDocs(q);
            qSnap.forEach(d => accountsTrovati.push({ email: d.id, ...d.data() }));
        }

        renderRisultati(accountsTrovati, container);

    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="alert alert-danger small">Errore durante la ricerca su Firestore: ${e.message}</div>`;
    }
});

// 3. RENDERING UI
function renderRisultati(accounts, container) {
    if (accounts.length === 0) {
        container.innerHTML = `
            <div class="alert alert-warning small">
                Nessun account trovato.<br>
                <span style="font-size:10px;">Assicurati che l'email sia corretta o che l'ID Famiglia sia stato migrato su Firestore.</span>
            </div>`;
        return;
    }

    let html = `<div class="text-muted mb-2" style="font-size:11px;">Account trovati: ${accounts.length}</div>`;

    accounts.forEach(acc => {
        // Cerchiamo di mostrare il nome se presente, altrimenti usiamo l'email come titolo
        const nomeUtente = (acc.Cognome || acc.Nome) ? `${acc.Cognome} ${acc.Nome}`.toUpperCase() : acc.email;

        html += `
            <div class="card mb-2 shadow-sm border-0 animate__animated animate__fadeIn">
                <div class="card-body p-3">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <div class="fw-bold text-dark" style="font-size:14px;">${nomeUtente}</div>
                            <div class="text-danger fw-bold" style="font-size:11px;">ID FAMIGLIA: ${acc.ID_Famiglia || acc.id_famiglia || 'N/D'}</div>
                            <div class="text-muted small" style="font-size:10px;">${acc.email}</div>
                        </div>
                        <button class="btn btn-danger btn-sm fw-bold px-3" onclick="window.avviaImpersonate('${acc.email}')">
                            GESTISCI <i class="fas fa-chevron-right ms-1"></i>
                        </button>
                    </div>
                </div>
            </div>`;
    });
    container.innerHTML = html;
}

// 4. ATTIVAZIONE MODALITÀ ASSISTENZA
window.avviaImpersonate = function (targetEmail) {
    if (!confirm(`Vuoi prendere il controllo del portale di:\n${targetEmail}?`)) return;

    // Pulizia totale della sessione Admin
    sessionStorage.clear();

    // Impostazione email bersaglio per initPortal
    sessionStorage.setItem('impersonate_email', targetEmail.toLowerCase().trim());

    // Ritorno alla dashboard principale
    window.location.href = 'index.html';
};