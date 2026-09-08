import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { addToFirestoreCart, removeFromFirestoreCart, listenToCart } from "./cart-service.js";
import { safeSet } from "./utils.js";
import { initPaypalCheckout } from "./checkout-service.js";
import { checkSandboxMode } from "./paypal-config.js"; // Importa la funzione

let sharedData = null;
let currentCartItems = [];
let selectedMemberId = null;
let allProducts = [];
let paypalRendered = false;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const raw = sessionStorage.getItem('myoval_shared_data');
        if (!raw) { window.location.href = "index.html"; return; }
        sharedData = JSON.parse(raw);

        // L'ID Famiglia nel tuo log è nella radice
        const idFamiglia = sharedData.idFamiglia || sharedData.famiglia?.ID_Famiglia;
        if (!idFamiglia) return console.error("❌ ID Famiglia non trovato");

        safeSet('user-email-display-pagamenti', sharedData.userEmail || user.email);

        // 1. Ascolta carrello Firestore
        listenToCart(idFamiglia, (items) => {
            currentCartItems = items;
            updateCartUI();
        });

        // 2. Carica Prodotti da Firestore
        await loadProducts();

        // 3. Disegna Bolle
        renderFamilySelector();

        checkSandboxMode();

    } else {
        window.location.href = "index.html";
    }
});

function renderFamilySelector() {
    const container = document.getElementById('pagamenti-family-selector');
    if (!container || !sharedData?.famiglia?.data) return;
    container.innerHTML = sharedData.famiglia.data.map(m => `
        <div class="family-item" id="f-${m.IDContatto}" onclick="window.selectMember('${m.IDContatto}')">
            <div class="avatar-circle"><i class="fas ${m.Ruolo.toLowerCase().includes('atleta') ? 'fa-running' : 'fa-user-tie'}"></i></div>
            <div class="family-name text-truncate small fw-bold mt-2">${m.Nome}</div>
        </div>`).join('');
    const firstId = sharedData.famiglia.data[0]?.IDContatto;
    if (firstId) window.selectMember(firstId);
}

window.selectMember = (id) => {
    selectedMemberId = id;

    // Gestione visuale delle bolle (active)
    document.querySelectorAll('.family-item').forEach(el => el.classList.remove('active'));
    const activeBubble = document.getElementById(`f-${id}`);
    if (activeBubble) activeBubble.classList.add('active');

    // Rendering dei prodotti filtrati
    renderFilteredProducts();
};


async function loadProducts() {
    try {
        const q = query(collection(db, "payment_items"), where("isActive", "==", true));
        const snap = await getDocs(q);
        allProducts = [];
        snap.forEach(doc => allProducts.push(doc.data()));
        if (selectedMemberId) renderFilteredProducts();
    } catch (err) {
        console.error("❌ Errore Firestore:", err);
    }
}

