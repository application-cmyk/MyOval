import { APP_ENV } from "./firebase-config.js";

const GAS_URL = "https://script.google.com/macros/s/AKfycbyt5jq-GUb98_V5crrCBhZt4OQzaRxsrOf86cj-c3x-sGnhLgPUam4IhbEaFj5dBEExQg/exec";

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
        // Usiamo APP_ENV importato per sapere dove siamo
        const currentEnv = APP_ENV || "staging";

        console.log(`📡 Chiamata Bridge [POST] [${currentEnv}]: ${action}`);

        const response = await fetch(GAS_URL, {
            method: 'POST',
            mode: 'cors',
            // 2. Aggiungiamo l'ambiente nel body inviato a GAS
            body: JSON.stringify({
                action,
                env: currentEnv, // <--- Passiamo l'ambiente a GAS
                params
            })
        });

        if (!response.ok) throw new Error("Errore di rete verso Apps Script");

        const res = await response.json();

        if (res.success === false) {
            throw new Error(res.error || "Errore lato GAS");
        }

        return res.data;
    } catch (e) {
        console.error(`❌ Errore Bridge GAS [${action}]:`, e);
        throw e;
    }
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
