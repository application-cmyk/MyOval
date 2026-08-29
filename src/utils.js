const GAS_URL = "https://script.google.com/macros/s/AKfycbwZmL398hpN54AA2myDsty2u5mSANmTLpQUxrKyBWwP1zRXLng2ZgRJoQMIsy8p_fA8Xw/exec";

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
        console.log(`📡 Chiamata Bridge [POST]: ${action}`);

        const response = await fetch(GAS_URL, {
            method: 'POST',
            mode: 'cors',
            body: JSON.stringify({ action, params })
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
        "<CONTATTO>": encodeURIComponent(data.idContatto || "")
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
        // Sostituisce tutte le occorrenze del segnaposto
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
