import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// Importiamo initializeAppCheck una sola volta
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

// Configurazione per l'ambiente di PRODUZIONE
const prodConfig = {
  apiKey: "AIzaSyAsoOTKqzYVwH63UHOb8M6-O4MspDuIs2c",
  authDomain: "rugby-milano-app-16681.firebaseapp.com",
  projectId: "rugby-milano-app-16681",
  storageBucket: "rugby-milano-app-16681.firebasestorage.app",
  messagingSenderId: "373260519506",
  appId: "1:373260519506:web:07197fefca8c12fbac378b",
  measurementId: "G-N4WS11WH6H"
};

// Configurazione per l'ambiente di TEST (Inserisci qui le credenziali quando avrai creato il progetto di test)
const testConfig = {
  apiKey: "INSERISCI_API_KEY_DI_TEST",
  authDomain: "INSERISCI_AUTH_DOMAIN_DI_TEST.firebaseapp.com",
  projectId: "INSERISCI_PROJECT_ID_DI_TEST",
  storageBucket: "INSERISCI_STORAGE_BUCKET_DI_TEST.firebasestorage.app",
  messagingSenderId: "INSERISCI_MESSAGING_SENDER_ID_DI_TEST",
  appId: "INSERISCI_APP_ID_DI_TEST",
  measurementId: "INSERISCI_MEASUREMENT_ID_DI_TEST"
};

// Determina quale configurazione usare in base all'hostname
const isProduction = window.location.hostname === "rugby-milano-app-16681.web.app" || 
                     window.location.hostname === "rugby-milano-app-16681.firebaseapp.com";

// Se siamo in produzione o se il progetto di test non è ancora configurato, usa prodConfig
const firebaseConfig = (isProduction || testConfig.apiKey.startsWith("INSERISCI_"))
  ? prodConfig 
  : testConfig;

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// 2. Attivazione reCAPTCHA Enterprise / App Check
// Scommenta la riga sotto solo quando testi in IDX per non essere bloccato
// self.FIREBASE_APPCHECK_DEBUG_TOKEN = true; 

// 2. Inizializza App Check
const appCheck = initializeAppCheck(app, {
  // Assicurati che questa sia la SITE KEY di reCAPTCHA Enterprise (non la API Key di Firebase!)
  provider: new ReCaptchaEnterpriseProvider('6Ld3AyYtAAAAAGUPb1yotg0RJR4dxO_50pIjM6MG'),
  isTokenAutoRefreshEnabled: true
});


