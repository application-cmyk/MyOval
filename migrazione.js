const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { google } = require('googleapis');

const args = process.argv.slice(2);
const cmd = args[0] ? args[0].toLowerCase() : null;
const env = args[1] ? args[1].toLowerCase() : "staging";
const isClean = args[2] ? args[2].toLowerCase() === 'clean' : false;

// 1. DIVERSIFICAZIONE FILE SERVICE ACCOUNT
const keyFile = env === "prod" ? "./service-account-prod.json" : "./service-account-staging.json";
const serviceAccount = require(keyFile);

// 2. DIVERSIFICAZIONE SPREADSHEET ID
const ID_SS_STAGING = "1FnMM8dOJ_qzbjw9TOVIrEhlOqiUrFAR6tMIb12LeW-E";
const ID_SS_PROD = "1_SZlQtpiRQhTsQEvFCCkCE3ODzQNrhPbIV7yzntqFT8"; // <--- Cambialo!

const ID_SS_BASE = env === "prod" ? ID_SS_PROD : ID_SS_STAGING;

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const cleanKey = (k) => k ? k.toString().trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') : "";

// Funzione per convertire stringhe sporche (€, virgole) in numeri veri
const smartParse = (val) => {
    if (typeof val !== 'string') return val;
    let s = val.replace('€', '').replace(/\s/g, '').replace(',', '.').trim();
    if (s === "" || isNaN(s)) return val;
    return Number(s);
};

