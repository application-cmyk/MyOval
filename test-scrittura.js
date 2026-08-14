const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./service-account-staging.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function test() {
    try {
        console.log("Provando a scrivere un documento di test...");
        await db.collection('test_connessione').doc('123').set({
            data: new Date().toISOString(),
            status: "funziona"
        });
        console.log("✅ SUCCESSO! Il database è scrivibile.");
    } catch (e) {
        console.error("❌ FALLIMENTO:", e.message);
        console.log("Dettagli errore:", e.code);
    }
}
test();