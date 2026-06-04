# Scan Me Dining Navigator — Backend API

Node.js + Express + PostgreSQL backend for the QR-based restaurant menu app with Gemini AI recommendations and Google Reviews integration.

---

## Quick start (local)

```bash
git clone https://github.com/you/scanme-backend
cd scanme-backend
npm install
cp .env.example .env       # Fill in your keys
npm run db:migrate         # Create all tables
npm run db:seed            # Load Kabab Souq demo data
npm run dev                # Start with hot-reload
```

Server runs at `http://localhost:3000`

---

## Project structure

```
src/
├── index.js              # Express app + middleware
├── db/
│   ├── index.js          # PostgreSQL pool
│   ├── migrate.js        # Run: npm run db:migrate
│   └── seed.js           # Run: npm run db:seed
├── middleware/
│   ├── auth.js           # JWT verification
│   └── logger.js         # Winston logger
└── routes/
    ├── auth.js           # POST /api/auth/register, /login
    ├── menu.js           # GET/POST/PATCH/DELETE /api/menu/*
    ├── qr.js             # POST /api/qr/generate, GET /api/qr/list
    ├── ai.js             # POST /api/ai/recommend  (Gemini)
    ├── reviews.js        # GET /api/reviews/:slug  (Google Places)
    └── analytics.js      # GET /api/analytics/dashboard
```

---

## API reference

### Auth

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | name, email, password, slug | Register restaurant |
| POST | `/api/auth/login` | email, password | Login → JWT token |

### Menu (public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/menu/:slug` | Full menu grouped by category |
| GET | `/api/menu/:slug/items?veg=true&spice_max=2&price_max=400` | Filterable items |

### Menu (admin — requires `Authorization: Bearer <token>`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/menu/admin/items` | All items for restaurant |
| POST | `/api/menu/admin/items` | Add new item |
| PATCH | `/api/menu/admin/items/:id` | Update item fields |
| DELETE | `/api/menu/admin/items/:id` | Delete item |
| GET | `/api/menu/admin/categories` | List categories |
| POST | `/api/menu/admin/categories` | Add category |

### QR Codes (requires auth)

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/qr/generate` | `{ label }` | Generate QR PNG + SVG |
| GET | `/api/qr/list` | — | All QR codes with scan counts |
| DELETE | `/api/qr/:id` | — | Delete QR code |

### AI Recommendations

```
POST /api/ai/recommend
{
  "restaurant_slug": "kabab-souq",
  "preferences": {
    "dietary": "vegetarian",       // vegetarian | vegan | non-vegetarian
    "spice_tolerance": "medium",   // none | low | medium | high | extreme
    "budget_max": 400,             // number in ₹
    "mood": "date night",          // casual | date night | family | business | solo
    "party_size": 2
  }
}
```

Returns top 3 dishes with Gemini-generated reasoning + drink pairing.

### Google Reviews

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reviews/:slug` | Reviews (cached 6h) |
| POST | `/api/reviews/refresh/:slug` | Force cache clear |

### Analytics (requires auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/dashboard` | Total scans, 24h/7d, QR stats |
| GET | `/api/analytics/scans/daily` | Daily scan counts (30 days) |

### Health check

```
GET /health  → { "status": "ok", "db": "connected" }
```

---

## Deployment

### Option A — Railway (recommended, easiest)

1. Push code to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add a **PostgreSQL** plugin from the Railway dashboard
4. Set environment variables in the Railway Variables tab:
   ```
   GEMINI_API_KEY=...
   GOOGLE_PLACES_API_KEY=...
   JWT_SECRET=...
   ALLOWED_ORIGINS=https://yourfrontend.vercel.app
   NODE_ENV=production
   ```
   `DATABASE_URL` is auto-injected by Railway when you add PostgreSQL.
5. After first deploy, open the Railway shell and run:
   ```bash
   npm run db:migrate
   npm run db:seed   # optional demo data
   ```
6. Your API URL: `https://scanme-backend-production.up.railway.app`

**Cost:** ~$5/month (Hobby plan)

---

### Option B — Render (free tier available)

1. Push to GitHub
2. Go to [render.com](https://render.com) → New → Blueprint
3. Point to your repo — Render reads `render.yaml` automatically
4. Add secret env vars in the Render dashboard (GEMINI_API_KEY, GOOGLE_PLACES_API_KEY)
5. After deploy, open Render Shell → `npm run db:migrate`

**Cost:** Free (spins down after 15min inactivity) or $7/month for always-on

---

### Option C — Supabase (DB) + Railway (API)

Best of both worlds: use Supabase's managed PostgreSQL (generous free tier) as your database, deploy the API on Railway.

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Copy the connection string from Supabase → Settings → Database → URI
3. Set `DATABASE_URL` in Railway to the Supabase URI
4. Run migrations from Railway shell

---

## Getting your API keys

| Key | Where to get |
|-----|-------------|
| `GEMINI_API_KEY` | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) — free tier |
| `GOOGLE_PLACES_API_KEY` | [console.cloud.google.com](https://console.cloud.google.com) → Enable "Places API (New)" |
| `JWT_SECRET` | Any random string: `openssl rand -base64 32` |

---

## Setting up Google Place ID for Kabab Souq

The Place ID for Kabab Souq Whitefield is in the Google Maps URL. To find it programmatically:

```bash
curl "https://places.googleapis.com/v1/places:searchText" \
  -H "X-Goog-Api-Key: YOUR_KEY" \
  -H "X-Goog-FieldMask: places.id,places.displayName" \
  -d '{"textQuery": "Kabab Souq Whitefield Bengaluru"}'
```

Then update the restaurant record:
```sql
UPDATE restaurants SET google_place_id = 'ChIJ...' WHERE slug = 'kabab-souq';
```
