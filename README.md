# Welcome to Antigravity!

Welcome to your new developer home! Your Firebase Studio project has been successfully migrated to Antigravity.

Antigravity is our next-generation, agent-first IDE designed for high-velocity, autonomous development. Because Antigravity runs locally on your machine, you now have access to powerful local workflows and fully integrated AI editing capabilities that go beyond a cloud-based web IDE.

## Getting Started
- **Run Locally**: Use the **Run and Debug** menu on the left sidebar to start your local development server.
  - Or in a terminal run `npm run dev` and visit `http://localhost:9002`.
- **Deploy**: You can deploy your changes to Firebase App Hosting by using the integrated terminal and standard Firebase CLI commands, just as you did in Firebase Studio.
- **Cleanup**: Cleanup unused artifacts with the @cleanup workflow.

Enjoy the next era of AI-driven development!

File any bugs at https://github.com/firebase/firebase-tools/issues

**Firebase Studio Export Date:** 2026-08-06


---

## Previous README.md contents:

A simple HTML/JS/CSS starter template

reCAPTCHA Enterprise: 
"siteKey": "6Ld3AyYtAAAAAGUPb1yotg0RJR4dxO_50pIjM6MG",

Token IDX: E57094A9-3888-453D-A832-4A974423F89A


firebase use staging (per lavorare/distribuire sull'ambiente di test)
firebase use production (per lavorare/distribuire sull'ambiente di produzione)


## USERNAME e PASSWORD PAYPAL SANDBOX
Username: sb-47olmi53162347@personal.example.com
Password: l,#)s.0S


## UTIILIZZO SCRIPT PER FIREBASE
Scenario	Script da usare
"Voglio salvarmi i dati prima di fare modifiche"	node esportazione.js all staging
"Ho modificato a mano il Foglio Google e voglio inviare le modifiche"	node migrazione.js all staging
"Ho cancellato per sbaglio dei documenti su Firestore!"	node ripristino.js all staging
"Voglio copiare i dati da Produzione a Staging"	1. node esportazione.js all prod <br> 2. node ripristino.js all staging
"Voglio ripulire il database e rimettere solo quello che c'è nel Foglio"	node migrazione.js all staging clean