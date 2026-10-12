/**
 * Inizializzazione Portale con Error Handling avanzato
 */
import { db, auth, APP_ENV } from "./firebase-config.js";
import { doc, getDoc, collection, getDocs, query, where } from "firebase/firestore";
import { buildFamilyUI, selectMember } from "./anagrafica.js";
import { callGAS, mapArraysToObjects, formattaDataRugby } from "./utils.js";

/**
 * Inizializzazione Portale con gestione Cache e risoluzione ID Famiglia
 */
export async function initPortal(user) {
    const loading = document.getElementById('loading-overlay');
    const errorContainer = document.getElementById('global-error-container');

    // --- 1. LOGICA IMPERSONATE ---
    const realEmail = user.email.toLowerCase().trim();
    let emailToLoad = realEmail;
    const impersonateEmail = sessionStorage.getItem('impersonate_email');

    if (impersonateEmail) {
        const staffSnap = await getDoc(doc(db, "staff_roles", realEmail));
        if (staffSnap.exists()) {
            emailToLoad = impersonateEmail.toLowerCase().trim();
            console.warn(`🛠️ MODALITÀ ASSISTENZA: Operando come ${emailToLoad}`);
            if (typeof renderAdminWarningBar === "function") renderAdminWarningBar(emailToLoad);
        } else {
            console.error("🚫 Tentativo di impersonificazione non autorizzato.");
            sessionStorage.removeItem('impersonate_email');
        }
    }

    const email = emailToLoad;
    if (errorContainer) errorContainer.classList.add('d-none');

    try {
        // --- 2. VERIFICA CACHE ---
        const rawCache = sessionStorage.getItem('myoval_shared_data');
        if (rawCache) {
            const parsed = JSON.parse(rawCache);
            if (parsed.userEmail === email && parsed.idFamiglia && parsed.idFamiglia !== "N/D") {
                window.globalData = parsed;
                console.log("%c 🚀 CACHE DATA RECOVERY: Sessione valida. ", "color: #28a745; font-weight: bold;");

                // LOG STATO CACHE PER TAGLIE E PRIVACY
                console.group("📦 Verifica Taglie e Privacy da CACHE");
                console.log("taglieKit in cache:", window.globalData.taglieKit);
                console.log("privacyData in cache:", window.globalData.privacyData);
                console.groupEnd();

                startGlobalCartListener(window.globalData.idFamiglia);
                renderFinalUI(loading);
                return;
            }
        }

        // --- 3. CARICAMENTO DATI ---
        if (loading) {
            loading.style.setProperty('display', 'flex', 'important');
            const h5 = loading.querySelector('h5');
            if (h5) h5.innerText = "Sincronizzazione dati...";
        }

        const username = email.split('@')[0];
        const isNumeric = /^\d+$/.test(username);
        const isInternal = email.endsWith("@rugbymilano.it");

        let userGroup = "ASSOCIATO";
        const roleSnap = await getDoc(doc(db, "staff_roles", email));
        if (roleSnap.exists()) {
            userGroup = (roleSnap.data().Gruppo || roleSnap.data().Ruolo || "STAFF").toUpperCase();
        }

        let gasAction = "";
        let gasParams = {};
        let idFamigliaDaFirestore = null;

        if (isInternal && isNumeric) {
            gasAction = "GetDatiFamigliaAnagTesseratiFC";
            gasParams = { firCode: username.toString() };
        } else {
            const accountSnap = await getDoc(doc(db, "accounts", email));
            if (!accountSnap.exists()) {
                if (impersonateEmail) throw new Error("Account socio non configurato.");
                return avviaOnboardingSequence(email, loading);
            }

            const accountData = accountSnap.data();
            idFamigliaDaFirestore = accountData.ID_Famiglia || accountData.id_famiglia;

            if (userGroup === "ASSOCIATO") {
                userGroup = (accountData.Gruppo || accountData.Ruolo || "ASSOCIATO").toUpperCase().trim();
            }
            gasAction = "GetDatiFamigliaAnagTesseratiIDFam";
            gasParams = { idFamiglia: idFamigliaDaFirestore ? idFamigliaDaFirestore.toString() : "" };
        }

        console.log(`📡 Caricamento dati per Gruppo: ${userGroup}`);

        const [rawRes, uiConfig, servizi, shopArticoliSnap] = await Promise.all([
            callGAS(gasAction, gasParams),
            getUIConfigByGroup(userGroup),
            getServiziOnlineByGroup(userGroup),
            getDocs(collection(db, "shop_items"))
        ]);

        // Controllo se l'utente esiste e ha dati validi nella famiglia
        const famigliaOggetti = rawRes && rawRes.famiglia ? mapArraysToObjects(rawRes.famiglia) : [];
        if (famigliaOggetti.length === 0) {
            throw new Error("Utente non in Anagrafica. Contatta la Segreteria");
        }

        // --- 🔍 DIAGNOSTICA DATI GREZZI DA GOOGLE (GAS) ---
        console.group("📡 Diagnostica Risposta Server GAS (rawRes)");
        console.log("Tutte le proprietà in rawRes:", Object.keys(rawRes));
        console.log("rawRes.taglie grezzo:", rawRes.taglie);
        console.log("rawRes.privacy grezzo:", rawRes.privacy);
        console.groupEnd();

        const articoliShop = shopArticoliSnap.docs.map(d => ({ ID_Articolo: d.id, ...d.data() }));

        const creaMappa = (arr, nomeMappa) => {
            const m = {};
            (arr || []).forEach((o, index) => {
                const id = (o.IDContatto || o.ID_Contatto || o.IdContatto || o.ID_Tesserato || o.ID || "").toString().toLowerCase().trim();
                if (id) {
                    m[id] = o;
                } else if (index === 0) {
                    console.warn(`⚠️ [${nomeMappa}] Attenzione: Impossibile trovare IDContatto nel primo oggetto! Chiavi disponibili:`, Object.keys(o));
                }
            });
            return m;
        };

        const taglieMappate = creaMappa(mapArraysToObjects(rawRes.taglie), "Taglie");
        const privacyMappate = creaMappa(mapArraysToObjects(rawRes.privacy), "Privacy");

        console.group("🗺️ Mappe Create");
        console.log("taglieKit Mappato:", taglieMappate);
        console.log("privacyData Mappato:", privacyMappate);
        console.groupEnd();

        // --- 5. LOGICA DI SICUREZZA ID FAMIGLIA ---
        let idFamigliaFinale = idFamigliaDaFirestore || (famigliaOggetti.length > 0 ? famigliaOggetti[0].ID_Famiglia : "N/D");

        // --- 6. AVVIO LISTENER CARRELLO FIRESTORE ---
        startGlobalCartListener(idFamigliaFinale);

        // --- 7. SALVATAGGIO IN MEMORIA GLOBALE ---
        window.globalData = {
            userEmail: email,
            environment: APP_ENV,
            userGroup: userGroup,
            idFamiglia: idFamigliaFinale.toString(),
            famiglia: { data: famigliaOggetti },
            atleti: creaMappa(mapArraysToObjects(rawRes.atleti), "Atleti"),
            taglieKit: taglieMappate,
            privacyData: privacyMappate,
            codici: mapArraysToObjects(rawRes.codici),
            config: uiConfig,
            funzioni: servizi,
            articoli: articoliShop,
            cart: [],
            currentProfile: "ASSOCIATO",
            selectedMemberIndex: 0
        };

        sessionStorage.setItem('myoval_shared_data', JSON.stringify(window.globalData));
        renderFinalUI(loading);

    } catch (error) {
        console.error("❌ Errore Portale:", error);

        // Spegniamo il loader se attivo
        if (loading) loading.style.setProperty('display', 'none', 'important');

        let messaggioUtente = error.message;
        let tipoErrore = "RETE"; // Default per errori di connessione/CORS o generici

        // Distinguiamo se è un errore di anagrafica o di rete/CORS
        if (error.message.includes("Utente non in Anagrafica")) {
            tipoErrore = "ANAGRAFICA";
        } else if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
            messaggioUtente = "Impossibile connettersi al server. Verifica la tua connessione internet o i permessi dello script.";
        }

        // Chiamiamo la funzione grafica passandogli il tipo di errore
        if (typeof mostraErroreBloccante === "function") {
            mostraErroreBloccante(messaggioUtente, tipoErrore);
        }
    }
}

