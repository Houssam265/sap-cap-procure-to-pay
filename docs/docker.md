# Guide de Déploiement Docker & PostgreSQL — Procure-to-Pay

Ce guide décrit l'architecture conteneurisée de l'application Procure-to-Pay SAP CAP, son intégration avec PostgreSQL, et les procédures de vérification (mode démo local, persistance des données, et neutralisation fail-closed en production).

---

## 1. Architecture et Modes d'Exécution

Le projet propose deux modes d'exécution stricts :

1. **Mode Démo Local (Docker Compose)** :
   - Application CAP conteneurisée connectée à PostgreSQL 16 Alpine.
   - Activé explicitement via `PTP_DEMO_MODE=true`, `CDS_ENV=production,demo`, et `CDS_REQUIRES_AUTH_KIND=mocked`.
   - Port applicatif publié exclusivement sur l'interface locale `127.0.0.1:4004`.
   - PostgreSQL isolé sur le réseau interne Docker (`ptp-network`), **aucun port de base de données n'est exposé sur l'hôte**.
   - Initialisation idempotente de la base de données (`scripts/init-db.js`) préservant l'état des données entre redémarrages.

2. **Image de Production (Fail-Closed)** :
   - Image Docker multi-stage basée sur `node:22-alpine` exécutée sous l'utilisateur non-privilégié `node`.
   - Par défaut : `NODE_ENV=production`, `PTP_DEMO_MODE=false`.
   - Neutralisation complète des fonctions de démo : `/api/switch` et `/api/login` répondent strictement **HTTP 404 Not Found**.
   - Aucun compte de test mock n'est actif sans configuration d'authentification d'entreprise (XSUAA / SAP Cloud Identity Services).
   - _Règle absolue : l'authentification "dummy" est interdite et n'est jamais utilisée en production._
   - **Arrêt contrôlé en mode isolé (Échec fermé sans base)** : si l'image est démarrée seule sans serveur PostgreSQL joignable (`docker run procure-to-pay`), le script `scripts/init-db.js` effectue 3 tentatives espacées de 2 secondes puis s'arrête proprement avec code 1 en affichant un message explicite (`PostgreSQL injoignable à <hôte>:<port>...`), sans aucune pile d'erreur technique Node et sans repli silencieux en mémoire.

---

## 2. Prérequis

