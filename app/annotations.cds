using ProcurementService as service from '../srv/procurement-service';

// =============================================================================
// 1. DEMANDES D'ACHAT (PurchaseRequests & PurchaseRequestItems)
// =============================================================================

annotate service.PurchaseRequests with @(
  UI.HeaderInfo: {
    TypeName: 'Demande d''achat',
    TypeNamePlural: 'Demandes d''achat',
    Title: { $Type: 'UI.DataField', Value: number },
    Description: { $Type: 'UI.DataField', Value: description }
  },
  UI.SelectionFields: [
    number,
    status,
    createdBy,
    createdAt
  ],
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: number,
      Label: 'N° Demande'
    },
    {
      $Type: 'UI.DataField',
      Value: description,
      Label: 'Description'
    },
    {
      $Type: 'UI.DataField',
      Value: status,
      Label: 'Statut',
      Criticality: statusCriticality,
      CriticalityRepresentation: #WithoutIcon
    },
    {
      $Type: 'UI.DataField',
      Value: totalAmount,
      Label: 'Montant Total (MAD)'
    },
    {
      $Type: 'UI.DataField',
      Value: createdBy,
      Label: 'Demandeur'
    },
    {
      $Type: 'UI.DataField',
      Value: createdAt,
      Label: 'Date de création'
    },
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'ProcurementService.submit',
      Label: 'Soumettre',
      InvocationGrouping: #ChangeSet,
      ![@UI.Hidden]: isSubmitHidden
    },
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'ProcurementService.approve',
      Label: 'Approuver',
      InvocationGrouping: #ChangeSet,
      ![@UI.Hidden]: isManagerActionHidden
    },
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'ProcurementService.decline',
      Label: 'Refuser',
      InvocationGrouping: #ChangeSet,
      ![@UI.Hidden]: isManagerActionHidden
    },
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'ProcurementService.createPurchaseOrder',
      Label: 'Générer Commandes',
      InvocationGrouping: #ChangeSet,
      ![@UI.Hidden]: isManagerActionHidden
    }
  ],
  UI.Identification: [
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'ProcurementService.submit',
      Label: 'Soumettre la demande',
      ![@UI.Hidden]: isSubmitHidden
    },
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'ProcurementService.approve',
      Label: 'Approuver la demande',
      ![@UI.Hidden]: isManagerActionHidden
    },
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'ProcurementService.decline',
      Label: 'Refuser la demande',
      ![@UI.Hidden]: isManagerActionHidden
    },
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'ProcurementService.createPurchaseOrder',
      Label: 'Générer les commandes d''achat',
      ![@UI.Hidden]: isManagerActionHidden
    }
  ],
  UI.Facets: [
    {
      $Type: 'UI.CollectionFacet',
      ID: 'GeneralInfoFacet',
      Label: 'Informations Générales',
      Facets: [
        {
          $Type: 'UI.ReferenceFacet',
          ID: 'MainGroup',
          Label: 'Détails de la demande',
          Target: '@UI.FieldGroup#General'
        },
        {
          $Type: 'UI.ReferenceFacet',
          ID: 'AuditGroup',
          Label: 'Traçabilité & Audit',
          Target: '@UI.FieldGroup#Audit'
        }
      ]
    },
    {
      $Type: 'UI.ReferenceFacet',
      ID: 'ItemsFacet',
      Label: 'Articles demandés',
      Target: 'items/@UI.LineItem'
    }
  ],
  UI.FieldGroup #General: {
    Data: [
      { $Type: 'UI.DataField', Value: number, Label: 'N° Demande' },
      { $Type: 'UI.DataField', Value: description, Label: 'Description' },
      {
        $Type: 'UI.DataField',
        Value: status,
        Label: 'Statut actuel',
        Criticality: statusCriticality,
        CriticalityRepresentation: #WithoutIcon
      },
      {
        $Type: 'UI.DataField',
        Value: rejectionReason,
        Label: 'Motif du refus',
        ![@UI.Hidden]: isRejectionReasonHidden
      },
      { $Type: 'UI.DataField', Value: totalAmount, Label: 'Montant Total' },
      { $Type: 'UI.DataField', Value: currency, Label: 'Devise' }
    ]
  },
  UI.FieldGroup #Audit: {
    Data: [
      { $Type: 'UI.DataField', Value: createdBy, Label: 'Créé par' },
      { $Type: 'UI.DataField', Value: createdAt, Label: 'Date de création' },
      { $Type: 'UI.DataField', Value: modifiedBy, Label: 'Modifié par' },
      { $Type: 'UI.DataField', Value: modifiedAt, Label: 'Dernière modification' }
    ]
  }
);

