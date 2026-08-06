const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { google } = require('googleapis');
const serviceAccount = require('./service-account.json');

// --- CONFIGURAZIONE ID SPREADSHEET ---
const ID_SS_CONFIG = "1pxT7oRGruB9VQIHL4PrjLkwrUM6ZWmWlGL5LnP-lTUY"; 
const ID_SS_DATI   = "1OQ4pYpPaRmnwgglRCSebBLypWbT1llb8uXAebQVuYBo"; 

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const cleanKey = (k) => k ? k.toString().trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') : "";

async function start() {
    const args = process.argv.slice(2);
    const cmd = args[0] ? args[0].toLowerCase() : null;
    const isClean = args[1] ? args[1].toLowerCase() === 'clean' : false;

    if (!cmd) {
        console.log("\n❌ Uso: node migrazione.js [TARGET] [clean (opzionale)]");
        console.log("Esempi: \n - node migrazione.js members (aggiorna)\n - node migrazione.js members clean (cancella e ricarica)\n");
        process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: './service-account.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    try {
        // Mappatura Target -> Collezione
        const targets = {
            'accounts': { ss: ID_SS_CONFIG, sheet: 'Utenti_Account', coll: 'accounts', key: 'Email' },
            'config': { ss: ID_SS_CONFIG, sheet: 'Config_Campi', coll: 'ui_config', key: null },
            'staff': { ss: ID_SS_CONFIG, sheet: 'Staff_Ruoli', coll: 'staff_roles', key: 'Email' },
            'access': { ss: ID_SS_CONFIG, sheet: 'Config_Accessi', coll: 'config_access', key: null },
            'features': { ss: ID_SS_CONFIG, sheet: 'Funzionalità', coll: 'features', key: 'Nome' }
            };

        if (cmd === 'liste') {
            await migrateListe(sheets, ID_SS_CONFIG);
        } else if (targets[cmd]) {
            const t = targets[cmd];
            if (isClean) {
                console.log(`\n🗑️  Svuotamento collezione [${t.coll}] in corso...`);
                await deleteCollection(db, t.coll);
            }
            console.log(`\n⏳ Migrazione [${t.sheet}] --> [${t.coll}]...`);
            await migrateSheet(sheets, t.ss, t.sheet, t.coll, t.key);
        } else if (cmd === 'all') {
            // Esegue tutto senza clean (se vuoi clean su 'all' dovresti specificarlo per ogni chiamata)
            for (let k in targets) await migrateSheet(sheets, targets[k].ss, targets[k].sheet, targets[k].coll, targets[k].key);
            await migrateListe(sheets, ID_SS_CONFIG);
        }

        console.log("\n✅ OPERAZIONE COMPLETATA!");
        process.exit(0);

    } catch (err) {
        console.error("\n❌ ERRORE:", err.message);
        process.exit(1);
    }
}

/**
 * Funzione per svuotare una collezione (batch di 500)
 */
async function deleteCollection(db, collectionPath) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(500);
    return new Promise((resolve, reject) => {
        deleteQueryBatch(db, query, resolve).catch(reject);
    });
}

async function deleteQueryBatch(db, query, resolve) {
    const snapshot = await query.get();
    if (snapshot.size === 0) { resolve(); return; }
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    process.nextTick(() => deleteQueryBatch(db, query, resolve));
}

