import cds from "@sap/cds";

/**
 * Service ProcurementService - Gestion du cycle Procure-to-Pay
 * Étape 4 : Flux utilisateur complet, boîtes de dialogue et messages i18n
 */
export default class ProcurementService extends cds.ApplicationService {
  async init() {
    const {
      Suppliers,
      Products,
      PurchaseRequests,
      PurchaseRequestItems,
      PurchaseOrders,
      PurchaseOrderItems,
      GoodsReceipts,
      GoodsReceiptItems,
      StockMovements
    } = this.entities;

    // Helper pour générer des identifiants séquentiels lisibles (PR-1001, PO-1001, GR-1001)
    async function getNextNumber(entity, prefix) {
      const rows = await SELECT.from(entity).columns("number");
      let max = 1000;
      for (const r of rows) {
        if (r.number && r.number.startsWith(`${prefix}-`)) {
          const num = parseInt(r.number.substring(prefix.length + 1), 10);
          if (!isNaN(num) && num > max) max = num;
        }
      }
      return `${prefix}-${max + 1}`;
    }

    // Helper pour recalculer le montant total d'une demande d'achat
    async function recalculateRequestTotal(requestId) {
      if (!requestId) return;
      const items = await SELECT.from(PurchaseRequestItems).where({ request_ID: requestId });
      const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);
      await UPDATE(PurchaseRequests, requestId).set({ totalAmount: total });
    }

    // =========================================================================
    // 1. RÈGLES MÉTIER SUR LES PRODUITS ET FOURNISSEURS
    // =========================================================================

    // Calcul dynamique de l'indicateur stock bas (lowStock) et criticité UI
    this.after("READ", "Products", (each) => {
      if (!each) return;
      const list = Array.isArray(each) ? each : [each];
      for (const p of list) {
        if (p && typeof p.stock === "number" && typeof p.minStock === "number") {
          p.lowStock = p.stock < p.minStock;
        }
        p.lowStockCriticality = p.lowStock ? 1 : 3;
      }
    });

    // Criticité UI pour le statut et contrôle d'accès dynamique aux boutons (statut & rôle)
    this.after("READ", "PurchaseRequests", async (each, req) => {
      if (!each) return;
      const list = Array.isArray(each) ? each : [each];
      const isManager = Boolean(req.user?.is("Manager") || req.user?.is("Admin"));
      const isRequester = Boolean(req.user?.is("Requester") || req.user?.is("Admin"));
      const userId = req.user?.id;

      // Détecter si des commandes existent déjà pour ces demandes
      const prIds = list.map((p) => p.ID).filter(Boolean);
      let existingOrderMap = new Set();
      if (prIds.length > 0) {
        const orders = await SELECT.from(PurchaseOrders)
          .columns("request_ID")
          .where({ request_ID: { in: prIds } });
        existingOrderMap = new Set(orders.map((o) => o.request_ID));
      }

      for (const pr of list) {
        if (!pr) continue;
        switch (pr.status) {
          case "DRAFT":
            pr.statusCriticality = 0;
            pr.statusText = "Brouillon";
            break;
          case "SUBMITTED":
            pr.statusCriticality = 2;
            pr.statusText = "Soumise";
            break;
          case "APPROVED":
            pr.statusCriticality = 3;
            pr.statusText = "Approuvée";
            break;
          case "REJECTED":
            pr.statusCriticality = 1;
            pr.statusText = "Refusée";
            break;
          default:
            pr.statusCriticality = 0;
            pr.statusText = pr.status;
        }

        const isOwner = !pr.createdBy || pr.createdBy === userId;
        const hasOrders = existingOrderMap.has(pr.ID);

        // Disponibilité d'action (@Core.OperationAvailable)
        pr.isSubmitAllowed = Boolean(isRequester && isOwner && pr.status === "DRAFT");
        pr.isApproveAllowed = Boolean(isManager && pr.status === "SUBMITTED");
        pr.isDeclineAllowed = Boolean(isManager && pr.status === "SUBMITTED");
        pr.isPoCreationAllowed = Boolean(isManager && pr.status === "APPROVED" && !hasOrders);

        // Masquage selon le rôle (@UI.Hidden)
        // Soumettre : visible uniquement pour le propriétaire Requester
        pr.isSubmitHidden = Boolean(!isRequester || !isOwner);
        pr.isManagerActionHidden = Boolean(!isManager);
        pr.isRejectionReasonHidden = Boolean(pr.status !== "REJECTED" || !pr.rejectionReason);

        // Supprimer : autorisé seulement si DRAFT et propriétaire (ou Manager/Admin)
        pr.isDeleteAllowed = Boolean(pr.status === "DRAFT" && (isOwner || isManager));
      }
    });

