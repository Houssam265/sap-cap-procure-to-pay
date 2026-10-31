#!/bin/sh
set -e

echo "[entrypoint] Initialisation de la base de données..."
node scripts/init-db.js

echo "[entrypoint] Lancement du serveur d'application..."
exec "$@"