annotate service.PurchaseRequestItems with @(
  UI.HeaderInfo: {
    TypeName: 'Article de la demande',
    TypeNamePlural: 'Articles de la demande',
    Title: { $Type: 'UI.DataField', Value: product.name }
  },
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: product.code,
      Label: 'Code Produit'
    },
    {
      $Type: 'UI.DataField',
      Value: product.name,
      Label: 'Désignation Produit'
    },
    {
      $Type: 'UI.DataField',
      Value: quantity,
      Label: 'Quantité demandée'
    },
    {
      $Type: 'UI.DataField',
      Value: price,
      Label: 'Prix unitaire (MAD)'
    },
    {
      $Type: 'UI.DataField',
      Value: currency,
      Label: 'Devise'
    }
  ]
);

// =============================================================================
// 2. COMMANDES D'ACHAT (PurchaseOrders & PurchaseOrderItems)
// =============================================================================

annotate service.PurchaseOrders with @(
  UI.HeaderInfo: {
    TypeName: 'Commande d''achat',
    TypeNamePlural: 'Commandes d''achat',
    Title: { $Type: 'UI.DataField', Value: number },
    Description: { $Type: 'UI.DataField', Value: supplier.name }
  },
  UI.SelectionFields: [
    number,
    status,
    supplier_ID,
    createdAt
  ],
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: number,
      Label: 'N° Commande'
    },
    {
      $Type: 'UI.DataField',
      Value: supplier.name,
      Label: 'Fournisseur'
    },
    {
      $Type: 'UI.DataField',
      Value: status,
      Label: 'Statut',
      Criticality: statusCriticality,
      CriticalityRepresentation: #WithoutIcon
    },
    {
      $Type: 'UI.DataField',
      Value: totalAmount,
      Label: 'Montant Total (MAD)'
    },
    {
      $Type: 'UI.DataField',
      Value: request.number,
      Label: 'Demande source'
    },
    {
      $Type: 'UI.DataField',
      Value: createdAt,
      Label: 'Date d''émission'
    },
  ],
  UI.Identification: [
    {
      $Type: 'UI.DataFieldForAction',
      Action: 'ProcurementService.receive',
      Label: 'Enregistrer la réception',
      ![@UI.Hidden]: isWarehouseActionHidden
    }
  ],
  UI.Facets: [
    {
      $Type: 'UI.CollectionFacet',
      ID: 'PoGeneralInfo',
      Label: 'Informations Commande',
      Facets: [
        {
          $Type: 'UI.ReferenceFacet',
          ID: 'PoDetails',
          Label: 'Détails de la commande',
          Target: '@UI.FieldGroup#PoGeneral'
        },
        {
          $Type: 'UI.ReferenceFacet',
          ID: 'PoSupplier',
          Label: 'Coordonnées Fournisseur',
          Target: '@UI.FieldGroup#SupplierDetails'
        }
      ]
    },
    {
      $Type: 'UI.ReferenceFacet',
      ID: 'PoItemsFacet',
      Label: 'Articles commandés',
      Target: 'items/@UI.LineItem'
    },
    {
      $Type: 'UI.ReferenceFacet',
      ID: 'PoReceiptsFacet',
      Label: 'Historique des réceptions',
      Target: 'receipts/@UI.LineItem'
    }
  ],
  UI.FieldGroup #PoGeneral: {
    Data: [
      { $Type: 'UI.DataField', Value: number, Label: 'N° Commande' },
      {
        $Type: 'UI.DataField',
        Value: status,
        Label: 'Statut',
        Criticality: statusCriticality,
        CriticalityRepresentation: #WithoutIcon
      },
      { $Type: 'UI.DataField', Value: totalAmount, Label: 'Montant Total' },
      { $Type: 'UI.DataField', Value: currency, Label: 'Devise' },
      { $Type: 'UI.DataField', Value: request.number, Label: 'Demande d''achat source' },
      { $Type: 'UI.DataField', Value: createdAt, Label: 'Date de création' }
    ]
  },
  UI.FieldGroup #SupplierDetails: {
    Data: [
      { $Type: 'UI.DataField', Value: supplier.name, Label: 'Raison sociale' },
      { $Type: 'UI.DataField', Value: supplier.email, Label: 'Email' },
      { $Type: 'UI.DataField', Value: supplier.phone, Label: 'Téléphone' },
      { $Type: 'UI.DataField', Value: supplier.city, Label: 'Ville' }
    ]
  }
);

