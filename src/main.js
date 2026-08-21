import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut, getRedirectResult } from "firebase/auth";
import { resettaPassword } from "./auth.js"; // <--- AGGIUNGI L'IMPORT

// UNIFICA QUI TUTTI GLI IMPORT DA AUTH.JS
import { registraNuovoUtente, loginEmailPass, loginConGoogle } from "./auth.js";

import { recuperaEmailDaCF } from "./auth.js";
import { callGAS } from "./utils.js";


// --- 1. DICHIARAZIONE GLOBALE DEL LUCCHETTO (Fondamentale qui!) ---
let isRegistering = false;
console.log("🚀 MyOval Main caricato - v.3.0.3");

// --- 1. UTILITY (Spostata in alto per evitare ReferenceError) ---
const safeBind = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, async (e) => {
            if (event === 'click') e.preventDefault();
            console.log(`🔘 Azione su: ${id}`);
            await fn();
        });
    } else {
        console.warn(`[safeBind] Elemento '${id}' non trovato.`);
    }
};

// --- 2. GESTIONE RITORNO DA REDIRECT ---
getRedirectResult(auth)
    .then((result) => {
        if (result) console.log("✅ Benvenuto di ritorno:", result.user.email);
    })
    .catch((error) => {
        console.error("❌ Errore post-redirect:", error.message);
    });

// --- 3. LOGICA DI INSTRADAMENTO (Auth Observer) ---
onAuthStateChanged(auth, async (user) => {
    // 1. SBLOCCO UI: Rimuove blocchi aria-hidden o overflow lasciati dal caricamento/redirect
    document.body.removeAttribute('aria-hidden');
    document.body.style.overflow = 'auto';

    const loadingScreen = document.getElementById('loading-screen');
    const loginScreen = document.getElementById('login-screen');
    const appPortaleScreen = document.getElementById('app-portale-screen');
    const appGestionaleScreen = document.getElementById('app-gestionale-screen');
    const errorDiv = document.getElementById('auth-error');

    if (user) {
        console.log("🟢 Utente rilevato:", user.email);

        const email = user.email.toLowerCase();
        const username = email.split('@')[0];
        const isNumeric = /^\d+$/.test(username);
        const isInternal = email.endsWith("@rugbymilano.it");

        // --- BIVIO LOGICO ---

        if (!isInternal || isNumeric) {
            // ==========================================================
            // CASO A: SOCIO / ESTERNO
            // ==========================================================

            // 1. Controllo verifica Email (fondamentale per utenti Gmail)
            if (!isInternal && !user.emailVerified) {
                if (errorDiv) errorDiv.innerText = "Verifica la tua email per accedere.";
                if (loadingScreen) loadingScreen.classList.add('d-none');
                if (loginScreen) loginScreen.classList.remove('d-none');
                await signOut(auth);
                return;
            }

            // 2. Aggiornamento stato su Firestore (Solo per Soci/Esterni)
            try {
                const { aggiornaStatoUtente } = await import('./auth.js?v=2.2.0');
                await aggiornaStatoUtente(user);
            } catch (e) { console.warn("Aggiornamento stato saltato o fallito."); }

            // 3. UI Portale
            if (loadingScreen) loadingScreen.classList.add('d-none');
            if (loginScreen) loginScreen.classList.add('d-none');
            if (appPortaleScreen) appPortaleScreen.classList.remove('d-none');
            if (appGestionaleScreen) appGestionaleScreen.classList.add('d-none');

            if (errorDiv) errorDiv.innerText = "";

            try {
                const { initPortal } = await import('./portal.js?v=35.0.0');
                await initPortal(user);

                console.log("✅ Moduli Portale e Shop caricati correttamente.");
            } catch (err) {
                console.error("❌ Errore caricamento moduli portale:", err);
            }

        } else {
            // ==========================================================
            // CASO B: STAFF (NON TOCCA COLLEZIONE USERS)
            // ==========================================================
            console.log("🛠️ Accesso Staff: Caricamento Gestionale...");

            if (loadingScreen) loadingScreen.classList.add('d-none');
            if (loginScreen) loginScreen.classList.add('d-none');
            if (appPortaleScreen) appPortaleScreen.classList.add('d-none');
            if (appGestionaleScreen) appGestionaleScreen.classList.remove('d-none');

            const staffEmailLabel = document.getElementById('staff-email-display');
            if (staffEmailLabel) staffEmailLabel.innerText = email;

            try {
                const { initGestionale } = await import('./gestionale.js?v=2.2.0');
                await initGestionale(user);
            } catch (err) { console.error("❌ Errore caricamento Gestionale:", err); }
        }
    } else {
        // ==========================================================
        // CASO C: LOGOUT / UTENTE NON AUTENTICATO
        // ==========================================================
        console.log("⚪ Stato: Disconnesso");
        if (loadingScreen) loadingScreen.classList.add('d-none');
        if (loginScreen) loginScreen.classList.remove('d-none');
        if (appPortaleScreen) appPortaleScreen.classList.add('d-none');
        if (appGestionaleScreen) appGestionaleScreen.classList.add('d-none');
        if (errorDiv) errorDiv.innerText = "";
    }
});


