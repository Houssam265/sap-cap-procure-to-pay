/**
 * srv/server.js — Extension du serveur CAP
 *
 * Endpoints exposés :
 *   GET  /me             → { id, roles, roleLabel, isDev } (401 si non connecté)
 *   GET  /api/auth-mode  → { isDev, mode } — pas de credentials dans la réponse
 *   POST /api/switch     → [DEV ONLY] bascule vers un compte mock sans mot de passe client
 *   POST /api/login      → [DEV ONLY] authentification avec identifiant + mot de passe (formulaire manuel)
 *   POST /api/logout     → Invalidation de la session
 *   GET  /logout         → Page de confirmation de déconnexion
 *   GET  /login          → Redirection après login (protection open redirect)
 *
 * Sécurité du cookie :
 *   - Le cookie ptp_auth contient un jeton signé HMAC-SHA256 (username|expiry|sig)
 *   - Le mot de passe n'est jamais stocké dans le cookie ni renvoyé au client
 *   - Le cookie est HttpOnly + SameSite=Lax (pas accessible depuis JS)
 *   - Secret lu depuis PTP_COOKIE_SECRET ou généré aléatoirement au démarrage
 *
 * Mode production :
 *   - /api/switch et /api/login répondent 404
 *   - getAuthenticatedUser retourne null immédiatement
 *   - Les comptes mock sont absents (définis uniquement dans le profil [development] de package.json)
 *   - Le Dockerfile doit définir NODE_ENV=production
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import cds from "@sap/cds";

// ── Détection du profil de production ─────────────────────────────────────────
// On considère que c'est la production si l'UNE des conditions suivantes est vraie :
//   1. NODE_ENV=production  (variable Docker / Heroku / BTP standard)
//   2. CDS_ENV=production   (variable CDS)
//   3. cds.env.profiles contient "production"
//   4. cds.env.production === true
// Dans le doute (valeur indéterminée), le mode démo est DÉSACTIVÉ.
const _nodeEnvProd = process.env.NODE_ENV === "production";
const _cdsEnvProd = process.env.CDS_ENV === "production";
const _profilesProd = cds.env.profiles
  ? Array.isArray(cds.env.profiles)
    ? cds.env.profiles.includes("production")
    : typeof cds.env.profiles.has === "function"
      ? cds.env.profiles.has("production")
      : String(cds.env.profiles).includes("production")
  : false;
const _cdsConfProd = cds.env.production === true;

const isProduction = _nodeEnvProd || _cdsEnvProd || _profilesProd || _cdsConfProd;

// ── Contrôle d'activation du mode démo ─────────────────────────────────────────
// Les fonctions de démo (/api/switch, /api/login, cookie ptp_auth) ne s'activent QUE SI :
//   - Soit en développement / test pur (!isProduction) avec auth mocked
//   - Soit avec TOUTES les conditions suivantes réunies :
//       1. Variable explicite PTP_DEMO_MODE === "true"
//       2. cds.env.requires.auth?.kind === "mocked"
//       3. Des comptes mock sont réellement configurés dans cds.env.requires.auth.users
// Sans ces 3 conditions en production, fail-closed total (404 sur les endpoints de démo).
function checkDemoActive() {
  const isDemoEnv = process.env.PTP_DEMO_MODE === "true";
  const authKind = cds.env.requires.auth?.kind;
  const configuredUsers = cds.env.requires.auth?.users || {};
  const hasMockUsers = Object.keys(configuredUsers).length > 0;

  if (isDemoEnv && authKind === "mocked" && hasMockUsers) {
    return true;
  }
  if (!isProduction && authKind === "mocked" && hasMockUsers) {
    return true;
  }
  return false;
}

// ── Secret HMAC ────────────────────────────────────────────────────────────────
// Lu depuis l'environnement en production, généré en mémoire en développement.
// Un secret éphémère en dev signifie que toutes les sessions sont invalidées au
// redémarrage du serveur — comportement intentionnel en développement.
const COOKIE_SECRET = process.env.PTP_COOKIE_SECRET
  ? Buffer.from(process.env.PTP_COOKIE_SECRET, "utf8")
  : randomBytes(32);

const COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 heures

const ROLE_LABELS = {
  Requester: "Demandeur",
  Manager: "Manager",
  Warehouse: "Magasinier",
  Admin: "Administrateur"
};

// ── Fonctions HMAC pour le cookie ─────────────────────────────────────────────

function signToken(username) {
  const expiry = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS;
  const payload = `${username}|${expiry}`;
  const sig = createHmac("sha256", COOKIE_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

function verifyToken(token) {
  if (!token || token === "logout") return null;
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split("|");
    if (parts.length !== 3) return null;
    const [username, expiry, sig] = parts;
    const payload = `${username}|${expiry}`;
    const expectedSig = createHmac("sha256", COOKIE_SECRET).update(payload).digest("hex");
    // Comparaison à temps constant pour éviter les timing attacks
    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
    if (Math.floor(Date.now() / 1000) > parseInt(expiry, 10)) return null;
    return username;
  } catch {
    return null;
  }
}

function setCookieToken(res, username) {
  const token = signToken(username);
  res.setHeader("Set-Cookie", `ptp_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}`);
}

function clearCookie(res) {
  res.setHeader("Set-Cookie", "ptp_auth=logout; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isSafeReturnUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  if (/^\/[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(url)) return false;
  if (url.includes("\\")) return false;
  return true;
}

function getRoleInfo(userConf) {
  let roles = [];
  if (Array.isArray(userConf?.roles)) {
    roles = userConf.roles;
  } else if (userConf?.roles && typeof userConf.roles === "object") {
    roles = Object.keys(userConf.roles);
  }
  let roleLabel = "Utilisateur";
  for (const [r, label] of Object.entries(ROLE_LABELS)) {
    if (roles.includes(r)) {
      roleLabel = label;
      break;
    }
  }
  if (roleLabel === "Utilisateur" && roles.includes("Admin")) {
    roleLabel = "Administrateur";
  }
  return { roles, roleLabel };
}

// ── Lecture de l'utilisateur authentifié (cookie HMAC ou Basic Auth) ────────
// Appelée à chaque requête. Retourne null si :
//   - on est en production
//   - un cookie ptp_auth est fourni mais invalide, corrompu ou expiré
//   - aucun cookie et aucun en-tête Basic Auth valide n'est fourni
//   - le nom d'utilisateur n'existe pas dans la config

function getAuthenticatedUser(req) {
  if (!checkDemoActive()) return null;

  const configuredUsers = cds.env.requires.auth?.users || {};

  // 1. Authentification par cookie de session HMAC (navigateur)
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)ptp_auth=([^;]*)/);
    if (match) {
      const raw = decodeURIComponent(match[1]);
      if (raw === "logout" || !raw) return null;

      const username = verifyToken(raw);
      if (!username) return null; // Jeton invalide ou expiré -> rejet immédiat

      const targetKey = Object.keys(configuredUsers).find((k) => k.toLowerCase() === username.toLowerCase());
      return targetKey || null;
    }
  }

  // 2. Authentification HTTP Basic standard (tests automatisés, outils API)
  const authHeader = req.headers.authorization;
  if (authHeader && /^basic\s+/i.test(authHeader)) {
    try {
      const b64 = authHeader.replace(/^basic\s+/i, "").trim();
      const credentials = Buffer.from(b64, "base64").toString("utf8");
      const colonIdx = credentials.indexOf(":");
      if (colonIdx === -1) return null;

      const user = credentials.slice(0, colonIdx);
      const pass = credentials.slice(colonIdx + 1);

      const targetKey = Object.keys(configuredUsers).find((k) => k.toLowerCase() === user.trim().toLowerCase());
      if (!targetKey) return null;

      const userConf = configuredUsers[targetKey];
      const pwdBuf = Buffer.from(userConf.password || "", "utf8");
      const inputBuf = Buffer.from(pass, "utf8");
      if (pwdBuf.length !== inputBuf.length) return null;
      if (!timingSafeEqual(pwdBuf, inputBuf)) return null;

      return targetKey;
    } catch {
      return null;
    }
  }

  return null;
}

// ── Bootstrap CAP ─────────────────────────────────────────────────────────────
cds.on("bootstrap", (app) => {
  // ── Middleware de session ─────────────────────────────────────────────────
  app.use((req, res, next) => {
    const cookieHeader = req.headers.cookie;
    let rawCookieVal = null;
    if (cookieHeader) {
      const m = cookieHeader.match(/(?:^|;\s*)ptp_auth=([^;]*)/);
      if (m) rawCookieVal = decodeURIComponent(m[1]);
    }

    const authUser = getAuthenticatedUser(req);

    if (rawCookieVal === "logout") {
      // Cookie explicitement invalidé — on s'assure qu'aucun Basic ne passe
      delete req.headers.authorization;
    } else if (authUser) {
      // Injecter l'en-tête Basic pour que CAP puisse vérifier les rôles
      const configuredUsers = cds.env.requires.auth?.users || {};
      const pwd = configuredUsers[authUser]?.password;
      if (pwd) {
        req.headers.authorization = "Basic " + Buffer.from(`${authUser}:${pwd}`).toString("base64");
      }
    }

    // Redirection vers l'accueil si une page Fiori est demandée sans session
    const isAppHtml =
      req.method === "GET" &&
      (req.headers.accept?.includes("text/html") || req.path.endsWith(".html")) &&
      (req.path.includes("/webapp") ||
        req.path.match(/^\/(purchase-requests|purchase-orders|products|stock-movements)/));

    if (isAppHtml && !authUser && !isProduction) {
      const returnUrl = req.originalUrl || "/";
      return res.redirect(302, `/?loginRequired=1&returnUrl=${encodeURIComponent(returnUrl)}`);
    }

    next();
  });

  // Servir les assets statiques sous /app
  app.use("/app", express.static("./app"));

  // ── GET /health ─────────────────────────────────────────────────────────────
  // Endpoint de santé léger pour Docker HEALTHCHECK (sans auth, sans donnée sensible)
  app.get("/health", (_req, res) => {
    res.json({ status: "UP" });
  });

  // ── GET /api/auth-mode ──────────────────────────────────────────────────────
  app.get("/api/auth-mode", (_req, res) => {
    const isDemo = checkDemoActive();
    let mode = "production";
    if (isDemo) {
      mode = isProduction ? "demo" : "development";
    }
    res.json({
      isDev: isDemo,
      mode: mode
    });
  });

  // ── POST /api/switch ────────────────────────────────────────────────────────
  // Mode démo uniquement (dev). Bascule vers un compte mock SANS mot de passe
  // côté client. Le serveur retrouve l'utilisateur dans cds.env.requires.auth.users.
  // Répond 404 en production pour ne laisser aucune surface d'attaque.
  app.post("/api/switch", express.json(), (req, res) => {
    if (!checkDemoActive()) {
      return res.status(404).json({ error: "Endpoint non disponible en production." });
    }

    const { username } = req.body || {};
    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Champ 'username' manquant." });
    }

    const configuredUsers = cds.env.requires.auth?.users || {};
    const targetKey = Object.keys(configuredUsers).find((k) => k.toLowerCase() === username.trim().toLowerCase());

    if (!targetKey) {
      return res.status(401).json({ error: "Utilisateur inconnu." });
    }

    setCookieToken(res, targetKey);
    const { roles, roleLabel } = getRoleInfo(configuredUsers[targetKey]);

    res.json({
      ok: true,
      user: { id: targetKey, roles, roleLabel },
      isDev: true
    });
  });

  // ── POST /api/login ─────────────────────────────────────────────────────────
  // Mode démo uniquement (dev). Utilisé par le formulaire manuel "Se connecter
  // avec un autre compte". Valide le mot de passe saisi par l'utilisateur.
  // Répond 404 en production.
  app.post("/api/login", express.json(), (req, res) => {
    if (!checkDemoActive()) {
      return res.status(404).json({ error: "Endpoint non disponible en production." });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Identifiant et mot de passe requis." });
    }

    const configuredUsers = cds.env.requires.auth?.users || {};
    const targetKey = Object.keys(configuredUsers).find((k) => k.toLowerCase() === username.trim().toLowerCase());
    const userConf = targetKey ? configuredUsers[targetKey] : null;

    // Validation du mot de passe (comparaison à temps constant)
    if (!userConf) {
      return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
    }
    const pwdBuf = Buffer.from(userConf.password || "", "utf8");
    const inputBuf = Buffer.from(password, "utf8");
    const sameLength = pwdBuf.length === inputBuf.length;
    const pwdMatch = sameLength && timingSafeEqual(pwdBuf, inputBuf);
    if (!pwdMatch) {
      return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
    }

    setCookieToken(res, targetKey);
    const { roles, roleLabel } = getRoleInfo(userConf);

    res.json({
      ok: true,
      user: { id: targetKey, roles, roleLabel },
      isDev: true
    });
  });

  // ── POST /api/logout ────────────────────────────────────────────────────────
  app.post("/api/logout", (_req, res) => {
    clearCookie(res);
    res.json({ ok: true });
  });

  // ── GET /me ──────────────────────────────────────────────────────────────────
  app.get("/me", (req, res) => {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      // Pas de WWW-Authenticate → pas de popup navigateur
      return res.status(401).json({ error: "Non authentifié", isDev: !isProduction });
    }

    const configuredUsers = cds.env.requires.auth?.users || {};
    const userConf = configuredUsers[authUser] || {};
    const { roles, roleLabel } = getRoleInfo(userConf);

    res.json({
      id: authUser,
      roles,
      roleLabel,
      isDev: !isProduction
    });
  });

  // ── GET /logout ──────────────────────────────────────────────────────────────
  app.get("/logout", (req, res) => {
    clearCookie(res);

    // Réinitialisation Basic Auth natif si explicitement demandée
    if (req.query.native === "1") {
      res.status(401);
      res.setHeader("WWW-Authenticate", 'Basic realm="SAP Procure-to-Pay"');
      return res.send("Session Basic réinitialisée");
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Déconnexion — SAP Procure-to-Pay</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #090d16; color: #f3f4f6;
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
      background-image: radial-gradient(at 50% 50%, rgba(14, 165, 233, 0.12) 0px, transparent 60%);
    }
    .card {
      background: rgba(22, 29, 47, 0.85); backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 16px; padding: 48px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6); text-align: center; max-width: 480px; width: 90%;
    }
    .icon {
      width: 64px; height: 64px; margin: 0 auto 20px;
      background: rgba(14, 165, 233, 0.15); border: 1px solid rgba(14, 165, 233, 0.3);
      border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px;
    }
    h1 { color: #fff; font-size: 24px; font-weight: 700; margin-bottom: 12px; }
    p  { color: #94a3b8; font-size: 14px; line-height: 1.6; margin-bottom: 28px; }
    a.btn {
      display: inline-block; background: linear-gradient(135deg, #0070f3, #0051b3);
      color: #fff; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 8px;
      text-decoration: none; box-shadow: 0 4px 14px rgba(0, 112, 243, 0.35); transition: all .2s;
    }
    a.btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0, 112, 243, 0.5); }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔓</div>
    <h1>Session fermée</h1>
    <p>Vous avez été déconnecté avec succès. Vous pouvez maintenant vous reconnecter avec un autre compte.</p>
    <a class="btn" href="/">Retour au portail</a>
  </div>
</body>
</html>`);
  });

  // ── GET /login ───────────────────────────────────────────────────────────────
  app.get("/login", (req, res) => {
    const raw = req.query.returnUrl;
    const safeUrl = isSafeReturnUrl(raw) ? raw : "/";
    res.redirect(302, safeUrl);
  });
});

cds.on("served", () => {
  const isDemo = checkDemoActive();
  if (isDemo && isProduction) {
    console.warn("\n========================================================");
    console.warn("⚠️  ATTENTION : MODE DEMO ACTIF - ne pas utiliser en production !");
    console.warn("⚠️  Les endpoints /api/switch et /api/login sont opérationnels.");
    console.warn("========================================================\n");
  }
  console.log(
    `[server.js] Prêt. isProduction=${isProduction}, demoActive=${isDemo}. ` +
      `Routes actives : /health, /me, /api/auth-mode, /api/switch, /api/login, /api/logout, /logout, /login`
  );
});

export default cds.server;