async function start() {
    if (!cmd) {
        console.log("\n❌ Uso: node migrazione.js [TARGET] [ENV] [clean]");
        process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const targets = {
        'accounts': { ss: ID_SS_BASE, sheet: 'Utenti_Account', coll: 'accounts', key: 'Email' },
        'config': { ss: ID_SS_BASE, sheet: 'Config_Campi', coll: 'ui_config', key: 'id_doc_firestore' }, // <-- Usa la colonna
        'staff': { ss: ID_SS_BASE, sheet: 'Staff_Ruoli', coll: 'staff_roles', key: 'Email' },
        'access': { ss: ID_SS_BASE, sheet: 'Config_Accessi', coll: 'config_access', key: 'id_doc_firestore' }, // <-- Usa la colonna
        'features': { ss: ID_SS_BASE, sheet: 'Funzionalità', coll: 'features', key: 'Nome' },
        // SHOP (Aggiornati con i tuoi nuovi nomi)
        'shop_cat': { ss: ID_SS_BASE, sheet: 'Shop_Categorie', coll: 'shop_categories', key: 'Nome Categoria' },
        'shop_art': { ss: ID_SS_BASE, sheet: 'Shop_Articoli', coll: 'shop_items', key: 'Nome Articolo' },
        'shop_tar': { ss: ID_SS_BASE, sheet: 'Shop_Tariffe', coll: 'shop_rates', key: 'ID_Tariffa' },
        'shop_sco': { ss: ID_SS_BASE, sheet: 'Shop_Sconti', coll: 'shop_discounts', key: 'Nome_Sconto' },
        // PAGAMENTI
        'payments': {
            ss: ID_SS_BASE, sheet: 'Pagamenti', coll: 'payment_items', key: 'skuId' // <--- Deve corrispondere al nuovo nome colonna
        }

    };

    try {
        console.log(`\n🚀 MIGRAZIONE [${env.toUpperCase()}]`);
        if (cmd === 'liste') {
            await migrateListe(sheets, ID_SS_BASE);
        } else if (targets[cmd]) {
            const t = targets[cmd];
            if (isClean) await deleteCollection(db, t.coll);
            await migrateSheet(sheets, t.ss, t.sheet, t.coll, t.key);
        } else if (cmd === 'all') {
            for (let k in targets) {
                if (isClean) await deleteCollection(db, targets[k].coll);
                await migrateSheet(sheets, targets[k].ss, targets[k].sheet, targets[k].coll, targets[k].key);
            }
            await migrateListe(sheets, ID_SS_BASE);
        }
        console.log("\n✅ OPERAZIONE COMPLETATA!");
    } catch (err) { console.error("\n❌ ERRORE:", err.message); }
}

async function migrateSheet(sheets, spreadsheetId, sheetName, collectionName, keyField) {
    console.log(`\n⏳ [${sheetName}] --> [${collectionName}]...`);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:ZZ` });
    const rows = res.data.values;
    if (!rows || rows.length === 0) {
        console.log(`   ⚠️ Foglio vuoto o non trovato.`);
        return;
    }

    const headers = rows[0].map(h => cleanKey(h));
    const dataRows = rows.slice(1);

    let batch = db.batch();
    let batchOps = 0;
    let countRead = 0;
    const seenIds = new Set();
    let duplicates = 0;
    let skippedEmpty = 0;

    for (let i = 0; i < dataRows.length; i++) {
        // Salta righe vuote
        if (!dataRows[i] || dataRows[i].length === 0 || dataRows[i].every(cell => !cell || cell.toString().trim() === '')) {
            continue;
        }

        let obj = {};
        let docIdFromSheet = null;

        headers.forEach((h, idx) => {
            if (!h) return;
            let val = dataRows[i][idx] !== undefined ? dataRows[i][idx] : "";
            const vU = val.toString().toUpperCase().trim();

            // Parsing booleani
            if (vU === "TRUE" || vU === "SÌ" || vU === "SI") val = true;
            else if (vU === "FALSE" || vU === "NO") val = false;
            // Parsing date
            else if (h.includes('Data') || h.includes('Valido_') || h.includes('Scadenza')) {
                val = parseStringToDate(val);
            }
            // Parsing numeri / valuta
            else {
                val = smartParse(val);
            }

            // Se la colonna è id_doc_firestore, la estraiamo per usarla come ID
            if (h === "id_doc_firestore") {
                docIdFromSheet = val ? val.toString().trim() : null;
            } else {
                obj[h] = val;
            }
        });

        // -------------------------------------------------------------
        // LOGICA DI SELEZIONE DELL'ID DOCUMENTO (con priorità)
        // -------------------------------------------------------------
        let docId = null;

        // 1. Se nel foglio esiste la colonna id_doc_firestore valorizzata
        if (docIdFromSheet) {
            docId = docIdFromSheet;
        }
        // 2. Se c'è un campo chiave configurato (es. Email, Nome, skuId)
        else if (keyField) {
            const rawKey = obj[cleanKey(keyField)];
            if (rawKey !== undefined && rawKey !== null && rawKey.toString().trim() !== "") {
                docId = rawKey.toString().trim();
            }
        }
        // 3. Regole speciali fallback per fogli di configurazione senza colonna ID
        else if (sheetName === 'Config_Accessi') {
            docId = `${(obj.Gruppo || "ALL")}_${(i + 1).toString().padStart(3, '0')}`;
        }
        else if (sheetName === 'Config_Campi') {
            docId = `${(obj.Gruppo || "ALL")}_${(obj.Profilo || "DEF")}_${(i + 1).toString().padStart(3, '0')}`;
        }
        // 4. ID autogenerato da Firestore se non c'è nessuna chiave
        else {
            docId = db.collection(collectionName).doc().id;
        }

        // Se l'ID contiene slash '/', li convertiamo in '-' per non creare sottocollezioni errate
        if (docId) {
            docId = docId.toString().replace(/\//g, '-');
        } else {
            skippedEmpty++;
            console.log(`   ⚠️ Riga ${i + 2}: ID non valido o vuoto. Riga saltata.`);
            continue;
        }

        // Rilevamento duplicati
        if (seenIds.has(docId)) {
            duplicates++;
            console.log(`   ⚠️ ID DUPLICATO: "${docId}" alla riga ${i + 2} dello sheet. Sovrascriverà il precedente!`);
        }
        seenIds.add(docId);

        // Aggiunta al batch
        batch.set(db.collection(collectionName).doc(docId), obj);
        countRead++;
        batchOps++;

        // Commit ogni 499 operazioni (il limite Firestore è 500)
        if (batchOps === 499) {
            await batch.commit();
            batch = db.batch();
            batchOps = 0;
        }
    }

    // Scrive le operazioni rimanenti
    if (batchOps > 0) {
        await batch.commit();
    }

    // Controllo di verifica effettivo su Firestore
    const totalInFirestore = (await db.collection(collectionName).count().get()).data().count;

    console.log(`   --------------------------------------------------`);
    console.log(`   ✅ Righe elaborate dal foglio: ${countRead}`);
    if (duplicates > 0) console.log(`   ⚠️ Attenzione: ${duplicates} righe avevano ID duplicati e sono state sovrascritte.`);
    if (skippedEmpty > 0) console.log(`   ⚠️ Righe scartate (senza ID): ${skippedEmpty}`);
    console.log(`   📊 Totale documenti reali presenti in [${collectionName}]: ${totalInFirestore}`);
    console.log(`   --------------------------------------------------`);
}

async function migrateListe(sheets, spreadsheetId) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Liste!A:Z' });
    if (!res.data.values) return;
    let listeObj = {};
    res.data.values[0].forEach((h, i) => {
        if (h) listeObj[h.toUpperCase().trim()] = res.data.values.slice(1).map(r => r[i]).filter(Boolean);
    });
    await db.collection('settings').doc('liste_valori').set(listeObj);
    console.log(`✅ [Liste] Migrate.`);
}

async function deleteCollection(db, collectionPath) {
    const snapshot = await db.collection(collectionPath).get();
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`   🗑️ Collezione [${collectionPath}] svuotata.`);
}

// Aggiungi questa funzione di utilità nel tuo migrazione.js
const parseStringToDate = (val) => {
    if (!val) return null;
    const s = val.toString().trim();
    // Gestione formato DD/MM/YYYY
    if (s.includes('/')) {
        const [d, m, y] = s.split('/');
        return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    }
    // Gestione formato YYYY-MM-DD
    if (s.includes('-')) {
        return new Date(s);
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d; // Ritorna la stringa se non è una data valida
};


start();