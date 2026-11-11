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

// 2. DIVERSIFICAZIONE SPREADSHEET ID (Unico file di riferimento per ambiente)
const ID_SS_STAGING = "1_SZlQtpiRQhTsQEvFCCkCE3ODzQNrhPbIV7yzntqFT8";
const ID_SS_PROD = "1_SZlQtpiRQhTsQEvFCCkCE3ODzQNrhPbIV7yzntqFT8"; // <--- Cambialo se necessario!

const ID_SS_BASE = env === "prod" ? ID_SS_PROD : ID_SS_STAGING;

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const cleanKey = (k) => k ? k.toString().trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') : "";

// Converte stringhe valuta/numeri e stringhe JSON (array/oggetti)
const smartParse = (val) => {
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();

    // Riconoscimento automatico JSON (oggetti/array esportati)
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            // Se non è JSON valido prosegue
        }
    }

    let s = trimmed.replace('€', '').replace(/\s/g, '').replace(',', '.');
    if (s === "" || isNaN(s)) return val;
    return Number(s);
};

async function start() {
    if (!cmd) {
        console.log("\n❌ Uso: node migrazione.js [TARGET] [ENV] [clean]");
        console.log("Esempi: node migrazione.js all staging");
        console.log("        node migrazione.js settings prod");
        console.log("        node migrazione.js stagione staging clean");
        console.log("        node migrazione.js users staging");
        process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const targets = {
        'accounts': { ss: ID_SS_BASE, sheet: 'Utenti_Account', coll: 'accounts', key: 'Email' },
        'config': { ss: ID_SS_BASE, sheet: 'Config_Campi', coll: 'ui_config', key: 'id_doc_firestore' },
        'staff': { ss: ID_SS_BASE, sheet: 'Staff_Ruoli', coll: 'staff_roles', key: 'Email' },
        'access': { ss: ID_SS_BASE, sheet: 'Config_Accessi', coll: 'config_access', key: 'id_doc_firestore' },
        'features': { ss: ID_SS_BASE, sheet: 'Funzionalità', coll: 'features', key: 'Nome' },
        'shop_cat': { ss: ID_SS_BASE, sheet: 'Shop_Categorie', coll: 'shop_categories', key: 'Nome Categoria' },
        'shop_art': { ss: ID_SS_BASE, sheet: 'Shop_Articoli', coll: 'shop_items', key: 'Nome Articolo' },
        'shop_tar': { ss: ID_SS_BASE, sheet: 'Shop_Tariffe', coll: 'shop_rates', key: 'ID_Tariffa' },
        'shop_sco': { ss: ID_SS_BASE, sheet: 'Shop_Sconti', coll: 'shop_discounts', key: 'Nome_Sconto' },
        'payments': { ss: ID_SS_BASE, sheet: 'Pagamenti', coll: 'payment_items', key: 'skuId' },

        // --- NUOVI TARGET ---
        'stagione': { ss: ID_SS_BASE, sheet: 'stagione', coll: 'stagione', key: 'id_doc_firestore' },
        'users': { ss: ID_SS_BASE, sheet: 'users', coll: 'users', key: 'id_doc_firestore' }
    };

    try {
        console.log(`\n🚀 MIGRAZIONE [${env.toUpperCase()}]`);

        if (cmd === 'liste' || cmd === 'settings') {
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
        } else {
            console.log(`❌ Target "${cmd}" non trovato.`);
        }

        console.log("\n✅ OPERAZIONE COMPLETATA!");
    } catch (err) {
        console.error("\n❌ ERRORE:", err.message);
    }
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
            // Parsing numeri / valuta / array / json
            else {
                val = smartParse(val);
            }

            // Se la colonna è id_doc_firestore la usiamo come ID documento
            if (h === "id_doc_firestore") {
                docIdFromSheet = val ? val.toString().trim() : null;
            } else {
                obj[h] = val;
            }
        });

        // -------------------------------------------------------------
        // LOGICA ID DOCUMENTO
        // -------------------------------------------------------------
        let docId = null;

        // 1. Priorità assoluta alla colonna id_doc_firestore (se valorizzata)
        if (docIdFromSheet) {
            docId = docIdFromSheet;
        }
        // 2. Colonna chiave alternativa (es. Email, Nome, skuId)
        else if (keyField) {
            const rawKey = obj[cleanKey(keyField)];
            if (rawKey !== undefined && rawKey !== null && rawKey.toString().trim() !== "") {
                docId = rawKey.toString().trim();
            }
        }
        // 3. Fallback speciali per configurazioni prive di chiavi
        else if (sheetName === 'Config_Accessi') {
            docId = `${(obj.Gruppo || "ALL")}_${(i + 1).toString().padStart(3, '0')}`;
        }
        else if (sheetName === 'Config_Campi') {
            docId = `${(obj.Gruppo || "ALL")}_${(obj.Profilo || "DEF")}_${(i + 1).toString().padStart(3, '0')}`;
        }
        // 4. Auto-generazione Firestore
        else {
            docId = db.collection(collectionName).doc().id;
        }

        // Sanitizzazione caratteri speciali per Firestore
        if (docId) {
            docId = docId.toString().replace(/\//g, '-');
        } else {
            skippedEmpty++;
            console.log(`   ⚠️ Riga ${i + 2}: ID non valido. Riga saltata.`);
            continue;
        }

        // Controllo duplicati
        if (seenIds.has(docId)) {
            duplicates++;
            console.log(`   ⚠️ ID DUPLICATO: "${docId}" alla riga ${i + 2}. Sovrascriverà il precedente.`);
        }
        seenIds.add(docId);

        batch.set(db.collection(collectionName).doc(docId), obj);
        countRead++;
        batchOps++;

        if (batchOps === 499) {
            await batch.commit();
            batch = db.batch();
            batchOps = 0;
        }
    }

    if (batchOps > 0) {
        await batch.commit();
    }

    const totalInFirestore = (await db.collection(collectionName).count().get()).data().count;

    console.log(`   --------------------------------------------------`);
    console.log(`   ✅ Righe elaborate dal foglio: ${countRead}`);
    if (duplicates > 0) console.log(`   ⚠️ ID duplicati sovrascritti: ${duplicates}`);
    if (skippedEmpty > 0) console.log(`   ⚠️ Righe saltate (ID mancante): ${skippedEmpty}`);
    console.log(`   📊 Totale documenti in Firestore [${collectionName}]: ${totalInFirestore}`);
    console.log(`   --------------------------------------------------`);
}

