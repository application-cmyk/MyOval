const { initializeApp, cert } = require('firebase-admin/app'); // <--- QUESTA RIGA MANCAVA
const { getFirestore } = require('firebase-admin/firestore');  // <--- QUESTA RIGA MANCAVA
const { google } = require('googleapis');

const args = process.argv.slice(2);
const cmd = args[0] ? args[0].toLowerCase() : null;
const env = args[1] ? args[1].toLowerCase() : "staging";

const keyFile = env === "prod" ? "./service-account-prod.json" : "./service-account-staging.json";
const serviceAccount = require(keyFile);

console.log(`\n🚀 ESPORTAZIONE [${env.toUpperCase()}]`);

// --- ID SPREADSHEET DI BACKUP ---
const ID_SS_BACKUP = "15rAkEzv4VDakmfF_91HrpxGHxOughyNhI9H-8Navs1w";

// Inizializzazione Firebase
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function start() {
    if (!cmd) {
        console.log("❌ Uso: node esportazione.js [TARGET] [ENV]");
        process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const targets = {
        'accounts': { ss: ID_SS_BACKUP, sheet: 'Utenti_Account', coll: 'accounts' },
        'config': { ss: ID_SS_BACKUP, sheet: 'Config_Campi', coll: 'ui_config' },
        'staff': { ss: ID_SS_BACKUP, sheet: 'Staff_Ruoli', coll: 'staff_roles' },
        'access': { ss: ID_SS_BACKUP, sheet: 'Config_Accessi', coll: 'config_access' },
        'features': { ss: ID_SS_BACKUP, sheet: 'Funzionalità', coll: 'features' }
    };

    try {
        if (cmd === 'liste') {
            await exportListe(sheets, ID_SS_BACKUP);
        } else if (targets[cmd]) {
            await exportToSheet(sheets, targets[cmd]);
        } else if (cmd === 'all') {
            for (let k in targets) await exportToSheet(sheets, targets[k]);
            await exportListe(sheets, ID_SS_BACKUP);
        }
        console.log(`\n✅ COMPLETATO!`);
    } catch (err) { console.error("\n❌ ERRORE:", err.message); }
}

async function ensureSheetExists(sheets, spreadsheetId, title) {
    const ss = await sheets.spreadsheets.get({ spreadsheetId });
    if (!ss.data.sheets.some(s => s.properties.title === title)) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: { requests: [{ addSheet: { properties: { title } } }] }
        });
    }
}

async function exportToSheet(sheets, t) {
    console.log(`⏳ [${t.coll}] --> [${t.sheet}]...`);
    try {
        await ensureSheetExists(sheets, t.ss, t.sheet);
        const snapshot = await db.collection(t.coll).get();
        if (snapshot.empty) return;
        const docs = snapshot.docs.map(doc => ({ id_doc_firestore: doc.id, ...doc.data() }));
        const headerSet = new Set();
        docs.forEach(d => Object.keys(d).forEach(k => headerSet.add(k)));
        const headers = Array.from(headerSet);
        const rows = [headers, ...docs.map(d => headers.map(h => {
            let val = d[h];
            if (val === true) return "SÌ";
            if (val === false) return "NO";
            return val !== undefined ? val : "";
        }))];
        await sheets.spreadsheets.values.clear({ spreadsheetId: t.ss, range: `${t.sheet}!A:ZZ` });
        await sheets.spreadsheets.values.update({
            spreadsheetId: t.ss, range: `${t.sheet}!A1`,
            valueInputOption: 'RAW', resource: { values: rows },
        });
    } catch (e) { console.error(`❌ Errore ${t.sheet}:`, e.message); }
}

async function exportListe(sheets, spreadsheetId) {
    const sheetName = 'Liste_Backup';
    try {
        await ensureSheetExists(sheets, spreadsheetId, sheetName);
        const doc = await db.collection('settings').doc('liste_valori').get();
        if (!doc.exists) return;
        const data = doc.data();
        const headers = Object.keys(data);
        const maxRows = Math.max(...headers.map(h => data[h] ? data[h].length : 0));
        const rows = [headers, ...Array.from({ length: maxRows }, (_, i) => headers.map(h => (data[h] && data[h][i]) ? data[h][i] : ""))];
        await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetName}!A:ZZ` });
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${sheetName}!A1`,
            valueInputOption: 'RAW', resource: { values: rows },
        });
    } catch (e) { console.error(`❌ Errore Liste:`, e.message); }
}

start();
