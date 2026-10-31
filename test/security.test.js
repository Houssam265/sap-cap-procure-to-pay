import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import cds from "@sap/cds";
import { authAlice, authCarol, authDave, authAdmin, expectStatus, LAPTOP_ID } from "./helpers.js";

const { GET, POST, PATCH, DELETE, data } = cds.test(".");

describe("Security, Role Permissions & Validations", () => {
  beforeEach(async () => {
    await data.reset();
  });

  describe("1. Authentification & Permissions par rôle", () => {
    it("1.1 Requête anonyme sans credentials -> 401", async () => {
      await expectStatus(GET("/odata/v4/procurement/PurchaseRequests"), 401);
    });

    it("1.2 Requête avec mot de passe erroné -> 401", async () => {
      const badAuth = { auth: { username: "alice", password: "mauvais_password" } };
      await expectStatus(GET("/odata/v4/procurement/PurchaseRequests", badAuth), 401);
    });

    it("1.3 Requester (Alice) ne peut pas accéder aux commandes d'achat -> 403", async () => {
      await expectStatus(GET("/odata/v4/procurement/PurchaseOrders", authAlice), 403);
    });

    it("1.4 Requester (Alice) ne peut pas créer directement de commande -> 405 ou 403", async () => {
      const directPo = {
        number: "PO-HACK",
        supplier_ID: "11111111-1111-1111-1111-111111111111",
        totalAmount: 500
      };
      try {
        const res = await POST("/odata/v4/procurement/PurchaseOrders", directPo, authAlice);
        assert.fail(`Attendu 403 ou 405, reçu ${res.status}`);
      } catch (err) {
        const code = err.status || err.response?.status;
        assert.ok(code === 403 || code === 405, `Code attendu 403 ou 405, reçu: ${code}`);
      }
    });

    it("1.5 Requester (Alice) ne peut pas approuver sa propre demande -> 403", async () => {
      const pr = await expectStatus(
        POST(
          "/odata/v4/procurement/PurchaseRequests",
          {
            description: "Demande test rôle",
            items: [{ product_ID: LAPTOP_ID, quantity: 1 }]
          },
          authAlice
        ),
        201
      );
      await expectStatus(POST(`/odata/v4/procurement/PurchaseRequests(ID=${pr.data.ID})/approve`, {}, authAlice), 403);
    });

    it("1.6 Warehouse (Carol) ne peut pas créer de demande d'achat -> 403", async () => {
      await expectStatus(
        POST(
          "/odata/v4/procurement/PurchaseRequests",
          {
            description: "Demande par magasinier",
            items: [{ product_ID: LAPTOP_ID, quantity: 1 }]
          },
          authCarol
        ),
        403
      );
    });
  });

  describe("2. Isolation stricte entre demandeurs (Ownership)", () => {
    it("2.1 Dave ne peut ni lire, ni modifier, ni soumettre, ni supprimer les demandes d'Alice", async () => {
      // Alice crée sa demande
      const pr = await expectStatus(
        POST(
          "/odata/v4/procurement/PurchaseRequests",
          {
            description: "Demande confidentielle d'Alice",
            items: [{ product_ID: LAPTOP_ID, quantity: 2 }]
          },
          authAlice
        ),
        201
      );
      const prId = pr.data.ID;

      // Dave tente de lire la demande d'Alice -> 403 ou 404 (non trouvé dans son scope)
      try {
        const getRes = await GET(`/odata/v4/procurement/PurchaseRequests(ID=${prId})`, authDave);
        assert.fail(`Dave ne doit pas pouvoir lire la demande d'Alice (reçu ${getRes.status})`);
      } catch (err) {
        const code = err.status || err.response?.status;
        assert.ok(code === 403 || code === 404, `Code attendu 403 ou 404, reçu: ${code}`);
      }

      // Dave tente de soumettre la demande d'Alice -> 403 ou 404
      try {
        const subRes = await POST(`/odata/v4/procurement/PurchaseRequests(ID=${prId})/submit`, {}, authDave);
        assert.fail(`Dave ne doit pas pouvoir soumettre la demande d'Alice (reçu ${subRes.status})`);
      } catch (err) {
        const code = err.status || err.response?.status;
        assert.ok(code === 403 || code === 404, `Code attendu 403 ou 404, reçu: ${code}`);
      }

      // Dave tente de modifier la demande d'Alice -> 403 ou 404
      try {
        const patchRes = await PATCH(
          `/odata/v4/procurement/PurchaseRequests(ID=${prId})`,
          { description: "Altération par Dave" },
          authDave
        );
        assert.fail(`Dave ne doit pas pouvoir modifier la demande d'Alice (reçu ${patchRes.status})`);
      } catch (err) {
        const code = err.status || err.response?.status;
        assert.ok(code === 403 || code === 404, `Code attendu 403 ou 404, reçu: ${code}`);
      }

      // Dave tente de supprimer la demande d'Alice -> 403 ou 404
      try {
        const delRes = await DELETE(`/odata/v4/procurement/PurchaseRequests(ID=${prId})`, authDave);
        assert.fail(`Dave ne doit pas pouvoir supprimer la demande d'Alice (reçu ${delRes.status})`);
      } catch (err) {
        const code = err.status || err.response?.status;
        assert.ok(code === 403 || code === 404, `Code attendu 403 ou 404, reçu: ${code}`);
      }
    });
  });

  describe("3. Validations d'intégrité et contraintes de saisie", () => {
    it("3.1 Format email invalide sur fournisseur (@assert.format) -> 400", async () => {
      const badSupplier = { name: "Fournisseur Test", email: "adresse-sans-arobase" };
      await expectStatus(POST("/odata/v4/procurement/Suppliers", badSupplier, authAdmin), 400);
    });

    it("3.2 Quantité négative ou nulle sur article (@assert.range) -> 400", async () => {
      const badQtyPr = {
        description: "Demande quantité invalide",
        items: [{ product_ID: LAPTOP_ID, quantity: -3 }]
      };
      await expectStatus(POST("/odata/v4/procurement/PurchaseRequests", badQtyPr, authAlice), 400);

      const zeroQtyPr = {
        description: "Demande quantité zéro",
        items: [{ product_ID: LAPTOP_ID, quantity: 0 }]
      };
      await expectStatus(POST("/odata/v4/procurement/PurchaseRequests", zeroQtyPr, authAlice), 400);
    });

    it("3.3 Description obligatoire manquante -> 400", async () => {
      const noDescPr = {
        description: "   ",
        items: [{ product_ID: LAPTOP_ID, quantity: 1 }]
      };
      await expectStatus(POST("/odata/v4/procurement/PurchaseRequests", noDescPr, authAlice), 400);
    });

    it("3.4 Demande sans articles -> 400", async () => {
      const noItemsPr = {
        description: "Demande sans items",
        items: []
      };
      await expectStatus(POST("/odata/v4/procurement/PurchaseRequests", noItemsPr, authAlice), 400);
    });
  });
});
