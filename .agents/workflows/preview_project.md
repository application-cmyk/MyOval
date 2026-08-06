# Preview Project Workflow

This workflow details the steps to launch the local preview server for Rugby Milano (MyOval).

## Steps

1. **Start the Local Preview Server**
   Since python3 is not available in the system path, we use the Node-based `http-server` package to host the static files:
   ```bash
   npx -y http-server -p 8080 -a 127.0.0.1
   ```

2. **Access the Preview**
   Open your browser and navigate to:
   [http://127.0.0.1:8080](http://127.0.0.1:8080)
