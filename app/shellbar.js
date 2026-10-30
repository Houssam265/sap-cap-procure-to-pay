/**
 * shellbar.js — Barre de navigation supérieure premium & sélecteur d'utilisateur
 * Déployée sur toutes les applications Fiori Elements de Procure-to-Pay.
 */
(function () {
  "use strict";

  // Profils préconfigurés pour la démonstration
  var PROFILES = [
    {
      id: "alice",
      name: "Alice Martin",
      role: "Demandeur",
      roleTech: "Requester",
      avatarBg: "linear-gradient(135deg, #0ea5e9, #0284c7)",
      desc: "Création, modification et soumission de ses demandes d'achat.",
      initial: "A",
    },
    {
      id: "bob",
      name: "Bob Bernard",
      role: "Manager",
      roleTech: "Manager",
      avatarBg: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
      desc: "Approbation / refus des demandes et génération des commandes.",
      initial: "B",
    },
    {
      id: "carol",
      name: "Carol Magasinière",
      role: "Magasinier",
      roleTech: "Warehouse",
      avatarBg: "linear-gradient(135deg, #f59e0b, #d97706)",
      desc: "Réception des marchandises et consultation des stocks.",
      initial: "C",
    },
    {
      id: "dave",
      name: "Dave Demandeur 2",
      role: "Demandeur",
      roleTech: "Requester",
      avatarBg: "linear-gradient(135deg, #06b6d4, #0891b2)",
      desc: "Second demandeur (vérification du cloisonnement des données).",
      initial: "D",
    },
    {
      id: "admin",
      name: "Admin Système",
      role: "Administrateur",
      roleTech: "Admin",
      avatarBg: "linear-gradient(135deg, #10b981, #059669)",
      desc: "Supervision technique et accès transversal complet.",
      initial: "★",
    },
  ];

  var currentUser = null;
  var _isDev = false; // mis à jour via /api/auth-mode au démarrage

  // ── 1. STYLES CSS DU HEADER & DU MODAL ──────────────────────────────────────
  var css = [
    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap');",
    "",
    "/* Header fixe premium */",
    "#ptp-shell {",
    "  position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 999999;",
    "  display: flex; align-items: center; justify-content: space-between;",
    "  padding: 0 18px; gap: 14px;",
    "  background: rgba(11, 18, 36, 0.94);",
    "  backdrop-filter: blur(20px) saturate(180%);",
    "  -webkit-backdrop-filter: blur(20px) saturate(180%);",
    "  border-bottom: 1px solid rgba(255, 255, 255, 0.10);",
    "  box-shadow: 0 4px 24px -2px rgba(0, 0, 0, 0.45);",
    "  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
    "  color: #f1f5f9; box-sizing: border-box;",
    "}",
    "",
    "#ptp-shell * { box-sizing: border-box; }",
    "",
    "/* Groupes gauche et droite */",
    ".ptp-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }",
    ".ptp-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }",
    "",
    "/* Badge SAP */",
    ".ptp-sap-badge {",
    "  background: linear-gradient(135deg, #0a6ed1, #0051b3);",
    "  color: #ffffff; font-weight: 800; font-size: 11px; letter-spacing: 0.08em;",
    "  padding: 4px 8px; border-radius: 6px;",
    "  box-shadow: 0 2px 10px rgba(10, 110, 209, 0.45);",
    "  display: inline-flex; align-items: center; user-select: none;",
    "}",
    "",
    "/* Boutons d'action standards du header */",
    ".ptp-nav-btn {",
    "  background: rgba(255, 255, 255, 0.06);",
    "  border: 1px solid rgba(255, 255, 255, 0.12);",
    "  color: #f1f5f9; text-decoration: none;",
    "  padding: 6px 12px; border-radius: 6px;",
    "  font-size: 12px; font-weight: 500; cursor: pointer;",
    "  display: inline-flex; align-items: center; gap: 6px; line-height: 1;",
    "  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);",
    "  white-space: nowrap; user-select: none;",
    "}",
    ".ptp-nav-btn:hover {",
    "  background: rgba(255, 255, 255, 0.14);",
    "  border-color: rgba(255, 255, 255, 0.25);",
    "  color: #ffffff; transform: translateY(-1px);",
    "}",
    ".ptp-nav-btn:active { transform: translateY(0); }",
    "",
    "/* Séparateur vertical */",
    ".ptp-divider {",
    "  width: 1px; height: 18px; background: rgba(255, 255, 255, 0.15); margin: 0 2px;",
    "}",
    "",
    "/* Titre de l'application */",
    ".ptp-app-title-group {",
    "  display: flex; align-items: center; gap: 8px; min-width: 0;",
    "}",
    ".ptp-app-title {",
    "  font-weight: 600; font-size: 14px; color: #ffffff; letter-spacing: -0.01em;",
    "  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;",
    "}",
    ".ptp-tag-v4 {",
    "  font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600;",
    "  color: #38bdf8; background: rgba(56, 189, 248, 0.12);",
    "  border: 1px solid rgba(56, 189, 248, 0.28);",
    "  padding: 2px 6px; border-radius: 4px; letter-spacing: 0.02em;",
    "}",
    "",
    "/* Capsule utilisateur cliquable */",
    ".ptp-user-capsule {",
    "  background: rgba(255, 255, 255, 0.06);",
    "  border: 1px solid rgba(255, 255, 255, 0.14);",
    "  border-radius: 24px; padding: 3px 12px 3px 4px;",
    "  display: inline-flex; align-items: center; gap: 8px;",
    "  cursor: pointer; transition: all 0.2s;",
    "  user-select: none;",
    "}",
    ".ptp-user-capsule:hover {",
    "  background: rgba(255, 255, 255, 0.12);",
    "  border-color: rgba(56, 189, 248, 0.4);",
    "}",
    ".ptp-avatar {",
    "  width: 26px; height: 26px; border-radius: 50%;",
    "  display: flex; align-items: center; justify-content: center;",
    "  color: #ffffff; font-weight: 700; font-size: 12px;",
    "  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);",
    "}",
    ".ptp-username { font-weight: 600; font-size: 13px; color: #f8fafc; }",
    ".ptp-role-pill {",
    "  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px;",
    "  background: rgba(255, 255, 255, 0.15); color: #e2e8f0;",
    "}",
    "",
    "/* Bouton Changer principal */",
    ".ptp-switch-btn {",
    "  background: linear-gradient(135deg, rgba(0, 112, 243, 0.25), rgba(10, 110, 209, 0.35));",
    "  border: 1px solid rgba(56, 189, 248, 0.45);",
    "  color: #e0f2fe; padding: 6px 14px; border-radius: 6px;",
    "  font-size: 12px; font-weight: 600; cursor: pointer;",
    "  display: inline-flex; align-items: center; gap: 6px;",
    "  box-shadow: 0 2px 10px rgba(0, 112, 243, 0.25);",
    "  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);",
    "  white-space: nowrap; user-select: none;",
    "}",
    ".ptp-switch-btn:hover {",
    "  background: linear-gradient(135deg, #0070f3, #0051b3);",
    "  color: #ffffff; border-color: #38bdf8;",
    "  box-shadow: 0 4px 16px rgba(0, 112, 243, 0.55);",
    "  transform: translateY(-1px);",
    "}",
    "",
    "/* Réserve 48px pour l'app UI5 sans décalage indésirable */",
    "body.sapUiBody { padding-top: 48px !important; box-sizing: border-box !important; }",
    "",
    "/* ── 2. MODAL DU SÉLECTEUR D'UTILISATEUR ───────────────────────────────── */",
    "#ptp-modal-overlay {",
    "  position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 1000000;",
    "  background: rgba(4, 8, 18, 0.75);",
    "  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);",
    "  display: none; align-items: center; justify-content: center; padding: 16px;",
    "  animation: ptpFadeIn 0.2s ease-out;",
    "}",
    "@keyframes ptpFadeIn { from { opacity: 0; } to { opacity: 1; } }",
    "",
    ".ptp-modal-card {",
    "  background: #0d1527;",
    "  border: 1px solid rgba(255, 255, 255, 0.14);",
    "  border-radius: 16px; width: 520px; max-width: 95vw;",
    "  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 30px rgba(14, 165, 233, 0.15);",
    "  overflow: hidden; display: flex; flex-direction: column;",
    "  font-family: 'Inter', sans-serif; color: #f1f5f9;",
    "  animation: ptpSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);",
    "}",
    "@keyframes ptpSlideUp { from { transform: translateY(16px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }",
    "",
    ".ptp-modal-header {",
    "  padding: 20px 24px 16px; display: flex; justify-content: space-between; align-items: center;",
    "  border-bottom: 1px solid rgba(255, 255, 255, 0.08);",
    "}",
    ".ptp-modal-title { font-size: 17px; font-weight: 700; color: #ffffff; display: flex; align-items: center; gap: 8px; }",
    ".ptp-modal-close {",
    "  background: rgba(255, 255, 255, 0.06); border: none; color: #94a3b8;",
    "  width: 32px; height: 32px; border-radius: 50%; font-size: 16px;",
    "  cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;",
    "}",
    ".ptp-modal-close:hover { background: rgba(255, 255, 255, 0.15); color: #ffffff; }",
    "",
    ".ptp-modal-body { padding: 20px 24px; max-height: 70vh; overflow-y: auto; }",
    ".ptp-modal-desc { font-size: 13px; color: #94a3b8; margin-bottom: 16px; line-height: 1.5; }",
    "",
    "/* Grille des profils 1-clic */",
    ".ptp-profiles-grid { display: flex; flex-direction: column; gap: 10px; }",
    ".ptp-profile-item {",
    "  display: flex; align-items: center; justify-content: space-between; padding: 12px 14px;",
    "  background: rgba(22, 33, 56, 0.6); border: 1px solid rgba(255, 255, 255, 0.08);",
    "  border-radius: 10px; cursor: pointer; transition: all 0.2s;",
    "}",
    ".ptp-profile-item:hover {",
    "  background: rgba(30, 47, 82, 0.85); border-color: rgba(56, 189, 248, 0.45);",
    "  transform: translateX(3px);",
    "}",
    ".ptp-profile-item.active {",
    "  background: rgba(14, 165, 233, 0.12); border-color: rgba(14, 165, 233, 0.5);",
    "}",
    ".ptp-profile-left { display: flex; align-items: center; gap: 12px; }",
    ".ptp-p-avatar {",
    "  width: 38px; height: 38px; border-radius: 50%;",
    "  display: flex; align-items: center; justify-content: center;",
    "  font-weight: 700; font-size: 15px; color: #ffffff; flex-shrink: 0;",
    "}",
    ".ptp-p-info { display: flex; flex-direction: column; gap: 2px; }",
    ".ptp-p-name { font-size: 14px; font-weight: 600; color: #ffffff; }",
    ".ptp-p-desc { font-size: 11px; color: #94a3b8; max-width: 300px; }",
    ".ptp-p-badge {",
    "  font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 12px;",
    "  background: rgba(255, 255, 255, 0.08); color: #38bdf8;",
    "  border: 1px solid rgba(56, 189, 248, 0.25); white-space: nowrap;",
    "}",
    ".ptp-active-tag {",
    "  font-size: 10px; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.15);",
    "  padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;",
    "}",
    "",
    "/* Section formulaire manuel */",
    ".ptp-manual-toggle {",
    "  margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.08);",
    "  display: flex; justify-content: space-between; align-items: center;",
    "}",
    ".ptp-link-btn {",
    "  background: transparent; border: none; color: #38bdf8; font-size: 12px;",
    "  cursor: pointer; text-decoration: underline; padding: 0;",
    "}",
    ".ptp-link-btn:hover { color: #7dd3fc; }",
    ".ptp-manual-form { display: none; margin-top: 14px; gap: 10px; flex-direction: column; }",
    ".ptp-input-row { display: flex; gap: 10px; }",
    ".ptp-input {",
    "  flex: 1; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.15);",
    "  border-radius: 6px; padding: 8px 12px; font-size: 13px; color: #ffffff; outline: none;",
    "}",
    ".ptp-input:focus { border-color: #0070f3; box-shadow: 0 0 0 2px rgba(0, 112, 243, 0.25); }",
    ".ptp-submit-btn {",
    "  background: #0070f3; border: none; color: #ffffff; padding: 8px 16px;",
    "  border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;",
    "  transition: background 0.15s;",
    "}",
    ".ptp-submit-btn:hover { background: #0051b3; }",
    "",
    "/* Toast / message d'état */",
    "#ptp-toast {",
    "  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);",
    "  background: #0f172a; border: 1px solid rgba(56, 189, 248, 0.4);",
    "  color: #ffffff; padding: 10px 20px; border-radius: 30px;",
    "  font-size: 13px; font-weight: 500; z-index: 1000001; display: none;",
    "  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5); align-items: center; gap: 8px;",
    "}"
  ].join("\n");

  var style = document.createElement("style");
  style.type = "text/css";
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);

  // ── 2. FONCTION DE CONNEXION SÉCURISÉE (1-CLIC) ──────────────────────────────
  window.ptpSwitchToUser = function (username, password) {
    showToast("⏳ Connexion en tant que " + username + "...");
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password || username }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Identifiant ou mot de passe incorrect.");
          return data;
        });
      })
      .then(function (data) {
        showToast("✓ Connecté : " + data.user.id + " (" + data.user.roleLabel + ")");
        setTimeout(function () {
          window.location.reload();
        }, 300);
      })
      .catch(function (err) {
        showToast("⚠ " + err.message);
      });
  };

  var isLoginRequired = false;

  // ── 3. DÉCONNEXION COMPLÈTE ────────────────────────────────────────────────
  // POST /api/logout invalide le cookie, puis /logout affiche la page de
  // confirmation et redirige vers l'accueil ─ ce qui force la saisie
  // d'identifiants si la session n'est plus valide.
  window.ptpFullLogout = function () {
    showToast("Déconnexion en cours...");
    fetch("/api/logout", { method: "POST" })
      .finally(function () {
        window.location.href = "/logout";
      });
  };

  // ── 4. NAVIGATION RETOUR INTELLIGENTE ───────────────────────────────────────
  window.ptpBack = function () {
    var hash = window.location.hash;
    if (hash && hash !== "#" && hash !== "#/") {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.hash = "";
      }
    } else {
      showToast("ℹ Vous êtes déjà sur la liste principale de l'application.");
    }
  };

  // ── 5. OUVERTURE / FERMETURE DU MODAL ──────────────────────────────────────
  window.ptpOpenModal = function (required) {
    isLoginRequired = !!required;
    var modal = document.getElementById("ptp-modal-overlay");
    if (modal) {
      modal.style.display = "flex";
      var titleEl = document.getElementById("ptp-modal-title-text");
      var descEl = document.getElementById("ptp-modal-desc-text");
      var closeBtn = document.getElementById("ptp-modal-close-btn");
      var demoBadge = document.getElementById("ptp-demo-badge");
      if (titleEl) {
        titleEl.textContent = isLoginRequired ? "🔒 Connexion requise" : "👥 Changer d'utilisateur";
      }
      if (descEl) {
        descEl.textContent = isLoginRequired
          ? "Veuillez vous connecter pour accéder à cette application :"
          : "Sélectionnez un compte du mode démo pour basculer instantanément :";
      }
      if (closeBtn) {
        closeBtn.title = isLoginRequired ? "Retour au portail d'accueil" : "Fermer";
      }
      // Afficher ou masquer le badge Mode démo et la grille selon le profil
      var grid = document.getElementById("ptp-profiles-grid");
      var demoBadgeWrap = document.getElementById("ptp-demo-badge-wrap");
      if (_isDev) {
        if (demoBadgeWrap) demoBadgeWrap.style.display = "flex";
        if (grid) grid.style.display = "flex";
        renderProfilesList();
      } else {
        if (demoBadgeWrap) demoBadgeWrap.style.display = "none";
        if (grid) grid.style.display = "none";
      }
    }
  };

  window.ptpCloseModal = function () {
    if (isLoginRequired) {
      window.location.href = "/";
      return;
    }
    var modal = document.getElementById("ptp-modal-overlay");
    if (modal) modal.style.display = "none";
  };

  function showToast(msg) {
    var toast = document.getElementById("ptp-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ptp-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = "flex";
    setTimeout(function () {
      toast.style.display = "none";
    }, 2500);
  }

  // ── 6. CONSTRUCTION DU DOM ────────────────────────────────────────────────
  function init() {
    if (document.getElementById("ptp-shell")) return;

    var appTitle = document.body.getAttribute("data-app-title") || "Procure-to-Pay";

    // ── Header fixe ───────────────────────────────────────────
    var header = document.createElement("header");
    header.id = "ptp-shell";
    header.setAttribute("role", "banner");
    header.innerHTML = [
      '<div class="ptp-left">',
      '  <span class="ptp-sap-badge">SAP</span>',
      '  <a href="/" class="ptp-nav-btn" title="Retour au portail d\'accueil">🏠 Accueil</a>',
      '  <button type="button" class="ptp-nav-btn" onclick="ptpBack()" title="Page précédente">⬅ Retour</button>',
      '  <div class="ptp-divider"></div>',
      '  <div class="ptp-app-title-group">',
      '    <span class="ptp-app-title">' + escapeHtml(appTitle) + '</span>',
      '    <span class="ptp-tag-v4">Fiori V4</span>',
      '  </div>',
      '</div>',
      '<div class="ptp-right">',
      '  <div class="ptp-user-capsule" id="ptp-user-capsule" onclick="ptpOpenModal()" title="Cliquer pour changer de profil">',
      '    <div class="ptp-avatar" id="ptp-avatar" style="background:#0a6ed1;">?</div>',
      '    <span class="ptp-username" id="ptp-username">Chargement...</span>',
      '    <span class="ptp-role-pill" id="ptp-role-pill" style="display:none;"></span>',
      '  </div>',
      '  <button type="button" class="ptp-switch-btn" id="ptp-switch-btn" onclick="ptpOpenModal()" title="Changer d\'utilisateur" style="display:none;">',
      '    🔄 Changer',
      '  </button>',
      '</div>',
    ].join("");

    document.body.insertBefore(header, document.body.firstChild);

    // ── Modal de changement d'utilisateur ─────────────────────
    var overlay = document.createElement("div");
    overlay.id = "ptp-modal-overlay";
    overlay.onclick = function (e) {
      if (e.target === overlay) ptpCloseModal();
    };

    overlay.innerHTML = [
      '<div class="ptp-modal-card">',
      '  <div class="ptp-modal-header">',
      '    <div class="ptp-modal-title" id="ptp-modal-title-text">👥 Changer d\'utilisateur</div>',
      '    <button type="button" class="ptp-modal-close" id="ptp-modal-close-btn" onclick="ptpCloseModal()" title="Fermer">✕</button>',
      '  </div>',
      '  <div class="ptp-modal-body">',
      '    <p class="ptp-modal-desc" id="ptp-modal-desc-text">Sélectionnez un compte du mode démo pour basculer instantanément :</p>',
      '    <!-- Badge Mode démo : uniquement affiché si isDev=true -->',
      '    <div id="ptp-demo-badge-wrap" style="display:none;margin-bottom:14px;padding:8px 12px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);border-radius:8px;align-items:center;gap:8px;">',
      '      <span style="font-size:15px;">⚗️</span>',
      '      <span style="font-size:12px;font-weight:600;color:#fbbf24;">Mode démo</span>',
      '      <span style="font-size:11px;color:#94a3b8;">— comptes fictifs, développement uniquement. Absent en production.</span>',
      '    </div>',
      '    <div class="ptp-profiles-grid" id="ptp-profiles-grid" style="display:none;"></div>',
      '    <div class="ptp-manual-toggle">',
      '      <button type="button" class="ptp-link-btn" onclick="toggleManualForm()" id="ptp-real-login-btn">Se connecter avec un autre compte</button>',
      '      <button type="button" class="ptp-link-btn" style="color:#ef4444;" onclick="ptpFullLogout()">Se déconnecter</button>',
      '    </div>',
      '    <form class="ptp-manual-form" id="ptp-manual-form" onsubmit="handleManualLogin(event)">',
      '      <div class="ptp-input-row">',
      '        <input type="text" id="ptp-input-user" class="ptp-input" placeholder="Identifiant" autocomplete="username" required />',
      '        <input type="password" id="ptp-input-pass" class="ptp-input" placeholder="Mot de passe" autocomplete="current-password" required />',
      '      </div>',
      '      <button type="submit" class="ptp-submit-btn">Connexion</button>',
      '    </form>',
      '  </div>',
      '</div>',
    ].join("");

    document.body.appendChild(overlay);

    // Fermeture avec la touche Échap
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") ptpCloseModal();
    });

    // ── Lecture du mode (dev/prod) puis chargement de l'utilisateur ──
    fetch("/api/auth-mode", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : { isDev: false }; })
      .catch(function () { return { isDev: false }; })
      .then(function (data) {
        _isDev = !!data.isDev;
        // Afficher ou masquer le bouton "Changer" dans le header
        var switchBtn = document.getElementById("ptp-switch-btn");
        if (switchBtn) {
          switchBtn.style.display = _isDev ? "inline-flex" : "none";
        }
        // La capsule utilisateur reste toujours visible (affiche le compte courant)
        // mais n'ouvre la grille mock qu'en dev
        loadCurrentUser();
      });
  }

  function loadCurrentUser() {
    fetch("/me", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        currentUser = data;
        updateHeaderUser(data);
      })
      .catch(function () {
        currentUser = null;
        var nameEl = document.getElementById("ptp-username");
        var roleEl = document.getElementById("ptp-role-pill");
        var avatarEl = document.getElementById("ptp-avatar");
        if (nameEl) nameEl.textContent = "Non connecté";
        if (roleEl) roleEl.style.display = "none";
        if (avatarEl) {
          avatarEl.textContent = "🔒";
          avatarEl.style.background = "#475569";
        }
        // Utilisateur déconnecté : ouvrir automatiquement le modal de connexion pour exiger l'authentification
        ptpOpenModal(true);
      });
  }

  function updateHeaderUser(user) {
    var nameEl = document.getElementById("ptp-username");
    var roleEl = document.getElementById("ptp-role-pill");
    var avatarEl = document.getElementById("ptp-avatar");

    if (!user || !user.id) return;

    if (nameEl) nameEl.textContent = user.id;
    if (roleEl) {
      roleEl.textContent = user.roleLabel || "Utilisateur";
      roleEl.style.display = "inline-block";
    }

    // Trouver le profil correspondant pour l'avatar
    var prof = PROFILES.find(function (p) {
      return p.id.toLowerCase() === user.id.toLowerCase();
    });

    if (avatarEl) {
      if (prof) {
        avatarEl.textContent = prof.initial;
        avatarEl.style.background = prof.avatarBg;
      } else {
        avatarEl.textContent = user.id.charAt(0).toUpperCase();
        avatarEl.style.background = "linear-gradient(135deg, #0ea5e9, #0284c7)";
      }
    }
  }

  function renderProfilesList() {
    var grid = document.getElementById("ptp-profiles-grid");
    if (!grid) return;

    var curId = (currentUser && currentUser.id) ? currentUser.id.toLowerCase() : "";

    grid.innerHTML = PROFILES.map(function (p) {
      var isActive = (p.id.toLowerCase() === curId);
      return [
        '<div class="ptp-profile-item' + (isActive ? ' active' : '') + '" onclick="ptpSwitchToUser(\'' + p.id + '\', \'' + p.id + '\')">',
        '  <div class="ptp-profile-left">',
        '    <div class="ptp-p-avatar" style="background:' + p.avatarBg + ';">' + p.initial + '</div>',
        '    <div class="ptp-p-info">',
        '      <div class="ptp-p-name">' + p.name + ' (' + p.id + ') ' + (isActive ? '<span class="ptp-active-tag">● Actuel</span>' : '') + '</div>',
        '      <div class="ptp-p-desc">' + p.desc + '</div>',
        '    </div>',
        '  </div>',
        '  <span class="ptp-p-badge">' + p.role + '</span>',
        '</div>',
      ].join("");
    }).join("");
  }

  window.toggleManualForm = function () {
    var form = document.getElementById("ptp-manual-form");
    if (form) {
      form.style.display = (form.style.display === "flex") ? "none" : "flex";
    }
  };

  window.handleManualLogin = function (e) {
    e.preventDefault();
    var u = document.getElementById("ptp-input-user").value.trim();
    var p = document.getElementById("ptp-input-pass").value;
    if (u && p) {
      ptpSwitchToUser(u, p);
    }
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
