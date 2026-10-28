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
  email : String(100) @mandatory @assert.format: '^[\w\.\-]+@[\w\-]+(\.[\w\-]+)+$';
  phone : String(30);
  city  : String(60);
}

entity Products : cuid, managed {
  code     : String(20)    @mandatory;
  name     : String(100)   @mandatory;
  unit     : String(10)    default 'PCS';
  price    : Decimal(10,2) @mandatory @assert.range: [ 0.01, 99999999.99 ];
  stock    : Integer       default 0  @assert.range: [ 0, 99999999 ];
  minStock : Integer       default 5  @assert.range: [ 0, 99999999 ];
  currency : String(3)     default 'MAD';
  lowStock : Boolean = (stock < minStock);
  supplier : Association to Suppliers @mandatory;
}

entity PurchaseRequests : cuid, managed {
  number      : String(20);
  description : String(200)   @mandatory;
  status      : Status        default 'DRAFT';
  totalAmount : Decimal(12,2) default 0 @assert.range: [ 0, 9999999999.99 ];
  currency    : String(3)     default 'MAD';
  items       : Composition of many PurchaseRequestItems on items.request = $self;
}

entity PurchaseRequestItems : cuid {
  request  : Association to PurchaseRequests;
  product  : Association to Products @mandatory;
  quantity : Integer         @mandatory @assert.range: [ 1, 99999999 ];
  price    : Decimal(10,2)   @assert.range: [ 0.01, 99999999.99 ];
  currency : String(3)       default 'MAD';
}

entity PurchaseOrders : cuid, managed {
  number      : String(20);
  request     : Association to PurchaseRequests;
  supplier    : Association to Suppliers @mandatory;
  status      : OrderStatus   default 'OPEN';
  totalAmount : Decimal(12,2) default 0 @assert.range: [ 0, 9999999999.99 ];
  currency    : String(3)     default 'MAD';
  items       : Composition of many PurchaseOrderItems on items.order = $self;
  receipts    : Association to many GoodsReceipts on receipts.order = $self;
}

entity PurchaseOrderItems : cuid {
  order            : Association to PurchaseOrders;
  product          : Association to Products @mandatory;
  quantity         : Integer       @mandatory @assert.range: [ 1, 99999999 ];
  receivedQuantity : Integer       default 0  @assert.range: [ 0, 99999999 ];
  price            : Decimal(10,2) @assert.range: [ 0.01, 99999999.99 ];
  currency         : String(3)     default 'MAD';
}

entity GoodsReceipts : cuid, managed {
  number      : String(20);
  order       : Association to PurchaseOrders @mandatory;
  postingDate : Date;
  items       : Composition of many GoodsReceiptItems on items.receipt = $self;
}

entity GoodsReceiptItems : cuid {
  receipt   : Association to GoodsReceipts;
  orderItem : Association to PurchaseOrderItems;
  product   : Association to Products @mandatory;
  quantity  : Integer @mandatory @assert.range: [ 1, 99999999 ];
}

entity StockMovements : cuid, managed {
  product      : Association to Products @mandatory;
  quantity     : Integer @mandatory @assert.range: [ 1, 99999999 ];
  type         : MovementType @mandatory;
  documentRef  : String(50);
  movementDate : DateTime;
}