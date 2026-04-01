# Docker Primer — What It Is and How We'll Use It

## What Problem Does Docker Solve?

Without Docker, deploying the proxy server means: install Node.js on a server, clone the code, run `npm install`, configure environment variables, set up a process manager (like PM2) to keep it running, and pray that the Node version and OS dependencies match what you developed on. If the server needs to be rebuilt or moved, you repeat all of that.

Docker packages your app and everything it needs (Node.js runtime, dependencies, config) into a single portable unit called a **container**. You build it once, and it runs identically everywhere — your laptop, the SAP server, a coworker's machine.

## Core Concepts

### Image
A **Docker image** is a blueprint. Think of it like a snapshot of a fully configured machine. It contains the OS layer, Node.js, your proxy code, and all npm packages. Images are built from a `Dockerfile` (a recipe) and are read-only.

### Container
A **container** is a running instance of an image. When you "start" a Docker image, it becomes a container — a live, isolated process running your app. You can start, stop, restart, and delete containers without affecting the image. Multiple containers can run from the same image.

### Dockerfile
A text file with step-by-step instructions for building an image. Ours will look like this:

```dockerfile
# Start with an official Node.js base image (slim = smaller, no unnecessary OS tools)
FROM node:20-slim

# Create a working directory inside the container
WORKDIR /app

# Copy package files first (Docker caches this layer — if packages haven't
# changed, it won't re-install them on the next build. Saves time.)
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --production

# Copy the rest of our proxy source code
COPY dist/ ./dist/

# Tell Docker this container listens on port 3001
EXPOSE 3001

# The command that runs when the container starts
CMD ["node", "dist/index.js"]
```

Reading top to bottom: start with Node.js 20, create a folder, install packages, copy code, expose a port, run the app. That's it.

### docker-compose.yml
When your app needs configuration (environment variables, ports, restart policies), you describe it in a `docker-compose.yml` file instead of typing long `docker run` commands. Ours:

```yaml
version: '3.8'

services:
  receiving-proxy:
    build: .                          # Build from the Dockerfile in this directory
    container_name: receiving-proxy
    restart: unless-stopped           # Auto-restart if it crashes or server reboots
    ports:
      - "3001:3001"                   # Map host port 3001 → container port 3001
    environment:
      - SAP_SL_URL=https://sapserver:50000/b1s/v1
      - SAP_COMPANY_DB=TORK_PROD
      - SAP_USERNAME=api_receiving
      - SAP_PASSWORD=${SAP_PASSWORD}   # Pulled from .env file (not committed to git)
      - AZURE_TENANT_ID=6dea7009-0c2d-49ce-9887-fb702c17447c
      - AZURE_CLIENT_ID=8d67b410-ec72-469c-ab0a-3b4c60ee8738
      - CORS_ORIGIN=https://receiving.torksystems.local
      - JWT_SECRET=${JWT_SECRET}
      - PORT=3001
    volumes:
      - ./attachments:/tmp/receiving   # Shared folder for SAP attachment files
    env_file:
      - .env                           # Secrets live here, NOT in docker-compose.yml
```

### .env File (Secrets)
The `.env` file sits next to `docker-compose.yml` and holds sensitive values. It is **never** committed to git (add it to `.gitignore`).

```env
SAP_PASSWORD=your_actual_password_here
JWT_SECRET=a_long_random_string_here
```

## How It All Fits Together

```
Your laptop (development)              Internal server (production)
┌──────────────────────────┐           ┌──────────────────────────┐
│                          │           │                          │
│  proxy/                  │           │  Docker Engine           │
│  ├── Dockerfile          │  build &  │  ┌────────────────────┐  │
│  ├── docker-compose.yml  │  push     │  │  receiving-proxy   │  │
│  ├── .env                │ ────────► │  │  container          │  │
│  └── src/                │           │  │                    │  │
│                          │           │  │  Node.js 20        │  │
│                          │           │  │  + your proxy code │  │
│                          │           │  │  listening on 3001 │  │
│                          │           │  └────────┬───────────┘  │
│                          │           │           │              │
│                          │           │           ▼              │
│                          │           │  SAP Service Layer       │
│                          │           │  (port 50000)            │
└──────────────────────────┘           └──────────────────────────┘
```

## Day-to-Day Commands

You only need about 6 commands. Here's the full lifecycle:

### First-Time Setup (on the server)

```bash
# 1. Install Docker (one-time, on the internal server)
#    On Ubuntu/Debian:
sudo apt-get update
sudo apt-get install docker.io docker-compose-plugin

#    On Windows Server:
#    Download Docker Desktop from docker.com and install it
```

### Build & Run

```bash
# 2. Navigate to the proxy folder
cd proxy/

# 3. Build the image from the Dockerfile
docker compose build
#    This reads the Dockerfile, downloads Node.js 20, installs npm packages,
#    copies your code, and creates an image. Takes ~1 minute first time,
#    seconds on subsequent builds (Docker caches unchanged layers).

# 4. Start the container
docker compose up -d
#    -d = "detached" (runs in background)
#    The proxy is now running on port 3001
```

### Check on It

```bash
# See running containers
docker compose ps

# Output:
# NAME               STATUS          PORTS
# receiving-proxy    Up 2 hours      0.0.0.0:3001->3001/tcp

# View logs (like looking at console output)
docker compose logs -f
#    -f = "follow" (live tail, Ctrl+C to stop watching)

# View last 50 lines of logs
docker compose logs --tail 50
```

### Update the Code

When you change the proxy code and want to deploy the update:

```bash
# Rebuild and restart (one command)
docker compose up -d --build
#    --build forces a fresh image build
#    Docker restarts the container with the new code
#    Downtime: ~5 seconds
```

### Stop / Restart

```bash
# Stop the container (proxy stops accepting requests)
docker compose down

# Restart (if something seems off)
docker compose restart
```

## What Makes This Better Than Running Node.js Directly?

| Concern | Without Docker | With Docker |
|---|---|---|
| **"Works on my machine"** | Maybe not on the server — different Node version, missing OS lib | Identical environment everywhere |
| **Crashes** | App dies, stays dead until someone notices | `restart: unless-stopped` brings it back automatically |
| **Server reboot** | Need to remember to start the app | Docker auto-starts containers on boot |
| **Multiple apps** | Port conflicts, dependency conflicts | Each container is isolated |
| **Rollback** | Hope you can `git revert` and reinstall cleanly | Keep the old image, switch back instantly |
| **Cleanup** | Node modules, temp files scattered everywhere | Delete the container, everything's gone |

## For This Project Specifically

The proxy is simple — one Node.js process, one port, a few environment variables. Docker is the right fit because:

1. **Set it and forget it.** Once the container is running, it auto-restarts on crashes and server reboots. No babysitting.
2. **Clean deployment.** No installing Node.js on the SAP server. Docker is the only prerequisite.
3. **Easy updates.** Change code → `docker compose up -d --build` → done. Five seconds.
4. **Secrets management.** The `.env` file keeps passwords out of your codebase.

### Where Docker Runs

The Docker host (the server running Docker Engine) needs to be on the same network as the SAP server so it can reach Service Layer. It also needs to be reachable by iPhones on company WiFi (port 3001). This could be:

- The SAP server itself (if it has spare capacity)
- A separate VM or small server on the same network
- A Raspberry Pi or mini PC (Docker runs on ARM too, though x86 is simpler)

### What You'll Need to Install

On the server you choose:

- **Docker Engine** (the runtime that runs containers)
- **Docker Compose** (the tool that reads `docker-compose.yml` — included with modern Docker installs)

That's it. No Node.js, no npm, no anything else. Docker handles all of that inside the container.