async function migrateListe(sheets, spreadsheetId) {
    console.log(`\n⏳ [Liste] --> [settings/liste_valori]...`);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Liste!A:ZZ' });
    if (!res.data.values || res.data.values.length === 0) {
        console.log(`   ⚠️ Foglio "Liste" vuoto.`);
        return;
    }
    let listeObj = {};
    const headers = res.data.values[0];
    const dataRows = res.data.values.slice(1);

    headers.forEach((h, colIdx) => {
        if (h && h.trim()) {
            const colName = h.trim();
            // Prende solo le celle piene di ogni colonna
            listeObj[colName] = dataRows
                .map(row => row[colIdx])
                .filter(val => val !== undefined && val !== null && val.toString().trim() !== "");
        }
    });

    await db.collection('settings').doc('liste_valori').set(listeObj);
    console.log(`   ✅ [Liste] migrate con successo in settings/liste_valori.`);
}

async function deleteCollection(db, collectionPath) {
    const snapshot = await db.collection(collectionPath).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`   🗑️ Collezione [${collectionPath}] svuotata.`);
}

const parseStringToDate = (val) => {
    if (!val) return null;
    const s = val.toString().trim();
    if (s.includes('/')) {
        const [d, m, y] = s.split('/');
        return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    }
    if (s.includes('-')) {
        return new Date(s);
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d;
};

start();