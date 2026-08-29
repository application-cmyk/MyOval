const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { google } = require('googleapis');

const args = process.argv.slice(2);
const cmd = args[0] ? args[0].toLowerCase() : null;
const env = args[1] ? args[1].toLowerCase() : "staging";
const isClean = args[2] ? args[2].toLowerCase() === 'clean' : false;

const keyFile = env === "prod" ? "./service-account-prod.json" : "./service-account-staging.json";
const serviceAccount = require(keyFile);

const ID_SS_BASE = "15-aMr1xLiLwP1TAQvczXMn4do2Y2zR-dm1um9KvVuFY";

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
        'config': { ss: ID_SS_BASE, sheet: 'Config_Campi', coll: 'ui_config', key: null },
        'staff': { ss: ID_SS_BASE, sheet: 'Staff_Ruoli', coll: 'staff_roles', key: 'Email' },
        'access': { ss: ID_SS_BASE, sheet: 'Config_Accessi', coll: 'config_access', key: null },
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
    console.log(`⏳ [${sheetName}] --> [${collectionName}]...`);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:ZZ` });
    const rows = res.data.values;
    if (!rows || rows.length === 0) return;

    const headers = rows[0].map(h => cleanKey(h));
    const dataRows = rows.slice(1);
    let batch = db.batch();
    let count = 0;

    for (let i = 0; i < dataRows.length; i++) {
        let obj = {};
        headers.forEach((h, idx) => {
            let val = dataRows[i][idx] || "";
            const vU = val.toString().toUpperCase().trim();

            if (vU === "TRUE" || vU === "SÌ" || vU === "SI") val = true;
            else if (vU === "FALSE" || vU === "NO") val = false;
            // Riconoscimento automatico colonne date
            else if (h.includes('Data') || h.includes('Valido_') || h.includes('Scadenza')) {
                val = parseStringToDate(val);
            }
            else val = smartParse(val);

            if (h !== "id_doc_firestore") obj[h] = val;
        });

        let docId;
        if (sheetName === 'Config_Accessi') docId = `${(obj.Gruppo || "ALL")}_${(obj.Ordine || i).toString().padStart(3, '0')}`;
        else if (sheetName === 'Config_Campi') docId = `${(obj.Gruppo || "ALL")}_${(obj.Profilo || "DEF")}_${(obj.Ordine || i).toString().padStart(3, '0')}`;
        else if (keyField) docId = obj[cleanKey(keyField)]?.toString().trim();
        else docId = db.collection(collectionName).doc().id;

        if (docId) {
            batch.set(db.collection(collectionName).doc(docId), obj);
            count++;
        }
        if (count % 500 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    console.log(`   ✅ Finito: ${count} documenti.`);
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