/**
 * srv/server.js — Extension du serveur CAP
 *
 * Expose les endpoints :
 *   GET  /me         → { id, roles, roleLabel } pour l'utilisateur authentifié (401 si non connecté)
 *   POST /api/login  → Authentification via cookie de session (sélection 1-clic ou saisie)
 *   POST /api/logout → Invalidation de la session (suppression du cookie)
 *   GET  /logout     → Déconnexion web sécurisée
 *   GET  /login      → Redirection après login avec protection open redirect
 */

import express from "express";
import cds from "@sap/cds";

const ROLE_LABELS = {
  Requester: "Demandeur",
  Manager: "Manager",
  Warehouse: "Magasinier",
  Admin: "Administrateur",
};

const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.CDS_ENV === "production" ||
  (cds.env.profiles && (cds.env.profiles.includes("production") || (typeof cds.env.profiles.has === "function" && cds.env.profiles.has("production")))) ||
  cds.env.production === true;

function isSafeReturnUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  if (/^\/[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(url)) return false;
  if (url.includes("\\")) return false;
  return true;
}

function getAuthenticatedUser(req) {
  if (isProduction) {
    // En production, aucun utilisateur mocké via cookie ptp_auth n'est autorisé
    return null;
  }

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)ptp_auth=([^;]*)/);
    if (match) {
      const val = decodeURIComponent(match[1]);
      if (val === "logout" || !val) return null;
      try {
        const [u, p] = Buffer.from(val, "base64").toString().split(":");
        const configuredUsers = cds.env.requires.auth?.users || {};
        const targetKey = Object.keys(configuredUsers).find(
          (k) => k.toLowerCase() === (u || "").toLowerCase()
        );
        if (targetKey && configuredUsers[targetKey].password === p) {
          return targetKey;
        }
      } catch (e) {
        return null;
      }
    }
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.match(/^basic/i)) {
    try {
      const [u, p] = Buffer.from(authHeader.slice(6), "base64").toString().split(":");
      const configuredUsers = cds.env.requires.auth?.users || {};
      const targetKey = Object.keys(configuredUsers).find(
        (k) => k.toLowerCase() === (u || "").toLowerCase()
      );
      if (targetKey && configuredUsers[targetKey].password === p) {
        return targetKey;
      }
    } catch (e) {
      return null;
    }
  }

  return null;
}

