const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { google } = require('googleapis');

const args = process.argv.slice(2);
const cmd = args[0] ? args[0].toLowerCase() : null;
const env = args[1] ? args[1].toLowerCase() : "staging";

const keyFile = env === "prod" ? "./service-account-prod.json" : "./service-account-staging.json";
const serviceAccount = require(keyFile);

const ID_SS_BASE = "15-aMr1xLiLwP1TAQvczXMn4do2Y2zR-dm1um9KvVuFY";

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const smartParse = (val) => {
    if (typeof val !== 'string') return val;
    let s = val.replace('€', '').replace(/\s/g, '').replace(',', '.').trim();
    if (s === "" || isNaN(s)) return val;
    return Number(s);
};

async function start() {
    if (!cmd) {
        console.log("\n❌ Uso: node ripristino.js [TARGET] [ENV]");
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
        'shop_tar': { ss: ID_SS_BASE, sheet: 'Shop_Tariffe', coll: 'shop_rates', key: 'Nome_Tariffa' },
        'shop_sco': { ss: ID_SS_BASE, sheet: 'Shop_Sconti', coll: 'shop_discounts', key: 'Nome_Sconto' }
    };

    try {
        console.log(`\n🚀 RIPRISTINO DA BACKUP [${env.toUpperCase()}]`);
        if (cmd === 'liste') {
            await importListe(sheets, ID_SS_BASE);
        } else if (targets[cmd]) {
            await importFromBackup(sheets, targets[cmd]);
        } else if (cmd === 'all') {
            for (let k in targets) await importFromBackup(sheets, targets[k]);
            await importListe(sheets, ID_SS_BASE);
        }
        console.log(`\n✅ RIPRISTINO COMPLETATO!`);
    } catch (err) { console.error("\n❌ ERRORE:", err.message); }
}

async function importFromBackup(sheets, t) {
    console.log(`⏳ Ripristino [${t.sheet}]...`);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: t.ss, range: `${t.sheet}!A:ZZ` });
    const rows = res.data.values;
    if (!rows || rows.length <= 1) return;

    const headers = rows[0];
    const dataRows = rows.slice(1);
    let batch = db.batch();
    let count = 0;

    for (const rowData of dataRows) {
        let obj = {};
        let docId = null;
        headers.forEach((h, idx) => {
            let val = rowData[idx];
            if (h === 'id_doc_firestore') { docId = val; return; }
            if (val === "SÌ") val = true;
            else if (val === "NO") val = false;
            else val = smartParse(val);
            if (val !== undefined && val !== "") obj[h] = val;
        });

        if (docId) {
            batch.set(db.collection(t.coll).doc(docId), obj);
            count++;
        }
        if (count % 500 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    console.log(`   ✅ Ripristinati ${count} documenti.`);
}

async function importListe(sheets, spreadsheetId) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `Liste!A:ZZ` });
    if (!res.data.values) return;
    const headers = res.data.values[0];
    const data = {};
    headers.forEach((h, i) => {
        if (h) data[h.toUpperCase().trim()] = res.data.values.slice(1).map(row => row[i]).filter(Boolean);
    });
    await db.collection('settings').doc('liste_valori').set(data);
    console.log(`✅ [Liste] Ripristinate.`);
}

start();