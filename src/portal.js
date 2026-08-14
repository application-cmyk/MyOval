import { db } from "./firebase-config.js";
import { doc, getDoc, collection, getDocs, query, where } from "firebase/firestore";
import { buildFamilyUI, selectMember } from "./anagrafica.js";
import { callGAS, mapArraysToObjects, formattaDataRugby } from "./utils.js";

/**
 * Inizializzazione Portale con Error Handling avanzato
 */
export async function initPortal(user) {
    const loading = document.getElementById('loading-overlay');
    const errorContainer = document.getElementById('global-error-container');

    if (loading) loading.style.display = 'flex';
    if (errorContainer) errorContainer.classList.add('d-none'); // Reset errori precedenti

    try {
        const email = user.email.toLowerCase().trim();
        const username = email.split('@')[0];
        const isNumeric = /^\d+$/.test(username);
        const isInternal = email.endsWith("@rugbymilano.it");

        // --- 1. DETERMINAZIONE GRUPPO OPERATIVO (Chi opera) ---
        let userGroup = "ASSOCIATO";
        try {
            if (isInternal && !isNumeric) {
                const roleSnap = await getDoc(doc(db, "staff_roles", email));
                if (roleSnap.exists()) {
                    userGroup = (roleSnap.data().Gruppo || roleSnap.data().Ruolo || "STAFF").trim();
                } else {
                    userGroup = "STAFF";
                }
            }
        } catch (e) {
            console.warn("⚠️ Impossibile leggere staff_roles, procedo come ASSOCIATO:", e);
        }

        // --- 2. DETERMINAZIONE STRADA DI ACCESSO E ID INIZIALE ---
        let gasAction = "";
        let gasParams = {};
        let idFamigliaIniziale = null;

        if (isInternal && isNumeric) {
            // Caso Utente Club: andiamo diretti su GAS col FIRCode
            gasAction = "GetDatiFamigliaAnagTesseratiFC";
            gasParams = { firCode: username.toString() };
        }
        else {
            // Caso Utente Esterno: cerchiamo l'account registrato in Firestore
            const accountSnap = await getDoc(doc(db, "accounts", email));
            if (!accountSnap.exists()) {
                // Funzione definita nel file portal.js
                return avviaOnboardingSequence(email, loading);
            }
            const accountData = accountSnap.data();
            idFamigliaIniziale = accountData.ID_Famiglia || accountData.id_famiglia;
            gasAction = "GetDatiFamigliaAnagTesseratiIDFam";
            gasParams = { idFamiglia: idFamigliaIniziale ? idFamigliaIniziale.toString() : "" };
        }

        // --- 3. CARICAMENTO DATI PARALLELO (GAS + FIRESTORE) ---
        console.log(`📡 Esecuzione Bridge: ${gasAction}...`);

        let rawRes, uiConfig, servizi;

        try {
            [rawRes, uiConfig, servizi] = await Promise.all([
                callGAS(gasAction, gasParams),
                getUIConfigByGroup(userGroup),
                getServiziOnlineByGroup(userGroup)
            ]);
        } catch (dataErr) {
            console.error("🔥 Errore durante il caricamento dati:", dataErr);
            throw new Error("Errore di connessione al database. Ricarica la pagina.");
        }

        if (!rawRes || !rawRes.famiglia) throw new Error("Dati famiglia non ricevuti dal server Google.");

        // --- 4. MAPPING DATI ---
        const famigliaOggetti = mapArraysToObjects(rawRes.famiglia);

        const creaMappaPerID = (arrayOggetti) => {
            const mappa = {};
            arrayOggetti.forEach(obj => {
                const idC = (obj.IDContatto || obj.ID_Contatto || "").toString().toLowerCase().trim();
                if (idC) mappa[idC] = obj;
            });
            return mappa;
        };

        const atletiMap = creaMappaPerID(mapArraysToObjects(rawRes.atleti));
        const taglieMap = creaMappaPerID(mapArraysToObjects(rawRes.taglie));
        const privacyMap = creaMappaPerID(mapArraysToObjects(rawRes.privacy));
        const codiciOggetti = mapArraysToObjects(rawRes.codici);

        // --- 5. RICERCA AGGRESSIVA ID FAMIGLIA ---
        const idDaGAS = rawRes.debug?.codFam || rawRes.idFamiglia || rawRes.ID_Famiglia;
        const idDaData = (famigliaOggetti.length > 0) ? famigliaOggetti[0].ID_Famiglia : null;
        const idFamigliaFinale = idFamigliaIniziale || idDaGAS || idDaData || "N/D";

        // --- 6. SALVATAGGIO IN MEMORIA GLOBALE ---
        window.globalData = {
            userEmail: email,
            userGroup: userGroup,
            idFamiglia: idFamigliaFinale,
            famiglia: { data: famigliaOggetti },
            atleti: atletiMap,
            taglieKit: taglieMap,
            privacyData: privacyMap,
            codici: codiciOggetti,
            config: uiConfig,
            funzioni: servizi,
            currentProfile: "ASSOCIATO"
        };

        // --- 7. AGGIORNAMENTO INTERFACCIA ---

        // A. Scriviamo l'email nell'header
        const emailLabel = document.getElementById('user-email-display');
        if (emailLabel) emailLabel.innerText = email;

        // B. Scriviamo l'ID Famiglia nel sommario
        const idDisplay = document.getElementById('ui-display-id-famiglia');
        if (idDisplay) idDisplay.innerText = `ID FAMIGLIA: ${idFamigliaFinale}`;

        // C. Gestione Viste
        document.getElementById('onboarding-view')?.classList.add('d-none');
        document.getElementById('dashboard-view')?.classList.remove('d-none');

        // D. Generazione Bolle e Bottoni
        buildFamilyUI(famigliaOggetti);

        const { buildFunzioniUI, validateAllMembers } = await import('./anagrafica.js');
        buildFunzioniUI(servizi);
        validateAllMembers();

        // Seleziona il primo membro
        selectMember(0);

    } catch (error) {
        console.error("❌ Errore Portale:", error);
        if (typeof mostraErroreBloccante === "function") {
            mostraErroreBloccante(error.message);
        } else {
            alert("Si è verificato un errore durante l'avvio: " + error.message);
        }
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function mostraErroreBloccante(msg) {
    const errorCont = document.getElementById('global-error-container');
    const errorMsg = document.getElementById('global-error-msg');
    const dashboard = document.getElementById('dashboard-view');

    if (errorCont && errorMsg) {
        errorMsg.innerText = msg;
        errorCont.classList.remove('d-none');
        if (dashboard) dashboard.classList.add('d-none');

        // Scroll verso l'errore per essere sicuri che l'utente lo veda
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        alert("ERRORE CRITICO: " + msg);
    }
}


/**
 * Helper per mostrare l'errore nel box rosso dell'index
 */
function mostraErroreCritico(msg) {
    const errCont = document.getElementById('global-error-container');
    const errMsg = document.getElementById('global-error-msg');
    if (errCont && errMsg) {
        errMsg.innerText = msg;
        errCont.classList.remove('d-none');
        // Scroll verso l'errore
        errCont.scrollIntoView({ behavior: 'smooth' });
    } else {
        alert(msg); // Fallback se il div non esiste
    }
}


/**
 * Nuova funzione per caricare i campi filtrati per Gruppo
 */
async function getUIConfigByGroup(groupName) {
    try {
        const [configSnap, listeSnap] = await Promise.all([
            getDocs(query(collection(db, "ui_config"), where("Gruppo", "==", groupName))),
            getDoc(doc(db, "settings", "liste_valori"))
        ]);

        const dizionario = listeSnap.exists() ? listeSnap.data() : {};
        const profili = { "ASSOCIATO": [], "ATLETA": [] };

        configSnap.forEach(docSnap => {
            const f = docSnap.data();
            const pName = (f.Profilo || "ASSOCIATO").toUpperCase().trim();
            if (!profili[pName]) profili[pName] = [];

            // Gestione Liste
            let opzioni = [];
            const rawOpt = f.Opzioni_Lista || f.Opzioni || "";
            const tipoInput = (f.Tipo_Input || "").toLowerCase();

            if (tipoInput === "lista") {
                if (rawOpt.toUpperCase().startsWith("LISTE:")) {
                    const key = rawOpt.split(":")[1].trim().toUpperCase();
                    opzioni = dizionario[key] || [];
                }
                // --- AGGIUNTA QUESTA CONDIZIONE ---
                else if (rawOpt.toUpperCase().startsWith("ARTICOLO:")) {
                    // Passiamo la stringa intera, la risolverà shop.js al momento del click
                    opzioni = rawOpt;
                }
                else if (rawOpt) {
                    opzioni = rawOpt.split(',').map(s => s.trim());
                }
            }

            profili[pName].push({
                id: f.ID_Campo,
                label: f.Etichetta || f.ID_Campo,
                sezione: f.Sezione || "Generale",
                larghezza: parseInt(f.Larghezza_3__4__6_12 || 4),
                tipoInput: (f.Tipo_Input || "testo").toLowerCase(),
                required: f.Obbligatorio === true,
                readonly: f.Readonly === true,
                visibile: f.Visibile === true,
                ordine: parseInt(f.Ordine) || 0,
                sottotitolo: f.Sottotitolo_Help_Text || "",
                opzioni: opzioni
            });
        });

        Object.keys(profili).forEach(p => profili[p].sort((a, b) => a.ordine - b.ordine));
        return profili;
    } catch (e) { console.error(e); return {}; }
}


/**
 * Legge la configurazione dei campi e le liste da Firestore
 */
async function getUIConfig() {
    try {
        const [configSnap, listeSnap] = await Promise.all([
            getDocs(collection(db, "ui_config")),
            getDoc(doc(db, "settings", "liste_valori"))
        ]);

        const allFields = [];
        configSnap.forEach(doc => allFields.push(doc.data()));

        // Ordinamento numerico basato sul campo Ordine (es: 001, 002...)
        allFields.sort((a, b) => (parseInt(a.Ordine) || 0) - (parseInt(b.Ordine) || 0));

        const dizionarioGrezzo = listeSnap.exists() ? listeSnap.data() : {};
        const dizionario = {};
        Object.keys(dizionarioGrezzo).forEach(k => dizionario[k.toUpperCase().trim()] = dizionarioGrezzo[k]);

        // Helper interno per cercare le chiavi in modo tollerante
        const getVal = (obj, target) => {
            const cleanTarget = target.toLowerCase().replace(/_/g, "");
            const foundKey = Object.keys(obj).find(k => k.toLowerCase().replace(/_/g, "") === cleanTarget);
            return foundKey ? obj[foundKey] : undefined;
        };

        const profili = {};
        allFields.forEach(f => {
            const pName = (f.Profilo || "ASSOCIATO").toUpperCase().trim();
            if (!profili[pName]) profili[pName] = [];

            const idTecnico = f.ID_Campo || f.Campo || "";

            profili[pName].push({
                id: idTecnico,
                label: f.Etichetta || idTecnico,
                sezione: f.Sezione || "Generale",
                larghezza: parseInt(f.Larghezza_3__4__6_12 || f.Larghezza || 4),
                tipoInput: (f.Tipo_Input || "testo").toLowerCase(),

                // --- FIX MAPPING: Usa il nome esatto di Firestore ---
                required: f.Obbligatorio === true,
                readonly: f.Readonly === true,
                visibile: f.Visibile === true || f.Visibile === undefined,

                tipoDato: f.Tipo_Dato || "Generale",
                opzioni: generaOpzioni(f, dizionario),
                ordine: parseInt(f.Ordine) || 0,
                sottotitolo: f.Sottotitolo_Help_Text || ""
            });
        });

        console.log("✅ Configurazione caricata per profili:", Object.keys(profili));
        return profili;
    } catch (e) {
        console.error("❌ Errore getUIConfig:", e);
        return {};
    }
}

/**
 * Helper per generare l'array delle opzioni per le select
 */
function generaOpzioni(f, dizionario) {
    let opzioni = [];
    const rawOpt = f.Opzioni_Lista || f.Opzioni || "";
    if (f.Tipo_Input && f.Tipo_Input.toLowerCase() === "lista") {
        if (rawOpt.toUpperCase().startsWith("LISTE:")) {
            const key = rawOpt.split(":")[1].trim().toUpperCase();
            opzioni = dizionario[key] || [];
        } else {
            opzioni = rawOpt ? rawOpt.split(',').map(s => s.trim()) : [];
        }
    }
    return opzioni;
}

/**
 * Disegna i bottoni dei servizi online nel box centrale
 */
export function buildFunzioni(lista) {
    const container = document.getElementById('funzioni-container');
    if (!container || !lista) return;

    container.innerHTML = lista.map(f => `
        <div class="col-6 col-md-4">
            <div class="service-btn-compact h-100" onclick="execFunzione('${f.link}', '${f.tipo}', '${f.nome}', '${f.target}')" style="cursor:pointer">
                <i class="fas fa-external-link-alt text-danger me-2" style="font-size: 0.8rem;"></i>
                <span class="fw-bold text-dark" style="font-size: 0.7rem; text-transform: uppercase;">${f.nome}</span>
            </div>
        </div>`).join('');
}

/**
 * Recupera i servizi abilitati puntando alla chiave corretta 'Link_o_Mode'
 */
async function getServiziOnlineByGroup(groupName) {
    try {
        console.log(`📥 Caricamento Servizi Ordinati per: ${groupName}`);

        // 1. Recupero le abilitazioni con l'ordine specifico per questo gruppo
        const q = query(collection(db, "config_access"), where("Gruppo", "==", groupName.toUpperCase()));
        const accessSnap = await getDocs(q);


        const mappingAccesso = {}; // Funzione -> Ordine
        accessSnap.forEach(doc => {
            const d = doc.data();
            const nomeFunz = (d.Funzione || d.Funzionalit || "").toLowerCase().trim();
            if (nomeFunz) {
                mappingAccesso[nomeFunz] = parseInt(d.Ordine) || 999;
            }
        });

        if (Object.keys(mappingAccesso).length === 0) return [];

        // 2. Recupero i dettagli tecnici (features)
        const featuresSnap = await getDocs(collection(db, "features"));
        const listaFinal = [];

        featuresSnap.forEach(doc => {
            const data = doc.data();
            const idFeature = doc.id.toLowerCase().trim();

            if (mappingAccesso[idFeature] !== undefined) {
                listaFinal.push({
                    nome: data.Nome || doc.id,
                    link: data.Link_o_Mode || data.Link || "",
                    tipo: (data.Tipo || "IFRAME").toUpperCase(),
                    target: data.Target || "_self",
                    sottotitolo: data.Sottotitolo_Help_Text || "",
                    // PRENDIAMO L'ORDINE DALLA TABELLA ACCESSI
                    ordinePresentazione: mappingAccesso[idFeature]
                });
            }
        });

        // 3. ORDINAMENTO FINALE basato sulla tabella config_access
        listaFinal.sort((a, b) => a.ordinePresentazione - b.ordinePresentazione);

        return listaFinal;
    } catch (e) {
        console.error("❌ Errore in getServiziOnlineByGroup:", e);
        return [];
    }
}

// Funzione helper per l'onboarding
async function avviaOnboardingSequence(email, loading) {
    document.getElementById('dashboard-view').classList.add('d-none');
    document.getElementById('onboarding-view').classList.remove('d-none');
    window.globalData = { userEmail: email, config: await getUIConfigByGroup("ASSOCIATO") };
    const { WIZ_init } = await import('./onboarding.js');
    WIZ_init();
    if (loading) loading.style.display = 'none';
}
