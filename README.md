# OmniChannel — OTA Inventory Management

Single dashboard to manage product listings across Klook, 12Go Asia, and Trip.com.

## Architecture

```
Railway (cloud)
  Express API  ←→  PostgreSQL
  Vite dashboard (served as static from /dist)

Chrome Extension
  Polls Railway /api/jobs/pending
  Executes platform API calls using live browser session cookies
  Reports results back to Railway
```

## Quick Start

### 1. Server + Dashboard

```bash
# Install server deps
npm install

# Build dashboard
npm run build:dashboard

# Copy and fill in env
cp .env.example .env

# Start (uses NODE_ENV=production to serve dashboard)
NODE_ENV=production npm start
```

For local dev (separate terminals):

```bash
# Terminal 1 — API
npm run dev

# Terminal 2 — Dashboard with HMR
cd dashboard && npm run dev
```

### 2. Browser Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Edit `extension/background.js` line 2: set `API_URL` to your Railway URL
5. Reload the extension

### 3. Deploy to Railway

1. Push this repo to GitHub
2. Create a new Railway project → **Deploy from GitHub**
3. Add a PostgreSQL plugin — Railway auto-sets `DATABASE_URL`
4. Set `NODE_ENV=production` in Railway environment variables
5. Railway runs `npm start` by default (reads `main` from package.json)

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/products` | List all products with listing statuses |
| POST | `/api/products` | Create product |
| PUT | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |
| POST | `/api/products/:id/push` | Enqueue push job for a platform |
| GET | `/api/jobs` | List all jobs (dashboard) |
| GET | `/api/jobs/pending` | Pending jobs (extension polls this) |
| POST | `/api/jobs/:id/claim` | Claim a job (extension) |
| POST | `/api/jobs/:id/complete` | Report job result (extension) |
| GET | `/api/platforms` | List platforms |

## Adapters

`server/adapters/` contains per-platform request builders and response parsers. The extension's `background.js` mirrors the same logic for the actual fetch calls — update both if an OTA platform changes its API shape.