annotate service.PurchaseOrderItems with @(
  UI.HeaderInfo: {
    TypeName: 'Ligne de commande',
    TypeNamePlural: 'Lignes de commande',
    Title: { $Type: 'UI.DataField', Value: product.name }
  },
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: product.code,
      Label: 'Code Produit'
    },
    {
      $Type: 'UI.DataField',
      Value: product.name,
      Label: 'Désignation'
    },
    {
      $Type: 'UI.DataField',
      Value: quantity,
      Label: 'Quantité commandée'
    },
    {
      $Type: 'UI.DataField',
      Value: receivedQuantity,
      Label: 'Quantité réceptionnée'
    },
    {
      $Type: 'UI.DataField',
      Value: price,
      Label: 'Prix unitaire (MAD)'
    },
    {
      $Type: 'UI.DataField',
      Value: currency,
      Label: 'Devise'
    }
  ]
);

annotate service.GoodsReceipts with @(
  UI.HeaderInfo: {
    TypeName: 'Bon de réception',
    TypeNamePlural: 'Bons de réception',
    Title: { $Type: 'UI.DataField', Value: number }
  },
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: number,
      Label: 'N° Bon de Réception'
    },
    {
      $Type: 'UI.DataField',
      Value: postingDate,
      Label: 'Date de comptabilisation'
    },
    {
      $Type: 'UI.DataField',
      Value: createdBy,
      Label: 'Réceptionné par (Magasinier)'
    },
    {
      $Type: 'UI.DataField',
      Value: createdAt,
      Label: 'Date d''enregistrement'
    }
  ]
);

// =============================================================================
// 3. CATALOGUE PRODUITS (Products avec alerte Stock Bas)
// =============================================================================

annotate service.Products with @(
  UI.HeaderInfo: {
    TypeName: 'Produit',
    TypeNamePlural: 'Produits',
    Title: { $Type: 'UI.DataField', Value: name },
    Description: { $Type: 'UI.DataField', Value: code }
  },
  UI.SelectionFields: [
    code,
    name,
    supplier_ID
  ],
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: code,
      Label: 'Code'
    },
    {
      $Type: 'UI.DataField',
      Value: name,
      Label: 'Désignation'
    },
    {
      $Type: 'UI.DataField',
      Value: price,
      Label: 'Prix unitaire (MAD)'
    },
    {
      $Type: 'UI.DataField',
      Value: stock,
      Label: 'Stock disponible',
      Criticality: lowStockCriticality,
      CriticalityRepresentation: #WithoutIcon
    },
    {
      $Type: 'UI.DataField',
      Value: minStock,
      Label: 'Stock minimum'
    },
    {
      $Type: 'UI.DataField',
      Value: lowStock,
      Label: 'Alerte Réapprovisionnement',
      Criticality: lowStockCriticality,
      CriticalityRepresentation: #WithIcon
    },
    {
      $Type: 'UI.DataField',
      Value: supplier.name,
      Label: 'Fournisseur principal'
    }
  ],
  UI.Facets: [
    {
      $Type: 'UI.ReferenceFacet',
      ID: 'ProductGeneralInfo',
      Label: 'Fiche Produit',
      Target: '@UI.FieldGroup#ProductDetails'
    },
    {
      $Type: 'UI.ReferenceFacet',
      ID: 'ProductSupplierInfo',
      Label: 'Fournisseur Attitré',
      Target: '@UI.FieldGroup#ProductSupplier'
    }
  ],
  UI.FieldGroup #ProductDetails: {
    Data: [
      { $Type: 'UI.DataField', Value: code, Label: 'Code Référence' },
      { $Type: 'UI.DataField', Value: name, Label: 'Désignation' },
      { $Type: 'UI.DataField', Value: price, Label: 'Prix unitaire' },
      { $Type: 'UI.DataField', Value: currency, Label: 'Devise' },
      {
        $Type: 'UI.DataField',
        Value: stock,
        Label: 'Stock physique en magasin',
        Criticality: lowStockCriticality
      },
      { $Type: 'UI.DataField', Value: minStock, Label: 'Seuil d''alerte (Stock minimum)' },
      {
        $Type: 'UI.DataField',
        Value: lowStock,
        Label: 'Niveau critique atteint',
        Criticality: lowStockCriticality
      }
    ]
  },
  UI.FieldGroup #ProductSupplier: {
    Data: [
      { $Type: 'UI.DataField', Value: supplier.name, Label: 'Fournisseur' },
      { $Type: 'UI.DataField', Value: supplier.email, Label: 'Email contact' },
      { $Type: 'UI.DataField', Value: supplier.phone, Label: 'Téléphone' }
    ]
  }
);

