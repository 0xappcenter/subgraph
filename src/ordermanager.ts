import { Address, BigInt, ethereum, log } from "@graphprotocol/graph-ts";
import { integer } from "@protofire/subgraph-toolkit";
import {
  OrderCancelled,
  OrderExecuted,
  OrderExecuted1,
  OrderManager,
  OrderManager__swapOrdersResult,
  OrderPlaced,
  PoolAdded,
  Swap,
  SwapOrderCancelled,
  SwapOrderExecuted,
  SwapOrderPlaced
} from "../generated/OrderManager/OrderManager";
import { LpToken } from "../generated/OrderManager/LpToken";
import { Pool as PoolContract } from "../generated/OrderManager/Pool";
import {
  Block,
  History,
  Order,
  OrderIndex,
  Pool,
  PoolDailyData,
  Protocol,
  Token,
  User
} from "../generated/schema";
import { Pool as PoolTemplate } from "../generated/templates";
import { getOrNull, LP_TOKEN, Side, SKIP_BLOCKS } from "./helpers";
import { PriceFeed } from "../generated/PriceFeed/PriceFeed";
import { loadOrCreateProtocolDailyData, storeUserDailyData } from "./pool";

function loadOrCreateProtocol(address: Address): Protocol {
  let entity = Protocol.load("1");

  if (entity != null) {
    return entity;
  }
  entity = new Protocol("1");
  entity.address = address;
  entity.totalFee = integer.ZERO;
  entity.totalVolume = integer.ZERO;
  entity.totalLongPositions = integer.ZERO;
  entity.totalShortPositions = integer.ZERO;
  entity.profit = integer.ZERO;
  entity.loss = integer.ZERO;
  entity.totalUsers = 0;
  return entity;
}

function loadOrCreatePool(address: Address, protocol: string): Pool {
  let entity = Pool.load(address.toHex());

  if (entity != null) {
    return entity;
  }
  entity = new Pool(address.toHex());
  entity.totalFee = integer.ZERO;
  entity.totalVolume = integer.ZERO;
  entity.totalLongPositions = integer.ZERO;
  entity.totalShortPositions = integer.ZERO;
  entity.protocol = protocol;
  entity.tokenCount = 0;
  return entity;
}

function loadOrCreateUser(address: Address): User {
  let entity = User.load(address.toHex());

  if (entity != null) {
    return entity;
  }
  entity = new User(address.toHex());
  entity.positionCount = 0;
  entity.orderCount = 0;
  let protocol = Protocol.load("1");
  if (protocol) {
    protocol.totalUsers = protocol.totalUsers + 1;
    protocol.save();
  }
  return entity;
}

export function handlePoolAdded(ev: PoolAdded): void {
  let protocol = loadOrCreateProtocol(ev.address);
  let pool = loadOrCreatePool(ev.params.param0, protocol.id);
  protocol.save();
  pool.save();

  // create the tracked contract based on the template
  PoolTemplate.create(ev.params.param0);
}

