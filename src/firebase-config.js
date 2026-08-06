import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// Importiamo initializeAppCheck una sola volta
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

// Configurazione base pulita
const firebaseConfig = {
  apiKey: "AIzaSyAsoOTKqzYVwH63UHOb8M6-O4MspDuIs2c",
  authDomain: "rugby-milano-app-16681.firebaseapp.com",
  projectId: "rugby-milano-app-16681",
  storageBucket: "rugby-milano-app-16681.appspot.com",
  messagingSenderId: "373260519506",
  appId: "1:373260519506:web:07197fefca8c12fbac378b"
};

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


