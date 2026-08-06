import { db } from "./firebase-config.js";
import { doc, getDoc, collection, getDocs, query, where } from "firebase/firestore";
import { resolveUrlParams } from "./utils.js"; 

/**
 * Inizializzazione Dashboard Gestionale Staff
 */
export async function initGestionale(user) {
    const container = document.getElementById('gestionale-menu-container');
    if (!container) return;

    const email = user.email.toLowerCase().trim();
    
    // --- 1. INIZIALIZZAZIONE DATI GLOBALI STAFF ---
    window.globalData = {
        userEmail: email,
        idFamiglia: "", // Può essere popolato in seguito se necessario
        currentMemberIndex: 0,
        famiglia: { data: [] }
    };

    console.log("🛠️ Inizio caricamento Dashboard Gestionale per:", email);

    try {
        // --- 2. RECUPERO GRUPPO DA STAFF_ROLES ---
        const roleSnap = await getDoc(doc(db, "staff_roles", email));
        
        if (!roleSnap.exists()) {
            console.error("❌ Email non trovata in staff_roles");
            container.innerHTML = `<div class="alert alert-danger m-5 shadow-sm" style="border-radius:15px;">
                <i class="fas fa-user-slash me-2"></i> Accesso negato. L'utente <b>${email}</b> non è configurato nello Staff.
            </div>`;
            return;
        }

        const roleData = roleSnap.data();
        const userGroup = (roleData.Gruppo || roleData.Ruolo || "GUEST").toUpperCase();
        window.globalData.userGroup = userGroup;
        
        document.getElementById('staff-role-label').innerText = `Profilo: ${userGroup}`;
        document.getElementById('staff-email-display').innerText = email;

        // --- 3. RECUPERO ABILITAZIONI E ORDINE DA CONFIG_ACCESS ---
        // Cerchiamo le funzioni assegnate al Gruppo specifico o a "ALL"
        const qAccess = query(collection(db, "config_access"), where("Gruppo", "in", [userGroup, "ALL"]));
        const accessSnap = await getDocs(qAccess);
        
        const accessMapping = {}; // Mappa Funzione -> Ordine (da config_access)
        accessSnap.forEach(docSnap => {
            const d = docSnap.data();
            const fKey = (d.Funzione || d.Funzionalit || "").toLowerCase().trim();
            if (fKey) {
                // Salviamo l'ordine impostato per questo Gruppo
                accessMapping[fKey] = parseInt(d.Ordine) || 999;
            }
        });

        if (Object.keys(accessMapping).length === 0) {
            container.innerHTML = `<div class="alert alert-warning m-5">Nessun servizio configurato per il gruppo ${userGroup}.</div>`;
            return;
        }

        // --- 4. RECUPERO CATALOGO FEATURES E COSTRUZIONE STRUTTURA ---
        const featuresSnap = await getDocs(collection(db, "features"));
        const structure = {}; // Area -> SottoArea -> [Funzioni]

        featuresSnap.forEach(docSnap => {
            const f = docSnap.data();
            const fId = docSnap.id.toLowerCase().trim();

            // Match tra catalogo tecnico e abilitazione del Gruppo
            if (accessMapping[fId] !== undefined) {
                const area = f.Area || "VARIE";
                const sottoArea = f.Sotto_Area || "Generale";
                
                if (!structure[area]) {
                    structure[area] = { 
                        ordineArea: parseInt(f.Area_Ordine) || 999, 
                        content: {} 
                    };
                }
                if (!structure[area].content[sottoArea]) {
                    structure[area].content[sottoArea] = [];
                }
                
                structure[area].content[sottoArea].push({
                    id: docSnap.id,
                    nome: f.Nome || docSnap.id,
                    sottotitolo: f.Sottotitolo_Help_Text || f.Sottotitolo || "",
                    link: f.Link_o_Mode || f.Link || "",
                    tipo: (f.Tipo || "IFRAME").toUpperCase(),
                    target: f.Target || "_self",
                    // ORDINE PRESO DALLA TABELLA ACCESSI
                    ordineInGroup: accessMapping[fId] 
                });
            }
        });

        // --- 5. RENDERING FINALE ---
        renderGestionaleUI(structure);

    } catch (e) {
        console.error("❌ Errore Init Gestionale:", e);
        container.innerHTML = `<div class="alert alert-danger m-5">Errore caricamento: ${e.message}</div>`;
    }
}

