import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import cds from "@sap/cds";
import { authAlice, authBob, authCarol, authAdmin, expectStatus, LAPTOP_ID, PAPER_ID } from "./helpers.js";

const { GET, POST, PATCH, DELETE, data } = cds.test(".");

describe("Procure-to-Pay Workflow & Business Rules", () => {
  beforeEach(async () => {
    await data.reset();
  });

  it("1. Création d'une demande : total automatique, numéro PR- et statut initial DRAFT", async () => {
    const payload = {
      description: "Demande équipement bureau",
      items: [
        { product_ID: LAPTOP_ID, quantity: 2 }, // 2 * 1200 = 2400
        { product_ID: PAPER_ID, quantity: 10 } // 10 * 35 = 350
      ]
    };

    const res = await expectStatus(POST("/odata/v4/procurement/PurchaseRequests", payload, authAlice), 201);
    assert.ok(res.data.ID, "L'identifiant ID doit être présent");
    assert.match(res.data.number, /^PR-\d+$/, "Le numéro doit correspondre au format PR-xxxx");
    assert.equal(res.data.status, "DRAFT", "Le statut initial doit être DRAFT");
    assert.equal(Number(res.data.totalAmount), 2750, "Le montant total doit être de 2750 MAD (2*1200 + 10*35)");
    assert.equal(res.data.currency, "MAD", "La devise par défaut doit être MAD");
  });

  it("2. Cycle complet nominal : submit -> approve -> createPurchaseOrder -> receive", async () => {
    // 2.1 Création par Alice
    const createRes = await expectStatus(
      POST(
        "/odata/v4/procurement/PurchaseRequests",
        {
          description: "Cycle nominal complet",
          items: [{ product_ID: LAPTOP_ID, quantity: 3 }]
        },
        authAlice
      ),
      201
    );
    const prId = createRes.data.ID;

    // 2.2 Soumission par Alice (DRAFT -> SUBMITTED)
    const submitRes = await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/submit`, {}, authAlice),
      200
    );
    assert.equal(submitRes.data.status, "SUBMITTED");

    // 2.3 Approbation par Bob (Manager) (SUBMITTED -> APPROVED)
    const approveRes = await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/approve`, {}, authBob),
      200
    );
    assert.equal(approveRes.data.status, "APPROVED");

    // 2.4 Génération des commandes par Bob
    const poRes = await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/createPurchaseOrder`, {}, authBob),
      200
    );
    assert.ok(poRes.data.value?.length > 0, "Au moins une commande d'achat doit être créée");
    const po = poRes.data.value[0];
    assert.match(po.number, /^PO-\d+$/);
    assert.equal(po.status, "OPEN");

    // 2.5 Réception complète par Carol (Warehouse)
    const receiveRes = await expectStatus(
      POST(`/odata/v4/procurement/PurchaseOrders(ID=${po.ID})/receive`, {}, authCarol),
      200
    );
    assert.ok(receiveRes.data.ID);
    assert.match(receiveRes.data.number, /^GR-\d+$/);

    // Vérification du statut final de la commande
    const checkPo = await expectStatus(GET(`/odata/v4/procurement/PurchaseOrders(ID=${po.ID})`, authCarol), 200);
    assert.equal(checkPo.data.status, "RECEIVED");
  });

  it("3. Transitions de statut interdites (409 Conflict)", async () => {
    // Création DRAFT
    const pr = await expectStatus(
      POST(
        "/odata/v4/procurement/PurchaseRequests",
        {
          description: "Demande test transitions",
          items: [{ product_ID: LAPTOP_ID, quantity: 1 }]
        },
        authAlice
      ),
      201
    );
    const prId = pr.data.ID;

    // Approbation directe sur DRAFT -> 409
    await expectStatus(POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/approve`, {}, authBob), 409);

    // Génération de commande sur DRAFT -> 409
    await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/createPurchaseOrder`, {}, authBob),
      409
    );

    // Soumission (DRAFT -> SUBMITTED)
    await expectStatus(POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/submit`, {}, authAlice), 200);

    // Génération de commande sur SUBMITTED (sans approbation) -> 409
    await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/createPurchaseOrder`, {}, authBob),
      409
    );

    // Modification d'une demande SUBMITTED -> 409
    await expectStatus(
      PATCH(`/odata/v4/procurement/PurchaseRequests(ID=${prId})`, { description: "Modif illicite" }, authAlice),
      409
    );

    // Suppression d'une demande SUBMITTED -> 409
    await expectStatus(DELETE(`/odata/v4/procurement/PurchaseRequests(ID=${prId})`, authAlice), 409);
  });

  it("4. Impossibilité de générer deux fois les commandes d'une même demande (409)", async () => {
    const pr = await expectStatus(
      POST(
        "/odata/v4/procurement/PurchaseRequests",
        {
          description: "Demande anti-doublon",
          items: [{ product_ID: LAPTOP_ID, quantity: 1 }]
        },
        authAlice
      ),
      201
    );
    const prId = pr.data.ID;

    await expectStatus(POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/submit`, {}, authAlice), 200);
    await expectStatus(POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/approve`, {}, authBob), 200);

    // Première génération -> 200
    await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/createPurchaseOrder`, {}, authBob),
      200
    );

    // Deuxième génération sur la même demande -> 409
    await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/createPurchaseOrder`, {}, authBob),
      409
    );
  });

  it("5. Rejet 'decline' avec et sans motif", async () => {
    const pr = await expectStatus(
      POST(
        "/odata/v4/procurement/PurchaseRequests",
        {
          description: "Demande pour test decline",
          items: [{ product_ID: LAPTOP_ID, quantity: 1 }]
        },
        authAlice
      ),
      201
    );
    const prId = pr.data.ID;

    await expectStatus(POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/submit`, {}, authAlice), 200);

    // Rejet sans motif -> 400
    await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/decline`, { reason: "   " }, authBob),
      400
    );

    // Rejet avec motif valide -> 200
    const declineRes = await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/decline`, { reason: "Budget annuel épuisé" }, authBob),
      200
    );
    assert.equal(declineRes.data.status, "REJECTED");
    assert.equal(declineRes.data.rejectionReason, "Budget annuel épuisé");
  });

  it("6. Réception partielle puis totale, mise à jour du stock et enregistrement des mouvements", async () => {
    // Lire le stock initial du produit Laptop (15 dans les données initiales)
    const prodBefore = await expectStatus(GET(`/odata/v4/procurement/Products(ID=${LAPTOP_ID})`, authAlice), 200);
    const initialStock = prodBefore.data.stock;

    // Créer et approuver une commande de 5 Laptops
    const pr = await expectStatus(
      POST(
        "/odata/v4/procurement/PurchaseRequests",
        {
          description: "Demande pour réception par étapes",
          items: [{ product_ID: LAPTOP_ID, quantity: 5 }]
        },
        authAlice
      ),
      201
    );
    const prId = pr.data.ID;

    await expectStatus(POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/submit`, {}, authAlice), 200);
    await expectStatus(POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/approve`, {}, authBob), 200);
    const poRes = await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/createPurchaseOrder`, {}, authBob),
      200
    );
    const poId = poRes.data.value[0].ID;

    // 6.1 Réception partielle : 2 sur 5
    await expectStatus(
      POST(
        `/odata/v4/procurement/PurchaseOrders(ID=${poId})/receive`,
        { items: [{ product: LAPTOP_ID, quantity: 2 }] },
        authCarol
      ),
      200
    );

    const poPart = await expectStatus(GET(`/odata/v4/procurement/PurchaseOrders(ID=${poId})`, authCarol), 200);
    assert.equal(poPart.data.status, "PARTIALLY_RECEIVED", "Le statut doit être PARTIALLY_RECEIVED");

    const prodMid = await expectStatus(GET(`/odata/v4/procurement/Products(ID=${LAPTOP_ID})`, authAlice), 200);
    assert.equal(prodMid.data.stock, initialStock + 2, "Le stock doit être incrémenté de 2");

    // 6.2 Tentative de sur-réception : restant = 3, demande de 10 -> 400
    await expectStatus(
      POST(
        `/odata/v4/procurement/PurchaseOrders(ID=${poId})/receive`,
        { items: [{ product: LAPTOP_ID, quantity: 10 }] },
        authCarol
      ),
      400
    );

    // 6.3 Réception du solde restant : 3 sur 3
    await expectStatus(
      POST(
        `/odata/v4/procurement/PurchaseOrders(ID=${poId})/receive`,
        { items: [{ product: LAPTOP_ID, quantity: 3 }] },
        authCarol
      ),
      200
    );

    const poFull = await expectStatus(GET(`/odata/v4/procurement/PurchaseOrders(ID=${poId})`, authCarol), 200);
    assert.equal(poFull.data.status, "RECEIVED", "Le statut final doit être RECEIVED");

    const prodFinal = await expectStatus(GET(`/odata/v4/procurement/Products(ID=${LAPTOP_ID})`, authAlice), 200);
    assert.equal(prodFinal.data.stock, initialStock + 5, "Le stock final doit être initialStock + 5");

    // 6.4 Vérification des mouvements de stock créés
    const mvtRes = await expectStatus(GET("/odata/v4/procurement/StockMovements", authCarol), 200);
    const laptopMvts = mvtRes.data.value.filter((m) => m.product_ID === LAPTOP_ID);
    assert.ok(laptopMvts.length >= 2, "Au moins 2 mouvements de stock doivent exister pour le produit");
    assert.ok(
      laptopMvts.every((m) => m.type === "IN"),
      "Tous les mouvements doivent être de type IN"
    );

    // 6.5 Tentative de réception sur une commande déjà terminée -> 409
    await expectStatus(
      POST(
        `/odata/v4/procurement/PurchaseOrders(ID=${poId})/receive`,
        { items: [{ product: LAPTOP_ID, quantity: 1 }] },
        authCarol
      ),
      409
    );
  });

  it("7. Interdiction de supprimer un produit référencé dans les mouvements ou commandes (409)", async () => {
    // Créer une commande et réceptionner pour lier LAPTOP_ID à des mouvements
    const pr = await expectStatus(
      POST(
        "/odata/v4/procurement/PurchaseRequests",
        {
          description: "Demande pour verrouiller produit",
          items: [{ product_ID: LAPTOP_ID, quantity: 1 }]
        },
        authAlice
      ),
      201
    );
    const prId = pr.data.ID;
    await expectStatus(POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/submit`, {}, authAlice), 200);
    await expectStatus(POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/approve`, {}, authBob), 200);
    const poRes = await expectStatus(
      POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/createPurchaseOrder`, {}, authBob),
      200
    );
    const poId = poRes.data.value[0].ID;
    await expectStatus(POST(`/odata/v4/procurement/PurchaseOrders(ID=${poId})/receive`, {}, authCarol), 200);

    // Tentative de suppression du produit par l'administrateur -> 409
    await expectStatus(DELETE(`/odata/v4/procurement/Products(ID=${LAPTOP_ID})`, authAdmin), 409);
  });
});