// --- 4. COLLEGAMENTO PULSANTI (Ora sicuro perché safeBind è definito sopra) ---

// Login Manuale
safeBind('btn-login', 'click', async () => {
    const email = document.getElementById('email')?.value;
    const pass = document.getElementById('pass')?.value;
    const errDiv = document.getElementById('auth-error');

    if (!email || !pass) {
        if (errDiv) errDiv.innerText = "Email e Password obbligatorie";
        return;
    }

    try {
        if (errDiv) errDiv.innerText = "Verifica...";
        await loginEmailPass(email, pass);
    } catch (err) {
        console.error("Errore login:", err);
        if (errDiv) errDiv.innerText = "Credenziali errate o utente non trovato";
    }
});

// Login Google (Staff)
safeBind('btn-google', 'click', async () => {
    try {
        console.log("🚀 Avvio login Google...");
        // CHIAMIAMO LA FUNZIONE, non il provider
        await loginConGoogle();
    } catch (err) {
        console.error("Errore:", err);
        alert("Errore accesso Google: " + err.message);
    }
});

// Pulsanti Logout
const logoutAction = () => {
    const iframe = document.getElementById('gestionale-iframe');
    if (iframe) iframe.src = "about:blank";
    signOut(auth);
};
safeBind('btn-logout', 'click', logoutAction);
safeBind('btn-logout-staff', 'click', logoutAction);

// Switch Tab (Login/Register)
safeBind('tab-accedi', 'click', () => {
    document.getElementById('tab-accedi')?.classList.add('active');
    document.getElementById('tab-registrati')?.classList.remove('active');
    document.getElementById('login-form')?.classList.remove('d-none');
    document.getElementById('register-form')?.classList.add('d-none');
});

safeBind('tab-registrati', 'click', () => {
    document.getElementById('tab-registrati')?.classList.add('active');
    document.getElementById('tab-accedi')?.classList.remove('active');
    document.getElementById('register-form')?.classList.remove('d-none');
    document.getElementById('login-form')?.classList.add('d-none');
});