- [Docker Engine](https://docs.docker.com/engine/) (v24+) ou Docker Desktop
- [Docker Compose](https://docs.docker.com/compose/) (v2+)
- PowerShell (Windows) ou Bash (Linux/macOS)

---

## 3. Configuration de l'Environnement

Créez le fichier `.env` local à partir de l'exemple fourni :

```powershell
Copy-Item .env.example .env
```

Le fichier `.env` contient par défaut :

- `POSTGRES_DB=procure_to_pay`
- `POSTGRES_USER=ptp_admin`
- `POSTGRES_PASSWORD=ptp_secure_local_dev_password_2026`
- `PTP_DEMO_MODE=false` (surchargé à `true` dans `docker-compose.yml` pour le profil démo)
- `PORT=4004`

---

## 4. Construction de l'Image Docker

L'image Docker utilise une compilation multi-stage pour garantir une taille minimale et aucune dépendance de développement en production (`npm ci --omit=dev`) :

```bash
docker build -t procure-to-pay:latest .
```

Vérifiez la création de l'image :

```bash
docker images procure-to-pay:latest
```

---

## 5. Démarrage en Mode Démo Local (PostgreSQL + App)

Lancez l'ensemble des services en arrière-plan :

```bash
docker compose up -d
```

### Vérification de l'état des conteneurs

```bash
docker compose ps
```

Les deux conteneurs `procure-to-pay-db-1` et `procure-to-pay-app-1` doivent afficher l'état `healthy` ou `Up`.

### Consultation des journaux de démarrage

```bash
docker compose logs -f app
```

Vous devez observer les traces suivantes attestant de la configuration sécurisée :

```text
[ptp-init] Connexion au service db (PostgreSQL)...
[ptp-init] Deploiement du schema relationnel PostgreSQL (idempotent)...
[ptp-init] Schema PostgreSQL applique avec succes.
[ptp-init] Table pt.Products vide : chargement initial des donnees CSV...
[ptp-init] Initialisation PostgreSQL terminee avec succes.
======================================================================
  ATTENTION : MODE DEMO ACTIF - NE PAS UTILISER EN PRODUCTION !
  Endpoints /api/switch et /api/login opérationnels avec comptes mock.
======================================================================
[cds] - server listening on { url: 'http://localhost:4004' }
```

### Vérification du Healthcheck

Le conteneur expose un endpoint de santé `/health` vérifié périodiquement par Alpine via `wget` :

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4004/health"
# Retourne : { "status": "UP" }
```

---

## 6. Exécution de la Suite de Tests E2E contre Docker

Exécutez la suite complète de 47 tests (authentification, matrice des rôles, workflow complet, validations métier, et durcissement HMAC) :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-e2e.ps1 -BaseUrl "http://localhost:4004"
```

Le script détecte automatiquement le mode démo via `/api/auth-mode` et valide le comportement de bout en bout avec 100% de succès.

---

## 7. Procédure de Vérification de la Persistance Réelle

Cette procédure démontre que le redémarrage du conteneur applicatif ne réinitialise **pas** les données métier (stocks, commandes, demandes), grâce au garde-fou d'idempotence de `scripts/init-db.js`.

### Étape 1 : Constater le stock initial

Le stock du produit `PROD-001` (Écran 27 Pouces 4K) est initialement à **15 unités**.

```powershell
$authCarol = @{ "Authorization" = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("carol:carol")) }
$prodBefore = Invoke-RestMethod -Uri "http://127.0.0.1:4004/odata/v4/procurement/Products('PROD-001')" -Headers $authCarol
Write-Host "Stock initial PROD-001 : $($prodBefore.stock)"
# Affiche : Stock initial PROD-001 : 15
```

### Étape 2 : Réceptionner une commande (augmentation du stock)

Exécutez une réception d'article via l'action OData `receive` :

```powershell
# (Effectué via l'application web ou lors du passage de test-e2e.ps1, où le stock passe par exemple à 20 ou 25)
$prodAfter = Invoke-RestMethod -Uri "http://127.0.0.1:4004/odata/v4/procurement/Products('PROD-001')" -Headers $authCarol
Write-Host "Stock apres reception : $($prodAfter.stock)"
# Affiche : Stock apres reception : 20
```

### Étape 3 : Redémarrer le conteneur applicatif

```bash
docker compose restart app
```

Consultez les logs de redémarrage :

```bash
docker compose logs --tail=30 app
```

Vous devez observer :

```text
[ptp-init] Donnees existantes detectees dans pt.Products (seed CSV ignore pour preserver l'etat).
```

### Étape 4 : Confirmer le maintien du stock modifié

```powershell
$prodPersisted = Invoke-RestMethod -Uri "http://127.0.0.1:4004/odata/v4/procurement/Products('PROD-001')" -Headers $authCarol
Write-Host "Stock apres redemarrage du conteneur : $($prodPersisted.stock)"
```

Le stock reste à la valeur modifiée (**20** et non réinitialisé à **15**). La persistance sur le volume PostgreSQL `postgres_data` est confirmée.

---

## 8. Preuve de Neutralisation Fail-Closed (Mode Production Réel)

L'architecture applique un principe strict de **fail-closed** à deux niveaux :

### 8.1. Arrêt net de l'image lancée de façon isolée (sans base PostgreSQL)

Si l'image de production est lancée seule sur l'hôte sans service PostgreSQL joignable :

```bash
docker run --rm -p 127.0.0.1:4005:4004 procure-to-pay:latest
```

Le script `scripts/init-db.js` tente de joindre la base PostgreSQL sur `localhost:5432`, effectue 3 tentatives espacées de 2 secondes, puis s'arrête avec le code d'erreur 1 en affichant un message limpide (sans pile d'erreur Node verbeuse) :

```text
[init-db] ----------------------------------------------------
[init-db] Initialisation de la base de données Procure-to-Pay
[init-db] ----------------------------------------------------
[init-db] Cible : postgres
[init-db] Tentative de connexion à PostgreSQL (localhost:5432) [1/3]...
[init-db] ⏳ PostgreSQL injoignable (tentative 1/3). Nouvelle tentative dans 2s...
[init-db] Tentative de connexion à PostgreSQL (localhost:5432) [2/3]...
[init-db] ⏳ PostgreSQL injoignable (tentative 2/3). Nouvelle tentative dans 2s...
[init-db] Tentative de connexion à PostgreSQL (localhost:5432) [3/3]...

[init-db] ❌ PostgreSQL injoignable à localhost:5432 après 3 tentative(s) : vérifiez les variables CDS_REQUIRES_DB_* ou lancez l'application avec docker compose up.
```

Ce comportement est intentionnel : aucun fallback silencieux vers une base volatile en mémoire n'est toléré en production.

### 8.2. Preuve du 404 sur les endpoints de démo via `docker compose run`

Pour valider le comportement fonctionnel de production (avec la base PostgreSQL connectée mais sans mode démo actif), lancez une instance éphémère avec `PTP_DEMO_MODE=false` sur un port distinct (par exemple `4005`) :

```bash
docker compose run --rm -p 127.0.0.1:4005:4004 -e PTP_DEMO_MODE=false -e CDS_ENV=production app
```

#### Étape 1 : Interroger `/api/auth-mode`

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4005/api/auth-mode"
```

Réponse retournée confirmant le mode production :

```json
{
  "isDev": false,
  "mode": "production"
}
```

#### Étape 2 : Vérifier le 404 strict sur `/api/switch`

```powershell
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:4005/api/switch" -Method POST -Body '{"username":"alice"}' -ContentType "application/json"
} catch {
    Write-Host "Code HTTP recu : $($_.Exception.Response.StatusCode.value__)"
}
# Affiche : Code HTTP recu : 404
```

#### Étape 3 : Vérifier le 404 strict sur `/api/login`

```powershell
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:4005/api/login" -Method POST -Body '{"username":"alice","password":"pwd"}' -ContentType "application/json"
} catch {
    Write-Host "Code HTTP recu : $($_.Exception.Response.StatusCode.value__)"
}
# Affiche : Code HTTP recu : 404
```

#### Étape 4 : Exécution de la suite E2E contre l'instance de production

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-e2e.ps1 -BaseUrl "http://127.0.0.1:4005"
```

Le script détecte `isDev=false` et valide que les tentatives de bascule de compte mock sont systématiquement rejetées avec un statut HTTP 404.

---

## 9. Arrêt et Réinitialisation

### Arrêter les services

```bash
docker compose stop
```

### Arrêter et supprimer les conteneurs (en conservant les données)

```bash
docker compose down
```

### Réinitialisation complète (purge du volume de données PostgreSQL)

```bash
docker compose down -v
```

Au prochain démarrage avec `docker compose up -d`, PostgreSQL démarrera avec un volume neuf et `scripts/init-db.js` rechargera les données CSV initiales.
