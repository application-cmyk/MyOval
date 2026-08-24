/**
 * Inizializzazione Portale con Error Handling avanzato
 */
import { db } from "./firebase-config.js";
import { doc, getDoc, collection, getDocs, query, where } from "firebase/firestore";
import { buildFamilyUI, selectMember } from "./anagrafica.js";
import { callGAS, mapArraysToObjects, formattaDataRugby } from "./utils.js";

/**
 * Inizializzazione Portale con gestione Cache e risoluzione ID Famiglia
 */
export async function initPortal(user) {
    const loading = document.getElementById('loading-overlay');
    const errorContainer = document.getElementById('global-error-container');
    const email = user.email.toLowerCase().trim();

    if (errorContainer) errorContainer.classList.add('d-none');

    try {
        // --- 1. VERIFICA CACHE (Sessione già attiva) ---
        const rawCache = sessionStorage.getItem('myoval_shared_data');
        if (rawCache) {
            const parsed = JSON.parse(rawCache);
            if (parsed.userEmail === email && parsed.idFamiglia && parsed.idFamiglia !== "N/D") {
                window.globalData = parsed;
                console.log("%c 🚀 CACHE DATA RECOVERY: Sessione valida. ", "color: #28a745; font-weight: bold;");
                renderFinalUI(loading);
                return;
            }
        }

        // --- 2. CARICAMENTO DATI DAI SERVER ---
        if (loading) {
            loading.style.setProperty('display', 'flex', 'important');
            const h5 = loading.querySelector('h5');
            if (h5) h5.innerText = "Sincronizzazione dati...";
        }

        const username = email.split('@')[0];
        const isNumeric = /^\d+$/.test(username);
        const isInternal = email.endsWith("@rugbymilano.it");

        // A. Determinazione Gruppo Operatore (Staff vs Socio)
        let userGroup = "ASSOCIATO";
        const roleSnap = await getDoc(doc(db, "staff_roles", email));
        if (roleSnap.exists()) {
            userGroup = (roleSnap.data().Gruppo || roleSnap.data().Ruolo || "STAFF").toUpperCase();
        }

        // B. Determinazione Strada Accesso
        let gasAction = "";
        let gasParams = {};
        let idFamigliaDaFirestore = null;

        if (isInternal && isNumeric) {
            gasAction = "GetDatiFamigliaAnagTesseratiFC";
            gasParams = { firCode: username.toString() };
        } else {
            const accountSnap = await getDoc(doc(db, "accounts", email));
            if (!accountSnap.exists()) {
                // Avvio Wizard per nuovi utenti
                return avviaOnboardingSequence(email, loading);
            }
            const accountData = accountSnap.data();
            idFamigliaDaFirestore = accountData.ID_Famiglia || accountData.id_famiglia;
            gasAction = "GetDatiFamigliaAnagTesseratiIDFam";
            gasParams = { idFamiglia: idFamigliaDaFirestore ? idFamigliaDaFirestore.toString() : "" };
        }

        // C. Chiamata Parallela Bridge GAS e Firestore
        console.log(`📡 Chiamata Bridge: ${gasAction}...`);
        const [rawRes, uiConfig, servizi, shopData] = await Promise.all([
            callGAS(gasAction, gasParams),
            getUIConfigByGroup(userGroup),
            getServiziOnlineByGroup(userGroup),
            callGAS("getShopPortalDataWithCart", { email, idFamiglia: idFamigliaDaFirestore || "0", membri: [] })
        ]);

        if (!rawRes || !rawRes.famiglia) throw new Error("Dati non ricevuti dal server Google.");

        // D. Mapping Dati
        const famigliaOggetti = mapArraysToObjects(rawRes.famiglia);

        const creaMappa = (arr) => {
            const m = {};
            arr.forEach(o => {
                const id = (o.IDContatto || o.ID_Contatto || "").toString().toLowerCase().trim();
                if (id) m[id] = o;
            });
            return m;
        };

        // --- 3. LOGICA DI SICUREZZA ID FAMIGLIA (FIX CRITICO) ---
        // Evitiamo che il FIR (username) venga salvato come ID Famiglia
        let idFamigliaFinale = "N/D";

        // Priorità 1: Valore certo da Firestore (per esterni)
        if (idFamigliaDaFirestore) {
            idFamigliaFinale = idFamigliaDaFirestore;
        } else {
            // Priorità 2: Valore dalla colonna ID_Famiglia del primo membro trovato
            const idDalSocio = (famigliaOggetti.length > 0) ? famigliaOggetti[0].ID_Famiglia : null;
            // Priorità 3: Valore dal campo debug inviato da GAS
            const idDalDebug = rawRes.debug?.codFam;

            // Validazione: L'ID non deve corrispondere al FIR (username)
            if (idDalSocio && idDalSocio.toString() !== username) {
                idFamigliaFinale = idDalSocio;
            } else if (idDalDebug && idDalDebug.toString() !== username) {
                idFamigliaFinale = idDalDebug;
            }
        }

        console.log(`🏠 ID FAMIGLIA VALIDATO: ${idFamigliaFinale}`);

        // --- 4. SALVATAGGIO IN MEMORIA GLOBALE ---
        window.globalData = {
            userEmail: email,
            userGroup: userGroup,
            idFamiglia: idFamigliaFinale.toString(),
            famiglia: { data: famigliaOggetti },
            atleti: creaMappa(mapArraysToObjects(rawRes.atleti)),
            taglieKit: creaMappa(mapArraysToObjects(rawRes.taglie)),
            privacyData: creaMappa(mapArraysToObjects(rawRes.privacy)),
            codici: mapArraysToObjects(rawRes.codici),
            config: uiConfig,
            funzioni: servizi,
            articoli: shopData.articoli || [],
            currentProfile: "ASSOCIATO",
            selectedMemberIndex: 0
        };

        // Salvataggio nella valigia di sessione per App Satellite (Shop, Certificati...)
        sessionStorage.setItem('myoval_shared_data', JSON.stringify(window.globalData));

        renderFinalUI(loading);

    } catch (error) {
        console.error("❌ Errore Portale:", error);
        if (typeof mostraErroreBloccante === "function") mostraErroreBloccante(error.message);
    }
}