export function handleOrderPlaced(ev: OrderPlaced): void {
  let order = OrderManager.bind(ev.address);
  let priceFeedAddress = getOrNull<Address>(order.try_oracle());
  let priceFeed = priceFeedAddress ? PriceFeed.bind(priceFeedAddress) : null;
  let collateralPrice = priceFeed
    ? getOrNull<BigInt>(priceFeed.try_getPrice(ev.params.order.collateralToken))
    : integer.ZERO;
  let entity = new Order(ev.params.key.toHex());

  entity.owner = ev.params.order.owner;
  entity.pool = ev.params.order.pool.toHex();
  entity.market = ev.params.order.indexToken.toHex();
  entity.collateralToken = ev.params.order.collateralToken;
  entity.payToken = ev.params.order.payToken;
  entity.sizeChange = ev.params.request.sizeChange;
  entity.executionFee = ev.params.order.executionFee;
  entity.expiresAt = ev.params.order.expiresAt;
  entity.submissionBlock = ev.params.order.submissionBlock;
  entity.submissionTimestamp = ev.block.timestamp;
  entity.price = ev.params.order.price;
  entity.triggerAboveThreshold = ev.params.order.triggerAboveThreshold;
  entity.executionTimestamp = integer.ZERO;
  entity.executionPrice = integer.ZERO;
  entity.side = ev.params.request.side;
  entity.updateType =
    ev.params.request.updateType == 0 ? "INCREASE" : "DECREASE";
  entity.type = ev.params.order.expiresAt.gt(integer.ZERO) ? "MARKET" : "LIMIT";
  entity.collateralValue = collateralPrice
    ? entity.updateType === "INCREASE"
      ? ev.params.request.collateral.times(collateralPrice)
      : ev.params.request.collateral
    : integer.ZERO;
  entity.status = "OPEN";

  let orderRow = new OrderIndex(entity.id);
  orderRow.direction =
    entity.side == Side.LONG && entity.updateType == "INCREASE" ? "BID" : "ASK";
  orderRow.createdAt = entity.submissionTimestamp;
  orderRow.status = "OPEN";
  orderRow.market = entity.market;
  orderRow.triggerPrice = entity.price;

  let history = new History(`${ev.params.key.toHex()}-${ev.block.timestamp}`);
  history.owner = entity.owner;
  history.size = entity.sizeChange;
  history.collateralValue = entity.collateralValue;
  history.side = entity.side;
  history.type = entity.type;
  history.updateType = entity.updateType;
  history.collateralToken = entity.collateralToken;
  history.market = entity.market;
  history.triggerPrice = entity.price;
  history.executionPrice = entity.executionPrice;
  history.triggerAboveThreshold = entity.triggerAboveThreshold;
  history.status = entity.status;
  history.createdAtTimestamp = ev.block.timestamp;
  history.tx = ev.transaction.hash;

  if (entity.type == "LIMIT") {
    let user = loadOrCreateUser(ev.params.order.owner);
    user.orderCount = user.orderCount + 1;
    user.save();
  }

  //save entity
  entity.save();
  orderRow.save();
  history.save();
}

export function handleOrderCancelled(ev: OrderCancelled): void {
  let key = ev.params.key.toHex();
  let entity = Order.load(key);
  if (entity) {
    if (entity.status == "OPEN" && entity.type == "LIMIT") {
      let user = loadOrCreateUser(Address.fromBytes(entity.owner));
      user.orderCount = user.orderCount - 1;
      user.save();
    }
    entity.status = "CANCELLED";
    entity.save();

    let history = new History(`${ev.params.key.toHex()}-${ev.block.timestamp}`);
    history.owner = entity.owner;
    history.size = entity.sizeChange;
    history.collateralValue = entity.collateralValue;
    history.side = entity.side;
    history.type = entity.type;
    history.updateType = entity.updateType;
    history.collateralToken = entity.collateralToken;
    history.market = entity.market;
    history.triggerPrice = entity.price;
    history.executionPrice = entity.executionPrice;
    history.triggerAboveThreshold = entity.triggerAboveThreshold;
    history.status = entity.status;
    history.createdAtTimestamp = ev.block.timestamp;
    history.tx = ev.transaction.hash;
    history.save();
  }
  let row = OrderIndex.load(key);
  if (row) {
    row.status = "CANCELLED";
    row.save();
  }
}

export function handleOrderExpired(ev: OrderCancelled): void {
  let key = ev.params.key.toHex();
  let entity = Order.load(key);
  if (entity) {
    if (entity.status == "OPEN" && entity.type == "LIMIT") {
      let user = loadOrCreateUser(Address.fromBytes(entity.owner));
      user.orderCount = user.orderCount - 1;
      user.save();
    }
    entity.status = "EXPIRED";
    entity.save();

    let history = new History(`${ev.params.key.toHex()}-${ev.block.timestamp}`);
    history.owner = entity.owner;
    history.size = entity.sizeChange;
    history.collateralValue = entity.collateralValue;
    history.side = entity.side;
    history.type = entity.type;
    history.updateType = entity.updateType;
    history.collateralToken = entity.collateralToken;
    history.market = entity.market;
    history.triggerPrice = entity.price;
    history.executionPrice = entity.executionPrice;
    history.triggerAboveThreshold = entity.triggerAboveThreshold;
    history.status = entity.status;
    history.createdAtTimestamp = ev.block.timestamp;
    history.tx = ev.transaction.hash;
    history.save();
  }
  let row = OrderIndex.load(key);
  if (row) {
    row.status = "EXPIRED";
    row.save();
  }
}

