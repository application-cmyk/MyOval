# Deploy Project Workflow

This workflow details the steps to publish and deploy the Rugby Milano (MyOval) application to Firebase Hosting.

## Steps

1. **Verify Authentication**
   Ensure you are logged in to the Firebase CLI:
   ```bash
   npx -y firebase-tools@latest login
   ```

2. **Deploy to Firebase Hosting**
   Run the deployment command specifying the correct hosting target and project ID:
   ```bash
   npx -y firebase-tools@latest deploy --only hosting --project rugby-milano-app-16681
   ```