    // Criticité UI et libellés français pour le statut des commandes d'achat
    this.after("READ", "PurchaseOrders", (each, req) => {
      if (!each) return;
      const list = Array.isArray(each) ? each : [each];
      const isWarehouse = Boolean(req.user?.is("Warehouse") || req.user?.is("Admin"));

      for (const po of list) {
        if (!po) continue;
        switch (po.status) {
          case "OPEN":
            po.statusCriticality = 5;
            po.statusText = "Ouverte";
            break;
          case "PARTIALLY_RECEIVED":
            po.statusCriticality = 2;
            po.statusText = "Partiellement reçue";
            break;
          case "RECEIVED":
            po.statusCriticality = 3;
            po.statusText = "Reçue";
            break;
          case "CANCELLED":
            po.statusCriticality = 1;
            po.statusText = "Annulée";
            break;
          default:
            po.statusCriticality = 0;
            po.statusText = po.status;
        }

        po.isReceiveAllowed = Boolean(isWarehouse && (po.status === "OPEN" || po.status === "PARTIALLY_RECEIVED"));
        po.isWarehouseActionHidden = Boolean(!isWarehouse);
      }
    });

    // Interdire la suppression d'un produit référencé dans des demandes, commandes ou mouvements
    this.before("DELETE", "Products", async (req) => {
      const prodId = req.data?.ID || req.params[0]?.ID || req.params[0];
      if (!prodId) return;

      const prod = await SELECT.one.from(Products).where({ ID: prodId });
      if (!prod) return;

      const [hasMovements, hasPoItems, hasPrItems] = await Promise.all([
        SELECT.one.from(StockMovements).where({ product_ID: prodId }),
        SELECT.one.from(PurchaseOrderItems).where({ product_ID: prodId }),
        SELECT.one.from(PurchaseRequestItems).where({ product_ID: prodId })
      ]);

      if (hasMovements || hasPoItems || hasPrItems) {
        req.reject(409, "ERR_409_PRODUCT_IN_USE", [prod.name]);
      }
    });

    // Interdire la suppression d'un fournisseur référencé dans des produits ou commandes
    this.before("DELETE", "Suppliers", async (req) => {
      const supplierId = req.data?.ID || req.params[0]?.ID || req.params[0];
      if (!supplierId) return;

      const supplier = await SELECT.one.from(Suppliers).where({ ID: supplierId });
      if (!supplier) return;

      const [hasProducts, hasOrders] = await Promise.all([
        SELECT.one.from(Products).where({ supplier_ID: supplierId }),
        SELECT.one.from(PurchaseOrders).where({ supplier_ID: supplierId })
      ]);

      if (hasProducts || hasOrders) {
        req.reject(409, "ERR_409_SUPPLIER_IN_USE", [supplier.name]);
      }
    });

    // =========================================================================
    // 2. RÈGLES MÉTIER SUR LES DEMANDES D'ACHAT (PurchaseRequests)
    // =========================================================================

