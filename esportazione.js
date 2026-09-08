const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { google } = require('googleapis');

const args = process.argv.slice(2);
const cmd = args[0] ? args[0].toLowerCase() : null;
const env = args[1] ? args[1].toLowerCase() : "staging";

// 1. DIVERSIFICAZIONE FILE SERVICE ACCOUNT
const keyFile = env === "prod" ? "./service-account-prod.json" : "./service-account-staging.json";
const serviceAccount = require(keyFile);

// 2. DIVERSIFICAZIONE SPREADSHEET ID
const ID_SS_STAGING = "1FnMM8dOJ_qzbjw9TOVIrEhlOqiUrFAR6tMIb12LeW-E";
const ID_SS_PROD = "1_SZlQtpiRQhTsQEvFCCkCE3ODzQNrhPbIV7yzntqFT8"; // <--- Cambialo!

const ID_SS_BASE = env === "prod" ? ID_SS_PROD : ID_SS_STAGING;

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// Mappatura identica a migrazione.js
const targets = {
    'accounts': { ss: ID_SS_BASE, sheet: 'Utenti_Account', coll: 'accounts' },
    'config': { ss: ID_SS_BASE, sheet: 'Config_Campi', coll: 'ui_config' },
    'staff': { ss: ID_SS_BASE, sheet: 'Staff_Ruoli', coll: 'staff_roles' },
    'access': { ss: ID_SS_BASE, sheet: 'Config_Accessi', coll: 'config_access' },
    'features': { ss: ID_SS_BASE, sheet: 'Funzionalità', coll: 'features' },
    'shop_cat': { ss: ID_SS_BASE, sheet: 'Shop_Categorie', coll: 'shop_categories' },
    'shop_art': { ss: ID_SS_BASE, sheet: 'Shop_Articoli', coll: 'shop_items' },
    'shop_tar': { ss: ID_SS_BASE, sheet: 'Shop_Tariffe', coll: 'shop_rates' },
    'shop_sco': { ss: ID_SS_BASE, sheet: 'Shop_Sconti', coll: 'shop_discounts' },
    'payments': { ss: ID_SS_BASE, sheet: 'Pagamenti', coll: 'payment_items' }
};

async function start() {
    if (!cmd) {
        console.log("\n❌ Uso: node esportazione.js [TARGET] [ENV]");
        console.log("Esempi: node esportazione.js all staging");
        console.log("        node esportazione.js shop_art prod");
        process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    try {
        console.log(`\n🚀 ESPORTAZIONE [${env.toUpperCase()}]`);

        if (cmd === 'liste') {
            await exportListe(sheets, ID_SS_BASE);
        } else if (targets[cmd]) {
            await exportToSheet(sheets, targets[cmd]);
        } else if (cmd === 'all') {
            for (let k in targets) {
                await exportToSheet(sheets, targets[k]);
            }
            await exportListe(sheets, ID_SS_BASE);
        } else {
            console.log(`❌ Target "${cmd}" non trovato.`);
        }

        console.log(`\n✅ OPERAZIONE COMPLETATA!`);
    } catch (err) {
        console.error("\n❌ ERRORE GENERALE:", err.message);
    }
}

/**
 * Converte i valori Firestore in formati leggibili dallo Spreadsheet
 */
function formatValue(val) {
    if (val === null || val === undefined) return "";
    if (val === true) return "SÌ";
    if (val === false) return "NO";

    // Gestione Date (Timestamp Firestore)
    if (val instanceof Timestamp || (val && typeof val.toDate === 'function')) {
        const d = val instanceof Timestamp ? val.toDate() : val.toDate();
        const day = d.getDate().toString().padStart(2, '0');
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    }

    return val;
}

async function exportToSheet(sheets, t) {
    console.log(`⏳ [${t.coll}] --> Foglio [${t.sheet}]...`);
    try {
        await ensureSheetExists(sheets, t.ss, t.sheet);
        const snapshot = await db.collection(t.coll).get();

        if (snapshot.empty) {
            console.log(`   ⚠️ Collezione ${t.coll} vuota. Salto.`);
            return;
        }

        const docs = snapshot.docs.map(doc => ({
            id_doc_firestore: doc.id,
            ...doc.data()
        }));

        // Recupera tutti gli header possibili analizzando tutti i documenti
        const headerSet = new Set();
        // Mettiamo l'ID come prima colonna se non presente
        headerSet.add("id_doc_firestore");
        docs.forEach(d => Object.keys(d).forEach(k => headerSet.add(k)));
        const headers = Array.from(headerSet);

        // Costruisci le righe
        const rows = [
            headers, // Prima riga: Header
            ...docs.map(d => headers.map(h => formatValue(d[h])))
        ];

        // Pulisci e scrivi
        await sheets.spreadsheets.values.clear({ spreadsheetId: t.ss, range: `${t.sheet}!A:ZZ` });
        await sheets.spreadsheets.values.update({
            spreadsheetId: t.ss,
            range: `${t.sheet}!A1`,
            valueInputOption: 'USER_ENTERED', // USER_ENTERED riconosce meglio date e numeri
            resource: { values: rows },
        });
        console.log(`   ✅ Esportati ${docs.length} record.`);
    } catch (e) {
        console.error(`   ❌ Errore durante l'esportazione di ${t.sheet}:`, e.message);
    }
}

async function exportListe(sheets, spreadsheetId) {
    const sheetName = 'Liste';
    console.log(`⏳ [settings/liste_valori] --> Foglio [${sheetName}]...`);
    try {
        await ensureSheetExists(sheets, spreadsheetId, sheetName);
        const doc = await db.collection('settings').doc('liste_valori').get();

        if (!doc.exists) {
            console.log("   ⚠️ Documento settings/liste_valori non trovato.");
            return;
        }

        const data = doc.data();
        const headers = Object.keys(data); // Ogni chiave è una colonna (es. CATEGORIE, RUOLI)

        // Trova la colonna più lunga per determinare quante righe servono
        const maxRows = Math.max(...headers.map(h => Array.isArray(data[h]) ? data[h].length : 0));

        const rows = [
            headers,
            ...Array.from({ length: maxRows }, (_, i) =>
                headers.map(h => (data[h] && data[h][i]) ? data[h][i] : "")
            )
        ];

        await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetName}!A:ZZ` });
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'RAW',
            resource: { values: rows },
        });
        console.log(`   ✅ Liste esportate.`);
    } catch (e) {
        console.error(`   ❌ Errore Liste:`, e.message);
    }
}

async function ensureSheetExists(sheets, spreadsheetId, title) {
    try {
        const ss = await sheets.spreadsheets.get({ spreadsheetId });
        if (!ss.data.sheets.some(s => s.properties.title === title)) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: { requests: [{ addSheet: { properties: { title } } }] }
            });
            console.log(`   📝 Creato foglio mancante: ${title}`);
        }
    } catch (e) {
        console.error("Errore verifica foglio:", e.message);
    }
}

start();