/**
 * Funzione di supporto per gestire il carrello real-time in tutta la dashboard
 */
function startGlobalCartListener(idFamiglia) {
    if (!idFamiglia || idFamiglia === "N/D") return;

    import("./cart-service.js").then(m => {
        m.listenToCart(idFamiglia, (items) => {
            console.log(`🛒 Dashboard: Carrello sincronizzato (${items.length} articoli)`);

            // Aggiorna variabile in memoria
            if (window.globalData) window.globalData.cart = items;

            // Aggiorna badge carrello nella Navbar se presente
            const badge = document.getElementById('cart-count');
            if (badge) badge.innerText = items.length;
        });
    });
}

function renderAdminWarningBar(target) {
    if (document.getElementById('admin-bar')) return;
    const div = document.createElement('div');
    div.id = 'admin-bar';
    div.style = "background:#ffc107; color:black; font-weight:bold; padding:8px; text-align:center; position:fixed; top:0; width:100%; z-index:10001; border-bottom:2px solid #000; font-size:12px;";
    div.innerHTML = `MODALITÀ ASSISTENZA: STAI OPERANDO COME ${target.toUpperCase()} 
                     <button onclick="sessionStorage.removeItem('impersonate_email'); sessionStorage.removeItem('myoval_shared_data'); window.location.href='admin_control.html'" 
                     class="btn btn-dark btn-sm ms-3" style="font-size:10px;">ESCI</button>`;
    document.body.prepend(div);
    document.body.style.paddingTop = "40px";
}