async function migrateSheet(sheets, spreadsheetId, sheetName, collectionName, keyField) {
    try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:ZZ` });
        const rows = res.data.values;
        if (!rows || rows.length === 0) return;

        const headers = rows[0].map(h => cleanKey(h));
        const dataRows = rows.slice(1);
        let batch = db.batch();
        let count = 0;

        const campiDaEscludereAccounts = [
            "Password_Hash", "Salt", "Token_Azione", "Scadenza_Token", 
            "Stato", "Tipo_Utente", "PosizioneOriginale", "Data_Registrazione"
        ].map(c => cleanKey(c));

        for (let i = 0; i < dataRows.length; i++) {
            let obj = {};
            headers.forEach((h, idx) => {
                let val = dataRows[i][idx] || "";

                if (collectionName === 'accounts' && campiDaEscludereAccounts.includes(h)) return;

                // --- 1. NORMALIZZAZIONE GRUPPI E RUOLI (FORZA MAIUSCOLO) ---
                // Se la colonna è Gruppo o Ruolo, forziamo il maiuscolo per evitare errori di query
                if (h === "Gruppo" || h === "Ruolo") {
                    val = val.toString().toUpperCase().trim();
                }

                // --- 2. LOGICA DI CONVERSIONE BOOLEANA ---
                const valUpper = val.toString().toUpperCase().trim();
                if (valUpper === "TRUE" || valUpper === "SÌ" || valUpper === "SI") {
                    val = true;
                } else if (valUpper === "FALSE" || valUpper === "NO" || valUpper === "0" || 
                          (valUpper === "" && (h === "Visibile" || h === "Required" || h === "Readonly" || h === "Obbligatorio"))) {
                    val = false;
                }
                
                if (h !== "ID_Campo" && h !== "IDCampo" && h !== "PosizioneOriginale") {
                    obj[h] = val;
                }
            });
            
            let docId;

            // --- 3. GESTIONE ID DOCUMENTO ---
            if (sheetName === 'Config_Accessi') {
                // Usiamo il valore già convertito in maiuscolo sopra
                const gruppo = (obj.Gruppo || obj.Ruolo || "ALL");
                const ordineVal = parseInt(obj.Ordine);
                const ordineSicuro = isNaN(ordineVal) ? (i + 1) : ordineVal;
                
                docId = `${gruppo}_${ordineSicuro.toString().padStart(3, '0')}`;
                obj.Funzione = cleanKey(obj.Funzione || obj.Funzionalit || ""); 
                obj.Ordine = ordineSicuro;
            } 
            else if (sheetName === 'Config_Campi') {
                const profilo = (obj.Profilo || "ASSOCIATO").toUpperCase().trim();
                const ordineVal = parseInt(obj.Ordine);
                const ordineSicuro = isNaN(ordineVal) ? (i + 1) : ordineVal;
                
                // ID DOCUMENTO: GRUPPO_PROFILO_ORDINE
                const gruppo = (obj.Gruppo || "ASSOCIATO");
                docId = `${gruppo}_${profilo}_${ordineSicuro.toString().padStart(3, '0')}`;
                
                obj.ID_Campo = cleanKey(obj.Campo || "");
                obj.Ordine = ordineSicuro;
                delete obj.Campo; 
            } 
            else if (sheetName === 'Funzionalità') {
                docId = cleanKey(obj.Nome || obj.Titolo || "");
            }
            else if (keyField) {
                docId = obj[cleanKey(keyField)]?.toString().toLowerCase().trim();
            } 
            else {
                const idC = cleanKey(obj.ID_Contatto || obj.IDContatto || "unk");
                const tipo = cleanKey(obj.Tipo_Tesseramento || obj.Ente || "NA");
                docId = `${idC}_${tipo}`;
            }

            if (!docId || docId.includes("unk")) continue;

            batch.set(db.collection(collectionName).doc(docId), obj);
            count++;

            if (count % 500 === 0) {
                await batch.commit();
                batch = db.batch();
                console.log(`   - [${sheetName}] Caricati ${count}...`);
            }
        }
        await batch.commit();
        console.log(`✅ [${sheetName}] Completato. Totale: ${count}`);
    } catch (e) { console.error(`❌ Errore ${sheetName}:`, e.message); }
}

async function migrateListe(sheets, spreadsheetId) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Liste!A:Z' });
    const rows = res.data.values;
    if (!rows) return;
    let listeObj = {};
    rows[0].forEach((h, i) => {
        if (h) listeObj[h.toUpperCase().trim()] = rows.slice(1).map(r => r[i]).filter(Boolean);
    });
    await db.collection('settings').doc('liste_valori').set(listeObj);
    console.log(`[Liste] Migrata.`);
}

start();