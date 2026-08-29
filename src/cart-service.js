import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot } from "firebase/firestore";

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

export async function addToFirestoreCart(idFamiglia, item) {
    const cartRef = doc(db, "carts", idFamiglia.toString());
    const cartSnap = await getDoc(cartRef);

    let items = [];
    if (cartSnap.exists()) {
        items = cartSnap.data().items || [];
    }

    // Aggiungiamo ID univoco per la riga
    item.idUnivoco = Date.now().toString() + "_" + item.skuId;
    items.push(item);

    await setDoc(cartRef, {
        idFamiglia: idFamiglia,
        ultimoAggiornamento: new Date().toISOString(),
        items: items
    }, { merge: true });
}

export async function removeFromFirestoreCart(idFamiglia, idUnivoco) {
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