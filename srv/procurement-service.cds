using pt from '../db/schema';

service ProcurementService @(requires: 'authenticated-user') {

  @restrict: [
    { grant: 'READ', to: 'authenticated-user' },
    { grant: '*', to: 'Admin' }
  ]
  entity Suppliers as projection on pt.Suppliers;

  @restrict: [
    { grant: 'READ', to: 'authenticated-user' },
    { grant: '*', to: 'Admin' }
  ]
  entity Products as projection on pt.Products;

  @restrict: [
    { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'submit'], to: 'Requester', where: 'createdBy = $user' },
    { grant: '*', to: ['Manager', 'Admin'] }
  ]
  entity PurchaseRequests as projection on pt.PurchaseRequests actions {
    @(requires: 'Requester')
    action submit() returns PurchaseRequests;
    @(requires: 'Manager')
    action approve() returns PurchaseRequests;
    @(requires: 'Manager')
    action decline() returns PurchaseRequests;
    @(requires: 'Manager')
    action createPurchaseOrder() returns array of PurchaseOrders;
  };

  @restrict: [
    { grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'], to: 'Requester', where: 'request.createdBy = $user' },
    { grant: '*', to: ['Manager', 'Admin'] }
  ]
  entity PurchaseRequestItems as projection on pt.PurchaseRequestItems;

  type ReceiptItemInput {
    product  : UUID;
    quantity : Integer;
  }

  @readonly
  @restrict: [
    { grant: ['READ', 'receive'], to: 'Warehouse' },
    { grant: 'READ', to: 'Manager' },
    { grant: '*', to: 'Admin' }
  ]
  entity PurchaseOrders as projection on pt.PurchaseOrders actions {
    @(requires: 'Warehouse')
    action receive(items : array of ReceiptItemInput) returns GoodsReceipts;
  };

  @readonly
  @restrict: [
    { grant: 'READ', to: ['Warehouse', 'Manager', 'Admin'] }
  ]
  entity PurchaseOrderItems as projection on pt.PurchaseOrderItems;

  @readonly
  @restrict: [
    { grant: 'READ', to: ['Warehouse', 'Manager', 'Admin'] }
  ]
  entity GoodsReceipts as projection on pt.GoodsReceipts;

  @readonly
  @restrict: [
    { grant: 'READ', to: ['Warehouse', 'Manager', 'Admin'] }
  ]
  entity GoodsReceiptItems as projection on pt.GoodsReceiptItems;

  @readonly
  @restrict: [
    { grant: 'READ', to: ['Warehouse', 'Manager', 'Admin'] }
  ]
  entity StockMovements as projection on pt.StockMovements;
}