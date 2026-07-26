# PathWise Deployment Guide

## Architecture

- **Frontend**: Next.js (Vercel)
- **Backend**: FastAPI OCR Service (Railway/Render)

---

## Option 1: Quick Deploy (Vercel + Railway)

### Step 1: Deploy Backend (Railway)

1. **Create `Procfile` for Railway:**

```bash
web: uvicorn backend.ocr_service:app --host 0.0.0.0 --port $PORT
```

2. **Create `railway.json`:**

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "cd backend && uvicorn ocr_service:app --host 0.0.0.0 --port $PORT",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

3. **Deploy to Railway:**
   - Go to https://railway.app
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repo
   - Railway will detect Python and install dependencies
   - Get your backend URL: `https://your-app.railway.app`

### Step 2: Deploy Frontend (Vercel)

1. **Update `.env.local` with production backend URL:**

```bash
SARVAM_API_KEY=your_actual_key_here
OCR_SERVICE_URL=https://your-app.railway.app
```

2. **Deploy to Vercel:**
   - Go to https://vercel.com
   - Click "Add New" → "Project"
   - Import your GitHub repo
   - Add environment variables:
     - `SARVAM_API_KEY` = your key
     - `OCR_SERVICE_URL` = your Railway backend URL
   - Click "Deploy"

3. **Done!** Your app will be live at `https://your-app.vercel.app`

---

## Option 2: All-in-One Deploy (Render)

### Deploy Both Services on Render

1. **Create `render.yaml`:**

```yaml
services:
  # Backend OCR Service
  - type: web
    name: pathwise-backend
    env: python
    region: oregon
    buildCommand: "cd backend && pip install -r requirements.txt"
    startCommand: "cd backend && uvicorn ocr_service:app --host 0.0.0.0 --port $PORT"
    envVars:
      - key: PYTHON_VERSION
        value: 3.11.0

  # Frontend
  - type: web
    name: pathwise-frontend
    env: node
    region: oregon
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: SARVAM_API_KEY
        sync: false
      - key: OCR_SERVICE_URL
        fromService:
          type: web
          name: pathwise-backend
          property: host
```

2. **Deploy:**
   - Go to https://render.com
   - Click "New" → "Blueprint"
   - Connect your GitHub repo
   - Render deploys both services automatically

---

## Option 3: Docker Deploy

### Create `docker-compose.yml`

```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - PORT=8000
    restart: unless-stopped

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - "3000:3000"
    environment:
      - SARVAM_API_KEY=${SARVAM_API_KEY}
      - OCR_SERVICE_URL=http://backend:8000
    depends_on:
      - backend
    restart: unless-stopped
```

### Create `backend/Dockerfile`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "ocr_service:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Create `Dockerfile.frontend`

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

### Deploy

```bash
docker-compose up -d
```

---

## Environment Variables

### Production Frontend (.env.production)

```bash
SARVAM_API_KEY=sk_your_production_key
OCR_SERVICE_URL=https://your-backend-url.com
```

### Backend (Set in Railway/Render)

No environment variables needed - backend is stateless.

---

## Pre-Deployment Checklist

- [ ] Test locally: `npm run build && npm start`
- [ ] Test backend: `cd backend && python ocr_service.py`
- [ ] Verify `.env.local` has correct Sarvam API key
- [ ] Update `OCR_SERVICE_URL` to production backend
- [ ] Test with sample documents
- [ ] Check CORS settings in backend
- [ ] Verify file upload limits
- [ ] Test on mobile devices

---

## Quick Commands

### Build & Test Locally

```bash
# Backend
cd backend
python ocr_service.py

# Frontend (new terminal)
npm run build
npm start
```

### Deploy Frontend Only (Vercel CLI)

```bash
npm i -g vercel
vercel --prod
```

### Deploy Backend Only (Railway CLI)

```bash
npm i -g @railway/cli
railway login
railway up
```

---

## Troubleshooting

### Backend Not Starting

**Error**: `ModuleNotFoundError: No module named 'easyocr'`

**Fix**: Ensure `requirements.txt` is in backend folder
```bash
cd backend
pip install -r requirements.txt
```

### Frontend Can't Connect to Backend

**Error**: `Cannot connect to OCR service`

**Fix**: Update `OCR_SERVICE_URL` in Vercel environment variables

### Large Model Download Timeout

**Error**: Backend times out during first request

**Fix**: Increase startup timeout in Railway/Render settings to 300s

### CORS Error

**Error**: `Access-Control-Allow-Origin`

**Fix**: Backend already has CORS enabled. Check if URL is correct.

---

## Cost Estimates

### Free Tier (Hobby Projects)

| Service | Free Tier |
|---------|-----------|
| Vercel | 100GB bandwidth/month |
| Railway | $5 credit/month (~500 hours) |
| Render | 750 hours/month |

**Total**: $0-5/month for hobby use

### Production

| Service | Cost |
|---------|------|
| Vercel Pro | $20/month |
| Railway (1GB RAM) | $5/month |
| **Total** | **$25/month** |

---

## Performance Optimization

### Backend

1. **Enable GPU** (if available):
   ```python
   gpu=True  # in ocr_service.py
   ```

2. **Add Redis caching**:
   ```bash
   pip install redis
   # Cache OCR results for duplicate uploads
   ```

3. **Increase workers**:
   ```bash
   uvicorn ocr_service:app --workers 4
   ```

### Frontend

1. **Enable Next.js caching**
2. **Use CDN for static assets**
3. **Enable compression**

---

## Recommended: Vercel + Railway

**Easiest and fastest deployment:**

1. Push code to GitHub
2. Connect Railway → Deploy backend → Get URL
3. Connect Vercel → Add backend URL → Deploy frontend
4. **Done in 5 minutes!**

Both platforms auto-deploy on git push.

---

## Need Help?

- Vercel Docs: https://vercel.com/docs
- Railway Docs: https://docs.railway.app
- Render Docs: https://render.com/docs
