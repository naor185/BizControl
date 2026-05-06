# BizControl — Production Deployment Guide

## Architecture
- **Backend**: Railway (FastAPI + PostgreSQL)
- **Frontend**: Vercel (Next.js)
- **Domain**: Optional custom domain (Namecheap / Cloudflare)

---

## Step 1 — Push code to GitHub

```bash
# In the BizControl root directory:
git add .
git commit -m "prepare for production deployment"
git push origin main
```

> Make sure `.env` is in `.gitignore` — it is already.

---

## Step 2 — Deploy Backend on Railway

1. Go to **railway.app** → Sign in with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select the `BizControl` repository
4. Railway will auto-detect Python via `railway.toml`

### Set Environment Variables in Railway

In your Railway project → **Variables** tab, add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Auto-provided by Railway PostgreSQL plugin |
| `JWT_SECRET` | Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ACCESS_TOKEN_MINUTES` | `60` |
| `REFRESH_TOKEN_DAYS` | `30` |
| `ADMIN_SETUP_SECRET` | A secret string you choose |
| `PLATFORM_SLUG` | `bizcontrol-platform` |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` (add after Vercel deploy) |
| `PLATFORM_SMTP_HOST` | `smtp.gmail.com` |
| `PLATFORM_SMTP_PORT` | `587` |
| `PLATFORM_SMTP_USER` | `ncbilutattoo@gmail.com` |
| `PLATFORM_SMTP_PASS` | `eymw rzmk uheg bpvh` |
| `PLATFORM_SMTP_FROM` | `BizControl <ncbilutattoo@gmail.com>` |
| `PLATFORM_ADMIN_EMAIL` | `ncbilutattoo@gmail.com` |
| `OPENAI_API_KEY` | Your OpenAI key (optional) |

### Add PostgreSQL to Railway

1. In your Railway project → **+ New** → **Database** → **PostgreSQL**
2. Railway will auto-inject `DATABASE_URL` into your backend service

### First Deploy

Railway will run:
```
alembic upgrade head && gunicorn app.main:app ...
```
This auto-runs migrations. Check Railway logs for success.

### Create Superadmin (once)

After first deploy, call this endpoint **once**:
```bash
curl -X POST https://YOUR-RAILWAY-URL/api/admin/setup \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "YOUR_ADMIN_SETUP_SECRET",
    "email": "ncbilutattoo@gmail.com",
    "password": "Admin123!",
    "display_name": "Naor"
  }'
```

Note your Railway URL — it looks like `bizcontrol-production.up.railway.app`

---

## Step 3 — Deploy Frontend on Vercel

1. Go to **vercel.com** → Sign in with GitHub
2. Click **Add New Project** → select the `BizControl` repo
3. Set **Root Directory** to `web`
4. Vercel auto-detects Next.js

### Set Environment Variables in Vercel

In Vercel project → **Settings** → **Environment Variables**:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_BASE` | `https://YOUR-RAILWAY-URL` |

### After Vercel Deploys

Copy the Vercel URL (e.g. `bizcontrol.vercel.app`) and:
1. Go back to Railway → Variables
2. Update `ALLOWED_ORIGINS` to: `https://bizcontrol.vercel.app`
3. Railway will auto-redeploy

---

## Step 4 — Custom Domain (Optional)

### Backend domain (api.yourdomain.com)
1. Railway project → **Settings** → **Domains** → Add custom domain
2. In your DNS (Cloudflare/Namecheap): add CNAME `api` → `your-railway-url`

### Frontend domain (yourdomain.com)
1. Vercel project → **Settings** → **Domains** → Add domain
2. In DNS: add CNAME `@` → `cname.vercel-dns.com`

Then update:
- Railway: `ALLOWED_ORIGINS=https://yourdomain.com`
- Vercel: `NEXT_PUBLIC_API_BASE=https://api.yourdomain.com`

---

## Step 5 — Uploads on Railway

Railway's filesystem is **ephemeral** (files lost on redeploy).
For production uploads (client images, invoices), use Cloudinary (free tier):

1. Sign up at cloudinary.com → get `CLOUDINARY_URL`
2. Add to Railway env vars: `CLOUDINARY_URL=cloudinary://...`
3. We'll update the upload service to use Cloudinary (next step)

For now, uploads work but reset on redeploy. Fine for initial launch.

---

## Quick Checklist

- [ ] Code pushed to GitHub
- [ ] Railway project created + PostgreSQL added
- [ ] All Railway env vars set
- [ ] First deploy succeeded (check logs)
- [ ] `POST /api/admin/setup` called to create superadmin
- [ ] Vercel project created, root dir = `web`
- [ ] `NEXT_PUBLIC_API_BASE` set in Vercel
- [ ] `ALLOWED_ORIGINS` updated in Railway with Vercel URL
- [ ] Login tested at `https://your-app.vercel.app/login`
- [ ] (Optional) Custom domain configured

---

## Useful Commands

```bash
# Check Railway logs (install Railway CLI first: npm i -g @railway/cli)
railway logs

# Run migrations manually
railway run alembic upgrade head

# Open Railway shell
railway shell
```
