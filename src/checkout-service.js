import { getPaypalClientId, PAYPAL_CONFIG } from "./paypal-config.js";
import { callGAS } from "./utils.js";
import { clearFirestoreCart } from "./cart-service.js";

/**
 * Inizializza il checkout PayPal con descrizione dettagliata per l'amministrazione
 */
export async function initPaypalCheckout(containerId, items, idFamiglia, userEmail, onSuccess) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const clientId = getPaypalClientId();

    try {
        // --- 1. GESTIONE CARICAMENTO SDK ---
        const existingScript = document.getElementById('paypal-sdk-script');

        // Se l'ambiente è cambiato (es. da localhost a pro), forziamo il ricaricamento
        if (existingScript && !existingScript.src.includes(clientId)) {
            console.warn("🔄 Ambiente cambiato, forzo ricarica SDK PayPal...");
            existingScript.remove();
            window.paypal = undefined;
        }

        if (typeof paypal === 'undefined' || !document.getElementById('paypal-sdk-script')) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.id = 'paypal-sdk-script';
                script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=EUR&intent=capture`;
                script.onload = () => {
                    console.log(`✅ PayPal SDK (${PAYPAL_CONFIG.mode}) caricato.`);
                    resolve();
                };
                script.onerror = (err) => {
                    console.error("❌ Errore caricamento script PayPal:", err);
                    reject(err);
                };
                document.head.appendChild(script);
            });
        }

        // --- 2. PREPARAZIONE DATI PER PAYPAL ---
        // Calcolo totale
        const total = items.reduce((sum, item) => sum + (item.totaleRiga || item.finalPrice || 0), 0).toFixed(2);
        if (parseFloat(total) <= 0) return;

        // Generazione descrizione dettagliata per la Dashboard PayPal dell'amministratore
        // Esempio: "Federico Longo (U18), Roberta (Quota Sospesa)"
        const itemsSummary = items.map(i => `${i.nomeMembro} (${i.nomeArticolo})`).join(', ');
        const adminDesc = itemsSummary.length > 120 ? itemsSummary.substring(0, 117) + "..." : itemsSummary;

        container.innerHTML = ''; // Pulisce eventuale spinner o bottoni vecchi

        // --- 3. RENDERING BOTTONI ---
        window.paypal.Buttons({
            style: { layout: 'vertical', color: 'blue', shape: 'pill', label: 'paypal', height: 40 },

            createOrder: (data, actions) => {
                return actions.order.create({
                    purchase_units: [{
                        description: adminDesc, // <--- Ciò che l'admin legge su PayPal
                        custom_id: `FAM-${idFamiglia}`, // <--- Identificativo famiglia nei dettagli PayPal
                        amount: {
                            value: total,
                            currency_code: 'EUR'
                        }
                    }]
                });
            },

            onApprove: async (data, actions) => {
                // Mostra il caricamento globale
                const loader = document.getElementById('loading-overlay') || document.getElementById('loading-overlay-pagamenti');
                if (loader) loader.classList.remove('d-none');

                try {
                    // Cattura il pagamento
                    const details = await actions.order.capture();
                    console.log("💰 Pagamento catturato:", details.id);

                    // Finalizza sul Bridge GAS (registrazione Spreadsheet)
                    await callGAS("finalizeUnifiedCheckout", {
                        paypalData: details,
                        userEmail: userEmail,
                        idFamiglia: idFamiglia,
                        cartItems: items,
                        env: PAYPAL_CONFIG.mode,
                        metodoPagamento: "PAYPAL"
                    });

                    // Svuota il carrello Firestore solo dopo la conferma di GAS
                    await clearFirestoreCart(idFamiglia);

                    if (onSuccess) onSuccess(details);

                } catch (err) {
                    console.error("❌ Errore durante la finalizzazione:", err);
                    alert(`ATTENZIONE: Il pagamento è avvenuto (ID: ${data.orderID}) ma la registrazione sul database ha avuto un errore. Contatta la segreteria comunicando l'ID ordine.`);
                } finally {
                    if (loader) loader.classList.add('d-none');
                }
            },

            onCancel: (data) => {
                console.log("⚠️ Pagamento annullato dall'utente.");
            },

            onError: (err) => {
                console.error("❌ Errore SDK PayPal:", err);
            }
        }).render(`#${containerId}`);

    } catch (e) {
        console.error("❌ Errore critico initPaypalCheckout:", e);
    }
}

/**
 * Funzione helper per caricare lo script PayPal nel <head>
 */
function loadPaypalSDK(clientId) {
    return new Promise((resolve, reject) => {
        if (document.getElementById('paypal-sdk-script')) {
            // Se lo script sta già caricando, aspettiamo un attimo
            setTimeout(resolve, 500);
            return;
        }
        const script = document.createElement('script');
        script.id = 'paypal-sdk-script';
        script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=EUR&intent=capture`;
        script.onload = () => {
            console.log("✅ PayPal SDK caricato correttamente");
            resolve();
        };
        script.onerror = () => reject(new Error("PayPal SDK load failed"));
        document.head.appendChild(script);
    });
}

/**
 * Finalizza l'acquisto tramite Bonifico Bancario
 */
export async function processBankTransferCheckout(items, idFamiglia, userEmail, onSuccess) {
    if (!confirm("Confermi di voler procedere con il pagamento tramite Bonifico Bancario? Riceverai le istruzioni via email.")) return;

    const loader = document.getElementById('loading-overlay') || document.getElementById('loading-overlay-pagamenti');
    if (loader) loader.classList.remove('d-none');

    try {
        const timestamp = Date.now();
        const fakePaypalData = {
            id: "BONIFICO-" + timestamp,
            status: "PENDING_BANK"
        };

        // Chiamata al bridge GAS (usiamo la stessa funzione ma specifichiamo il metodo)
        await callGAS("finalizeUnifiedCheckout", {
            paypalData: fakePaypalData, // Passiamo un ID fittizio per tracciabilità
            userEmail: userEmail,
            idFamiglia: idFamiglia,
            cartItems: items,
            metodoPagamento: "BONIFICO" // <--- Parametro extra per Apps Script
        });

        // Svuota carrello Firestore
        await clearFirestoreCart(idFamiglia);

        if (onSuccess) onSuccess();

    } catch (err) {
        console.error("Errore Checkout Bonifico:", err);
        alert("Errore durante la registrazione dell'ordine.");
    } finally {
        if (loader) loader.classList.add('d-none');
    }
}
