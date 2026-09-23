# TrackMyRMC — Production Deployment Guide

Deploying the Rust backend and PostgreSQL database to Render.

---

## 1. Render Infrastructure Blueprint (`render.yaml`)

The repository includes a production-ready `render.yaml` defining:
- Managed PostgreSQL database (`trackmyrmc-postgres`)
- Multi-stage Docker web service (`trackmyrmc-backend`)
- Auto-configured environment variables and health monitoring (`/health`).

---

## 2. Environment Variables Checklist

| Variable | Required | Description |
|---|:---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | Yes | Injected automatically by Render (default `8000`) |
| `JWT_SECRET` | Yes | High-entropy signing secret (32+ characters) |
| `JWT_EXPIRATION_HOURS` | Yes | Default `72` |
| `META_WHATSAPP_TOKEN` | Yes | Meta System User Access Token |
| `META_PHONE_NUMBER_ID` | Yes | Meta Cloud API Phone Number ID |
| `META_WABA_ID` | Yes | Meta WhatsApp Business Account ID |
| `EMAIL_API_KEY` | Yes | Postmark or SendGrid API token |
| `EMAIL_FROM_ADDRESS` | Yes | e.g., `noreply@trackmyrmc.com` |
| `WEBAUTHN_RP_ID` | Yes | Domain name (e.g. `trackmyrmc.com`) |
| `WEBAUTHN_RP_ORIGIN` | Yes | Scheme + host (e.g. `https://trackmyrmc.com`) |

---

## 3. Health Monitoring

Render monitors the `/health` endpoint every 30 seconds. The endpoint queries `SELECT 1` against PostgreSQL to confirm operational health.
