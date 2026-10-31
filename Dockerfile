# ==============================================================================
# Étape 1 : Builder (Installation optimisée des dépendances de production)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copie des manifestes de dépendances
COPY package.json package-lock.json ./

# Installation stricte des seules dépendances d'exécution (exclut devDependencies)
RUN npm ci --omit=dev

# ==============================================================================
# Étape 2 : Runner (Image d'exécution légère, durcie et non-root)
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Variables d'environnement de production par défaut (fail-closed)
ENV NODE_ENV=production \
    PORT=4004

# Copie des dépendances de production depuis le builder
COPY --from=builder /app/node_modules ./node_modules

# Copie sélective de tous les fichiers requis à l'exécution
COPY package.json ./
COPY _i18n ./_i18n
COPY db ./db
COPY srv ./srv
COPY app ./app
COPY scripts ./scripts
COPY docker-entrypoint.sh ./

# Droits d'exécution et passage à l'utilisateur non-root "node"
RUN chmod +x docker-entrypoint.sh && chown -R node:node /app

USER node

# Healthcheck périodique sur /health (léger, sans auth, sans données sensibles, via wget intégré)
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4004/health > /dev/null || exit 1

EXPOSE 4004

ENTRYPOINT ["/bin/sh", "docker-entrypoint.sh"]
CMD ["npm", "start"]