async function renderFinalUI(loading) {
    if (loading) loading.style.setProperty('display', 'none', 'important');

    const data = window.globalData;

    // Navbar
    const emailLabel = document.getElementById('user-email-display');
    if (emailLabel) emailLabel.innerText = data.userEmail;

    // ID Famiglia in alto a destra
    const idDisplay = document.getElementById('ui-display-id-famiglia');
    if (idDisplay) idDisplay.innerText = `ID FAMIGLIA: ${data.idFamiglia}`;

    // Switch Viste
    document.getElementById('onboarding-view')?.classList.add('d-none');
    document.getElementById('dashboard-view')?.classList.remove('d-none');
    document.getElementById('dashboard-view')?.style.setProperty('display', 'block', 'important');

    // Componenti
    buildFamilyUI(data.famiglia.data);

    const { buildFunzioniUI, validateAllMembers } = await import('./anagrafica.js');
    buildFunzioniUI(data.funzioni);
    validateAllMembers();

    // Seleziona il membro (usa quello in cache se presente)
    selectMember(data.selectedMemberIndex || 0);
}


function mostraErroreBloccante(msg) {
    const errCont = document.getElementById('global-error-container');
    const errMsg = document.getElementById('global-error-msg');
    if (errCont && errMsg) {
        errMsg.innerText = msg;
        errCont.classList.remove('d-none');
    } else {
        alert(msg);
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
        console.log(`📥 Caricamento regole UI per Gruppo: ${groupName}`);

        const q = query(collection(db, "ui_config"), where("Gruppo", "==", groupName.toUpperCase()));
        const [configSnap, listeSnap] = await Promise.all([
            getDocs(q),
            getDoc(doc(db, "settings", "liste_valori"))
        ]);

        const dizionarioGrezzo = listeSnap.exists() ? listeSnap.data() : {};
        const dizionario = {};
        Object.keys(dizionarioGrezzo).forEach(k => {
            dizionario[k.toUpperCase().trim()] = dizionarioGrezzo[k];
        });

        const configPerProfilo = { "ASSOCIATO": [], "ATLETA": [] };

        configSnap.forEach(docSnap => {
            const f = docSnap.data();
            const pName = (f.Profilo || "ASSOCIATO").toUpperCase().trim();
            if (!configPerProfilo[pName]) configPerProfilo[pName] = [];

            let opzioni = [];
            // Normalizziamo per il controllo logico ma teniamo l'originale per il log
            const tipoInputOriginale = f.Tipo_Input || "";
            const tipoInputLower = tipoInputOriginale.toLowerCase().trim();

            if (tipoInputLower === "lista" || tipoInputLower === "multi-lista") {
                const rawOpt = f.Opzioni_Lista || f.Opzioni || "";
                const rawUpper = rawOpt.toUpperCase().trim();

                if (rawUpper.startsWith("LISTE:")) {
                    const key = rawOpt.split(":")[1].trim().toUpperCase();
                    opzioni = dizionario[key] || [];
                } else if (rawUpper.startsWith("ARTICOLO:")) {
                    // Restituiamo la stringa per l'anagrafica.js (Scenario B)
                    opzioni = rawOpt;
                } else if (rawOpt) {
                    opzioni = rawOpt.split(',').map(s => s.trim());
                }

                // --- LOG DI TRACCIAMENTO SPECIFICO PER MULTI-LISTA ---
                if (tipoInputLower === "multi-lista") {
                    console.group(`✨ Tracciamento Campo Multi-Lista: ${f.ID_Campo}`);
                    console.log("Valore originale in DB:", tipoInputOriginale);
                    console.log("Configurazione Opzioni:", rawOpt);
                    console.log("Risultato Opzioni processate:", opzioni);
                    console.groupEnd();
                }
            }

            configPerProfilo[pName].push({
                id: f.ID_Campo,
                label: f.Etichetta || f.ID_Campo,
                sezione: f.Sezione || "Generale",
                larghezza: parseInt(f.Larghezza_3__4__6_12 || f.Larghezza || 4),
                tipoInput: tipoInputLower, // Usiamo il lower per coerenza nel rendering
                required: f.Obbligatorio === true,
                readonly: f.Readonly === true,
                visibile: f.Visibile === true,
                ordine: parseInt(f.Ordine) || 0,
                sottotitolo: f.Sottotitolo_Help_Text || "",
                opzioni: opzioni
            });
        });

        Object.keys(configPerProfilo).forEach(p => configPerProfilo[p].sort((a, b) => a.ordine - b.ordine));

        console.log("✅ Configurazione caricata. Profili pronti:", Object.keys(configPerProfilo));
        return configPerProfilo;
    } catch (e) {
        console.error("❌ Errore in getUIConfigByGroup:", e);
        return {};
    }
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
    // Cerchiamo il valore della colonna opzioni (tollerante ai nomi)
    const rawOpt = (f.Opzioni_Lista || f.Opzioni || f.opzioni || "").toString().trim();
    const tipo = (f.Tipo_Input || f.TipoInput || "").toLowerCase().trim();

    if (tipo === "lista" || tipo === "multi-lista") {
        const rawUpper = rawOpt.toUpperCase();

        // CASO 1: Riferimento al dizionario (es. LISTE:Sesso)
        if (rawUpper.startsWith("LISTE:")) {
            const key = rawOpt.split(":")[1].trim().toUpperCase();
            return dizionario[key] || [];
        }

        // CASO 2: Riferimento DINAMICO all'articolo (es. ARTICOLO:Lista_Squadre)
        // FONDAMENTALE: Restituiamo la STRINGA così com'è per attivarla in anagrafica.js
        if (rawUpper.startsWith("ARTICOLO:")) {
            return rawOpt;
        }

        // CASO 3: Lista fissa testuale (es. "Sì, No")
        if (rawOpt !== "") {
            return rawOpt.split(',').map(s => s.trim());
        }
    }
    return [];
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
        const gName = groupName.toUpperCase().trim();
        console.log(`%c 🛰️ INIZIO RECUPERO SERVIZI PER: ${gName} `, "background: #1a2b3c; color: #fff; font-weight: bold;");

        // 1. Recupero regole di accesso dal database
        const qAccess = query(collection(db, "config_access"), where("Gruppo", "in", [gName, "ALL"]));
        const accessSnap = await getDocs(qAccess);

        const mappingAccesso = {};
        accessSnap.forEach(docSnap => {
            const d = docSnap.data();
            // Cerchiamo il nome funzione (tollerante a Funzione/Funzionalit)
            const fKey = (d.Funzione || d.Funzionalit || "").toLowerCase().trim();
            if (fKey) {
                // Forziamo il valore a Numero
                const valOrdine = parseInt(d.Ordine);
                mappingAccesso[fKey] = isNaN(valOrdine) ? 99 : valOrdine;
                console.log(`📍 Da Spreadsheet Accessi -> Funzione: "${fKey}" | Ordine: ${mappingAccesso[fKey]}`);
            }
        });

        // 2. Recupero dettagli tecnici (features)
        const featuresSnap = await getDocs(collection(db, "features"));
        const listaFinal = [];

        featuresSnap.forEach(docSnap => {
            const fId = docSnap.id.toLowerCase().trim();

            if (mappingAccesso[fId] !== undefined) {
                const d = docSnap.data();
                listaFinal.push({
                    nome: d.Nome || docSnap.id,
                    link: d.Link_o_Mode || d.Link || "",
                    tipo: (d.Tipo || "IFRAME").toUpperCase(),
                    // Assegniamo l'ordine numerico trovato prima
                    ordine: mappingAccesso[fId]
                });
            }
        });

        // --- IL LOG CRITICO ---
        console.log("📦 Lista PRIMA del sort:", listaFinal.map(f => `${f.ordine}: ${f.nome}`));

        // 3. ORDINAMENTO NUMERICO
        listaFinal.sort((a, b) => a.ordine - b.ordine);

        console.log("%c ✅ LISTA DOPO IL SORT (Ordine finale): ", "color: #28a745; font-weight: bold;", listaFinal.map(f => `${f.ordine}: ${f.nome}`));

        return listaFinal;

    } catch (e) {
        console.error("❌ Errore in getServiziOnlineByGroup:", e);
        return [];
    }
}

async function avviaOnboardingSequence(email, loading) {
    document.getElementById('dashboard-view')?.classList.add('d-none');
    document.getElementById('onboarding-view')?.classList.remove('d-none');
    window.globalData = { userEmail: email, config: await getUIConfigByGroup("ASSOCIATO") };
    const { WIZ_init } = await import('./onboarding.js?v=35.0.1');
    WIZ_init();
    if (loading) loading.style.display = 'none';
}
