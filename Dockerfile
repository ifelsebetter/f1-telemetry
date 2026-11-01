# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Backend Base (Python 3.12 Slim)
# =============================================================================
FROM python:3.12-slim AS backend-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app

WORKDIR /app

# Create non-root user matching standard UID/GID 1000
RUN groupadd -g 1000 appuser && \
    useradd -m -u 1000 -g 1000 -s /bin/sh appuser && \
    mkdir -p /app/.fastf1_cache && \
    chown -R appuser:appuser /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# =============================================================================
# Stage 2: Backend Development (Hot Reload + Test Runner)
# =============================================================================
FROM backend-base AS backend-dev

RUN pip install --no-cache-dir pytest httpx
COPY --chown=appuser:appuser backend /app/backend

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# =============================================================================
# Stage 3: Backend Production (Hardened Non-Root Runtime)
# =============================================================================
FROM backend-base AS backend-prod

COPY --chown=appuser:appuser backend /app/backend

USER appuser
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

# =============================================================================
# Stage 4: Frontend Base (Node 22 Alpine)
# =============================================================================
FROM node:22-alpine AS frontend-base

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund

# =============================================================================
# Stage 5: Frontend Development (Vite HMR Server)
# =============================================================================
FROM frontend-base AS frontend-dev

COPY frontend/ ./

EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]

# =============================================================================
# Stage 6: Frontend Build (Compile Production Assets)
# =============================================================================
FROM frontend-base AS frontend-build

COPY frontend/ ./
RUN npm run build

# =============================================================================
# Stage 7: Frontend Production (Non-Root Static + API/WS Proxy Server)
# =============================================================================
FROM node:22-alpine AS frontend-prod

ENV NODE_ENV=production
WORKDIR /app/frontend

COPY --from=frontend-base --chown=node:node /app/frontend/package.json ./package.json
COPY --from=frontend-base --chown=node:node /app/frontend/node_modules ./node_modules
COPY --from=frontend-build --chown=node:node /app/frontend/vite.config.js ./vite.config.js
COPY --from=frontend-build --chown=node:node /app/frontend/dist ./dist

USER node
EXPOSE 3000
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "3000"]
