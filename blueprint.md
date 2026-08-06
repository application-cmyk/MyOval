# Project Blueprint: Rugby Milano (MyOval)

This document is the single source of truth for the Rugby Milano (MyOval) app's structure, implementation history, and the current plan to integrate the Firebase Studio project export with Antigravity and deploy it.

## Purpose and Capabilities

The Rugby Milano (MyOval) application is a framework-less web application designed to allow users (rugby players and administrators) to log in, view/manage documentation, registration details, certificate statuses, and visit info. It integrates with:
- **Firebase Auth** for authentication
- **Firebase Firestore** for database management
- **Firebase App Check** for application security

## Detailed Project Outline

### Tech Stack & Architecture
- **Frontend Core**: Framework-less HTML, custom CSS (`style.css`), and JavaScript imports.
- **Styling**: Vanilla CSS, Bootstrap 5.3 CDN, FontAwesome 6.4.0.
- **Data Layers & API**: Directly interacts with Firebase services (JS SDK v10.7.1) using ES modules mapping.
- **Local Dev Server**: Serves files using Python's built-in `http.server` as configured in `.idx/dev.nix`.

### Current Files
- `index.html`: Main landing, login, registration, and dashboard entry point.
- `certificati.html`: Management interface for medical certificates.
- `documenti.html`: User documentation management dashboard.
- `visita.html`: Medical examination booking/status interface.
- `style.css`: Main custom style sheet.
- `migrazione.js`: JavaScript logic to migrate or synchronize data with Firebase.

---

## Current Plan: Firebase Studio Export & App Deployment

We are currently executing the `/fbs-to-agy-export` skill combined with a deployment script to export the project and publish it.

### Steps to Complete:
1. **Verify Node.js**: Check if Node.js version is `>= v20` (Completed: `v24.19.0` detected).
2. **Firebase Login & Export**:
   - Run login command: `npx -y firebase-tools@latest login` (if needed)
   - Run export command: `npx -y firebase-tools@latest studio:export . --no-start-antigravity`
3. **Post-Export Verification**:
   - Inspect build/compile command configurations.
   - Verify CLI tools for preview are available.
4. **Setup Preview**:
   - Launch local server command (e.g. `python3 -m http.server 8080 --bind 0.0.0.0`).
   - Validate UI responsiveness and correctness in browser.
5. **Deployment (Publishing)**:
   - Run: `npx -y firebase-tools@latest deploy --only hosting --project rugby-milano-app-16681`
6. **Build Local Knowledge**:
   - Create `.agents/workflows/build_project.md`
   - Create `.agents/workflows/preview_project.md`
   - Create `.agents/workflows/deploy_project.md`
7. **Restart IDE**:
   - Instruct the user to restart their Antigravity IDE environment.