// Funzione globale per uscire dalla modalità impersonificazione
window.exitImpersonateMode = function () {
    sessionStorage.removeItem('impersonate_email');
    sessionStorage.removeItem('myoval_shared_data');
    // Torna alla pagina di ricerca admin
    window.location.href = 'admin_control.html';
};

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


export function mostraErroreBloccante(messaggio, tipoErrore = "RETE") {
    const errorContainer = document.getElementById('global-error-container');

    let titolo = "⚠️ Attenzione";
    let testoBottone = "Riprova";
    let azioneBottone = () => window.location.reload();

    if (tipoErrore === "ANAGRAFICA") {
        titolo = "❌ Accesso Negato";
        testoBottone = "Esci e Torna al Login";

        azioneBottone = async () => {
            // 1. Salviamo l'email nella blacklist del browser per evitare che il router la ricarichi
            const currentUser = auth.currentUser;
            if (currentUser && currentUser.email) {
                localStorage.setItem('mg_email_bloccata', currentUser.email.toLowerCase().trim());
            }

            // 2. Puliamo eventuali iframe (come fai nel tuo logout)
            const iframe = document.getElementById('gestionale-iframe');
            if (iframe) iframe.src = "about:blank";

            // 3. Pulizia di sessione
            sessionStorage.clear();

            // 4. Eseguiamo il logout di Firebase
            try {
                if (typeof auth !== 'undefined' && auth) {
                    await auth.signOut();
                }
            } catch (err) {
                console.error("Errore durante il logout:", err);
            }

            // 5. Ricarichiamo la pagina in modo pulito (a questo punto scatterà il blocco anti-loop e l'utente resterà al login)
            window.location.replace(window.location.pathname);
        };
    }

    if (errorContainer) {
        errorContainer.innerHTML = `
            <div class="alert alert-danger text-center p-4 shadow-lg mx-auto" role="alert" style="max-width: 500px; margin-top: 50px;">
                <h4 class="alert-heading">${titolo}</h4>
                <hr>
                <p class="mb-4 fs-5">${messaggio}</p>
                <button id="btn-azione-errore" class="btn btn-dark btn-lg w-100 shadow-sm">
                    ${testoBottone}
                </button>
            </div>
        `;

        errorContainer.classList.remove('d-none');

        const btn = document.getElementById('btn-azione-errore');
        if (btn) {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.innerText = "Disconnessione in corso...";
                await azioneBottone();
            });
        }
    } else {
        alert(messaggio);
        azioneBottone();
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

        // --- HELPER PER CONVERTIRE IN BOOLEANO QUALSIASI FORMATO (true, "true", "TRUE", "SI", 1) ---
        const toBool = (val) => {
            if (val === true || val === 1) return true;
            if (typeof val === "string") {
                const s = val.trim().toLowerCase();
                return s === "true" || s === "si" || s === "sì" || s === "1" || s === "vero";
            }
            return false;
        };

        configSnap.forEach(docSnap => {
            const f = docSnap.data();
            const pName = (f.Profilo || "ASSOCIATO").toUpperCase().trim();
            if (!configPerProfilo[pName]) configPerProfilo[pName] = [];

            let opzioni = [];
            const tipoInputOriginale = f.Tipo_Input || "";
            const tipoInputLower = tipoInputOriginale.toLowerCase().trim();

            if (tipoInputLower === "lista" || tipoInputLower === "multi-lista") {
                const rawOpt = f.Opzioni_Lista || f.Opzioni || "";
                const rawUpper = rawOpt.toUpperCase().trim();

                if (rawUpper.startsWith("LISTE:")) {
                    const key = rawOpt.split(":")[1].trim().toUpperCase();
                    opzioni = dizionario[key] || [];
                } else if (rawUpper.startsWith("ARTICOLO:")) {
                    opzioni = rawOpt;
                } else if (rawOpt) {
                    opzioni = rawOpt.split(',').map(s => s.trim());
                }

                if (tipoInputLower === "multi-lista") {
                    console.group(`✨ Tracciamento Campo Multi-Lista: ${f.ID_Campo}`);
                    console.log("Valore originale in DB:", tipoInputOriginale);
                    console.log("Configurazione Opzioni:", rawOpt);
                    console.log("Risultato Opzioni processate:", opzioni);
                    console.groupEnd();
                }
            }

            // --- LETTURA TOLLERANTE DEI CAMPI (gestisce maiuscole, minuscole, underscore e stringhe) ---
            const rawReadonly = f.Readonly ?? f.ReadOnly ?? f.readOnly ?? f.readonly ?? f.Read_Only ?? f.Sola_Lettura ?? f.SolaLettura;
            const rawRequired = f.Obbligatorio ?? f.Required ?? f.required;
            const rawVisibile = f.Visibile ?? f.visibile;

            configPerProfilo[pName].push({
                id: f.ID_Campo,
                label: f.Etichetta || f.ID_Campo,
                sezione: f.Sezione || "Generale",
                larghezza: parseInt(f.Larghezza_3__4__6_12 || f.Larghezza || 4),
                tipoInput: tipoInputLower,
                required: toBool(rawRequired),
                readonly: toBool(rawReadonly), // <--- ORA È FLESSIBILE E ROBUSTO!
                visibile: toBool(rawVisibile),
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
        const gName = (groupName || "ALL").toUpperCase().trim();
        console.log(`%c 🛰️ INIZIO RECUPERO SERVIZI PER: ${gName} `, "background: #1a2b3c; color: #fff; font-weight: bold;");

        // Funzione di utilità per normalizzare le chiavi come fa il migratore
        const normalize = (str) => str ? str.toString().toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') : "";

        // 1. Recupero regole di accesso
        const qAccess = query(collection(db, "config_access"), where("Gruppo", "in", [gName, "ALL"]));
        const accessSnap = await getDocs(qAccess);

        if (accessSnap.empty) {
            console.warn(`⚠️ Nessuna regola di accesso trovata per il gruppo ${gName} in config_access`);
        }

        const mappingAccesso = {};
        accessSnap.forEach(docSnap => {
            const d = docSnap.data();
            // Normalizziamo la funzione scritta nel campo del documento
            const fKey = normalize(d.Funzione || d.Funzionalit || "");

            if (fKey) {
                const valOrdine = parseInt(d.Ordine);
                mappingAccesso[fKey] = isNaN(valOrdine) ? 99 : valOrdine;
                console.log(`📍 Accesso trovato -> Funzione: "${fKey}" | Ordine: ${mappingAccesso[fKey]}`);
            }
        });

        // 2. Recupero dettagli tecnici (features)
        const featuresSnap = await getDocs(collection(db, "features"));
        const listaFinal = [];

        featuresSnap.forEach(docSnap => {
            // Normalizziamo l'ID del documento della feature
            const fId = normalize(docSnap.id);

            if (mappingAccesso[fId] !== undefined) {
                const d = docSnap.data();
                listaFinal.push({
                    nome: d.Nome || d.Titolo || docSnap.id,
                    link: d.Link_o_Mode || d.Link || "",
                    tipo: (d.Tipo || "IFRAME").toUpperCase(),
                    ordine: mappingAccesso[fId]
                });
                console.log(`✅ Feature matchata: ${fId}`);
            } else {
                // Log di debug per capire perché non matchano
                // console.log(`x Feature saltata: ${fId} (Non presente nel mapping del gruppo)`);
            }
        });

        // 3. ORDINAMENTO NUMERICO
        listaFinal.sort((a, b) => a.ordine - b.ordine);

        console.log("%c ✅ LISTA FINALE: ", "color: #28a745; font-weight: bold;", listaFinal);

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
