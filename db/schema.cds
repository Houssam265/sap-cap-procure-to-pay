namespace pt;

using { cuid, managed } from '@sap/cds/common';

type Status : String(20) enum {
  DRAFT;
  SUBMITTED;
  APPROVED;
  REJECTED;
}

type OrderStatus : String(20) enum {
  OPEN;
  PARTIALLY_RECEIVED;
  RECEIVED;
  CANCELLED;
}

type MovementType : String(10) enum {
  ![IN];
  OUT;
}

entity Suppliers : cuid, managed {
  name  : String(100) @mandatory;
  email : String(100);
  phone : String(30);
  city  : String(60);
}

entity Products : cuid, managed {
  code     : String(20)  @mandatory;
  name     : String(100) @mandatory;
  unit     : String(10)  default 'PCS';
  price    : Decimal(10,2);
  stock    : Integer     default 0;
  minStock : Integer     default 5;
  lowStock : Boolean = (stock < minStock);
  supplier : Association to Suppliers;
}

entity PurchaseRequests : cuid, managed {
  number      : String(20);
  description : String(200);
  status      : Status default 'DRAFT';
  totalAmount : Decimal(12,2) default 0;
  items       : Composition of many PurchaseRequestItems on items.request = $self;
}

entity PurchaseRequestItems : cuid {
  request  : Association to PurchaseRequests;
  product  : Association to Products;
  quantity : Integer;
  price    : Decimal(10,2);
}

entity PurchaseOrders : cuid, managed {
  number      : String(20);
  request     : Association to PurchaseRequests;
  supplier    : Association to Suppliers;
  status      : OrderStatus default 'OPEN';
  totalAmount : Decimal(12,2) default 0;
  items       : Composition of many PurchaseOrderItems on items.order = $self;
  receipts    : Association to many GoodsReceipts on receipts.order = $self;
}

entity PurchaseOrderItems : cuid {
  order            : Association to PurchaseOrders;
  product          : Association to Products;
  quantity         : Integer;
  receivedQuantity : Integer default 0;
  price            : Decimal(10,2);
}

entity GoodsReceipts : cuid, managed {
  number      : String(20);
  order       : Association to PurchaseOrders;
  postingDate : Date;
  items       : Composition of many GoodsReceiptItems on items.receipt = $self;
}

entity GoodsReceiptItems : cuid {
  receipt   : Association to GoodsReceipts;
  orderItem : Association to PurchaseOrderItems;
  product   : Association to Products;
  quantity  : Integer;
}

entity StockMovements : cuid, managed {
  product      : Association to Products;
  quantity     : Integer;
  type         : MovementType;
  documentRef  : String(50);
  movementDate : DateTime;
}