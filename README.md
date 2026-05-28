# Bókun Proxy Server

Handles CORS and HMAC-SHA1 signing between your Claude agent and the Bókun API.

## Deploy to Railway (Free — 5 minutes)

### Step 1 — Create a GitHub account
Go to https://github.com and sign up if you don't have one.

### Step 2 — Create a new repository
1. Click the "+" icon top right → "New repository"
2. Name it: bokun-proxy
3. Set to Public
4. Click "Create repository"

### Step 3 — Upload these files
Upload all 3 files to the repository:
- server.js
- package.json
- .env.example

### Step 4 — Deploy on Railway
1. Go to https://railway.app
2. Sign up with your GitHub account
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your bokun-proxy repository
5. Railway auto-detects Node.js and deploys

### Step 5 — Add environment variables
In Railway → your project → "Variables" tab, add:
- BOKUN_ACCESS_KEY = 3e29007af4c145a6a2dc2bea11c58858
- BOKUN_SECRET_KEY = c93c0b42e24e433384cd170842e75ba1
- BOKUN_VENDOR_ID  = 137489
- BOKUN_CHANNEL_ID = 411229

### Step 6 — Get your proxy URL
Railway gives you a public URL like:
https://bokun-proxy-production-xxxx.up.railway.app

### Step 7 — Update the agent
Replace the API call in the Claude agent from:
  https://api.bokun.io/activity.json/save-activity
To:
  https://YOUR-RAILWAY-URL.up.railway.app/proxy?path=/activity.json/save-activity

That's it — your agent will now create products in Bókun successfully.

## Endpoints

GET  /                        → Health check
POST /proxy?path=<bokun-path> → Forward POST to Bókun API
GET  /proxy?path=<bokun-path> → Forward GET to Bókun API
