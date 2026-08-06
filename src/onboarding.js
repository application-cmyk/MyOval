// src/onboarding.js

import { callGAS, safeSet } from "./utils.js";
import { renderAnagraficaForm, checkMemberValidation } from "./anagrafica.js";

let onboardingContext = ""; 
window.tempFamily = []; 

/**
 * Navigazione tra gli step del Wizard
 */
export function WIZ_navigate(stepNumber, progressPercent) {
    const pages = document.querySelectorAll('.wiz-page');
    pages.forEach(p => p.style.setProperty('display', 'none', 'important'));
    
    const target = document.getElementById('wiz-step-' + stepNumber);
    if (target) target.style.setProperty('display', 'block', 'important');

    const progCont = document.getElementById('wiz-progress-container');
    if (progCont) progCont.style.display = (stepNumber === 0) ? 'none' : 'block';

    const bar = document.getElementById('onboarding-progress');
    if (bar) bar.style.width = progressPercent;
}

/**
 * Inizializzazione (chiamata da portal.js)
 */
export function WIZ_init() {
    WIZ_navigate(0, '0%');
}

// --- AGGANCIO GLOBALE PER GLI ONCLICK DELL'HTML ---

window.WIZ_goStep1 = () => WIZ_navigate(1, '33%');

window.WIZ_goStep2 = (context) => {
    onboardingContext = context;
    WIZ_navigate(2, '66%');
    
    // 1. Recuperiamo la configurazione (Profilo ASSOCIATO)
    const config = window.globalData.config["ASSOCIATO"] || [];
    
    // 2. Determiniamo se deve vedere i campi Atleta subito (se ha scelto SINGOLO)
    const isAtletaInit = (context === 'SINGOLO');
    
    console.log("📝 Generazione form onboarding...");

    // 3. Chiamata al rendering specificando il div del Wizard
    // Parametri: dati vuoti {}, config, flag atleta, ID del div nel wizard
    renderAnagraficaForm({}, config, isAtletaInit, "wiz-form-container");
};

window.WIZ_backToStep1 = () => WIZ_navigate(1, '33%');

window.WIZ_navigate = WIZ_navigate; // Esposizione globale della navigazione

window.WIZ_saveAndGoStep3 = async () => {
    // 1. Validazione (usiamo l'indice -1 per indicare un nuovo inserimento temporaneo)
    const fields = document.querySelectorAll('#anagrafica-form-content .val-field');
    let isValid = true;
    
    fields.forEach(f => {
        if (f.hasAttribute('required') && (!f.value || f.value.trim() === "")) {
            f.classList.add('is-invalid');
            isValid = false;
        }
    });

    if (!isValid) {
        alert("⚠️ Per favore, compila i campi obbligatori contrassegnati in rosso.");
        return;
    }

    // 2. Raccolta dati del referente
    const data = {};
    fields.forEach(f => {
        const id = f.getAttribute('data-id');
        data[id] = f.type === 'checkbox' ? f.checked : f.value;
    });
    
    data["Ruolo"] = (onboardingContext === 'SINGOLO') ? "Atleta" : "Genitore/Tutore";
    window.tempFamily = [data];

    if (onboardingContext === 'SINGOLO') {
        await window.finalizzaOnboarding();
    } else {
        window.WIZ_updateFamilySummaryUI();
        WIZ_navigate(3, '100%');
    }
};

window.WIZ_updateFamilySummaryUI = () => {
    const list = document.getElementById('onboarding-family-list');
    if (!list) return;
    
    list.innerHTML = window.tempFamily.map((m, idx) => `
        <div class="card p-3 mb-2 d-flex flex-row align-items-center justify-content-between shadow-sm border-start border-danger border-4">
            <div class="d-flex align-items-center">
                <div class="avatar-circle me-3" style="width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:#eee;">
                    <i class="fas ${m.Ruolo.includes('Atleta') ? 'fa-running' : 'fa-user-tie'}"></i>
                </div>
                <div>
                    <b class="text-uppercase" style="font-size:0.9rem">${m.Cognome || ''} ${m.Nome || ''}</b><br>
                    <span class="badge bg-light text-dark border" style="font-size:0.6rem">${m.Ruolo}</span>
                </div>
            </div>
            ${idx > 0 ? `<button class="btn btn-sm text-danger" onclick="window.tempFamily.splice(${idx},1); window.WIZ_updateFamilySummaryUI();"><i class="fas fa-trash"></i></button>` : ''}
        </div>
    `).join('');
};

window.finalizzaOnboarding = async () => {
    if (!confirm("Confermi i dati inseriti per la creazione del tuo profilo?")) return;

    try {
        // Cerchiamo il pulsante per mostrare il caricamento
        const btn = document.querySelector('#wiz-step-3 .btn-success') || document.querySelector('#wiz-step-2 .btn-danger');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Inizializzazione...';
        }

        // Chiamata al Ponte GAS
        const res = await callGAS("creaNucleoFamiliareIniziale", { 
            membri: window.tempFamily,
            email: window.globalData.userEmail 
        });

        if (res && res.success) {
            alert("🎉 Benvenuto in Rugby Milano! Il tuo profilo è stato creato correttamente.");
            // Ricarichiamo l'app per entrare nella dashboard reale
            window.location.reload(); 
        } else {
            throw new Error(res ? res.error : "Risposta non valida dal server");
        }
    } catch (e) {
        alert("Errore durante la creazione: " + e.message);
        // Ripristino pulsante se fallisce
        location.reload(); 
    }
};