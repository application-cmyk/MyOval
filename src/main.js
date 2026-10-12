import { auth, isProd } from "./firebase-config.js";
import { onAuthStateChanged, signOut, getRedirectResult } from "firebase/auth";
import {
    registraNuovoUtente,
    loginEmailPass,
    loginConGoogle,
    resettaPassword,
    recuperaEmailDaCF
} from "./auth.js";
import { callGAS } from "./utils.js";

// --- 0. APPLICAZIONE IMMEDIATA AMBIENTE ---
// Applichiamo la classe al body prima di ogni altra cosa per evitare flicker UI
if (isProd) {
    document.body.classList.add('is-production');
    console.log("🚀 MyOval: Ambiente PRODUZIONE (Restrizioni attive)");
} else {
    console.log("🛠️ MyOval: Ambiente STAGING (Tutte le funzioni attive)");
}

// --- 1. VARIABILI GLOBALI E UTILITY ---
let isRegistering = false;

const safeBind = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, async (e) => {
            if (event === 'click') e.preventDefault();
            console.log(`🔘 Azione su: ${id}`);
            await fn();
        });
    }
};

// --- 2. GESTIONE RITORNO DA REDIRECT GOOGLE ---
getRedirectResult(auth)
    .then((result) => {
        if (result) console.log("✅ Benvenuto di ritorno:", result.user.email);
    })
    .catch((error) => {
        console.error("❌ Errore post-redirect:", error.message);
    });

// --- 3. LOGICA DI INSTRADAMENTO (Auth Observer) ---
onAuthStateChanged(auth, async (user) => {
    document.body.removeAttribute('aria-hidden');
    document.body.style.overflow = 'auto';

    const loadingScreen = document.getElementById('loading-screen');
    const loginScreen = document.getElementById('login-screen');
    const appPortaleScreen = document.getElementById('app-portale-screen');
    const appGestionaleScreen = document.getElementById('app-gestionale-screen');
    const errorDiv = document.getElementById('auth-error');

    if (user) {
        const emailCorrente = user.email.toLowerCase().trim();

        // --- 🛑 CONTROLLO ANTI-LOOP DEFINITIVO ---
        // Se questa specifica email è stata precedentemente bloccata perché non in anagrafica,
        // la buttiamo fuori all'istante senza far partire initPortal!
        const emailBloccata = localStorage.getItem('mg_email_bloccata');
        if (emailBloccata === emailCorrente) {
            console.warn("🚫 Utente in blacklist anagrafica. Forzatura logout...");
            await signOut(auth);

            // Mostriamo l'errore direttamente nella schermata di login
            if (loadingScreen) loadingScreen.classList.add('d-none');
            if (loginScreen) loginScreen.classList.remove('d-none');
            if (appPortaleScreen) appPortaleScreen.classList.add('d-none');
            if (appGestionaleScreen) appGestionaleScreen.classList.add('d-none');
            if (errorDiv) errorDiv.innerText = "Utente non in Anagrafica. Contatta la Segreteria.";
            return;
        }

        console.log("🟢 Utente rilevato:", user.email);
        const username = emailCorrente.split('@')[0];
        const isNumeric = /^\d+$/.test(username);
        const isInternal = emailCorrente.endsWith("@rugbymilano.it");
        const isImpersonating = sessionStorage.getItem('impersonate_email');

        // BIVIO: PORTALE SOCI vs GESTIONALE STAFF
        if (!isInternal || isNumeric || isImpersonating) {
            // --- CASO A: SOCIO / ESTERNO ---
            if (!isImpersonating && !isInternal && !user.emailVerified) {
                if (errorDiv) errorDiv.innerText = "Verifica la tua email per accedere.";
                if (loadingScreen) loadingScreen.classList.add('d-none');
                if (loginScreen) loginScreen.classList.remove('d-none');
                await signOut(auth);
                return;
            }

            if (!isImpersonating) {
                try {
                    const { aggiornaStatoUtente } = await import('./auth.js?v=2.2.0');
                    await aggiornaStatoUtente(user);
                } catch (e) { console.warn("Aggiornamento stato saltato."); }
            }

            loadingScreen?.classList.add('d-none');
            loginScreen?.classList.add('d-none');
            appPortaleScreen?.classList.remove('d-none');
            appGestionaleScreen?.classList.add('d-none');

            try {
                const { initPortal } = await import('./portal.js?v=35.0.0');
                await initPortal(user);
            } catch (err) {
                console.error("❌ Errore Portale:", err);

                // SE L'ERRORE È QUELLO DI ANAGRAFICA
                if (err.message && err.message.includes("Utente non in Anagrafica")) {
                    // 1. Salviamo l'email nella blacklist del browser
                    localStorage.setItem('mg_email_bloccata', emailCorrente);
                    // 2. Facciamo il logout da Firebase
                    await signOut(auth);
                    // 3. Ricarichiamo la pagina (ora il blocco all'inizio di questa funzione intercetterà l'email e fermerà il loop)
                    window.location.reload();
                }
            }

        } else {
            // --- CASO B: STAFF (GESTIONALE) ---
            loadingScreen?.classList.add('d-none');
            loginScreen?.classList.add('d-none');
            appPortaleScreen?.classList.add('d-none');
            appGestionaleScreen?.classList.remove('d-none');

            const staffEmailLabel = document.getElementById('staff-email-display');
            if (staffEmailLabel) staffEmailLabel.innerText = emailCorrente;

            try {
                const { initGestionale } = await import('./gestionale.js?v=2.2.0');
                await initGestionale(user);
            } catch (err) { console.error("❌ Errore Gestionale:", err); }
        }
    } else {
        // --- CASO C: DISCONNESSO ---
        // Se l'utente fa un login pulito con un'altra email, ricordati di pulire la blacklist:
        // (Opzionale ma pulito: localStorage.removeItem('mg_email_bloccata');)

        loadingScreen?.classList.add('d-none');
        loginScreen?.classList.remove('d-none');
        appPortaleScreen?.classList.add('d-none');
        appGestionaleScreen?.classList.add('d-none');
        if (errorDiv) errorDiv.innerText = "";
    }
});

