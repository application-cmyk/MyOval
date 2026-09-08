import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

const prodConfig = {
  apiKey: "AIzaSyAsoOTKqzYVwH63UHOb8M6-O4MspDuIs2c",
  authDomain: "rugby-milano-app-16681.firebaseapp.com",
  projectId: "rugby-milano-app-16681",
  storageBucket: "rugby-milano-app-16681.firebasestorage.app",
  messagingSenderId: "373260519506",
  appId: "1:373260519506:web:07197fefca8c12fbac378b",
  measurementId: "G-N4WS11WH6H",
  siteKey: "6Ld3AyYtAAAAAGUPb1yotg0RJR4dxO_50pIjM6MG" // Key Prod
};

const testConfig = {
  apiKey: "AIzaSyDIFlCs3xV3Ww7kHTBT6D0cdAJJNXN2RJ4",
  authDomain: "rugby-milano-app-test.firebaseapp.com",
  projectId: "rugby-milano-app-test",
  storageBucket: "rugby-milano-app-test.firebasestorage.app",
  messagingSenderId: "452219324199",
  appId: "1:452219324199:web:fffe9c3615cec8031e4b02",
  measurementId: "G-2JJCFTQJVJ",
  siteKey: "6LcsHX8tAAAAAP7N12OycdqCOYd7b78wZiY6nJtH" // Key Test
};

// Logica per determinare l'ambiente
export const isProd = window.location.hostname.includes("rugby-milano-app-16681");
const config = isProd ? prodConfig : testConfig;

// Creiamo una stringa standard da passare alle app esterne
export const APP_ENV = isProd ? "production" : "staging";

// Abilita il debug in locale
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// App Check
const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(config.siteKey),
  isTokenAutoRefreshEnabled: true
});