    // Création initiale : numéro, devise MAD, statut DRAFT et total
    this.before("CREATE", "PurchaseRequests", async (req) => {
      if (!req.data.description || !req.data.description.trim()) {
        return req.reject(400, "ERR_400_DESC_REQUIRED");
      }

      if (!req.data.items || !Array.isArray(req.data.items) || req.data.items.length === 0) {
        return req.reject(400, "ERR_400_ITEMS_REQUIRED");
      }

      for (const item of req.data.items) {
        if (!item.product_ID) {
          return req.reject(400, "ERR_400_PROD_NOT_FOUND");
        }
        if (item.quantity !== undefined && (isNaN(Number(item.quantity)) || Number(item.quantity) <= 0)) {
          return req.reject(400, "ERR_400_QTY_POSITIVE");
        }
      }

      if (!req.data.number) {
        req.data.number = await getNextNumber(PurchaseRequests, "PR");
      }
      if (!req.data.status) {
        req.data.status = "DRAFT";
      }
      if (!req.data.currency) {
        req.data.currency = "MAD";
      }

      let total = 0;
      for (const item of req.data.items) {
        if (!item.currency) item.currency = "MAD";
        if (!item.price && item.product_ID) {
          const prod = await SELECT.one.from(Products).where({ ID: item.product_ID });
          if (prod) item.price = prod.price;
        }
        total += (Number(item.quantity) || 0) * (Number(item.price) || 0);
      }
      req.data.totalAmount = total;
    });

    // Interdire la modification ou suppression d'une demande par un autre utilisateur ou non DRAFT
    this.before(["UPDATE", "DELETE"], "PurchaseRequests", async (req) => {
      const prId = req.data?.ID || req.params[0]?.ID || req.params[0];
      if (!prId) return;

      const pr = await SELECT.one.from(PurchaseRequests).where({ ID: prId });
      if (!pr) return;

      // Contrôle de propriété de la demande d'achat
      if (pr.createdBy && pr.createdBy !== req.user.id && !req.user.is("Manager") && !req.user.is("Admin")) {
        return req.reject(403, "ERR_403_OWN_REQUESTS_ONLY");
      }

      if (pr.status !== "DRAFT") {
        req.reject(409, "ERR_409_PR_LOCKED", [pr.number]);
      }
    });

    // Interdire la modification/création/suppression d'articles sur une demande non DRAFT
    this.before(["CREATE", "UPDATE", "DELETE"], "PurchaseRequestItems", async (req) => {
      let requestId = req.data?.request_ID || req.data?.request;
      if (!requestId) {
        const itemId = req.data?.ID || req.params[0]?.ID || req.params[0];
        if (itemId) {
          const existingItem = await SELECT.one.from(PurchaseRequestItems).where({ ID: itemId });
          requestId = existingItem?.request_ID;
        }
      }
      if (requestId) {
        const pr = await SELECT.one.from(PurchaseRequests).where({ ID: requestId });
        if (pr && pr.status !== "DRAFT") {
          req.reject(409, "ERR_409_PR_LOCKED", [pr.number]);
        }
      }
    });

    // Recalcul du total après modifications sur les items
    this.after(["CREATE", "UPDATE", "DELETE"], "PurchaseRequestItems", async (_, req) => {
      const requestId = req.data?.request_ID || req.data?.request;
      if (requestId) {
        await recalculateRequestTotal(requestId);
      }
    });

    // Action : Soumettre une demande (DRAFT -> SUBMITTED)
    this.on("submit", "PurchaseRequests", async (req) => {
      const prId = req.params[0]?.ID || req.params[0] || (await SELECT.one.from(req.subject))?.ID;
      const pr = await SELECT.one.from(PurchaseRequests).where({ ID: prId });
      if (!pr) return req.reject(404, "ERR_400_PR_NOT_FOUND");

      // Seul l'auteur (ou Manager/Admin) peut soumettre la demande
      if (pr.createdBy && pr.createdBy !== req.user.id && !req.user.is("Manager") && !req.user.is("Admin")) {
        return req.reject(403, "ERR_403_OWN_REQUESTS_ONLY");
      }

      if (pr.status !== "DRAFT") {
        const currentStatusFr =
          pr.status === "SUBMITTED" ? "Soumise" : pr.status === "APPROVED" ? "Approuvée" : "Refusée";
        return req.reject(409, "ERR_409_STATUS_TRANSITION", [pr.number, "soumise", currentStatusFr, "en brouillon"]);
      }

      await UPDATE(PurchaseRequests, prId).set({ status: "SUBMITTED" });
      req.notify("MSG_SUBMIT_SUCCESS", [pr.number]);
      return await SELECT.one.from(PurchaseRequests).where({ ID: prId });
    });

