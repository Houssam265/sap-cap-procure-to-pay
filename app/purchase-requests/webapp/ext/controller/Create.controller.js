sap.ui.define(
  ["sap/ui/core/mvc/Controller", "sap/ui/model/json/JSONModel", "sap/m/MessageBox", "sap/m/MessageToast"],
  function (Controller, JSONModel, MessageBox, MessageToast) {
    "use strict";

    return Controller.extend("purchaserequests.ext.controller.Create", {
      onInit: function () {
        const oViewModel = new JSONModel({
          description: "",
          items: [],
          products: [],
          totalEstimated: "0.00",
          busy: false
        });
        this.getView().setModel(oViewModel, "viewModel");

        // Écoute de l'événement de routage pour réinitialiser le formulaire
        const oRouter = this._getRouter();
        if (oRouter) {
          const oRoute = oRouter.getRoute("PurchaseRequestsCreate");
          if (oRoute) {
            oRoute.attachPatternMatched(this._onRouteMatched, this);
          }
        }

        this._loadProducts();
      },

      _getRouter: function () {
        const oComponent = this.getOwnerComponent();
        return oComponent ? oComponent.getRouter() : null;
      },

      _onRouteMatched: function () {
        const oViewModel = this.getView().getModel("viewModel");
        oViewModel.setProperty("/description", "");
        oViewModel.setProperty("/items", [{ product_ID: "", quantity: 1, price: 0, stock: 0 }]);
        oViewModel.setProperty("/totalEstimated", "0.00");
        oViewModel.setProperty("/busy", false);

        this._loadProducts();
      },

      _loadProducts: function () {
        const oViewModel = this.getView().getModel("viewModel");
        fetch("/odata/v4/procurement/Products", {
          headers: { Accept: "application/json" }
        })
          .then((response) => {
            if (!response.ok) throw new Error("Impossible de charger les produits");
            return response.json();
          })
          .then((data) => {
            oViewModel.setProperty("/products", data.value || []);
          })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error("Erreur chargement catalogue produits:", err);
          });
      },

      onAddItem: function () {
        const oViewModel = this.getView().getModel("viewModel");
        const aItems = oViewModel.getProperty("/items") || [];
        aItems.push({
          product_ID: "",
          quantity: 1,
          price: 0,
          stock: 0
        });
        oViewModel.setProperty("/items", aItems);
        this._recalculateTotal();
      },

      onDeleteItem: function (oEvent) {
        const oItem = oEvent.getSource().getBindingContext("viewModel").getObject();
        const oViewModel = this.getView().getModel("viewModel");
        let aItems = oViewModel.getProperty("/items") || [];
        aItems = aItems.filter((it) => it !== oItem);
        oViewModel.setProperty("/items", aItems);
        this._recalculateTotal();
      },

      onProductChange: function (oEvent) {
        const oBindingContext = oEvent.getSource().getBindingContext("viewModel");
        const sProductId = oEvent.getParameter("selectedItem") ? oEvent.getParameter("selectedItem").getKey() : "";

        const oViewModel = this.getView().getModel("viewModel");
        const aProducts = oViewModel.getProperty("/products") || [];
        const oProd = aProducts.find((p) => p.ID === sProductId);

        if (oBindingContext) {
          const sPath = oBindingContext.getPath();
          if (oProd) {
            oViewModel.setProperty(sPath + "/price", oProd.price || 0);
            oViewModel.setProperty(sPath + "/stock", oProd.stock !== undefined ? oProd.stock : 0);
          } else {
            oViewModel.setProperty(sPath + "/price", 0);
            oViewModel.setProperty(sPath + "/stock", 0);
          }
        }

        this._recalculateTotal();
      },

      onQuantityChange: function () {
        this._recalculateTotal();
      },

      _recalculateTotal: function () {
        const oViewModel = this.getView().getModel("viewModel");
        const aItems = oViewModel.getProperty("/items") || [];
        let nTotal = 0;
        for (const it of aItems) {
          const nQty = Number(it.quantity) || 0;
          const nPrice = Number(it.price) || 0;
          nTotal += nQty * nPrice;
        }
        oViewModel.setProperty("/totalEstimated", nTotal.toFixed(2));
      },

      onSave: function () {
        const oViewModel = this.getView().getModel("viewModel");
        const sDescription = (oViewModel.getProperty("/description") || "").trim();
        const aItems = oViewModel.getProperty("/items") || [];

        // Validations
        if (!sDescription) {
          MessageBox.error("La description de la demande d'achat est obligatoire.");
          return;
        }

        if (aItems.length === 0) {
          MessageBox.error("Veuillez ajouter au moins un article à la demande.");
          return;
        }

        for (let i = 0; i < aItems.length; i++) {
          const it = aItems[i];
          if (!it.product_ID) {
            MessageBox.error("Veuillez sélectionner un produit pour la ligne #" + (i + 1) + ".");
            return;
          }
          const nQty = Number(it.quantity);
          if (isNaN(nQty) || nQty < 1) {
            MessageBox.error("La quantité demandée pour la ligne #" + (i + 1) + " doit être d'au moins 1.");
            return;
          }
        }

        oViewModel.setProperty("/busy", true);

        const oPayload = {
          description: sDescription,
          items: aItems.map((it) => ({
            product_ID: it.product_ID,
            quantity: parseInt(it.quantity, 10)
          }))
        };

        fetch("/odata/v4/procurement/PurchaseRequests", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(oPayload)
        })
          .then(async (response) => {
            oViewModel.setProperty("/busy", false);
            if (response.status === 201) {
              const oCreated = await response.json();
              MessageToast.show("Demande d'achat " + (oCreated.number || "") + " créée avec succès (statut : DRAFT).");
              this.onCancel();
            } else {
              let errorMsg = "Erreur lors de la création de la demande (" + response.status + ").";
              try {
                const oErr = await response.json();
                if (oErr.error && oErr.error.message) {
                  errorMsg = oErr.error.message;
                }
              } catch {
                /* ignore */
              }
              MessageBox.error(errorMsg);
            }
          })
          .catch((err) => {
            oViewModel.setProperty("/busy", false);
            MessageBox.error("Erreur réseau lors de la création : " + (err.message || err));
          });
      },

      onCancel: function () {
        const oRouter = this._getRouter();
        if (oRouter) {
          oRouter.navTo("PurchaseRequestsList", {}, true);
        } else {
          window.history.back();
        }
      }
    });
  }
);