export function handleOrderExecuted1(ev: OrderExecuted1): void {
  let key = ev.params.key.toHex();
  let entity = Order.load(key);
  if (entity) {
    if (entity.status == "OPEN" && entity.type == "LIMIT") {
      let user = loadOrCreateUser(Address.fromBytes(entity.owner));
      user.orderCount = user.orderCount - 1;
      user.save();
    }
    entity.status = "FILLED";
    entity.executionTimestamp = ev.block.timestamp;
    entity.executionPrice = ev.params.order.price;
    entity.save();

    let history = new History(`${ev.params.key.toHex()}-${ev.block.timestamp}`);
    history.owner = entity.owner;
    history.size = entity.sizeChange;
    history.collateralValue = entity.collateralValue;
    history.side = entity.side;
    history.type = entity.type;
    history.updateType = entity.updateType;
    history.collateralToken = entity.collateralToken;
    history.market = entity.market;
    history.triggerPrice = entity.price;
    history.executionPrice = entity.executionPrice;
    history.triggerAboveThreshold = entity.triggerAboveThreshold;
    history.status = entity.status;
    history.createdAtTimestamp = ev.block.timestamp;
    history.tx = ev.transaction.hash;
    history.save();
  }
  let row = OrderIndex.load(key);
  if (row) {
    row.status = "FILLED";
    row.save();
  }
}

export function handleOrderExecuted(ev: OrderExecuted): void {
  let key = ev.params.key.toHex();
  let entity = Order.load(key);
  if (entity) {
    if (entity.status == "OPEN" && entity.type == "LIMIT") {
      let user = loadOrCreateUser(Address.fromBytes(entity.owner));
      user.orderCount = user.orderCount - 1;
      user.save();
    }
    entity.status = "FILLED";
    entity.executionTimestamp = ev.block.timestamp;
    entity.executionPrice = ev.params.fillPrice;
    entity.save();

    let history = new History(`${ev.params.key.toHex()}-${ev.block.timestamp}`);
    history.owner = entity.owner;
    history.size = entity.sizeChange;
    history.collateralValue = entity.collateralValue;
    history.side = entity.side;
    history.type = entity.type;
    history.updateType = entity.updateType;
    history.collateralToken = entity.collateralToken;
    history.market = entity.market;
    history.triggerPrice = entity.price;
    history.executionPrice = entity.executionPrice;
    history.triggerAboveThreshold = entity.triggerAboveThreshold;
    history.status = entity.status;
    history.createdAtTimestamp = ev.block.timestamp;
    history.tx = ev.transaction.hash;
    history.save();
  }
  let row = OrderIndex.load(key);
  if (row) {
    row.status = "FILLED";
    row.save();
  }
}

export function handleBlock(ev: ethereum.Block): void {
  let block = new Block(ev.hash.toHex());
  block.parentHash = ev.parentHash;
  block.unclesHash = ev.unclesHash;
  block.author = ev.author;
  block.stateRoot = ev.stateRoot;
  block.transactionsRoot = ev.transactionsRoot;
  block.receiptsRoot = ev.receiptsRoot;
  block.number = ev.number;
  block.gasUsed = ev.gasUsed;
  block.gasLimit = ev.gasLimit;
  block.timestamp = ev.timestamp;
  block.difficulty = ev.difficulty;
  block.totalDifficulty = ev.totalDifficulty;
  block.size = ev.size;
  block.save();

  for (let i = 0; i < LP_TOKEN.length; i++) {
    const address = Address.fromString(LP_TOKEN[i]);
    let token = LpToken.bind(Address.fromString(LP_TOKEN[i]));
    let entity = Token.load(address.toHex());
    if (!entity) {
      entity = new Token(address.toHex());
      entity.decimals = token.decimals();
      entity.symbol = token.symbol();
      entity.lastUpdatedBlock = integer.ZERO;
    }
    if (
      ev.number
        .minus(entity.lastUpdatedBlock)
        .le(integer.fromNumber(SKIP_BLOCKS))
    )
      return;
    let poolAddress = getOrNull<Address>(token.try_minter());
    if (!poolAddress) return;
    let pool = PoolContract.bind(poolAddress);
    let poolValue = getOrNull<BigInt>(pool.try_getPoolValue());
    let totalSupply = getOrNull<BigInt>(token.try_totalSupply());
    if (!poolValue || !totalSupply || totalSupply.le(integer.ZERO)) return;
    let price = poolValue.div(totalSupply);
    entity.price = price;
    entity.lastUpdatedBlock = ev.number;
    entity.save();
  }
}

