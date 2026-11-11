import { APP_ENV } from "./firebase-config.js";

const GAS_URL = "https://script.google.com/macros/s/AKfycbzIM1zY6ifZF0zEPuwbDsQVeEfqyP1gbsgxH3BDYhOMaUp7OJzaCM9kzkus0lQPsOZxoQ/exec";

export function formattaDataRugby(val) {
    if (!val || val === "" || val === "null" || val === undefined) return "-";

    const d = new Date(val);
    if (isNaN(d.getTime())) return val;

    const day = ("0" + d.getDate()).slice(-2);
    const month = ("0" + (d.getMonth() + 1)).slice(-2);
    const year = d.getFullYear();

    if (year === 1899 || year === 1900) return "Mancante";
    return `${day}/${month}/${year}`;
}

export const safeSet = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
};

export function formatEuro(v) {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v || 0);
}

/**
 * Funzione universale per chiamare il ponte Apps Script
 */
export async function callGAS(action, params = {}) {
    try {
        // Usa la costante globale APP_ENV se definita, altrimenti 'staging'
        const currentEnv = (typeof APP_ENV !== 'undefined' ? APP_ENV : "staging");

        const response = await fetch(GAS_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: action,
                env: currentEnv, // <-- Qui passiamo currentEnv, NON appEnv!
                params: params
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Errore HTTP ${response.status} da GAS per [${action}]:`, errorText);
            throw new Error(`Errore del server (${response.status})`);
        }

        const res = await response.json();
        if (res.success === false) {
            throw new Error(res.error || "Errore lato GAS");
        }

        return res.data;

    } catch (e) {
        console.error(`❌ Errore Bridge GAS [${action}]:`, e);

        let messaggioUtente = e.message;

        if (e instanceof TypeError && e.message.includes('Failed to fetch')) {
            messaggioUtente = "Errore connessione server. Riprova per verificare se il servizio è temporaneamente non disponibile.";
        }

        if (typeof mostraErroreCriticoA1Video === 'function') {
            mostraErroreCriticoA1Video(messaggioUtente);
        }

        throw e;
    }
}

// Funzione di supporto per mostrare un popup/overlay bloccante con richiesta di ricarica
function mostraErroreCriticoA1Video(messaggio) {
    // Controlla se esiste già un popup di errore per evitarne doppi
    if (document.getElementById('gas-critical-error-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'gas-critical-error-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.85);
        z-index: 999999;
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: Arial, sans-serif;
    `;

    overlay.innerHTML = `
        <div style="
            background: white; 
            padding: 30px; 
            border-radius: 12px; 
            max-width: 400px; 
            text-align: center;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        ">
            <div style="font-size: 40px; margin-bottom: 15px;">⚠️</div>
            <h3 style="color: #d9534f; margin-bottom: 10px; font-size: 20px;">Ops, si è verificato un problema</h3>
            <p style="color: #666; font-size: 14px; margin-bottom: 20px;">
                Non è stato possibile completare l'operazione con il server. Potrebbe essersi verificata un'interruzione temporanea della connessione.
            </p>
            <p style="color: #999; font-size: 11px; margin-bottom: 20px; word-break: break-all;">
                Dettaglio: ${messaggio}
            </p>
            <button id="btn-reload-app" style="
                background: #d9534f; 
                color: white; 
                border: none; 
                padding: 10px 20px; 
                font-size: 14px; 
                font-weight: bold; 
                border-radius: 6px; 
                cursor: pointer;
                width: 100%;
            ">
                Aggiorna Pagina
            </button>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('btn-reload-app').addEventListener('click', () => {
        window.location.reload();
    });
}


/**
 * Trasforma [ [h1, h2], [v1, v2] ] in [{h1: v1, h2: v2}]
 * Pulendo le chiavi come abbiamo fatto nella migrazione (es. spazi -> underscore)
 */
export function mapArraysToObjects(payload) {
    if (!payload || !payload.headers || !payload.data) return [];

    // Pulizia testate identica alla migrazione: spazi -> underscore, rimuovi speciali
    const cleanHeaders = payload.headers.map(h =>
        h.toString().trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')
    );

    return payload.data.map(row => {
        let obj = {};
        cleanHeaders.forEach((h, i) => {
            obj[h] = row[i] || "";
        });
        return obj;
    });
}

/**
 * Sostituisce i segnaposto <EMAIL>, <FAMIGLIA>, <CONTATTO> con i dati reali
 */
export function resolveUrlParams(url, data = {}) {
    if (!url) return "";

    let resolvedUrl = url;
    const replacements = {
        "<EMAIL>": encodeURIComponent(data.email || ""),
        "<FAMIGLIA>": encodeURIComponent(data.idFamiglia || ""),
        "<CONTATTO>": encodeURIComponent(data.idContatto || ""),
        "<ENV>": encodeURIComponent(APP_ENV) // <--- Utile se vuoi usarlo nei link del DB
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
        resolvedUrl = resolvedUrl.split(placeholder).join(value);
    }

    return resolvedUrl;
}

/**
 * Utility locale se non la importi da utils.js
 */
export function getThumbnailUrl(driveUrl) {
    if (!driveUrl) return "https://placehold.co/150x150?text=Senza+Foto";
    const match = driveUrl.match(/[-\w]{25,}/);
    return match ? `https://drive.google.com/thumbnail?id=${match[0]}&sz=w400` : driveUrl;
}
