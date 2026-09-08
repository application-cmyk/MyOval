const getDetectedMode = () => {
    const hostname = window.location.hostname;

    // Log di debug fondamentale per capire cosa vede il browser
    console.log("%c 🌐 PAYPAL ENVIRONMENT CHECK", "color: blue; font-weight: bold;");
    console.log("Host rilevato:", hostname);

    // 1. Se sei in locale, è sempre Sandbox
    if (hostname === "localhost" || hostname === "127.0.0.1") {
        return 'sandbox';
    }

    // 2. ELENCO DOMINI DI PRODUZIONE (CORRETTI col trattino)
    // Nota: Firebase usa rugby-milano-app-16681
    const prodDomains = [
        "rugby-milano-app-16681.web.app",
        "rugby-milano-app-16681.firebaseapp.com",
        "www.rugbymilano.it",
        "rugbymilano.it"
    ];

    // 3. Controllo: se l'host attuale è nella lista, allora LIVE
    const isProd = prodDomains.includes(hostname);

    console.log("Ambiente determinato:", isProd ? "🔴 LIVE (Produzione)" : "🟡 SANDBOX (Test)");

    return isProd ? 'live' : 'sandbox';
};

export const PAYPAL_CONFIG = {
    mode: getDetectedMode(),

    sandbox: {
        clientId: 'AQtEM289jxBtU26Lxkz_N0bokhpYW0DhNiCDUTmAGZkjgaeLZRqQzBC-ueaMktDbwVpsxxpRkILmKqYB',
        envTag: 'SANDBOX'
    },
    live: {
        clientId: 'AcnRqEqbrhdy0HfvREZ_BPSPnhGl375ww7j8FKTTPgQUbaSlDx61fWjHgcBoD1_P6OyuY2UInuuER87C',
        envTag: 'PRODUCTION'
    }
};

export const getPaypalClientId = () => PAYPAL_CONFIG[PAYPAL_CONFIG.mode].clientId;

export function checkSandboxMode() {
    const old = document.getElementById('sandbox-banner');
    if (old) old.remove();

    if (PAYPAL_CONFIG.mode === 'sandbox') {
        const banner = `
            <div id="sandbox-banner" style="position:fixed; top:65px; left:0; width:100%; background:#ffc107; color:#000; text-align:center; font-size:11px; font-weight:bold; z-index:9999; padding:4px 0; border-bottom: 1px solid #d39e00;">
                ⚠️ MODALITÀ TEST (SANDBOX) ATTIVA - I PAGAMENTI NON SONO REALI
            </div>`;
        document.body.insertAdjacentHTML('afterbegin', banner);
    }
}
