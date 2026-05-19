# CrowdFund Web

Crowdfunding demo with static HTML frontend, Express backend, JSON data storage, realtime updates, and Pakasir payment integration (optional).

## Features
- Static UI pages served from `public/`
- Express API with JSON storage
- Auth guard for dashboard and donation endpoints
- Realtime updates via Socket.io
- Pakasir payment (create + simulation)

## Tech Stack
- Node.js + Express
- Socket.io
- Pakasir SDK
- JSON file storage (data/)
- Tailwind CDN + Chart.js (frontend)

## Project Structure
```
public/
  index.html
  dashboard.html
  detail-campaign.html
  login.html
  register.html
  buat-campaign.html
  css/style.css
  js/app.js
  js/tailwind-config.js
data/
  users.json
  campaigns.json
  donations.json
  transactions.json
server.js
.env
```

## Getting Started
1) Install dependencies
```bash
npm install
```

2) Create .env (example)
```
PAKASIR_SLUG=slug-project-kamu
PAKASIR_API_KEY=api-key-kamu
PAKASIR_REDIRECT_URL=http://localhost:3000/dashboard.html
PAKASIR_SIMULATE=true
```

3) Start server
```bash
npm run dev
```

Open:
- http://localhost:3000/index.html
- http://localhost:3000/dashboard.html

## Demo Accounts
Seeded user:
- Email: admin@crowdfund.local
- Password: admin123

## Notes
- `PAKASIR_SIMULATE=true` will call Pakasir simulation to mark payment as completed.
- If Pakasir env vars are empty, the flow falls back to a local simulation.
- Dashboard analytics are computed from donations tied to the logged-in user.

## API Endpoints (Summary)
- GET /api/health
- GET /api/analytics (auth)
- GET /api/campaigns
- GET /api/campaigns/:id
- POST /api/campaigns (auth)
- PUT /api/campaigns/:id (auth)
- DELETE /api/campaigns/:id (auth)
- POST /api/auth/register
- POST /api/auth/login
- POST /api/donations (auth)

## Payment Methods (Pakasir)
Supported method codes in the UI:
- qris
- bni_va
- bri_va
- permata_va
- atm_bersama_va
- paypal

## Scripts
- npm run dev
- npm start