    // Action : Approuver une demande (SUBMITTED -> APPROVED)
    this.on("approve", "PurchaseRequests", async (req) => {
      const prId = req.params[0]?.ID || req.params[0] || (await SELECT.one.from(req.subject))?.ID;
      const pr = await SELECT.one.from(PurchaseRequests).where({ ID: prId });
      if (!pr) return req.reject(404, "ERR_400_PR_NOT_FOUND");

      if (pr.status !== "SUBMITTED") {
        const currentStatusFr =
          pr.status === "DRAFT" ? "Brouillon" : pr.status === "APPROVED" ? "Approuvée" : "Refusée";
        return req.reject(409, "ERR_409_STATUS_TRANSITION", [pr.number, "approuvée", currentStatusFr, "soumise"]);
      }

      await UPDATE(PurchaseRequests, prId).set({ status: "APPROVED" });
      req.notify("MSG_APPROVE_SUCCESS", [pr.number]);
      return await SELECT.one.from(PurchaseRequests).where({ ID: prId });
    });

    // Action : Rejeter une demande (SUBMITTED -> REJECTED)
    this.on("decline", "PurchaseRequests", async (req) => {
      const prId = req.params[0]?.ID || req.params[0] || (await SELECT.one.from(req.subject))?.ID;
      const pr = await SELECT.one.from(PurchaseRequests).where({ ID: prId });
      if (!pr) return req.reject(404, "ERR_400_PR_NOT_FOUND");

      const reason = (req.data?.reason || "").trim();
      if (!reason) {
        return req.reject(400, "ERR_400_REASON_REQUIRED");
      }

      if (pr.status !== "SUBMITTED") {
        const currentStatusFr =
          pr.status === "DRAFT" ? "Brouillon" : pr.status === "APPROVED" ? "Approuvée" : "Refusée";
        return req.reject(409, "ERR_409_STATUS_TRANSITION", [pr.number, "refusée", currentStatusFr, "soumise"]);
      }

      await UPDATE(PurchaseRequests, prId).set({ status: "REJECTED", rejectionReason: reason });
      req.notify("MSG_DECLINE_SUCCESS", [pr.number]);
      return await SELECT.one.from(PurchaseRequests).where({ ID: prId });
    });