cds.on("bootstrap", (app) => {
  // Middleware de session et de protection des applications Fiori
  app.use((req, res, next) => {
    const cookieHeader = req.headers.cookie;
    let cookieAuth = null;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)ptp_auth=([^;]*)/);
      if (match) cookieAuth = decodeURIComponent(match[1]);
    }

    const authUser = getAuthenticatedUser(req);

    if (cookieAuth === "logout") {
      delete req.headers.authorization;
    } else if (authUser && !isProduction) {
      const configuredUsers = cds.env.requires.auth?.users || {};
      const pwd = configuredUsers[authUser]?.password;
      if (pwd) {
        req.headers.authorization = "Basic " + Buffer.from(`${authUser}:${pwd}`).toString("base64");
      }
    }

    // Protection des applications UI HTML :
    // Si un utilisateur non authentifié demande la page HTML d'une application Fiori,
    // on le redirige vers l'accueil pour qu'il s'identifie via le modal sans déclencher de popup navigateur.
    const isAppHtml =
      req.method === "GET" &&
      (req.headers.accept?.includes("text/html") || req.path.endsWith(".html")) &&
      (req.path.includes("/webapp") || req.path.match(/^\/(purchase-requests|purchase-orders|products|stock-movements)/));

    if (isAppHtml && !authUser && !isProduction) {
      const returnUrl = req.originalUrl || "/";
      return res.redirect(302, `/?loginRequired=1&returnUrl=${encodeURIComponent(returnUrl)}`);
    }

    next();
  });

  // Servir les assets statiques sous /app
  app.use("/app", express.static("./app"));

  // ── GET /api/auth-mode ────────────────────────────────────────────────────
  app.get("/api/auth-mode", (req, res) => {
    res.json({
      isDev: !isProduction,
      mode: isProduction ? "production" : "development"
    });
  });

  // ── POST /api/login ───────────────────────────────────────────────────────
  app.post("/api/login", express.json(), (req, res) => {
    // Strictement interdit et non disponible en profil de production (répond 404)
    if (isProduction) {
      return res.status(404).json({ error: "Endpoint non disponible en production." });
    }

    const { username, password } = req.body || {};
    const configuredUsers = cds.env.requires.auth?.users || {};
    const targetKey = Object.keys(configuredUsers).find(
      (k) => k.toLowerCase() === (username || "").trim().toLowerCase()
    );
    const userConf = targetKey ? configuredUsers[targetKey] : null;

    if (!userConf || userConf.password !== password) {
      return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
    }

    const token = Buffer.from(`${targetKey}:${password}`).toString("base64");
    res.setHeader(
      "Set-Cookie",
      `ptp_auth=${token}; Path=/; SameSite=Lax; Max-Age=86400`
    );

    let roles = [];
    if (Array.isArray(userConf.roles)) {
      roles = userConf.roles;
    } else if (userConf.roles && typeof userConf.roles === "object") {
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

    res.json({
      ok: true,
      user: {
        id: username,
        roles,
        roleLabel,
      },
      isDev: true,
    });
  });

  // ── POST /api/logout ──────────────────────────────────────────────────────
  app.post("/api/logout", (req, res) => {
    // On conserve le cookie ptp_auth=logout pendant 24h pour que le navigateur
    // ne réutilise pas automatiquement son cache Basic Auth
    res.setHeader(
      "Set-Cookie",
      "ptp_auth=logout; Path=/; SameSite=Lax; Max-Age=86400"
    );
    res.json({ ok: true });
  });

  // ── GET /me ───────────────────────────────────────────────────────────────
  app.get("/me", (req, res) => {
    const authUser = getAuthenticatedUser(req);

    if (!authUser) {
      // 401 SANS WWW-Authenticate pour ne JAMAIS déclencher la popup native du navigateur
      return res.status(401).json({ error: "Non authentifié", isDev: !isProduction });
    }

    const configuredUsers = cds.env.requires.auth?.users || {};
    const userConf = configuredUsers[authUser] || {};

    const assignedRoles = [];
    if (userConf.roles) {
      if (Array.isArray(userConf.roles)) {
        assignedRoles.push(...userConf.roles);
      } else if (typeof userConf.roles === "object") {
        assignedRoles.push(...Object.keys(userConf.roles));
      }
    }

    let roleLabel = "Utilisateur";
    for (const [r, label] of Object.entries(ROLE_LABELS)) {
      if (assignedRoles.includes(r)) {
        roleLabel = label;
        break;
      }
    }
    if (roleLabel === "Utilisateur" && assignedRoles.includes("Admin")) {
      roleLabel = "Administrateur";
    }

    res.json({
      id: authUser,
      roles: assignedRoles,
      roleLabel,
      isDev: !isProduction,
    });
  });

  // ── GET /logout ───────────────────────────────────────────────────────────
  app.get("/logout", (req, res) => {
    res.setHeader(
      "Set-Cookie",
      "ptp_auth=logout; Path=/; SameSite=Lax; Max-Age=86400"
    );

    // Si de nouveaux identifiants valides sont passés :
    const authHeader = req.headers.authorization;
    if (authHeader?.match(/^basic/i)) {
      const [id, pwd] = Buffer.from(authHeader.slice(6), "base64").toString().split(":");
      const configuredUsers = cds.env.requires.auth?.users || {};
      const userConf = configuredUsers[id];
      const fromUser = req.query.from;
      if (userConf && userConf.password === pwd && (!fromUser || id !== fromUser)) {
        const token = Buffer.from(`${id}:${pwd}`).toString("base64");
        res.setHeader("Set-Cookie", `ptp_auth=${token}; Path=/; SameSite=Lax; Max-Age=86400`);
        const returnUrl = req.query.returnUrl || "/";
        return res.redirect(302, isSafeReturnUrl(returnUrl) ? returnUrl : "/");
      }
    }

    // Réinitialisation explicite Basic Auth natif si demandée
    if (req.query.native === "1") {
      res.status(401);
      res.setHeader("WWW-Authenticate", 'Basic realm="SAP Procure-to-Pay"');
      return res.send("Session Basic réinitialisée");
    }

    // Page de confirmation moderne avec redirection vers l'accueil
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

  // ── GET /login ───────────────────────────────────────────────────────────
  app.get("/login", (req, res) => {
    const raw = req.query.returnUrl;
    const safeUrl = isSafeReturnUrl(raw) ? raw : "/";
    res.redirect(302, safeUrl);
  });
});

cds.on("served", () => {
  console.log("[server.js] Routes /me, /api/login, /api/logout, /logout, /login actives.");
});

export default cds.server;
