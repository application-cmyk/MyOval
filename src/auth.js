// 1. Importa i tuoi oggetti configurati (UNA SOLA VOLTA)
import { auth, db, googleProvider } from "./firebase-config.js";

// 2. Importa le funzioni di Firebase (Raggruppate in un unico blocco)
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    sendEmailVerification,
    sendPasswordResetEmail // <--- Assicurati sia qui
} from "firebase/auth";

import { doc, setDoc, updateDoc } from "firebase/firestore";
import { collection, query, where, getDocs } from "firebase/firestore";

/**
 * LOGIN EMAIL E PASSWORD
 */
export const loginEmailPass = async (email, password) => {
    return await signInWithEmailAndPassword(auth, email, password);
};

/**
 * REGISTRAZIONE NUOVO UTENTE (Corretta)
 */
export const registraNuovoUtente = async (email, password, cf) => {
    // 1. Creazione account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 2. Invio mail
    await sendEmailVerification(user);

    // 3. Salvataggio Firestore
    await setDoc(doc(db, "users", user.uid), {
        email: email.toLowerCase().trim(),
        codiceFiscale: cf.toUpperCase().trim(),
        ruolo: "ESTERNO",
        stato: "IN_ATTESA_VERIFICA",
        createdAt: new Date().toISOString()
    });

    // 4. Logout
    await signOut(auth);

    // RESTITUIAMO SOLO IL DATI, NIENTE ALERT QUI
    return { success: true };
};

/**
 * AGGIORNA STATO UTENTE (Chiamata dopo la verifica email)
 */
export const aggiornaStatoUtente = async (user) => {
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    try {
        await updateDoc(userRef, {
            stato: "ATTIVO",
            ultimaVerifica: new Date().toISOString()
        });
        console.log("✅ Stato utente aggiornato ad ATTIVO");
    } catch (e) {
        console.warn("Profilo utente non trovato in Firestore, salto aggiornamento stato.");
    }
};

/**
 * LOGIN CON GOOGLE
 */
export const loginConGoogle = async () => {
    // 1. Puliamo la blacklist quando l'utente tenta un nuovo accesso
    localStorage.removeItem('mg_email_bloccata');

    // 2. Imposta la richiesta di scegliere l'account senza forzare la richiesta di permessi
    googleProvider.setCustomParameters({
        prompt: 'select_account'
    });

    return await signInWithPopup(auth, googleProvider);
};

export const resettaPassword = async (email) => {
    // Qui NON dichiarare "const auth = ...", usa quella importata sopra
    return await sendPasswordResetEmail(auth, email);
};

/**
 * Cerca l'email associata a un Codice Fiscale
 * Nota: Per sicurezza, non mostreremo l'email intera a video 
 * ma invieremo un promemoria via GAS o mostreremo una versione mascherata
 */
export const recuperaEmailDaCF = async (cf) => {
    try {
        const q = query(collection(db, "accounts"), where("Codice_Fiscale", "==", cf.toUpperCase().trim()));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            throw new Error("Nessun account trovato per questo Codice Fiscale.");
        }

        let emailTrovata = "";
        querySnapshot.forEach((doc) => {
            emailTrovata = doc.data().Email;
        });

        return emailTrovata;
    } catch (error) {
        throw error;
    }
};

export function mapArraysToObjects(payload) {
    if (!payload || !payload.headers || !payload.data) return [];

    const cleanHeaders = payload.headers.map(h =>
        h.toString().trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')
    );

    return payload.data.map(row => {
        let obj = {};
        cleanHeaders.forEach((h, i) => {
            let val = row[i];

            // --- NORMALIZZAZIONE BOLEANI (VERO/FALSO e TRUE/FALSE) ---
            if (val !== null && val !== undefined) {
                const s = val.toString().toUpperCase().trim();
                if (s === "VERO" || s === "TRUE" || s === "SÌ" || s === "SI") {
                    val = true;
                } else if (s === "FALSO" || s === "FALSE" || s === "NO") {
                    val = false;
                }
            }

            obj[h] = val;
        });
        return obj;
    });
}