function renderGestionaleUI(structure) {
    const container = document.getElementById('gestionale-menu-container');
    
    // Ordiniamo le card delle Aree in base a 'ordineArea' (da features)
    const sortedAreas = Object.keys(structure).sort((a, b) => structure[a].ordineArea - structure[b].ordineArea);

    container.innerHTML = sortedAreas.map(areaName => {
        const areaData = structure[areaName];
        
        return `
            <div class="col-md-6 col-xl-4 animate__animated animate__fadeIn">
                <div class="card h-100 shadow-sm border-0" style="border-radius: 20px; overflow: hidden;">
                    <div class="card-header bg-white border-0 pt-4 pb-0">
                        <h5 class="fw-bold text-danger text-uppercase" style="letter-spacing: 1px; font-size: 1rem;">
                            <i class="fas fa-folder-open me-2 text-dark opacity-50"></i>${areaName}
                        </h5>
                    </div>
                    <div class="card-body">
                        ${Object.keys(areaData.content).map(sottoArea => `
                            <div class="mb-4">
                                <small class="text-muted fw-bold text-uppercase d-block mb-2" style="font-size: 9px; opacity: 0.6; letter-spacing: 0.5px;">${sottoArea}</small>
                                <div class="list-group list-group-flush">
                                    ${areaData.content[sottoArea]
                                        .sort((a, b) => a.ordineInGroup - b.ordineInGroup) // <--- ORDINAMENTO PER CONFIG_ACCESSI
                                        .map(func => `
                                        <button class="list-group-item list-group-item-action border-0 px-2 py-3 d-flex align-items-center mb-1" 
                                                onclick="window.lanciaAppStaff('${func.link}', '${func.tipo}', '${func.nome}', '${func.target}')"
                                                style="border-radius: 12px;">
                                            <div class="bg-light rounded-circle p-2 me-3 d-flex align-items-center justify-content-center" style="width: 35px; height: 35px;">
                                                <i class="fas ${func.tipo === 'IFRAME' ? 'fa-th-large' : 'fa-external-link-alt'} text-dark" style="font-size: 12px;"></i>
                                            </div>
                                            <div class="flex-grow-1">
                                                <div class="fw-bold text-dark" style="font-size: 0.9rem; line-height: 1.1;">${func.nome}</div>
                                                <div class="text-muted" style="font-size: 0.75rem;">${func.sottotitolo}</div>
                                            </div>
                                            <i class="fas fa-chevron-right text-muted small"></i>
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>`;
    }).join('');
}

window.lanciaAppStaff = (link, tipo, titolo, target) => {
    if (!link) return;

    // Recuperiamo i dati per i segnaposto dalla sessione corrente
    const params = {
        email: window.globalData.userEmail,
        idFamiglia: window.globalData.idFamiglia || "" 
        // Nota: nel gestionale <CONTATTO> sarà gestito in seguito se apri una scheda specifica
    };

    // Risoluzione dei segnaposto (es: <EMAIL>)
    const finalUrl = resolveUrlParams(link, params);

    console.log(`🚀 Lancio Staff: ${titolo} | URL: ${finalUrl}`);

    if (target === "_blank" || tipo === "EXTERNAL") {
        window.open(finalUrl, '_blank');
    } else {
        const view = document.getElementById('gestionale-iframe-view');
        const iframe = document.getElementById('gestionale-iframe');
        const titleLabel = document.getElementById('gestionale-iframe-title');
        
        if (view && iframe) {
            if (titleLabel) titleLabel.innerText = titolo;
            view.classList.remove('d-none');
            iframe.src = finalUrl;
        }
    }
};
