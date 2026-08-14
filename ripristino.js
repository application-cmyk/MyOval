const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { google } = require('googleapis');

// --- CONFIGURAZIONE ARGOMENTI ---
const args = process.argv.slice(2);
const cmd = args[0] ? args[0].toLowerCase() : null;
const env = args[1] ? args[1].toLowerCase() : "staging";

// --- SELEZIONE FILE CHIAVI ---
const keyFile = env === "prod" ? "./service-account-prod.json" : "./service-account-staging.json";

let serviceAccount;
try {
    serviceAccount = require(keyFile);
} catch (e) {
    console.error(`\n❌ ERRORE: Impossibile trovare il file delle chiavi: ${keyFile}`);
    process.exit(1);
}

// --- ID SPREADSHEET DI BACKUP ---
const ID_SS_BACKUP = "15rAkEzv4VDakmfF_91HrpxGHxOughyNhI9H-8Navs1w";

// --- INIZIALIZZAZIONE FIREBASE ---
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

console.log("-----------------------------------------");
console.log("PROGETTO DESTINAZIONE:", db.projectId);
console.log("SERVICE ACCOUNT EMAIL:", serviceAccount.client_email);
console.log("-----------------------------------------");

// --- CONFIGURAZIONE AUTENTICAZIONE GOOGLE SHEETS ---
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function start() {
    if (!cmd) {
        console.log("\n❌ Uso: node ripristino.js [TARGET] [ENV]");
        console.log("Esempi: \n - node ripristino.js all staging\n - node ripristino.js accounts prod\n");
        process.exit(1);
    }

    console.log(`\n🚀 RIPRISTINO [${env.toUpperCase()}]`);
    console.log(`📡 Progetto Firebase: ${serviceAccount.project_id}`);

    try {
        // --- TEST DI AUTENTICAZIONE ---
        console.log("⏳ Verifica connessione a Google APIs...");
        await auth.getAccessToken();
        console.log("✅ Autenticazione Google riuscita!");

        const targets = {
            'accounts': { ss: ID_SS_BACKUP, sheet: 'Export_Accounts', coll: 'accounts' },
            'config': { ss: ID_SS_BACKUP, sheet: 'Export_Config_Campi', coll: 'ui_config' },
            'staff': { ss: ID_SS_BACKUP, sheet: 'Export_Staff_Ruoli', coll: 'staff_roles' },
            'access': { ss: ID_SS_BACKUP, sheet: 'Export_Config_Accessi', coll: 'config_access' },
            'features': { ss: ID_SS_BACKUP, sheet: 'Export_Funzionalità', coll: 'features' }
        };

        if (cmd === 'liste') {
            await importListe(sheets, ID_SS_BACKUP);
        } else if (targets[cmd]) {
            await importFromBackup(sheets, targets[cmd]);
        } else if (cmd === 'all') {
            for (let k in targets) await importFromBackup(sheets, targets[k]);
            await importListe(sheets, ID_SS_BACKUP);
        } else {
            console.log(`❌ Errore: Target [${cmd}] non configurato.`);
        }

        console.log(`\n✅ OPERAZIONE ${env.toUpperCase()} COMPLETATA!`);
        process.exit(0);

    } catch (err) {
        console.error("\n❌ ERRORE CRITICO:");
        console.error(err.message);
        if (err.message.includes("invalid_grant")) {
            console.log("\n💡 CONSIGLIO: Sincronizza l'orologio di Windows nelle impostazioni di sistema!");
        }
        process.exit(1);
    }
}

async function importFromBackup(sheets, t) {
    console.log(`\n⏳ Ripristino [${t.sheet}] --> Firestore [${t.coll}]...`);
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: t.ss,
            range: `${t.sheet}!A:ZZ`
        });
        const rows = res.data.values;
        if (!rows || rows.length <= 1) {
            console.log(`⚠️  Foglio ${t.sheet} vuoto o non trovato.`);
            return;
        }

        const headers = rows[0];
        const dataRows = rows.slice(1);
        let batch = db.batch();
        let count = 0;

        for (const rowData of dataRows) {
            let obj = {};
            let docId = null;

            headers.forEach((h, idx) => {
                let val = rowData[idx];

                if (h === 'id_doc_firestore') {
                    docId = val;
                    return;
                }

                // Conversione formati dati
                if (val === "SÌ") val = true;
                else if (val === "NO") val = false;
                else if (!isNaN(val) && val !== "" && val !== null && typeof val !== 'boolean') {
                    val = Number(val);
                }

                if (val !== undefined && val !== "") {
                    obj[h] = val;
                }
            });

            if (docId) {
                const docRef = db.collection(t.coll).doc(docId);
                batch.set(docRef, obj);
                count++;
            }

            if (count % 500 === 0) {
                await batch.commit();
                batch = db.batch();
            }
        }
        await batch.commit();
        console.log(`✅ [${t.coll}] Ripristinati ${count} documenti.`);
    } catch (e) {
        console.error(`❌ Errore ripristino ${t.coll}:`, e.message);
    }
}

async function importListe(sheets, spreadsheetId) {
    const sheetName = 'Liste_Backup';
    console.log(`\n⏳ Ripristino Liste --> Firestore [settings/liste_valori]...`);
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:ZZ`
        });
        const rows = res.data.values;
        if (!rows) return;

        const headers = rows[0];
        const data = {};

        headers.forEach((h, i) => {
            if (h) {
                data[h.toUpperCase().trim()] = rows.slice(1).map(row => row[i]).filter(Boolean);
            }
        });

        await db.collection('settings').doc('liste_valori').set(data);
        console.log(`✅ [Liste] Ripristinate.`);
    } catch (e) {
        console.error(`❌ Errore ripristino Liste:`, e.message);
    }
}

start();