window.selectMember = (id) => {
    selectedMemberId = id;
    document.querySelectorAll('.family-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`f-${id}`)?.classList.add('active');
    renderFilteredProducts();
};

// 3. Funzione di rendering con logica di filtraggio
function renderFilteredProducts() {
    const container = document.getElementById('products-list-area');
    if (!container || !selectedMemberId || allProducts.length === 0) return;

    const member = sharedData.famiglia.data.find(m => m.IDContatto.toString() === selectedMemberId.toString());
    const ruolo = (member?.Ruolo || "").toLowerCase();

    const filtered = allProducts.filter(p => {
        if (ruolo.includes("atleta")) return (p.tipoAcquisto === "Atleta" || p.tipoAcquisto === "Genitore e Atleta");
        if (ruolo.includes("genitore")) return (p.tipoAcquisto === "Genitore" || p.tipoAcquisto === "Genitore e Atleta");
        return false;
    });

    container.innerHTML = `<div class="shop-divider mb-3"></div>`;
    filtered.forEach(p => {
        const card = document.createElement('div');
        card.className = "catalog-card mb-2 shadow-sm animate__animated animate__fadeIn";
        card.innerHTML = `
            <div style="flex: 1; min-width: 0; padding-right: 10px;">
                <div class="title" style="font-size: 0.85rem; font-weight: 700;">${p.name}</div>
                <div class="catalog-desc">${p.description || ''}</div>
                <div class="subtitle text-danger fw-bold mt-1" style="font-size: 0.62rem; text-transform: uppercase;">
                    <i class="fas fa-tag me-1"></i> ${p.tipoAcquisto}
                </div>
            </div>
            <div class="d-flex align-items-center gap-2">
                ${p.isMultiple ? `
                    <div class="text-center me-2">
                        <span class="qty-label">Q.tà</span>
                        <input type="number" id="qty-${p.skuId}" class="qty-input" value="1" min="1" max="99">
                    </div>
                ` : `<input type="hidden" id="qty-${p.skuId}" value="1">`}
                <div class="text-end" style="min-width: 65px; margin-right: 5px;">
                    <div class="fw-bold text-dark mb-0" style="font-size: 0.95rem;">${parseFloat(p.price).toFixed(2)} €</div>
                </div>
                <button class="btn btn-acquista" id="btn-add-${p.skuId}">ACQUISTA</button>
            </div>`;
        container.appendChild(card);
        document.getElementById(`btn-add-${p.skuId}`).addEventListener('click', () => window.handlePurchase(p));
    });
}

/**
 * Gestore unico del click d'acquisto
 */
window.handlePurchase = (product) => {
    if (product.msgFlag && product.alertMessage && !confirm(product.alertMessage)) return;
    const quantity = parseInt(document.getElementById(`qty-${product.skuId}`).value) || 1;
    window.addToCart(product, quantity);
};

/**
 * Gestisce la pre-validazione (Alert) prima dell'aggiunta effettiva
 */
window.prepareAddToCart = (skuId, name, price, alertMessage) => {
    // 1. Se c'è un messaggio di alert, chiedi conferma
    if (alertMessage && alertMessage.trim() !== "") {
        if (!confirm(alertMessage)) {
            return; // L'utente ha annullato
        }
    }

    // 2. Recupera la quantità dal campo input
    const qtyInput = document.getElementById(`qty-${skuId}`);
    const quantity = parseInt(qtyInput.value) || 1;

    if (quantity <= 0) {
        alert("Inserire una quantità valida.");
        return;
    }

    // 3. Procedi all'aggiunta al carrello
    window.addToCart(skuId, name, price, quantity);
};


window.addToCart = async (product, quantity) => {
    const member = sharedData.famiglia.data.find(m => m.IDContatto.toString() === selectedMemberId.toString());
    const idFam = sharedData.idFamiglia || sharedData.famiglia?.ID_Famiglia;

    const newItem = {
        tipo: "PAGAMENTO",
        idContatto: selectedMemberId,
        nomeMembro: member.Nome + " " + member.Cognome,
        skuId: product.skuId,
        nomeArticolo: product.name,
        prezzoUnitario: parseFloat(product.price),
        quantita: quantity,
        totaleRiga: parseFloat(product.price) * quantity,
        emailInserimento: auth.currentUser.email
    };

    await addToFirestoreCart(idFam, newItem);
};

window.removeFromCart = async (idUnivoco) => {
    const idFam = sharedData.idFamiglia || sharedData.famiglia?.ID_Famiglia;
    await removeFromFirestoreCart(idFam, idUnivoco);
};

function updateCartUI() {
    const container = document.getElementById('cart-container');
    const rowsContainer = document.getElementById('cart-rows-container');
    const totalDisp = document.getElementById('cart-total-display');
    const countBadge = document.getElementById('cart-items-badge');
    const paypalContainerId = 'paypal-button-container';

    if (!container || !rowsContainer) return;

    // --- 1. FILTRO: Consideriamo solo gli articoli di tipo PAGAMENTO ---
    const itemsPagamenti = (currentCartItems || []).filter(item => item.tipo === "PAGAMENTO");

    if (itemsPagamenti.length > 0) {
        // Visualizzazione contenitore
        container.classList.remove('d-none');
        container.style.display = 'block';

        // Badge contatore (solo pagamenti)
        if (countBadge) {
            countBadge.innerText = `${itemsPagamenti.length} Articol${itemsPagamenti.length > 1 ? 'i' : 'o'}`;
        }

        // --- 2. GENERAZIONE RIGHE TABELLA ---
        rowsContainer.innerHTML = itemsPagamenti.map((item) => {
            const displayQty = item.quantita > 1 ?
                `<span class="badge bg-light text-dark border ms-1" style="font-size:0.6rem; vertical-align: middle;">x${item.quantita}</span>` : '';

            return `
            <div class="cart-item-row row m-0 align-items-center py-2" style="border-bottom: 1px solid #f0f0f0;">
                <div class="col-6">
                    <div class="beneficiary-name" style="font-weight: 700; font-size: 0.85rem; color: #000; line-height: 1.2;">
                        <i class="fas fa-receipt text-muted me-1"></i>${item.nomeArticolo}${displayQty}
                    </div>
                    <div class="beneficiary-for" style="font-size: 0.7rem; color: #666; margin-top: 2px;">
                        Per: <b style="color:#a00000; text-transform: uppercase;">${item.nomeMembro}</b>
                    </div>
                </div>

                <div class="col-3 text-center price-val" style="font-size: 0.8rem; color: #888;">
                    ${parseFloat(item.prezzoUnitario).toFixed(2)} €
                </div>

                <div class="col-3 text-end d-flex align-items-center justify-content-end">
                    <span class="total-val me-3" style="font-weight: 800; font-size: 1rem; color: #000;">
                        ${parseFloat(item.totaleRiga).toFixed(2)} €
                    </span>
                    <button class="btn-remove-item" onclick="window.removeFromCart('${item.idUnivoco}')" 
                            style="background:none; border:none; color:#dc3545; font-size:1.1rem; line-height:1; padding:0;">
                        <i class="fas fa-times-circle"></i>
                    </button>
                </div>
            </div>
            `;
        }).join('');

        // --- 3. CALCOLO TOTALE E FORMATTAZIONE ---
        const total = itemsPagamenti.reduce((sum, item) => sum + item.totaleRiga, 0);

        totalDisp.innerText = total.toLocaleString('it-IT', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 2
        });

        // --- 4. INIZIALIZZAZIONE PAYPAL (UNIFICATO) ---
        // Passiamo gli articoli filtrati al servizio checkout
        if (!paypalRendered) {
            paypalRendered = true;

            // Recuperiamo l'ID Famiglia e l'Email per la finalizzazione
            const idFam = sharedData.idFamiglia || sharedData.famiglia?.ID_Famiglia;
            const email = auth.currentUser.email;

            initPaypalCheckout(
                paypalContainerId,
                itemsPagamenti,
                idFam,
                email,
                (details) => {
                    // Callback di successo
                    alert("Pagamento completato con successo! 🎉");
                    // Eventuale redirect o pulizia UI locale
                    container.classList.add('d-none');
                }
            );
        }
    } else {
        // Carrello vuoto o senza pagamenti
        container.classList.add('d-none');
        container.style.display = 'none';

        // Reset flag per permettere il re-rendering se l'utente aggiunge di nuovo articoli
        paypalRendered = false;
        const ppBox = document.getElementById(paypalContainerId);
        if (ppBox) ppBox.innerHTML = '';
    }
}