    // Action : Créer les commandes à partir d'une demande approuvée (un fournisseur par commande)
    this.on("createPurchaseOrder", "PurchaseRequests", async (req) => {
      const prId = req.params[0]?.ID || req.params[0] || (await SELECT.one.from(req.subject))?.ID;
      const pr = await SELECT.one.from(PurchaseRequests).where({ ID: prId });
      if (!pr) return req.reject(404, "ERR_400_PR_NOT_FOUND");

      if (pr.status !== "APPROVED") {
        const currentStatusFr = pr.status === "DRAFT" ? "Brouillon" : pr.status === "SUBMITTED" ? "Soumise" : "Refusée";
        return req.reject(409, "ERR_409_STATUS_TRANSITION", [
          pr.number,
          "générée en commandes",
          currentStatusFr,
          "approuvée"
        ]);
      }

      // Vérifier si des commandes existent déjà pour cette demande
      const existingOrders = await SELECT.from(PurchaseOrders).where({ request_ID: prId });
      if (existingOrders.length > 0) {
        const poNumbers = existingOrders.map((o) => o.number).join(", ");
        return req.reject(409, "ERR_409_ORDERS_EXIST", [pr.number, poNumbers]);
      }

      const items = await SELECT.from(PurchaseRequestItems).where({ request_ID: prId });
      if (!items || items.length === 0) {
        return req.reject(400, "ERR_400_ITEMS_REQUIRED");
      }

      // Regrouper les articles par fournisseur
      const itemsBySupplier = new Map();
      for (const item of items) {
        const prod = await SELECT.one.from(Products).where({ ID: item.product_ID });
        if (!prod) {
          return req.reject(404, "ERR_400_PROD_NOT_FOUND");
        }
        if (!prod.supplier_ID) {
          return req.reject(400, `Le produit '${prod.name}' (${prod.code}) n'est associé à aucun fournisseur.`);
        }

        const supplierId = prod.supplier_ID;
        if (!itemsBySupplier.has(supplierId)) {
          itemsBySupplier.set(supplierId, []);
        }
        itemsBySupplier.get(supplierId).push({
          product_ID: prod.ID,
          quantity: item.quantity,
          price: item.price ?? prod.price,
          currency: "MAD",
          receivedQuantity: 0
        });
      }

      // Création d'une commande par fournisseur
      const createdOrders = [];
      for (const [supplierId, orderItems] of itemsBySupplier.entries()) {
        const poNumber = await getNextNumber(PurchaseOrders, "PO");
        const totalAmount = orderItems.reduce(
          (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.price) || 0),
          0
        );
        const poId = cds.utils.uuid();

        await INSERT.into(PurchaseOrders).entries({
          ID: poId,
          number: poNumber,
          request_ID: prId,
          supplier_ID: supplierId,
          status: "OPEN",
          totalAmount: totalAmount,
          currency: "MAD"
        });

        for (const it of orderItems) {
          await INSERT.into(PurchaseOrderItems).entries({
            ID: cds.utils.uuid(),
            order_ID: poId,
            product_ID: it.product_ID,
            quantity: it.quantity,
            receivedQuantity: 0,
            price: it.price,
            currency: "MAD"
          });
        }

        const fullPo = await SELECT.one.from(PurchaseOrders).where({ ID: poId });
        createdOrders.push(fullPo);
      }

      const poListStr = createdOrders.map((o) => o.number).join(", ");
      req.notify("MSG_PO_CREATED_SUCCESS", [createdOrders.length, poListStr]);
      return createdOrders;
    });

    // =========================================================================
    // 3. ACTIONS DE RÉCEPTION ET MISE À JOUR ATOMIQUE DU STOCK
    // =========================================================================

    // Action : Réceptionner des articles d'une commande
    this.on("receive", "PurchaseOrders", async (req) => {
      const poId = req.params[0]?.ID || req.params[0] || (await SELECT.one.from(req.subject))?.ID;
      const po = await SELECT.one.from(PurchaseOrders).where({ ID: poId });
      if (!po) return req.reject(404, "ERR_400_PO_NOT_FOUND");

      if (po.status === "CANCELLED") {
        return req.reject(409, "ERR_409_ORDER_CANCELLED", [po.number]);
      }
      if (po.status === "RECEIVED") {
        return req.reject(409, "ERR_409_ORDER_ALREADY_RECEIVED", [po.number]);
      }

      const orderItems = await SELECT.from(PurchaseOrderItems).where({ order_ID: poId });
      if (!orderItems || orderItems.length === 0) {
        return req.reject(400, "ERR_400_ITEMS_REQUIRED");
      }

      const requestedLines = req.data?.items;
      const linesToReceive = [];

      if (!requestedLines || requestedLines.length === 0) {
        // Réception automatique de tout le restant dû
        for (const oi of orderItems) {
          const remaining = (oi.quantity || 0) - (oi.receivedQuantity || 0);
          if (remaining > 0) {
            linesToReceive.push({
              orderItem: oi,
              quantity: remaining
            });
          }
        }
        if (linesToReceive.length === 0) {
          return req.reject(400, "ERR_400_NO_REMAINING_ITEMS");
        }
      } else {
        // Réception ciblée spécifiée par l'utilisateur
        for (const input of requestedLines) {
          const qty = Number(input.quantity);
          if (isNaN(qty) || qty <= 0) {
            return req.reject(400, "ERR_400_QTY_POSITIVE");
          }

          const oi = orderItems.find((item) => item.product_ID === input.product);
          if (!oi) {
            return req.reject(400, "ERR_400_PROD_NOT_FOUND");
          }

          const remaining = (oi.quantity || 0) - (oi.receivedQuantity || 0);
          if (qty > remaining) {
            const prod = await SELECT.one.from(Products).where({ ID: input.product });
            const prodName = prod?.name || input.product;
            return req.reject(400, "ERR_400_QTY_TOO_HIGH", [prodName, remaining, qty]);
          }

          linesToReceive.push({
            orderItem: oi,
            quantity: qty
          });
        }
      }

      // Création du bon de réception (GoodsReceipt)
      const grId = cds.utils.uuid();
      const grNumber = await getNextNumber(GoodsReceipts, "GR");
      const now = new Date();
      const postingDate = now.toISOString().split("T")[0];

      await INSERT.into(GoodsReceipts).entries({
        ID: grId,
        number: grNumber,
        order_ID: poId,
        postingDate: postingDate
      });

      // Traitement atomique de chaque ligne reçue
      for (const line of linesToReceive) {
        const oi = line.orderItem;
        const qty = line.quantity;

        // 1. Enregistrement de la ligne de réception
        await INSERT.into(GoodsReceiptItems).entries({
          ID: cds.utils.uuid(),
          receipt_ID: grId,
          orderItem_ID: oi.ID,
          product_ID: oi.product_ID,
          quantity: qty
        });

        // 2. Mise à jour de la quantité reçue sur la commande (SET receivedQuantity = receivedQuantity + qty)
        await UPDATE(PurchaseOrderItems, oi.ID).with({
          receivedQuantity: { "+=": qty }
        });

        // 3. Mise à jour ATOMIQUE du stock produit (UPDATE Products SET stock = stock + qty)
        await UPDATE(Products, oi.product_ID).with({
          stock: { "+=": qty }
        });

        // 4. Création du mouvement de stock historique
        await INSERT.into(StockMovements).entries({
          ID: cds.utils.uuid(),
          product_ID: oi.product_ID,
          quantity: qty,
          type: "IN",
          documentRef: grNumber,
          movementDate: now.toISOString()
        });
      }

      // Mise à jour du statut de la commande (RECEIVED ou PARTIALLY_RECEIVED)
      const updatedOrderItems = await SELECT.from(PurchaseOrderItems).where({ order_ID: poId });
      const allCompleted = updatedOrderItems.every((item) => (item.receivedQuantity || 0) >= (item.quantity || 0));
      const newStatus = allCompleted ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await UPDATE(PurchaseOrders, poId).set({ status: newStatus });

      if (allCompleted) {
        req.notify("MSG_RECEIVE_FULL_SUCCESS", [grNumber, po.number]);
      } else {
        const remainingTotal = updatedOrderItems.reduce(
          (sum, item) => sum + Math.max(0, (item.quantity || 0) - (item.receivedQuantity || 0)),
          0
        );
        req.notify("MSG_RECEIVE_PARTIAL_SUCCESS", [grNumber, po.number, remainingTotal]);
      }

      return await SELECT.one.from(GoodsReceipts).where({ ID: grId });
    });

    // =========================================================================
    // 4. GESTIONNAIRE D'ERREURS CENTRALISÉ (TRADUCTIONS 403, 401 ET VALIDATIONS)
    // =========================================================================
    this.on("error", (err, req) => {
      const code = err.status || err.code || err.statusCode;
      const target = req.target?.name || "";
      const event = req.event || "";
      const path = req._?.req?.url || "";

      if (code === 403 || code === "403") {
        if (event === "approve" || event === "decline" || path.includes("/approve") || path.includes("/decline")) {
          err.message = "Action refusée : seul un manager peut approuver ou refuser une demande.";
        } else if (event === "createPurchaseOrder" || path.includes("/createPurchaseOrder")) {
          err.message = "Action refusée : seul un manager peut générer les commandes d'achat.";
        } else if (event === "receive" || path.includes("/receive")) {
          err.message = "Action refusée : seul un magasinier peut enregistrer une réception.";
        } else if (
          target.includes("Products") ||
          target.includes("Suppliers") ||
          path.includes("/Products") ||
          path.includes("/Suppliers")
        ) {
          if (
            ["CREATE", "UPDATE", "DELETE", "POST", "PUT", "PATCH"].includes(event) ||
            ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
          ) {
            err.message = "Action refusée : seul un administrateur peut modifier le catalogue.";
          }
        } else if (target.includes("PurchaseRequests") || path.includes("/PurchaseRequests")) {
          err.message = "Vous ne pouvez agir que sur vos propres demandes.";
        }
      } else if (code === 401 || code === "401") {
        err.message = "Votre session a expiré ou vous n'êtes pas connecté. Reconnectez-vous.";
      }
    });

    return super.init();
  }
}
