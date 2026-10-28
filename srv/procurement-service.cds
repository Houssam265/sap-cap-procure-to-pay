using pt from '../db/schema';

service ProcurementService {
  entity Suppliers as projection on pt.Suppliers;
  entity Products  as projection on pt.Products;

  entity PurchaseRequests as projection on pt.PurchaseRequests actions {
    action submit() returns PurchaseRequests;
    action approve() returns PurchaseRequests;
    action decline() returns PurchaseRequests;
    action createPurchaseOrder() returns array of PurchaseOrders;
  };

  entity PurchaseRequestItems as projection on pt.PurchaseRequestItems;

  type ReceiptItemInput {
    product  : UUID;
    quantity : Integer;
  }

  @readonly
  entity PurchaseOrders as projection on pt.PurchaseOrders actions {
    action receive(items : array of ReceiptItemInput) returns GoodsReceipts;
  };

  @readonly
  entity PurchaseOrderItems as projection on pt.PurchaseOrderItems;

  @readonly
  entity GoodsReceipts as projection on pt.GoodsReceipts;

  @readonly
  entity GoodsReceiptItems as projection on pt.GoodsReceiptItems;

  @readonly
  entity StockMovements as projection on pt.StockMovements;
}