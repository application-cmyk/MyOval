import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot } from "firebase/firestore";

/**
 * Ascolta i cambiamenti del carrello in tempo reale
 */
export function listenToCart(idFamiglia, callback) {
    if (!idFamiglia) return;
    const cartRef = doc(db, "carts", idFamiglia.toString());
    return onSnapshot(cartRef, (doc) => {
        if (doc.exists()) {
            callback(doc.data().items || []);
        } else {
            callback([]);
        }
    });
}

/**
 * Aggiunge un articolo al carrello Firestore
 */
export async function addToFirestoreCart(idFamiglia, item) {
    if (!idFamiglia) return;
    const cartRef = doc(db, "carts", idFamiglia.toString());
    const cartSnap = await getDoc(cartRef);

    let items = [];
    if (cartSnap.exists()) {
        items = cartSnap.data().items || [];
    }

    // Creiamo un ID univoco per la riga se non esiste
    if (!item.idUnivoco) {
        item.idUnivoco = Date.now().toString() + "_" + item.skuId;
    }

    items.push(item);

    await setDoc(cartRef, {
        idFamiglia: idFamiglia,
        ultimoAggiornamento: new Date().toISOString(),
        items: items
    }, { merge: true });
}

/**
 * Rimuove un singolo articolo. Se è l'ultimo, elimina il documento.
 */
export async function removeFromFirestoreCart(idFamiglia, idUnivoco) {
    if (!idFamiglia) return;
    const cartRef = doc(db, "carts", idFamiglia.toString());
    const cartSnap = await getDoc(cartRef);

    if (cartSnap.exists()) {
        const items = cartSnap.data().items || [];
        const newItems = items.filter(i => i.idUnivoco !== idUnivoco);

        if (newItems.length === 0) {
            await deleteDoc(cartRef);
        } else {
            await updateDoc(cartRef, { items: newItems });
        }
    }
}

/**
 * SVUOTA COMPLETAMENTE IL CARRELLO (Necessaria per il checkout)
 * Questa è la funzione che mancava e causava l'errore
 */
export async function clearFirestoreCart(idFamiglia) {
    if (!idFamiglia) return;
    console.log("🧹 Svuotamento carrello Firestore per famiglia:", idFamiglia);
    const cartRef = doc(db, "carts", idFamiglia.toString());
    try {
        await deleteDoc(cartRef);
    } catch (e) {
        console.error("Errore durante clearFirestoreCart:", e);
    }
}
