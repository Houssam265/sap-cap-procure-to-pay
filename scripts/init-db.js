#!/usr/bin/env node
/**
 * scripts/init-db.js
 *
 * Déploiement idempotent du schéma de base de données (PostgreSQL ou SQLite)
 * et chargement conditionnel des données initiales (CSV).
 *
 * Garantie d'idempotence & Résilience :
 *   1. Vérifie la joignabilité de PostgreSQL avec un nombre limité de tentatives.
 *   2. En cas de base injoignable (échec fermé voulu en production isolée) :
 *      affiche un message explicite sans pile d'erreur technique et s'arrête.
 *   3. Déploie le schéma DDL (tables, contraintes, vues) via cds.deploy.schema.
 *   4. Vérifie si la table des produits (pt.Products) contient déjà des données.
 *   5. Si la base est vierge : charge les CSV (pt-Products, pt-Suppliers).
 *   6. Si la base contient déjà des enregistrements : ignore le chargement CSV,
 *      garantissant qu'aucun redémarrage ne réinitialise les stocks, commandes
 *      ou réceptions existantes.
 *   7. Optionnel : PTP_FORCE_SEED=true force le rechargement si demandé explicitement.
 */

import cds from "@sap/cds";

async function initDb() {
  console.log("[init-db] ----------------------------------------------------");
  console.log("[init-db] Initialisation de la base de données Procure-to-Pay");
  console.log("[init-db] ----------------------------------------------------");

  const dbKind = process.env.CDS_REQUIRES_DB_KIND || cds.env.requires?.db?.kind || "sqlite";
  console.log(`[init-db] Cible : ${dbKind}`);

  const host = process.env.CDS_REQUIRES_DB_CREDENTIALS_HOST || cds.env.requires?.db?.credentials?.host || "localhost";
  const port = process.env.CDS_REQUIRES_DB_CREDENTIALS_PORT || cds.env.requires?.db?.credentials?.port || "5432";

  const maxRetries = parseInt(process.env.PTP_DB_MAX_RETRIES || "3", 10);
  const retryDelayMs = parseInt(process.env.PTP_DB_RETRY_DELAY_MS || "2000", 10);

  let db = null;
  let connected = false;

  // 1. Connexion résiliente avec tentatives limitées pour PostgreSQL
  if (dbKind === "postgres") {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[init-db] Tentative de connexion à PostgreSQL (${host}:${port}) [${attempt}/${maxRetries}]...`);
        db = await cds.connect.to("db");
        await db.run("SELECT 1");
        connected = true;
        console.log("[init-db] [OK] Connexion a PostgreSQL etablie avec succes.");
        break;
      } catch (err) {
        const isConnError =
          err.code === "ECONNREFUSED" ||
          err.code === "ETIMEDOUT" ||
          err.code === "ENOTFOUND" ||
          (err.message &&
            (err.message.includes("ECONNREFUSED") ||
              err.message.includes("Connection error") ||
              err.message.includes("connect")));

        if (isConnError && attempt < maxRetries) {
          console.log(
            `[init-db] [WAIT] PostgreSQL injoignable (tentative ${attempt}/${maxRetries}). Nouvelle tentative dans ${retryDelayMs / 1000}s...`
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        } else if (!isConnError) {
          throw err;
        }
      }
    }

    if (!connected) {
      console.error(
        `\n[init-db] [ERREUR] PostgreSQL injoignable a ${host}:${port} apres ${maxRetries} tentative(s) : ` +
          "verifiez les variables CDS_REQUIRES_DB_* ou lancez l'application avec docker compose up.\n"
      );
      process.exit(1);
    }
  } else {
    db = await cds.connect.to("db");
  }

  // 2. Chargement du modèle CDS (inclut l'outbox uniquement si la file est activée)
  const hasQueue = Boolean(cds.env.requires?.queue);
  const modelSources = hasQueue ? ["db", "srv", "@sap/cds/srv/outbox"] : ["db", "srv"];
  const model = await cds.load(modelSources);

  // 3. Déploiement DDL du schéma (tables, index, vues)
  console.log("[init-db] Déploiement du schéma DDL en cours...");
  await cds.deploy.schema(db, model, {});
  console.log("[init-db] [OK] Schema DDL deploye avec succes.");

  // 4. Vérification d'idempotence sur les données existantes
  const hasData = await db
    .run(SELECT.one.from("pt.Products").columns("ID"))
    .then((existing) => Boolean(existing))
    .catch(() => false);

  const forceSeed = process.env.PTP_FORCE_SEED === "true";

  if (!hasData || forceSeed) {
    console.log("[init-db] Base vide (ou PTP_FORCE_SEED=true) : chargement des données CSV...");
    await cds.deploy.data(db, model);
    console.log("[init-db] [OK] Donnees de demonstration chargees avec succes.");
  } else {
    console.log("[init-db] [INFO] Donnees existantes detectees dans la base : chargement CSV ignore.");
    console.log("[init-db] [OK] Les stocks, commandes et receptions sont preserves a l'identique.");
  }

  console.log("[init-db] ----------------------------------------------------");
  console.log("[init-db] Initialisation terminée avec succès.");
  console.log("[init-db] ----------------------------------------------------");
}

initDb()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("[init-db] [ERREUR] Echec inattendu de l'initialisation :", err.message || err);
    process.exit(1);
  });