/**
 * Svuota il carrello agendo su Firestore (Unificato)
 */
window.clearCart = async () => {
    if (!confirm("Sei sicuro di voler svuotare il carrello?")) return;

    const idFam = sharedData.idFamiglia || sharedData.famiglia?.ID_Famiglia;
    try {
        await clearFirestoreCart(idFam);
        // La UI si aggiornerà da sola grazie al listener onSnapshot
    } catch (err) {
        console.error("Errore svuotamento carrello:", err);
    }
};


function renderPayPal() {
    if (paypalRendered) return;
    paypalRendered = true;

    paypal.Buttons({
        style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'paypal', height: 40 },
        createOrder: (data, actions) => {
            const total = cart.reduce((sum, item) => sum + item.price, 0).toFixed(2);
            return actions.order.create({
                purchase_units: [{
                    description: "Pagamenti MyOval - Rugby Milano",
                    amount: { value: total, currency_code: 'EUR' }
                }]
            });
        },
        onApprove: async (data, actions) => {
            document.getElementById('loading-overlay-pagamenti').classList.remove('d-none');
            try {
                const details = await actions.order.capture();

                // Registrazione su Spreadsheet via callGAS (POST)
                await callGAS("recordPayPalTransactionAndFinalizeOrder", {
                    paypalOrderData: details,
                    userEmail: auth.currentUser.email,
                    cartItems: cart
                });

                alert("Pagamento registrato correttamente!");
                location.href = "index.html";
            } catch (err) {
                alert("Errore durante la registrazione del pagamento: " + err.message);
            } finally {
                document.getElementById('loading-overlay-pagamenti').classList.add('d-none');
            }
        }
    }).render('#paypal-button-container');
}