safeBind('btn-register', 'click', async () => {
    // 1. Se stiamo già registrando, blocca tutto
    if (isRegistering) return;

    const email = document.getElementById('reg-email')?.value.trim();
    const emailConfirm = document.getElementById('reg-email-confirm')?.value.trim();
    const pass = document.getElementById('reg-pass')?.value;
    const cf = document.getElementById('reg-cf')?.value.trim();
    const errorDiv = document.getElementById('auth-error');
    const btn = document.getElementById('btn-register');

    // Validazioni
    if (email !== emailConfirm) {
        if (errorDiv) errorDiv.innerText = "Le email non corrispondono.";
        return;
    }
    if (!email || !pass || cf.length < 16) {
        if (errorDiv) errorDiv.innerText = "Compila tutti i campi correttamente.";
        return;
    }

    try {
        // 2. ATTIVA LUCCHETTO E UI
        isRegistering = true;
        if (btn) {
            btn.disabled = true;
            btn.innerText = "ATTENDI...";
        }
        if (errorDiv) errorDiv.innerText = "Creazione account in corso...";

        console.log("🚀 Chiamata UNICA a registraNuovoUtente...");

        await registraNuovoUtente(email, pass, cf);

        // 3. SUCCESSO
        alert("Registrazione completata! Controlla la tua email per il link di verifica.");
        window.location.reload(); // Pulisce tutto e torna al login pulito

    } catch (error) {
        console.error("❌ Errore:", error.code);

        // 4. RESET IN CASO DI ERRORE
        isRegistering = false;
        if (btn) {
            btn.disabled = false;
            btn.innerText = "REGISTRATI";
        }

        let msg = "Errore durante la registrazione.";
        if (error.code === 'auth/email-already-in-use') msg = "Email già registrata.";
        if (errorDiv) errorDiv.innerText = msg;
    }
});

// Listener per il pulsante ENTRA (Login)
const btnLogin = document.getElementById('btn-login');
if (btnLogin) {
    btnLogin.onclick = async () => {
        const email = document.getElementById('email').value;
        const pass = document.getElementById('pass').value;
        try {
            await loginEmailPass(email, pass);
        } catch (err) {
            document.getElementById('auth-error').innerText = "Errore: " + err.message;
        }
    };
}

// Link Password Dimenticata
safeBind('link-forgot-pass', 'click', async () => {
    const email = prompt("Inserisci la tua email per ricevere il link di reset:");
    if (!email) return;
    try {
        const { resettaPassword } = await import('./auth.js');
        await resettaPassword(email.trim().toLowerCase());
        alert("Controlla la tua posta: ti abbiamo inviato il link per cambiare la password.");
    } catch (e) {
        alert("Errore: inserisci un'email valida e registrata.");
    }
});

// --- RECUPERO EMAIL ---
safeBind('link-forgot-email', 'click', async () => {
    const cf = prompt("Inserisci il tuo Codice Fiscale per recuperare l'email associata:");
    if (!cf || cf.length !== 16) return alert("Codice Fiscale non valido.");

    try {
        const { recuperaEmailDaCF } = await import('./auth.js');
        const email = await recuperaEmailDaCF(cf.toUpperCase().trim());

        // Mascheriamo l'email per privacy (es: f*******o@rugbymilano.it)
        const [user, domain] = email.split("@");
        const masked = user.substring(0, 1) + "*".repeat(user.length - 2) + user.slice(-1) + "@" + domain;

        const invia = confirm(`L'account trovato è: ${masked}\n\nVuoi ricevere un promemoria all'indirizzo completo?`);
        if (invia) {
            await callGAS("inviaPromemoriaEmail", { email: email });
            alert("Email inviata con successo!");
        }
    } catch (e) {
        alert(e.message);
    }
});

// Funzione di lancio centralizzata (Sposta qui la logica)
const eseguiLancioShop = () => {
    console.log("🚀 Avvio transizione verso lo Shop Standalone...");

    // 1. Validazione Bolle
    const bubbles = document.querySelectorAll('.family-item[id^="f-"]');
    const allValid = Array.from(bubbles).every(b => b.classList.contains('is-valid-member'));

    if (bubbles.length === 0 || !allValid) {
        alert("📢 ATTENZIONE\n\nDevi completare le anagrafiche di TUTTI i componenti della famiglia (bolle verdi) prima di procedere.");
        return;
    }

    // 2. Impacchettamento Dati
    const dataToPass = {
        ...window.globalData,
        selectedMemberIndex: window.currentMemberIndex
    };

    // 3. Salvataggio e Redirect
    sessionStorage.setItem('myoval_shared_data', JSON.stringify(dataToPass));
    window.location.href = "shop.html";
};

// Colleghiamo il pulsante usando safeBind (che hai già nel file)
safeBind('btn-main-iscrizioni', 'click', eseguiLancioShop);
