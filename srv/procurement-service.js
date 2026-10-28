import cds from '@sap/cds';

/**
 * Service ProcurementService - Gestion du cycle Procure-to-Pay
 * Étape 2 : Validations et règles métier
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
      const rows = await SELECT.from(entity).columns('number');
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
    // 1. RÈGLES MÉTIER & VALIDATIONS SUR LES PRODUITS ET FOURNISSEURS
    // =========================================================================

    // Calcul dynamique de l'indicateur stock bas (lowStock)
    this.after('READ', 'Products', (each) => {
      if (!each) return;
      const list = Array.isArray(each) ? each : [each];
      for (const p of list) {
        if (p && typeof p.stock === 'number' && typeof p.minStock === 'number') {
          p.lowStock = p.stock < p.minStock;
        }
      }
    });

    // Interdire la suppression d'un produit référencé dans des demandes, commandes ou mouvements
    this.before('DELETE', 'Products', async (req) => {
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
        req.reject(
          409,
          `Impossible de supprimer le produit '${prod.name}' (${prod.code}) : des demandes, commandes ou mouvements de stock y font référence.`
        );
      }
    });

    // Interdire la suppression d'un fournisseur référencé dans des produits ou commandes
    this.before('DELETE', 'Suppliers', async (req) => {
      const supplierId = req.data?.ID || req.params[0]?.ID || req.params[0];
      if (!supplierId) return;

      const supplier = await SELECT.one.from(Suppliers).where({ ID: supplierId });
      if (!supplier) return;

      const [hasProducts, hasOrders] = await Promise.all([
        SELECT.one.from(Products).where({ supplier_ID: supplierId }),
        SELECT.one.from(PurchaseOrders).where({ supplier_ID: supplierId })
      ]);

      if (hasProducts || hasOrders) {
        req.reject(
          409,
          `Impossible de supprimer le fournisseur '${supplier.name}' : des produits ou commandes d'achat y font référence.`
        );
      }
    });

    // =========================================================================
    // 2. RÈGLES MÉTIER SUR LES DEMANDES D'ACHAT (PurchaseRequests)
    // =========================================================================

    // Création initiale : numéro, devise MAD, statut DRAFT et total
    this.before('CREATE', 'PurchaseRequests', async (req) => {
      if (!req.data.number) {
        req.data.number = await getNextNumber(PurchaseRequests, 'PR');
      }
      if (!req.data.status) {
        req.data.status = 'DRAFT';
      }
      if (!req.data.currency) {
        req.data.currency = 'MAD';
      }

      if (req.data.items && Array.isArray(req.data.items)) {
        let total = 0;
        for (const item of req.data.items) {
          if (!item.currency) item.currency = 'MAD';
          if (!item.price && item.product_ID) {
            const prod = await SELECT.one.from(Products).where({ ID: item.product_ID });
            if (prod) item.price = prod.price;
          }
          total += (Number(item.quantity) || 0) * (Number(item.price) || 0);
        }
        req.data.totalAmount = total;
      }
    });

    // Interdire la modification ou suppression d'une demande qui n'est plus en DRAFT
    this.before(['UPDATE', 'DELETE'], 'PurchaseRequests', async (req) => {
      const prId = req.data?.ID || req.params[0]?.ID || req.params[0];
      if (!prId) return;

      const pr = await SELECT.one.from(PurchaseRequests).where({ ID: prId });
      if (pr && pr.status !== 'DRAFT') {
        req.reject(
          409,
          `Impossible de modifier ou supprimer la demande '${pr.number}' : son statut est '${pr.status}'. Seules les demandes 'DRAFT' peuvent être modifiées ou supprimées.`
        );
      }
    });

    // Interdire la modification/création/suppression d'articles sur une demande non DRAFT
    this.before(['CREATE', 'UPDATE', 'DELETE'], 'PurchaseRequestItems', async (req) => {
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
        if (pr && pr.status !== 'DRAFT') {
          req.reject(
            409,
            `Impossible de modifier les articles de la demande '${pr.number}' : son statut est '${pr.status}'. Seules les demandes 'DRAFT' peuvent être modifiées.`
          );
        }
      }
    });

    // Recalcul du total après modifications sur les items
    this.after(['CREATE', 'UPDATE', 'DELETE'], 'PurchaseRequestItems', async (_, req) => {
      const requestId = req.data?.request_ID || req.data?.request;
      if (requestId) {
        await recalculateRequestTotal(requestId);
      }
    });

    // Action : Soumettre une demande (DRAFT -> SUBMITTED)
    this.on('submit', 'PurchaseRequests', async (req) => {
      const prId = req.params[0]?.ID || req.params[0] || (await SELECT.one.from(req.subject))?.ID;
      const pr = await SELECT.one.from(PurchaseRequests).where({ ID: prId });
      if (!pr) return req.reject(404, "Demande d'achat introuvable.");

      if (pr.status !== 'DRAFT') {
        return req.reject(
          409,
          `Impossible de soumettre la demande '${pr.number}' : son statut actuel est '${pr.status}'. Seules les demandes 'DRAFT' peuvent être soumises.`
        );
      }

      await UPDATE(PurchaseRequests, prId).set({ status: 'SUBMITTED' });
      return await SELECT.one.from(PurchaseRequests).where({ ID: prId });
    });

    // Action : Approuver une demande (SUBMITTED -> APPROVED)
    this.on('approve', 'PurchaseRequests', async (req) => {
      const prId = req.params[0]?.ID || req.params[0] || (await SELECT.one.from(req.subject))?.ID;
      const pr = await SELECT.one.from(PurchaseRequests).where({ ID: prId });
      if (!pr) return req.reject(404, "Demande d'achat introuvable.");

      if (pr.status !== 'SUBMITTED') {
        return req.reject(
          409,
          `Impossible d'approuver la demande '${pr.number}' : son statut actuel est '${pr.status}'. Seules les demandes 'SUBMITTED' peuvent être approuvées.`
        );
      }

      await UPDATE(PurchaseRequests, prId).set({ status: 'APPROVED' });
      return await SELECT.one.from(PurchaseRequests).where({ ID: prId });
    });

    // Action : Rejeter une demande (SUBMITTED -> REJECTED)
    this.on('decline', 'PurchaseRequests', async (req) => {
      const prId = req.params[0]?.ID || req.params[0] || (await SELECT.one.from(req.subject))?.ID;
      const pr = await SELECT.one.from(PurchaseRequests).where({ ID: prId });
      if (!pr) return req.reject(404, "Demande d'achat introuvable.");

      if (pr.status !== 'SUBMITTED') {
        return req.reject(
          409,
          `Impossible de refuser la demande '${pr.number}' : son statut actuel est '${pr.status}'. Seules les demandes 'SUBMITTED' peuvent être refusées.`
        );
      }

      await UPDATE(PurchaseRequests, prId).set({ status: 'REJECTED' });
      return await SELECT.one.from(PurchaseRequests).where({ ID: prId });
    });

    // Action : Créer les commandes à partir d'une demande approuvée (un fournisseur par commande)
    this.on('createPurchaseOrder', 'PurchaseRequests', async (req) => {
      const prId = req.params[0]?.ID || req.params[0] || (await SELECT.one.from(req.subject))?.ID;
      const pr = await SELECT.one.from(PurchaseRequests).where({ ID: prId });
      if (!pr) return req.reject(404, "Demande d'achat introuvable.");

      if (pr.status !== 'APPROVED') {
        return req.reject(
          409,
          `Impossible de créer une commande : la demande d'achat '${pr.number}' n'est pas approuvée (statut actuel : '${pr.status}').`
        );
      }

      // Vérifier si des commandes existent déjà pour cette demande
      const existingOrders = await SELECT.from(PurchaseOrders).where({ request_ID: prId });
      if (existingOrders.length > 0) {
        return req.reject(
          409,
          `Une ou plusieurs commandes d'achat ont déjà été créées pour la demande '${pr.number}'.`
        );
      }

      const items = await SELECT.from(PurchaseRequestItems).where({ request_ID: prId });
      if (!items || items.length === 0) {
        return req.reject(400, "La demande d'achat ne contient aucun article.");
      }

      // Regrouper les articles par fournisseur
      const itemsBySupplier = new Map();
      for (const item of items) {
        const prod = await SELECT.one.from(Products).where({ ID: item.product_ID });
        if (!prod) {
          return req.reject(404, `Produit avec l'identifiant '${item.product_ID}' introuvable.`);
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
          currency: 'MAD',
          receivedQuantity: 0
        });
      }

      // Création d'une commande par fournisseur
      const createdOrders = [];
      for (const [supplierId, orderItems] of itemsBySupplier.entries()) {
        const poNumber = await getNextNumber(PurchaseOrders, 'PO');
        const totalAmount = orderItems.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);
        const poId = cds.utils.uuid();

        await INSERT.into(PurchaseOrders).entries({
          ID: poId,
          number: poNumber,
          request_ID: prId,
          supplier_ID: supplierId,
          status: 'OPEN',
          totalAmount: totalAmount,
          currency: 'MAD'
        });

        for (const it of orderItems) {
          await INSERT.into(PurchaseOrderItems).entries({
            ID: cds.utils.uuid(),
            order_ID: poId,
            product_ID: it.product_ID,
            quantity: it.quantity,
            receivedQuantity: 0,
            price: it.price,
            currency: 'MAD'
          });
        }

        const fullPo = await SELECT.one.from(PurchaseOrders).where({ ID: poId });
        createdOrders.push(fullPo);
      }

      return createdOrders;
    });

    // =========================================================================
    // 3. ACTIONS DE RÉCEPTION ET MISE À JOUR ATOMIQUE DU STOCK
    // =========================================================================

    // Action : Réceptionner des articles d'une commande
    this.on('receive', 'PurchaseOrders', async (req) => {
      const poId = req.params[0]?.ID || req.params[0] || (await SELECT.one.from(req.subject))?.ID;
      const po = await SELECT.one.from(PurchaseOrders).where({ ID: poId });
      if (!po) return req.reject(404, "Commande d'achat introuvable.");

      if (po.status === 'CANCELLED') {
        return req.reject(409, `Impossible de réceptionner la commande '${po.number}' : elle a été annulée.`);
      }
      if (po.status === 'RECEIVED') {
        return req.reject(409, `La commande '${po.number}' a déjà été entièrement réceptionnée.`);
      }

      const orderItems = await SELECT.from(PurchaseOrderItems).where({ order_ID: poId });
      if (!orderItems || orderItems.length === 0) {
        return req.reject(400, "La commande d'achat ne contient aucun article.");
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
          return req.reject(400, "Aucun article restant à réceptionner pour cette commande.");
        }
      } else {
        // Réception ciblée spécifiée par l'utilisateur
        for (const input of requestedLines) {
          const qty = Number(input.quantity);
          if (isNaN(qty) || qty <= 0) {
            return req.reject(400, "La quantité à réceptionner doit être un nombre strictement positif.");
          }

          const oi = orderItems.find((item) => item.product_ID === input.product);
          if (!oi) {
            return req.reject(400, `Le produit '${input.product}' ne figure pas dans cette commande.`);
          }

          const remaining = (oi.quantity || 0) - (oi.receivedQuantity || 0);
          if (qty > remaining) {
            return req.reject(
              400,
              `Quantité reçue trop élevée pour le produit '${input.product}'. Quantité restante : ${remaining}, quantité soumise : ${qty}.`
            );
          }

          linesToReceive.push({
            orderItem: oi,
            quantity: qty
          });
        }
      }

      // Création du bon de réception (GoodsReceipt)
      const grId = cds.utils.uuid();
      const grNumber = await getNextNumber(GoodsReceipts, 'GR');
      const now = new Date();
      const postingDate = now.toISOString().split('T')[0];

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
          receivedQuantity: { '+=': qty }
        });

        // 3. Mise à jour ATOMIQUE du stock produit (UPDATE Products SET stock = stock + qty)
        await UPDATE(Products, oi.product_ID).with({
          stock: { '+=': qty }
        });

        // 4. Création du mouvement de stock historique
        await INSERT.into(StockMovements).entries({
          ID: cds.utils.uuid(),
          product_ID: oi.product_ID,
          quantity: qty,
          type: 'IN',
          documentRef: grNumber,
          movementDate: now.toISOString()
        });
      }

      // Mise à jour du statut de la commande (RECEIVED ou PARTIALLY_RECEIVED)
      const updatedOrderItems = await SELECT.from(PurchaseOrderItems).where({ order_ID: poId });
      const allCompleted = updatedOrderItems.every((item) => (item.receivedQuantity || 0) >= (item.quantity || 0));
      const newStatus = allCompleted ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await UPDATE(PurchaseOrders, poId).set({ status: newStatus });

      return await SELECT.one.from(GoodsReceipts).where({ ID: grId });
    });

    return super.init();
  }
}