export function handleSwapOrderPlaced(ev: SwapOrderPlaced): void {
  let swapOrderContract = OrderManager.bind(ev.address);
  let swapOrder = getOrNull<OrderManager__swapOrdersResult>(
    swapOrderContract.try_swapOrders(ev.params.key)
  );

  if (!swapOrder) {
    return;
  }

  let entity = new Order(`${ev.params.key.toHex()}-SWAP`);

  entity.owner = swapOrder.getOwner();
  entity.pool = swapOrder.getPool().toHex();
  entity.tokenIn = swapOrder.getTokenIn();
  entity.tokenOut = swapOrder.getTokenOut();
  entity.amountIn = swapOrder.getAmountIn();
  entity.minAmountOut = swapOrder.getMinAmountOut();
  entity.price = swapOrder.getPrice();
  entity.executionPrice = integer.ZERO;
  entity.executionFee = swapOrder.getExecutionFee();
  entity.submissionBlock = ev.block.number;
  entity.submissionTimestamp = ev.block.timestamp;
  entity.updateType = "SWAP";
  entity.type = "LIMIT";
  entity.status = "OPEN";

  let history = new History(`${ev.params.key.toHex()}-${ev.block.timestamp}`);
  history.owner = entity.owner;
  history.type = entity.type;
  history.updateType = entity.updateType;
  history.tokenIn = entity.tokenIn;
  history.tokenOut = entity.tokenOut;
  history.amountIn = entity.amountIn;
  history.minAmountOut = entity.minAmountOut;
  history.triggerPrice = entity.price;
  history.status = entity.status;
  history.createdAtTimestamp = ev.block.timestamp;
  history.tx = ev.transaction.hash;

  let user = loadOrCreateUser(swapOrder.getOwner());
  user.orderCount = user.orderCount + 1;
  user.save();

  entity.save();
  history.save();
}

export function handleSwapOrderCancelled(ev: SwapOrderCancelled): void {
  let key = ev.params.key.toHex();
  let entity = Order.load(`${key}-SWAP`);
  if (entity) {
    if (entity.status == "OPEN") {
      let user = loadOrCreateUser(Address.fromBytes(entity.owner));
      user.orderCount = user.orderCount - 1;
      user.save();
    }
    entity.status = "CANCELLED";
    entity.save();

    let history = new History(`${ev.params.key.toHex()}-${ev.block.timestamp}`);
    history.owner = entity.owner;
    history.type = entity.type;
    history.updateType = entity.updateType;
    history.tokenIn = entity.tokenIn;
    history.tokenOut = entity.tokenOut;
    history.amountIn = entity.amountIn;
    history.minAmountOut = entity.minAmountOut;
    history.triggerPrice = entity.price;
    history.status = entity.status;
    history.createdAtTimestamp = ev.block.timestamp;
    history.tx = ev.transaction.hash;

    history.save();
  }
}

export function handleSwapOrderExecuted(ev: SwapOrderExecuted): void {
  let key = ev.params.key.toHex();
  let entity = Order.load(`${key}-SWAP`);
  if (entity) {
    if (entity.status == "OPEN") {
      let user = loadOrCreateUser(Address.fromBytes(entity.owner));
      user.orderCount = user.orderCount - 1;
      user.save();
    }
    entity.amountOut = ev.params.amountOut;
    entity.status = "FILLED";
    entity.save();

    let history = new History(`${ev.params.key.toHex()}-${ev.block.timestamp}`);
    history.owner = entity.owner;
    history.type = entity.type;
    history.updateType = entity.updateType;
    history.tokenIn = entity.tokenIn;
    history.tokenOut = entity.tokenOut;
    history.amountIn = entity.amountIn;
    history.amountOut = entity.amountOut;
    history.minAmountOut = entity.minAmountOut;
    history.executionPrice = entity.price;
    history.status = entity.status;
    history.createdAtTimestamp = ev.block.timestamp;
    history.tx = ev.transaction.hash;
    history.save();
  }
}

export function handleSwap(ev: Swap): void {
  let key = ev.params._event.address;

  let history = new History(`${key.toHex()}-${ev.block.timestamp}`);
  history.owner = ev.params.account;
  history.type = "MARKET";
  history.updateType = "SWAP";
  history.tokenIn = ev.params.tokenIn;
  history.tokenOut = ev.params.tokenOut;
  history.amountIn = ev.params.amountIn;
  history.amountOut = ev.params.amountOut;
  history.status = "FILLED";
  history.createdAtTimestamp = ev.block.timestamp;
  history.tx = ev.transaction.hash;
  history.save();

  let protocolDailyData = loadOrCreateProtocolDailyData(ev.block.timestamp);
  storeUserDailyData(
    protocolDailyData,
    ev.params.account,
    "swap",
    ev.block.timestamp
  );
}
