import { getPaypalClientId, PAYPAL_CONFIG } from "./paypal-config.js";
import { callGAS } from "./utils.js";
import { clearFirestoreCart } from "./cart-service.js";

export async function initPaypalCheckout(containerId, items, idFamiglia, userEmail, onSuccess) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const clientId = getPaypalClientId();

    try {
        // --- 1. CARICAMENTO SDK PAYPAL ---
        const existingScript = document.getElementById('paypal-sdk-script');
        if (existingScript && !existingScript.src.includes(clientId)) {
            existingScript.remove();
            window.paypal = undefined;
        }

        if (typeof paypal === 'undefined' || !document.getElementById('paypal-sdk-script')) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.id = 'paypal-sdk-script';
                script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=EUR`; // Niente più intent=capture nel link
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        const total = items.reduce((sum, item) => sum + (item.totaleRiga || item.finalPrice || 0), 0).toFixed(2);
        if (parseFloat(total) <= 0) return;

        const itemsSummary = items.map(i => `${i.nomeMembro} (${i.nomeArticolo})`).join(', ');
        const adminDesc = itemsSummary.length > 120 ? itemsSummary.substring(0, 117) + "..." : itemsSummary;

        container.innerHTML = '';

        // --- 2. RENDERING BOTTONI (SERVER-SIDE PURO) ---
        window.paypal.Buttons({
            style: { layout: 'vertical', color: 'blue', shape: 'pill', label: 'paypal', height: 40 },

            // A. Chiama GAS per creare l'ordine sul server PayPal
            createOrder: async () => {
                try {
                    const response = await callGAS("createPayPalOrder", {
                        amount: total,
                        description: adminDesc,
                        idFamiglia: idFamiglia,
                        paypalEnv: PAYPAL_CONFIG.mode
                    });

                    if (!response || !response.id) {
                        throw new Error("ID ordine PayPal non valido.");
                    }
                    return response.id;
                } catch (error) {
                    console.error("❌ Errore creazione ordine server-side:", error);
                    alert("Errore durante la creazione dell'ordine.");
                    throw error;
                }
            },

            // B. Chiama GAS per catturare il pagamento dopo l'approvazione dell'utente
            onApprove: async (data) => {
                const loader = document.getElementById('loading-overlay') || document.getElementById('loading-overlay-pagamenti');
                if (loader) loader.classList.remove('d-none');

                try {
                    const captureResult = await callGAS("capturePayPalOrder", {
                        orderID: data.orderID,
                        paypalEnv: PAYPAL_CONFIG.mode,
                        userEmail: userEmail,
                        idFamiglia: idFamiglia,
                        cartItems: items
                    });

                    console.log("💰 Pagamento catturato con successo:", captureResult);

                    // Svuota il carrello Firestore
                    await clearFirestoreCart(idFamiglia);

                    if (onSuccess) onSuccess(captureResult);

                } catch (err) {
                    console.error("❌ Errore durante la cattura:", err);
                    alert(`ATTENZIONE: Il pagamento è avvenuto (ID: ${data.orderID}) ma la registrazione sul database ha avuto un errore.`);
                } finally {
                    if (loader) loader.classList.add('d-none');
                }
            },

            onCancel: () => console.log("⚠️ Pagamento annullato."),
            onError: (err) => console.error("❌ Errore SDK PayPal:", err)

        }).render(`#${containerId}`);

    } catch (e) {
        console.error("❌ Errore critico initPaypalCheckout:", e);
    }
}

// Funzione Bonifico (Invariata)
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

        await callGAS("finalizeUnifiedCheckout", {
            paypalData: fakePaypalData,
            userEmail: userEmail,
            idFamiglia: idFamiglia,
            cartItems: items,
            metodoPagamento: "BONIFICO"
        });

        await clearFirestoreCart(idFamiglia);
        if (onSuccess) onSuccess();

    } catch (err) {
        console.error("Errore Checkout Bonifico:", err);
        alert("Errore durante la registrazione dell'ordine.");
    } finally {
        if (loader) loader.classList.add('d-none');
    }
}