// --- 4. COLLEGAMENTO PULSANTI AUTH ---

// Login Manuale (Email/Pass)
safeBind('btn-login', 'click', async () => {
    if (isProd) return; // Protezione aggiuntiva

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
        if (errDiv) errDiv.innerText = "Credenziali errate o utente non trovato";
    }
});

// Login Google (Sempre attivo)
safeBind('btn-google', 'click', async () => {
    try {
        await loginConGoogle();
    } catch (err) {
        alert("Errore accesso Google: " + err.message);
    }
});

// Logout
const logoutAction = () => {
    const iframe = document.getElementById('gestionale-iframe');
    if (iframe) iframe.src = "about:blank";
    signOut(auth);
};
safeBind('btn-logout', 'click', logoutAction);
safeBind('btn-logout-staff', 'click', logoutAction);

// Switch Tab (Disabilitati visivamente in Prod via CSS)
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

// Registrazione
safeBind('btn-register', 'click', async () => {
    if (isProd) return;
    if (isRegistering) return;

    const email = document.getElementById('reg-email')?.value.trim();
    const emailConfirm = document.getElementById('reg-email-confirm')?.value.trim();
    const pass = document.getElementById('reg-pass')?.value;
    const cf = document.getElementById('reg-cf')?.value.trim();
    const errorDiv = document.getElementById('auth-error');
    const btn = document.getElementById('btn-register');

    if (email !== emailConfirm) {
        if (errorDiv) errorDiv.innerText = "Le email non corrispondono.";
        return;
    }
    if (!email || !pass || cf.length < 16) {
        if (errorDiv) errorDiv.innerText = "Compila tutti i campi correttamente.";
        return;
    }

    try {
        isRegistering = true;
        if (btn) { btn.disabled = true; btn.innerText = "ATTENDI..."; }
        if (errorDiv) errorDiv.innerText = "Creazione account in corso...";

        await registraNuovoUtente(email, pass, cf);
        alert("Registrazione completata! Controlla la tua email per il link di verifica.");
        window.location.reload();
    } catch (error) {
        isRegistering = false;
        if (btn) { btn.disabled = false; btn.innerText = "REGISTRATI"; }
        let msg = "Errore durante la registrazione.";
        if (error.code === 'auth/email-already-in-use') msg = "Email già registrata.";
        if (errorDiv) errorDiv.innerText = msg;
    }
});

// Link Recupero Credenziali
safeBind('link-forgot-pass', 'click', async () => {
    if (isProd) return;
    const email = prompt("Inserisci la tua email per ricevere il link di reset:");
    if (!email) return;
    try {
        await resettaPassword(email.trim().toLowerCase());
        alert("Controlla la tua posta per il link di reset.");
    } catch (e) { alert("Errore: email non valida."); }
});

safeBind('link-forgot-email', 'click', async () => {
    if (isProd) return;
    const cf = prompt("Inserisci il tuo Codice Fiscale:");
    if (!cf || cf.length !== 16) return alert("Codice Fiscale non valido.");

    try {
        const email = await recuperaEmailDaCF(cf.toUpperCase().trim());
        const [user, domain] = email.split("@");
        const masked = user.substring(0, 1) + "*".repeat(user.length - 2) + user.slice(-1) + "@" + domain;

        if (confirm(`L'account trovato è: ${masked}\n\nVuoi ricevere un promemoria all'indirizzo completo?`)) {
            await callGAS("inviaPromemoriaEmail", { email: email });
            alert("Email inviata con successo!");
        }
    } catch (e) { alert(e.message); }
});

// --- 5. LOGICA SHOP / ISCRIZIONI ---
const eseguiLancioShop = () => {
    if (isProd) {
        alert("Le iscrizioni online apriranno a breve. Ti avviseremo via email.");
        return;
    }

    const bubbles = document.querySelectorAll('.family-item[id^="f-"]');
    const allValid = Array.from(bubbles).every(b => b.classList.contains('is-valid-member'));

    if (bubbles.length === 0 || !allValid) {
        alert("📢 ATTENZIONE\n\nDevi completare le anagrafiche di TUTTI i componenti della famiglia (bolle verdi) prima di procedere.");
        return;
    }

    const dataToPass = { ...window.globalData, selectedMemberIndex: window.currentMemberIndex };
    sessionStorage.setItem('myoval_shared_data', JSON.stringify(dataToPass));
    window.location.href = "shop.html";
};

safeBind('btn-main-iscrizioni', 'click', eseguiLancioShop);

// --- 6. TEXT OVERRIDE PER PRODUZIONE ---
function applyTextOverrides() {
    if (isProd) {
        const staffLabel = document.querySelector('.staff-section p');
        if (staffLabel) {
            staffLabel.textContent = "ACCEDI AL PORTALE CON IL TUO ACCOUNT GOOGLE";
        }
    }
}

// Eseguiamo override testi al caricamento DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTextOverrides);
} else {
    applyTextOverrides();
}