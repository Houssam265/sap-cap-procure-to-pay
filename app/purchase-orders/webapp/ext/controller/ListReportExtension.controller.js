sap.ui.define(
  [
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/model/json/JSONModel",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Text",
    "sap/m/Title",
    "sap/m/Table",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/StepInput",
    "sap/m/ObjectStatus",
    "sap/m/OverflowToolbar",
    "sap/m/ToolbarSpacer",
    "sap/m/VBox",
    "sap/m/CheckBox",
    "sap/m/HBox",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
  ],
  function (
    ControllerExtension,
    JSONModel,
    Dialog,
    Button,
    Text,
    Title,
    Table,
    Column,
    ColumnListItem,
    StepInput,
    ObjectStatus,
    OverflowToolbar,
    ToolbarSpacer,
    VBox,
    CheckBox,
    HBox,
    MessageBox,
    MessageToast
  ) {
    "use strict";

    return ControllerExtension.extend("purchaseorders.ext.controller.ListReportExtension", {
      override: {
        onInit: function () {
          this._oReceiveDialog = null;
        }
      },

      onReceivePress: function () {
        // Récupère le contexte de ligne sélectionné
        var aContexts = [];
        try {
          if (this.base && this.base.getExtensionAPI) {
            aContexts = this.base.getExtensionAPI().getSelectedContexts();
          }
        } catch {
          /* empty */
        }

        if (!aContexts || aContexts.length === 0) {
          MessageBox.information("Veuillez sélectionner une commande à réceptionner.");
          return;
        }

        var oContext = aContexts[0];
        var oData = oContext.getObject();
        this._openReceiveDialog(oData);
      },

      _openReceiveDialog: function (oPoData) {
        var that = this;
        var sPoId = oPoData.ID;
        var sPoNumber = oPoData.number || sPoId;

        if (this._oReceiveDialog && this._oReceiveDialog.isOpen()) {
          return;
        }

        var oModel = new JSONModel({
          lines: [],
          busy: false,
          allReceive: false
        });

        // Charger les articles de la commande avec les quantités restantes
        fetch("/odata/v4/procurement/PurchaseOrderItems?$filter=order_ID eq " + sPoId + "&$expand=product", {
          headers: { Accept: "application/json" }
        })
          .then(function (res) {
            return res.json();
          })
          .then(function (data) {
            var aLines = (data.value || []).map(function (item) {
              var remaining = Math.max(0, (item.quantity || 0) - (item.receivedQuantity || 0));
              return {
                ID: item.ID,
                product_ID: item.product_ID,
                productCode: item.product ? item.product.code : item.product_ID,
                productName: item.product ? item.product.name : "—",
                ordered: item.quantity || 0,
                received: item.receivedQuantity || 0,
                remaining: remaining,
                toReceive: remaining // par défaut : tout le restant
              };
            });
            oModel.setProperty("/lines", aLines);
          })
          .catch(function (err) {
            // eslint-disable-next-line no-console
            console.error("Erreur chargement articles commande:", err);
            MessageBox.error("Impossible de charger les articles de la commande : " + (err.message || err));
          });

        // Table de réception
        var oTable = new Table({
          headerToolbar: new OverflowToolbar({
            content: [
              new Title({ text: "Articles à réceptionner — Commande " + sPoNumber, level: "H3" }),
              new ToolbarSpacer(),
              new Button({
                text: "Tout réceptionner",
                icon: "sap-icon://accept",
                type: "Emphasized",
                press: function () {
                  var aLines = oModel.getProperty("/lines");
                  aLines.forEach(function (line) {
                    line.toReceive = line.remaining;
                  });
                  oModel.setProperty("/lines", aLines);
                }
              }),
              new Button({
                text: "Tout à 0",
                icon: "sap-icon://clear-all",
                type: "Transparent",
                press: function () {
                  var aLines = oModel.getProperty("/lines");
                  aLines.forEach(function (line) {
                    line.toReceive = 0;
                  });
                  oModel.setProperty("/lines", aLines);
                }
              })
            ]
          }),
          columns: [
            new Column({ header: new Text({ text: "Code" }), width: "12%" }),
            new Column({ header: new Text({ text: "Désignation" }), width: "28%" }),
            new Column({ header: new Text({ text: "Commandé" }), hAlign: "End", width: "12%" }),
            new Column({ header: new Text({ text: "Déjà reçu" }), hAlign: "End", width: "12%" }),
            new Column({ header: new Text({ text: "Restant" }), hAlign: "End", width: "12%" }),
            new Column({ header: new Text({ text: "À recevoir" }), hAlign: "Center", width: "24%" })
          ]
        });

        oTable.bindItems({
          path: "receiveModel>/lines",
          template: new ColumnListItem({
            cells: [
              new Text({ text: "{receiveModel>productCode}" }),
              new Text({ text: "{receiveModel>productName}" }),
              new Text({
                text: {
                  path: "receiveModel>ordered",
                  formatter: function (v) {
                    return (v || 0).toString();
                  }
                }
              }),
              new ObjectStatus({
                text: {
                  path: "receiveModel>received",
                  formatter: function (v) {
                    return (v || 0).toString();
                  }
                },
                state: "Information"
              }),
              new ObjectStatus({
                text: {
                  path: "receiveModel>remaining",
                  formatter: function (v) {
                    return (v || 0).toString();
                  }
                },
                state: {
                  path: "receiveModel>remaining",
                  formatter: function (v) {
                    return v > 0 ? "Warning" : "Success";
                  }
                }
              }),
              new StepInput({
                value: "{receiveModel>toReceive}",
                min: 0,
                max: "{receiveModel>remaining}",
                width: "130px",
                change: function () {
                  /* valeur mise à jour via binding */
                }
              })
            ]
          })
        });

        var oDialog = new Dialog({
          title: "Enregistrer une réception",
          contentWidth: "780px",
          resizable: true,
          draggable: true,
          busy: "{receiveModel>/busy}",
          content: [
            new VBox({
              class: "sapUiSmallMargin",
              items: [oTable]
            })
          ],
          beginButton: new Button({
            text: "Valider la réception",
            icon: "sap-icon://save",
            type: "Emphasized",
            press: function () {
              var aLines = oModel.getProperty("/lines");
              var aToSend = aLines
                .map(function (line) {
                  return { product: line.product_ID, quantity: parseInt(line.toReceive, 10) || 0 };
                })
                .filter(function (l) {
                  return l.quantity > 0;
                });

              if (aToSend.length === 0) {
                MessageBox.warning("Saisissez au moins une quantité à recevoir.");
                return;
              }

              // Validation côté client : ne pas dépasser le restant
              var bOverflow = false;
              for (var i = 0; i < aLines.length; i++) {
                var line = aLines[i];
                var toRec = parseInt(line.toReceive, 10) || 0;
                if (toRec > line.remaining) {
                  MessageBox.error(
                    "La quantité à recevoir pour « " +
                      line.productName +
                      " » (" +
                      toRec +
                      ") dépasse le restant (" +
                      line.remaining +
                      ")."
                  );
                  bOverflow = true;
                  break;
                }
              }
              if (bOverflow) return;

              oModel.setProperty("/busy", true);

              fetch("/odata/v4/procurement/PurchaseOrders(ID=" + sPoId + ")/receive", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ items: aToSend })
              })
                .then(async function (response) {
                  oModel.setProperty("/busy", false);
                  var oBody = null;
                  try {
                    oBody = await response.json();
                  } catch {
                    /* ignore */
                  }

                  if (response.ok) {
                    oDialog.close();
                    var sMsg =
                      (oBody &&
                        oBody["@Common.Messages"] &&
                        oBody["@Common.Messages"][0] &&
                        oBody["@Common.Messages"][0].message) ||
                      "Réception enregistrée avec succès.";
                    MessageToast.show(sMsg, { duration: 5000 });
                    // Rafraîchir la liste Fiori Elements
                    try {
                      if (that.base && that.base.getExtensionAPI()) {
                        that.base.getExtensionAPI().refresh();
                      }
                    } catch {
                      /* ignore */
                    }
                  } else {
                    var sErr = "Erreur lors de l'enregistrement de la réception (" + response.status + ").";
                    if (oBody && oBody.error && oBody.error.message) {
                      sErr = oBody.error.message;
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
            that._oReceiveDialog = null;
          }
        });

        this._oReceiveDialog = oDialog;
        oDialog.setModel(oModel, "receiveModel");

        if (this.base && this.base.getView()) {
          this.base.getView().addDependent(oDialog);
        }

        oDialog.open();
      }
    });
  }
);
