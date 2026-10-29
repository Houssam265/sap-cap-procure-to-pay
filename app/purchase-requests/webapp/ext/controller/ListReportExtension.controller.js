sap.ui.define([
  "sap/ui/core/mvc/ControllerExtension",
  "sap/ui/model/json/JSONModel",
  "sap/m/Dialog",
  "sap/m/Button",
  "sap/m/Label",
  "sap/m/Input",
  "sap/m/Text",
  "sap/m/ObjectStatus",
  "sap/m/Table",
  "sap/m/Column",
  "sap/m/ColumnListItem",
  "sap/m/ComboBox",
  "sap/ui/core/Item",
  "sap/m/StepInput",
  "sap/m/OverflowToolbar",
  "sap/m/ToolbarSpacer",
  "sap/m/Title",
  "sap/m/VBox",
  "sap/m/HBox",
  "sap/m/Panel",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], function (
  ControllerExtension,
  JSONModel,
  Dialog,
  Button,
  Label,
  Input,
  Text,
  ObjectStatus,
  Table,
  Column,
  ColumnListItem,
  ComboBox,
  Item,
  StepInput,
  OverflowToolbar,
  ToolbarSpacer,
  Title,
  VBox,
  HBox,
  Panel,
  MessageBox,
  MessageToast
) {
  "use strict";

  return ControllerExtension.extend("purchaserequests.ext.controller.ListReportExtension", {
    override: {
      onInit: function () {
        this._oCreateDialog = null;
      }
    },

    onCreatePress: function () {
      this._openCreateDialog();
    },

    _openCreateDialog: function () {
      if (this._oCreateDialog && this._oCreateDialog.isOpen()) {
        return;
      }

      const that = this;

      // Modèle JSON local pour gérer l'état du formulaire de création
      const oModel = new JSONModel({
        description: "",
        items: [
          { product_ID: "", quantity: 1, price: 0, stock: 0 }
        ],
        products: [],
        totalEstimated: "0.00",
        busy: false
      });

      // Recalcul en direct du montant total estimé
      function recalculateTotal() {
        const aItems = oModel.getProperty("/items") || [];
        let nTotal = 0;
        for (let i = 0; i < aItems.length; i++) {
          const qty = Number(aItems[i].quantity) || 0;
          const price = Number(aItems[i].price) || 0;
          nTotal += qty * price;
        }
        oModel.setProperty("/totalEstimated", nTotal.toFixed(2));
      }

      // Chargement du catalogue des produits
      fetch("/odata/v4/procurement/Products", {
        headers: { "Accept": "application/json" }
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          oModel.setProperty("/products", data.value || []);
        })
        .catch(function (err) {
          console.error("Erreur chargement catalogue produits:", err);
        });

      // 1. Informations générales (En-tête)
      const oHeaderPanel = new Panel({
        headerText: "Informations Générales",
        expandable: false,
        expanded: true,
        content: [
          new VBox({
            items: [
              new Label({ text: "Description de la demande *", class: "sapUiTinyMarginBottom" }),
              new Input({
                value: "{createModel>/description}",
                placeholder: "Ex: Demande de matériel informatique et consommables...",
                maxLength: 200,
                width: "100%"
              }),
              new HBox({
                alignItems: "Center",
                class: "sapUiSmallMarginTop",
                items: [
                  new Label({ text: "Statut initial :", class: "sapUiTinyMarginEnd" }),
                  new ObjectStatus({ text: "Brouillon (DRAFT)", state: "None", class: "sapUiMediumMarginEnd" }),
                  new Label({ text: "Devise :", class: "sapUiTinyMarginEnd" }),
                  new Text({ text: "MAD (Dirham Marocain)" })
                ]
              })
            ]
          })
        ]
      });

      // 2. Table des articles
      const oItemsTable = new Table({
        headerToolbar: new OverflowToolbar({
          content: [
            new Title({ text: "Articles demandés", level: "H3" }),
            new ToolbarSpacer(),
            new Button({
              text: "Ajouter un article",
              icon: "sap-icon://add",
              type: "Emphasized",
              press: function () {
                const aItems = oModel.getProperty("/items") || [];
                aItems.push({ product_ID: "", quantity: 1, price: 0, stock: 0 });
                oModel.setProperty("/items", aItems);
                recalculateTotal();
              }
            })
          ]
        }),
        columns: [
          new Column({ header: new Text({ text: "Produit (Désignation / Code)" }), width: "42%" }),
          new Column({ header: new Text({ text: "Prix Unitaire" }), hAlign: "End", width: "16%" }),
          new Column({ header: new Text({ text: "Quantité" }), hAlign: "Center", width: "18%" }),
          new Column({ header: new Text({ text: "Sous-Total" }), hAlign: "End", width: "16%" }),
          new Column({ header: new Text({ text: "" }), hAlign: "Center", width: "8%" })
        ]
      });

      oItemsTable.bindItems({
        path: "createModel>/items",
        template: new ColumnListItem({
          cells: [
            new ComboBox({
              selectedKey: "{createModel>product_ID}",
              width: "100%",
              placeholder: "Sélectionner un produit...",
              items: {
                path: "createModel>/products",
                template: new Item({
                  key: "{createModel>ID}",
                  text: "{createModel>name} ({createModel>code})"
                }),
                templateShareable: false
              },
              change: function (oEvent) {
                const oCombo = oEvent.getSource();
                const sKey = oCombo.getSelectedKey();
                const oCtx = oCombo.getBindingContext("createModel");
                if (!oCtx) return;
                const aProds = oModel.getProperty("/products") || [];
                const oFound = aProds.find(function (p) { return p.ID === sKey; });
                const sPath = oCtx.getPath();
                oModel.setProperty(sPath + "/product_ID", sKey);
                oModel.setProperty(sPath + "/price", oFound ? (oFound.price || 0) : 0);
                oModel.setProperty(sPath + "/stock", oFound ? (oFound.stock || 0) : 0);
                recalculateTotal();
              }
            }),
            new Text({
              text: {
                path: "createModel>price",
                formatter: function (v) { return v !== undefined && v !== null ? Number(v).toFixed(2) + " MAD" : "-"; }
              }
            }),
            new StepInput({
              value: "{createModel>quantity}",
              min: 1,
              max: 99999999,
              width: "110px",
              change: function () {
                recalculateTotal();
              }
            }),
            new Text({
              parts: [
                { path: "createModel>price" },
                { path: "createModel>quantity" }
              ],
              formatter: function (p, q) {
                const nP = Number(p) || 0;
                const nQ = Number(q) || 0;
                return (nP * nQ).toFixed(2) + " MAD";
              }
            }),
            new Button({
              icon: "sap-icon://delete",
              type: "Transparent",
              tooltip: "Supprimer cet article",
              press: function (oEvent) {
                const oCtx = oEvent.getSource().getBindingContext("createModel");
                const oTarget = oCtx.getObject();
                let aCur = oModel.getProperty("/items") || [];
                aCur = aCur.filter(function (it) { return it !== oTarget; });
                oModel.setProperty("/items", aCur);
                recalculateTotal();
              }
            })
          ]
        })
      });

      // 3. Barre de total estimé
      const oTotalToolbar = new OverflowToolbar({
        content: [
          new Title({
            text: {
              path: "createModel>/totalEstimated",
              formatter: function (t) {
                return "Montant Total Estimé : " + (t || "0.00") + " MAD";
              }
            },
            level: "H3"
          })
        ]
      });

      // 4. Boîte de dialogue modale principale
      const oDialog = new Dialog({
        title: "Créer une Demande d'Achat",
        contentWidth: "850px",
        contentHeight: "auto",
        resizable: true,
        draggable: true,
        busy: "{createModel>/busy}",
        content: [
          new VBox({
            class: "sapUiResponsiveContentPadding",
            items: [
              oHeaderPanel,
              oItemsTable,
              oTotalToolbar
            ]
          })
        ],
        beginButton: new Button({
          text: "Créer la demande",
          icon: "sap-icon://save",
          type: "Emphasized",
          press: function () {
            const sDesc = (oModel.getProperty("/description") || "").trim();
            const aItems = oModel.getProperty("/items") || [];

            if (!sDesc) {
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

            oModel.setProperty("/busy", true);

            const oPayload = {
              description: sDesc,
              items: aItems.map(function (it) {
                return {
                  product_ID: it.product_ID,
                  quantity: parseInt(it.quantity, 10)
                };
              })
            };

            fetch("/odata/v4/procurement/PurchaseRequests", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              },
              body: JSON.stringify(oPayload)
            })
              .then(async function (response) {
                oModel.setProperty("/busy", false);
                if (response.status === 201) {
                  const oCreated = await response.json();
                  oDialog.close();
                  MessageToast.show(
                    "Demande d'achat " + (oCreated.number || "") + " créée avec succès (statut : Brouillon)."
                  );
                  // Rafraîchir la table Fiori Elements
                  try {
                    if (that.base && that.base.getExtensionAPI()) {
                      that.base.getExtensionAPI().refresh();
                    }
                  } catch (_) {}
                } else {
                  let sErr = "Erreur lors de la création de la demande (" + response.status + ").";
                  try {
                    const oErr = await response.json();
                    if (oErr.error && oErr.error.message) {
                      sErr = oErr.error.message;
                    }
                  } catch (_) {}
                  MessageBox.error(sErr);
                }
              })
              .catch(function (err) {
                oModel.setProperty("/busy", false);
                MessageBox.error("Erreur réseau : " + (err.message || err));
              });
          }
        }),
        endButton: new Button({
          text: "Annuler",
          type: "Transparent",
          press: function () {
            oDialog.close();
          }
        }),
        afterClose: function () {
          oDialog.destroy();
          that._oCreateDialog = null;
        }
      });

      this._oCreateDialog = oDialog;
      oDialog.setModel(oModel, "createModel");

      if (this.base && this.base.getView()) {
        this.base.getView().addDependent(oDialog);
      }

      oDialog.open();
    }
  });
});
