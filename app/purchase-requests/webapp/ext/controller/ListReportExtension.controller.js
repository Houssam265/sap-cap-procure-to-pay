sap.ui.define(
  [
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
  ],
  function (
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

        var that = this;

        var oModel = new JSONModel({
          description: "",
          items: [{ product_ID: "", quantity: 1, price: 0, subTotal: "0.00" }],
          products: [],
          totalEstimated: "0.00",
          busy: false
        });

        // Recalcul du sous-total par ligne et du total général
        function recalculateAll() {
          var aItems = oModel.getProperty("/items") || [];
          var nTotal = 0;
          aItems.forEach(function (it, idx) {
            var sub = (Number(it.price) || 0) * (Number(it.quantity) || 0);
            oModel.setProperty("/items/" + idx + "/subTotal", sub.toFixed(2));
            nTotal += sub;
          });
          oModel.setProperty("/totalEstimated", nTotal.toFixed(2));
        }

        // Charger le catalogue des produits
        fetch("/odata/v4/procurement/Products", { headers: { Accept: "application/json" } })
          .then(function (res) {
            return res.json();
          })
          .then(function (data) {
            oModel.setProperty("/products", data.value || []);
          })
          .catch(function (err) {
            // eslint-disable-next-line no-console
            console.error("Erreur produits:", err);
          });

        // --- En-tête ---
        var oHeaderPanel = new Panel({
          headerText: "Informations Générales",
          expandable: false,
          expanded: true,
          content: [
            new VBox({
              class: "sapUiSmallMargin",
              items: [
                new Label({ text: "Description de la demande *", design: "Bold" }),
                new Input({
                  value: "{createModel>/description}",
                  placeholder: "Ex: Demande de matériel informatique...",
                  maxLength: 200,
                  width: "100%"
                }),
                new HBox({
                  class: "sapUiSmallMarginTop",
                  alignItems: "Center",
                  items: [
                    new Label({ text: "Statut initial :", class: "sapUiSmallMarginEnd" }),
                    new ObjectStatus({ text: "Brouillon (DRAFT)", state: "None", class: "sapUiMediumMarginEnd" }),
                    new Label({ text: "Devise :", class: "sapUiSmallMarginEnd" }),
                    new Text({ text: "MAD (Dirham Marocain)" })
                  ]
                })
              ]
            })
          ]
        });

        // --- Table des articles ---
        var oItemsTable = new Table({
          headerToolbar: new OverflowToolbar({
            content: [
              new Title({ text: "Articles demandés", level: "H3" }),
              new ToolbarSpacer(),
              new Button({
                text: "Ajouter un article",
                icon: "sap-icon://add",
                type: "Emphasized",
                press: function () {
                  var aItems = oModel.getProperty("/items") || [];
                  aItems.push({ product_ID: "", quantity: 1, price: 0, subTotal: "0.00" });
                  oModel.setProperty("/items", aItems);
                  recalculateAll();
                }
              })
            ]
          }),
          columns: [
            new Column({ header: new Text({ text: "Produit (Désignation / Code)" }), width: "36%" }),
            new Column({ header: new Text({ text: "Prix unitaire (MAD)" }), hAlign: "End", width: "15%" }),
            new Column({ header: new Text({ text: "Quantité" }), hAlign: "Center", width: "16%" }),
            new Column({ header: new Text({ text: "Sous-Total (MAD)" }), hAlign: "End", width: "18%" }),
            new Column({ header: new Text({ text: "" }), hAlign: "Center", width: "7%" }),
            new Column({ header: new Text({ text: "" }), hAlign: "Center", width: "8%" })
          ]
        });

        oItemsTable.bindItems({
          path: "createModel>/items",
          template: new ColumnListItem({
            cells: [
              // Colonne produit
              new ComboBox({
                selectedKey: "{createModel>product_ID}",
                width: "100%",
                placeholder: "Sélectionner un produit...",
                items: {
                  path: "createModel>/products",
                  template: new Item({ key: "{createModel>ID}", text: "{createModel>name} ({createModel>code})" }),
                  templateShareable: false
                },
                change: function (oEvent) {
                  var oCombo = oEvent.getSource();
                  var sKey = oCombo.getSelectedKey();
                  var oCtx = oCombo.getBindingContext("createModel");
                  if (!oCtx) {
                    return;
                  }
                  var sPath = oCtx.getPath();
                  var aProds = oModel.getProperty("/products") || [];
                  var oFound = aProds.find(function (p) {
                    return p.ID === sKey;
                  });

                  // Détection de doublon
                  if (sKey) {
                    var aItems = oModel.getProperty("/items") || [];
                    var sMyPath = sPath; // ex: /items/1
                    var bDuplicate = aItems.some(function (it, idx) {
                      return it.product_ID === sKey && "/items/" + idx !== sMyPath;
                    });
                    if (bDuplicate) {
                      MessageBox.warning("Ce produit est déjà dans une autre ligne. Fusionner les quantités ?", {
                        actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                        onClose: function (sAction) {
                          if (sAction === MessageBox.Action.YES) {
                            var aAll = oModel.getProperty("/items");
                            var idxSelf = parseInt(sMyPath.replace("/items/", ""), 10);
                            var idxOther = -1;
                            aAll.forEach(function (it, i) {
                              if (it.product_ID === sKey && i !== idxSelf) {
                                idxOther = i;
                              }
                            });
                            if (idxOther >= 0) {
                              var mergedQty =
                                (Number(aAll[idxSelf].quantity) || 1) + (Number(aAll[idxOther].quantity) || 1);
                              oModel.setProperty("/items/" + idxOther + "/quantity", mergedQty);
                              aAll.splice(idxSelf, 1);
                              oModel.setProperty("/items", aAll);
                            }
                          } else {
                            oModel.setProperty(sPath + "/product_ID", "");
                            oCombo.setSelectedKey("");
                          }
                          recalculateAll();
                        }
                      });
                      return;
                    }
                  }

                  oModel.setProperty(sPath + "/product_ID", sKey);
                  oModel.setProperty(sPath + "/price", oFound ? Number(oFound.price) || 0 : 0);
                  recalculateAll();
                }
              }),
              // Prix unitaire
              new Text({
                text: {
                  path: "createModel>price",
                  formatter: function (v) {
                    return v !== undefined && v !== null ? Number(v).toFixed(2) : "—";
                  }
                }
              }),
              // Quantité
              new StepInput({
                value: "{createModel>quantity}",
                min: 1,
                max: 99999999,
                width: "110px",
                change: function () {
                  recalculateAll();
                }
              }),
              // Sous-total calculé
              new ObjectStatus({
                text: {
                  path: "createModel>subTotal",
                  formatter: function (v) {
                    return (v || "0.00") + " MAD";
                  }
                },
                state: "Information"
              }),
              // Supprimer
              new Button({
                icon: "sap-icon://delete",
                type: "Transparent",
                tooltip: "Supprimer cet article",
                press: function (oEvent) {
                  var oCtx = oEvent.getSource().getBindingContext("createModel");
                  var oTarget = oCtx.getObject();
                  var aCur = (oModel.getProperty("/items") || []).filter(function (it) {
                    return it !== oTarget;
                  });
                  oModel.setProperty("/items", aCur);
                  recalculateAll();
                }
              }),
              // Spacer
              new Text({ text: "" })
            ]
          })
        });

        // --- Barre de total ---
        var oTotalBar = new OverflowToolbar({
          content: [
            new ToolbarSpacer(),
            new ObjectStatus({
              text: {
                path: "createModel>/totalEstimated",
                formatter: function (t) {
                  return "Montant Total Estimé : " + (t || "0.00") + " MAD";
                }
              },
              state: "Success"
            })
          ]
        });

        // --- Dialogue principal ---
        var oDialog = new Dialog({
          title: "Créer une Demande d'Achat",
          contentWidth: "870px",
          resizable: true,
          draggable: true,
          busy: "{createModel>/busy}",
          content: [
            new VBox({
              class: "sapUiResponsiveContentPadding",
              items: [oHeaderPanel, oItemsTable, oTotalBar]
            })
          ],
          beginButton: new Button({
            text: "Créer la demande",
            icon: "sap-icon://save",
            type: "Emphasized",
            press: function () {
              var sDesc = (oModel.getProperty("/description") || "").trim();
              var aItems = oModel.getProperty("/items") || [];

              if (!sDesc) {
                MessageBox.error("La description de la demande d'achat est obligatoire.");
                return;
              }
              if (aItems.length === 0) {
                MessageBox.error("Veuillez ajouter au moins un article.");
                return;
              }
              for (var i = 0; i < aItems.length; i++) {
                if (!aItems[i].product_ID) {
                  MessageBox.error("Veuillez sélectionner un produit pour la ligne #" + (i + 1) + ".");
                  return;
                }
                var nQty = Number(aItems[i].quantity);
                if (isNaN(nQty) || nQty < 1) {
                  MessageBox.error("La quantité de la ligne #" + (i + 1) + " doit être ≥ 1.");
                  return;
                }
              }

              oModel.setProperty("/busy", true);
              var oPayload = {
                description: sDesc,
                items: aItems.map(function (it) {
                  return { product_ID: it.product_ID, quantity: parseInt(it.quantity, 10) };
                })
              };

              fetch("/odata/v4/procurement/PurchaseRequests", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(oPayload)
              })
                .then(async function (response) {
                  oModel.setProperty("/busy", false);
                  if (response.status === 201) {
                    var oCreated = await response.json();
                    oDialog.close();
                    MessageToast.show(
                      "Demande " + (oCreated.number || "") + " créée avec succès (statut : Brouillon)."
                    );
                    try {
                      if (that.base && that.base.getExtensionAPI()) {
                        that.base.getExtensionAPI().refresh();
                      }
                    } catch {
                      /* ignore */
                    }
                  } else {
                    var sErr = "Erreur (" + response.status + ").";
                    try {
                      var oErr = await response.json();
                      if (oErr.error && oErr.error.message) {
                        sErr = oErr.error.message;
                      }
                    } catch {
                      /* ignore */
                    }
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
  }
);