// =============================================================================
// 4. MOUVEMENTS DE STOCK (StockMovements - Consultation seule)
// =============================================================================

annotate service.StockMovements with @(
  UI.HeaderInfo: {
    TypeName: 'Mouvement de stock',
    TypeNamePlural: 'Mouvements de stock',
    Title: { $Type: 'UI.DataField', Value: documentRef }
  },
  UI.SelectionFields: [
    product_ID,
    type,
    movementDate
  ],
  UI.LineItem: [
    {
      $Type: 'UI.DataField',
      Value: movementDate,
      Label: 'Date & Heure'
    },
    {
      $Type: 'UI.DataField',
      Value: type,
      Label: 'Sens du flux (IN/OUT)'
    },
    {
      $Type: 'UI.DataField',
      Value: product.code,
      Label: 'Code Produit'
    },
    {
      $Type: 'UI.DataField',
      Value: product.name,
      Label: 'Désignation Produit'
    },
    {
      $Type: 'UI.DataField',
      Value: quantity,
      Label: 'Quantité mouvementée'
    },
    {
      $Type: 'UI.DataField',
      Value: documentRef,
      Label: 'Pièce justificative (Réf. Document)'
    },
    {
      $Type: 'UI.DataField',
      Value: createdBy,
      Label: 'Opérateur'
    }
  ]
);

// =============================================================================
// Annotations génériques des entités (Common.Label)
// =============================================================================

annotate service.Suppliers with {
  ID    @UI.Hidden;
  name  @Common.Label: 'Nom du Fournisseur';
  email @Common.Label: 'Email';
  phone @Common.Label: 'Téléphone';
};

annotate service.Products with {
  ID       @UI.Hidden;
  code     @Common.Label: 'Code Produit';
  name     @Common.Label: 'Nom du Produit';
  price    @Common.Label: 'Prix';
  currency @Common.Label: 'Devise';
  stock    @Common.Label: 'Stock actuel';
  minStock @Common.Label: 'Stock minimum';
  supplier @Common.Label: 'Fournisseur';
};

annotate service.PurchaseRequests with @(
  Capabilities.DeleteRestrictions: {
    Deletable: isDeleteAllowed
  }
) {};

annotate service.PurchaseRequests with {
  ID                      @UI.Hidden;
  number                  @Common.Label: 'N° Demande';
  description             @Common.Label: 'Description';
  status                  @Common.Label: 'Statut'
                          @Common.Text: statusText
                          @Common.TextArrangement: #TextOnly;
  rejectionReason         @Common.Label: 'Motif du refus';
  totalAmount             @Common.Label: 'Montant total';
  currency                @Common.Label: 'Devise';
  statusText              @UI.Hidden;
  statusCriticality       @UI.Hidden;
  isSubmitAllowed         @UI.Hidden;
  isApproveAllowed        @UI.Hidden;
  isDeclineAllowed        @UI.Hidden;
  isPoCreationAllowed     @UI.Hidden;
  isSubmitHidden          @UI.Hidden;
  isManagerActionHidden   @UI.Hidden;
  isRejectionReasonHidden @UI.Hidden;
  isDeleteAllowed         @UI.Hidden;
};

annotate service.PurchaseRequestItems with {
  ID      @UI.Hidden;
  product @(
    Common.ValueList: {
      Label: 'Produits',
      CollectionPath: 'Products',
      Parameters: [
        { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: product_ID, ValueListProperty: 'ID' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'code' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'price' }
      ]
    },
    Common.Text: product.name,
    Common.TextArrangement: #TextFirst
  );
};

annotate service.PurchaseOrders with {
  ID                      @UI.Hidden;
  number                  @Common.Label: 'N° Commande';
  status                  @Common.Label: 'Statut'
                          @Common.Text: statusText
                          @Common.TextArrangement: #TextOnly;
  totalAmount             @Common.Label: 'Montant total';
  currency                @Common.Label: 'Devise';
  supplier                @Common.Label: 'Fournisseur';
  request                 @Common.Label: 'Demande d''achat';
  statusText              @UI.Hidden;
  statusCriticality       @UI.Hidden;
  isReceiveAllowed        @UI.Hidden;
  isWarehouseActionHidden @UI.Hidden;
};
