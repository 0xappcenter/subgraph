import {
  Market,
  Position,
  Protocol,
  Token,
  Trade,
  Pool,
  History,
  User,
  PoolDailyData,
  ProtocolDailyData,
  UserDailyData
} from "../generated/schema";
import { ERC20 } from "../generated/templates/Pool/ERC20";
import { LpToken } from "../generated/templates/Pool/LpToken";
import { PriceFeed } from "../generated/templates/Pool/PriceFeed";
import {
  Address,
  BigInt,
  Bytes,
  dataSource,
  ethereum,
  log
} from "@graphprotocol/graph-ts";
import { emptyArray, EthAddress, getOrNull, Side } from "./helpers";
import {
  ClosePosition,
  DecreasePosition,
  IncreasePosition,
  LiquidatePosition,
  TokenWhitelisted,
  UpdatePosition,
  Swap,
  AddLiquidity,
  RemoveLiquidity
} from "../generated/templates/Pool/Pool";
import { integer } from "@protofire/subgraph-toolkit";
import { Pool as PoolContract } from "../generated/OrderManager/Pool";

function loadOrCreateToken(address: Address): Token {
  let entity = Token.load(address.toHex());
  if (entity != null) {
    return entity;
  }

  entity = new Token(address.toHex());
  let token = ERC20.bind(address);
  let isETH = address.equals(EthAddress);
  entity.decimals = isETH ? 18 : token.decimals();
  entity.symbol = isETH ? "ETH" : token.symbol();
  entity.price = integer.ZERO;
  entity.lastUpdatedBlock = integer.ZERO;
  return entity;
}

function loadOrCreateMarket(indexToken: Address, pool: Pool): Market {
  let entity = Market.load(indexToken.toHex());
  if (entity != null) {
    return entity;
  }

  entity = new Market(indexToken.toHex());
  entity.pool = pool.id;
  entity.indexToken = indexToken.toHex();
  return entity;
}

function loadOrCreatePosition(key: Bytes, event: ethereum.Event): Position {
  let entity = Position.load(key.toHex());
  if (entity != null) {
    return entity;
  }
  entity = new Position(key.toHex());
  entity.size = integer.ZERO;
  entity.status = "CLOSED";
  entity.collateralValue = integer.ZERO;
  entity.leverage = integer.ZERO;
  entity.reserveAmount = integer.ZERO;
  entity.entryPrice = integer.ZERO;
  entity.entryInterestRate = integer.ZERO;
  entity.createdAtTimestamp = event.block.timestamp;

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
  return entity;
}

function loadOrCreatePoolDailyData(
  pool: Pool,
  timestamp: BigInt
): PoolDailyData {
  let interval = BigInt.fromI32(60 * 60 * 24);
  let day = timestamp.div(interval).times(interval);
  let id = pool.id + "-day-" + day.toString();
  let data = PoolDailyData.load(id);

  if (data == null) {
    data = new PoolDailyData(id);
    data.pool = pool.id;
    data.timestamp = day;
    data.poolValue = integer.ZERO;
    data.totalSupply = integer.ZERO;
    data.swapVolume = integer.ZERO;
    data.swapFee = integer.ZERO;
    data.mintLpValue = integer.ZERO;
    data.mintLpFee = integer.ZERO;
    data.burnLpValue = integer.ZERO;
    data.burnLpFee = integer.ZERO;
    data.liquidatedValue = integer.ZERO;
    data.liquidatedFee = integer.ZERO;
    data.tradingVolume = integer.ZERO;
    data.tradingFee = integer.ZERO;
    data.tokenDistributions = emptyArray(pool.tokenCount, integer.ZERO);
    data.totalLongPositions = integer.ZERO;
    data.totalShortPositions = integer.ZERO;
  }
  return data;
}

export function loadOrCreateProtocolDailyData(
  timestamp: BigInt
): ProtocolDailyData {
  let interval = BigInt.fromI32(60 * 60 * 24);
  let day = timestamp.div(interval).times(interval);
  let id = "day-" + day.toString();
  let data = ProtocolDailyData.load(id);

  if (data == null) {
    data = new ProtocolDailyData(id);
    data.timestamp = day;
    data.swapVolume = integer.ZERO;
    data.swapFee = integer.ZERO;
    data.mintLpValue = integer.ZERO;
    data.mintLpFee = integer.ZERO;
    data.burnLpValue = integer.ZERO;
    data.burnLpFee = integer.ZERO;
    data.liquidatedValue = integer.ZERO;
    data.liquidatedFee = integer.ZERO;
    data.tradingVolume = integer.ZERO;
    data.tradingFee = integer.ZERO;
    data.totalLongPositions = integer.ZERO;
    data.totalShortPositions = integer.ZERO;
    data.profit = integer.ZERO;
    data.loss = integer.ZERO;
    data.cumulativeLoss = integer.ZERO;
    data.cumulativeProfit = integer.ZERO;
    data.cumulativeVolume = integer.ZERO;
    data.cumulativeFee = integer.ZERO;
    data.swapCount = 0;
    data.burnLpCount = 0;
    data.mintLpCount = 0;
    data.uniqueSwapCount = 0;
    data.uniqueMintLpCount = 0;
    data.uniqueBurnLpCount = 0;
    data.uniqueUserCount = 0;
    data.tradeCount = 0;
    data.uniqueTradeCount = 0;
  }
  return data;
}

export function storeUserDailyData(
  protocolDailyData: ProtocolDailyData,
  user: Address,
  action: String,
  timestamp: BigInt
): void {
  let interval = BigInt.fromI32(60 * 60 * 24);
  let day = timestamp.div(interval).times(interval);
  let id = user.toHex() + "-day-" + day.toString();
  let data = UserDailyData.load(id);
  if (data == null) {
    data = new UserDailyData(id);
    data.address = user;
    data.timestamp = day;
    data.swapCount = 0;
    data.burnLpCount = 0;
    data.mintLpCount = 0;
    data.tradeCount = 0;
    protocolDailyData.uniqueUserCount++;
  }
  if (action === "swap") {
    if (data.swapCount === 0) {
      protocolDailyData.uniqueSwapCount++;
    }
    protocolDailyData.swapCount++;
    data.swapCount++;
  }
  if (action === "mint") {
    if (data.mintLpCount === 0) {
      protocolDailyData.uniqueMintLpCount++;
    }
    protocolDailyData.mintLpCount++;
    data.mintLpCount++;
  }
  if (action === "burn") {
    if (data.burnLpCount === 0) {
      protocolDailyData.uniqueBurnLpCount++;
    }
    protocolDailyData.burnLpCount++;
    data.burnLpCount++;
  }
  if (action === "trade") {
    if (data.tradeCount === 0) {
      protocolDailyData.uniqueTradeCount++;
    }
    protocolDailyData.tradeCount++;
    data.tradeCount++;
  }
  data.save();
  protocolDailyData.save();
}

function storePoolDailyData(pool: Pool, ev: ethereum.Event): PoolDailyData {
  let poolDailyData = loadOrCreatePoolDailyData(pool, ev.block.timestamp);
  let poolContract = PoolContract.bind(ev.address);
  let priceFeed = PriceFeed.bind(poolContract.oracle());
  poolDailyData.poolValue = poolContract.getPoolValue();
  let lpTokenContract = LpToken.bind(poolContract.lpToken());
  poolDailyData.totalSupply = lpTokenContract.totalSupply();
  let tokenDistributions = emptyArray(pool.tokenCount, integer.ZERO);
  for (let i = 0; i < pool.tokenCount; i++) {
    let token = poolContract.allWhitelistedTokens(integer.fromNumber(i));
    let poolAsset = poolContract.poolAssets(token);
    let tokenPrice = priceFeed.getPrice(token);
    tokenDistributions[i] = poolAsset.getPoolAmount().times(tokenPrice);
  }
  poolDailyData.tokenDistributions = tokenDistributions;
  return poolDailyData;
}

export function handleTokenWhitelisted(ev: TokenWhitelisted): void {
  let pool = Pool.load(ev.address.toHex());
  if (!pool) return;
  let token = loadOrCreateToken(ev.params.token);
  let market = loadOrCreateMarket(ev.params.token, pool);
  pool.tokenCount = pool.tokenCount + 1;
  token.save();
  market.save();
  pool.save();
}

export function handleIncreasePosition(ev: IncreasePosition): void {
  let protocol = Protocol.load("1");
  let pool = Pool.load(ev.address.toHex());
  if (!pool || !protocol) return;
  let position = loadOrCreatePosition(ev.params.key, ev);
  if (position.status == "CLOSED") {
    let user = loadOrCreateUser(ev.params.account);
    user.positionCount = user.positionCount + 1;
    user.save();
  }
  position.status = "OPEN";
  position.owner = ev.params.account;
  position.collateralToken = ev.params.collateralToken;
  position.market = ev.params.indexToken.toHex();
  position.side = ev.params.side;
  position.save();

  if (ev.params.sizeChanged.gt(integer.ZERO)) {
    let trade = new Trade(
      `${ev.params.indexToken.toHex()}-${ev.block.timestamp}`
    );
    trade.owner = ev.params.account;
    trade.date = ev.block.timestamp;
    trade.market = ev.params.indexToken.toHex();
    trade.side = ev.params.side;
    trade.updateType = "INCREASE";
    trade.price = ev.params.indexPrice;
    trade.size = ev.params.sizeChanged;
    trade.tx = ev.transaction.hash;
    trade.save();

    pool.totalVolume = integer.increment(
      pool.totalVolume,
      ev.params.sizeChanged
    );
    pool.totalFee = integer.increment(pool.totalFee, ev.params.feeValue);
    protocol.totalVolume = integer.increment(
      protocol.totalVolume,
      ev.params.sizeChanged
    );
    protocol.totalFee = integer.increment(
      protocol.totalFee,
      ev.params.feeValue
    );
    if (ev.params.side === Side.LONG) {
      pool.totalLongPositions = integer.increment(
        pool.totalLongPositions,
        ev.params.sizeChanged
      );
      protocol.totalLongPositions = integer.increment(
        protocol.totalLongPositions,
        ev.params.sizeChanged
      );
    } else {
      pool.totalShortPositions = integer.increment(
        pool.totalShortPositions,
        ev.params.sizeChanged
      );
      protocol.totalShortPositions = integer.increment(
        protocol.totalShortPositions,
        ev.params.sizeChanged
      );
    }
    let poolDailyData = storePoolDailyData(pool, ev);
    let protocolDailyData = loadOrCreateProtocolDailyData(ev.block.timestamp);
    poolDailyData.tradingFee = integer.increment(
      poolDailyData.tradingFee,
      ev.params.feeValue
    );
    protocolDailyData.tradingFee = integer.increment(
      protocolDailyData.tradingFee,
      ev.params.feeValue
    );
    poolDailyData.tradingVolume = integer.increment(
      poolDailyData.tradingVolume,
      ev.params.sizeChanged
    );
    protocolDailyData.tradingVolume = integer.increment(
      protocolDailyData.tradingVolume,
      ev.params.sizeChanged
    );
    protocolDailyData.cumulativeVolume = protocol.totalVolume;
    protocolDailyData.cumulativeFee = protocol.totalFee;
    if (ev.params.side === Side.LONG) {
      poolDailyData.totalLongPositions = integer.increment(
        poolDailyData.totalLongPositions,
        ev.params.sizeChanged
      );
      protocolDailyData.totalLongPositions = integer.increment(
        protocolDailyData.totalLongPositions,
        ev.params.sizeChanged
      );
    } else {
      poolDailyData.totalShortPositions = integer.increment(
        poolDailyData.totalShortPositions,
        ev.params.sizeChanged
      );
      protocolDailyData.totalShortPositions = integer.increment(
        protocolDailyData.totalShortPositions,
        ev.params.sizeChanged
      );
    }
    storeUserDailyData(
      protocolDailyData,
      ev.params.account,
      "trade",
      ev.block.timestamp
    );
    poolDailyData.save();
    protocolDailyData.save();
    pool.save();
    protocol.save();
  }
}

export function handleDecreasePosition(ev: DecreasePosition): void {
  let protocol = Protocol.load("1");
  let pool = Pool.load(ev.address.toHex());
  if (!pool || !protocol) return;
  if (ev.params.sizeChanged.gt(integer.ZERO)) {
    let trade = new Trade(
      `${ev.params.indexToken.toHex()}-${ev.block.timestamp}`
    );
    trade.owner = ev.params.account;
    trade.date = ev.block.timestamp;
    trade.market = ev.params.indexToken.toHex();
    trade.side = ev.params.side;
    trade.updateType = "DECREASE";
    trade.price = ev.params.indexPrice;
    trade.size = ev.params.sizeChanged;
    trade.tx = ev.transaction.hash;
    trade.save();

    pool.totalVolume = integer.increment(
      pool.totalVolume,
      ev.params.sizeChanged
    );
    pool.totalFee = integer.increment(pool.totalFee, ev.params.feeValue);
    protocol.totalVolume = integer.increment(
      protocol.totalVolume,
      ev.params.sizeChanged
    );
    protocol.totalFee = integer.increment(
      protocol.totalFee,
      ev.params.feeValue
    );
    if (ev.params.side === Side.LONG) {
      pool.totalLongPositions = integer.decrement(
        pool.totalLongPositions,
        ev.params.sizeChanged
      );
      protocol.totalLongPositions = integer.decrement(
        protocol.totalLongPositions,
        ev.params.sizeChanged
      );
    } else {
      pool.totalShortPositions = integer.decrement(
        pool.totalShortPositions,
        ev.params.sizeChanged
      );
      protocol.totalShortPositions = integer.decrement(
        protocol.totalShortPositions,
        ev.params.sizeChanged
      );
    }
    let protocolDailyData = loadOrCreateProtocolDailyData(ev.block.timestamp);
    let poolDailyData = storePoolDailyData(pool, ev);
    poolDailyData.tradingFee = integer.increment(
      poolDailyData.tradingFee,
      ev.params.feeValue
    );
    poolDailyData.tradingVolume = integer.increment(
      poolDailyData.tradingVolume,
      ev.params.sizeChanged
    );
    protocolDailyData.tradingFee = integer.increment(
      protocolDailyData.tradingFee,
      ev.params.feeValue
    );
    protocolDailyData.tradingVolume = integer.increment(
      protocolDailyData.tradingVolume,
      ev.params.sizeChanged
    );
    protocolDailyData.cumulativeVolume = protocol.totalVolume;
    protocolDailyData.cumulativeFee = protocol.totalFee;
    if (ev.params.pnl.sig.equals(integer.ZERO)) {
      protocol.profit = integer.increment(protocol.profit, ev.params.pnl.abs);
      protocolDailyData.profit = integer.increment(
        protocolDailyData.profit,
        ev.params.pnl.abs
      );
      protocolDailyData.cumulativeProfit = protocol.profit;
    } else {
      if (ev.params.pnl.sig.equals(integer.ZERO)) {
        protocol.loss = integer.increment(protocol.loss, ev.params.pnl.abs);
        protocolDailyData.loss = integer.increment(
          protocolDailyData.loss,
          ev.params.pnl.abs
        );
        protocolDailyData.cumulativeLoss = protocol.loss;
      }
    }
    storeUserDailyData(
      protocolDailyData,
      ev.params.account,
      "trade",
      ev.block.timestamp
    );
    poolDailyData.save();
    protocolDailyData.save();
    pool.save();
    protocol.save();
  }
}

export function handleUpdatePosition(ev: UpdatePosition): void {
  let position = loadOrCreatePosition(ev.params.key, ev);
  position.size = ev.params.size;
  position.collateralValue = ev.params.collateralValue;
  position.leverage = ev.params.collateralValue
    ? ev.params.size
        .times(integer.fromNumber(10).pow(30))
        .div(ev.params.collateralValue)
    : integer.ZERO;
  position.reserveAmount = ev.params.reserveAmount;
  position.entryPrice = ev.params.entryPrice;
  position.entryInterestRate = ev.params.entryInterestRate;
  position.save();
}

export function handleClosePosition(ev: ClosePosition): void {
  let position = loadOrCreatePosition(ev.params.key, ev);
  if (position.status == "OPEN") {
    let user = loadOrCreateUser(Address.fromBytes(position.owner));
    user.positionCount = user.positionCount - 1;
    user.save();
  }
  position.size = ev.params.size;
  position.collateralValue = ev.params.collateralValue;
  position.leverage = ev.params.collateralValue.gt(integer.ZERO)
    ? ev.params.size
        .times(integer.fromNumber(10).pow(30))
        .div(ev.params.collateralValue)
    : integer.ZERO;
  position.reserveAmount = ev.params.reserveAmount;
  position.entryInterestRate = ev.params.entryInterestRate;
  position.status = "CLOSED";
  position.save();
}

export function handleLiquidatePosition(ev: LiquidatePosition): void {
  let protocol = Protocol.load("1");
  let pool = Pool.load(ev.address.toHex());
  if (!pool || !protocol) return;
  let position = loadOrCreatePosition(ev.params.key, ev);
  if (position.status == "OPEN") {
    let user = loadOrCreateUser(Address.fromBytes(position.owner));
    user.positionCount = user.positionCount - 1;
    user.save();
  }
  position.status = "CLOSED";
  pool.totalFee = integer.increment(pool.totalFee, ev.params.feeValue);
  protocol.totalFee = integer.increment(protocol.totalFee, ev.params.feeValue);
  if (ev.params.side === Side.LONG) {
    pool.totalLongPositions = integer.decrement(
      pool.totalLongPositions,
      ev.params.size
    );
    protocol.totalLongPositions = integer.decrement(
      protocol.totalLongPositions,
      ev.params.size
    );
  } else {
    pool.totalShortPositions = integer.decrement(
      pool.totalShortPositions,
      ev.params.size
    );
    protocol.totalShortPositions = integer.decrement(
      protocol.totalShortPositions,
      ev.params.size
    );
  }
  let poolDailyData = storePoolDailyData(pool, ev);
  let protocolDailyData = loadOrCreateProtocolDailyData(ev.block.timestamp);
  poolDailyData.liquidatedValue = integer.increment(
    poolDailyData.liquidatedValue,
    position.size
  );
  poolDailyData.liquidatedFee = integer.increment(
    poolDailyData.liquidatedFee,
    ev.params.feeValue
  );
  protocolDailyData.liquidatedValue = integer.increment(
    protocolDailyData.liquidatedValue,
    position.size
  );
  protocolDailyData.liquidatedFee = integer.increment(
    protocolDailyData.liquidatedFee,
    ev.params.feeValue
  );
  protocolDailyData.cumulativeFee = protocol.totalFee;
  if (ev.params.pnl.sig.equals(integer.ZERO)) {
    protocolDailyData.profit = integer.increment(
      protocolDailyData.profit,
      ev.params.pnl.abs
    );
  } else {
    if (ev.params.pnl.sig.equals(integer.ZERO)) {
      protocolDailyData.loss = integer.increment(
        protocolDailyData.loss,
        ev.params.pnl.abs
      );
    }
  }
  poolDailyData.save();
  protocolDailyData.save();

  let history = new History(`${ev.params.key.toHex()}-${ev.block.timestamp}`);
  history.owner = position.owner;
  history.size = position.size;
  history.collateralValue = position.collateralValue;
  history.side = position.side;
  history.collateralToken = position.collateralToken;
  history.market = position.market;
  history.liquidatedPrice = ev.params.indexPrice;
  history.status = "LIQUIDATED";
  history.createdAtTimestamp = ev.block.timestamp;
  history.tx = ev.transaction.hash;

  // save entity
  position.save();
  history.save();
  pool.save();
  protocol.save();
}

export function handleSwap(ev: Swap): void {
  let protocol = Protocol.load("1");
  let pool = Pool.load(ev.address.toHex());
  if (!pool || !protocol) return;
  let poolContract = PoolContract.bind(ev.address);
  let priceFeed = PriceFeed.bind(poolContract.oracle());
  let poolDailyData = storePoolDailyData(pool, ev);
  let protocolDailyData = loadOrCreateProtocolDailyData(ev.block.timestamp);
  let tokenInPrice = priceFeed.getPrice(ev.params.tokenIn);
  let tokenOutPrice = priceFeed.getPrice(ev.params.tokenOut);
  if (tokenInPrice && tokenOutPrice) {
    let swapVolume = ev.params.amountIn
      .times(tokenInPrice)
      .plus(ev.params.amountOut.times(tokenOutPrice))
      .div(integer.TWO);
    let swapFee = ev.params.fee.times(tokenOutPrice);
    pool.totalVolume = integer.increment(pool.totalVolume, swapVolume);
    pool.totalFee = integer.increment(pool.totalFee, swapFee);
    protocol.totalVolume = integer.increment(protocol.totalVolume, swapVolume);
    protocol.totalFee = integer.increment(protocol.totalFee, swapFee);
    poolDailyData.swapVolume = integer.increment(
      poolDailyData.swapVolume,
      swapVolume
    );
    poolDailyData.swapFee = integer.increment(poolDailyData.swapFee, swapFee);
    protocolDailyData.swapVolume = integer.increment(
      protocolDailyData.swapVolume,
      swapVolume
    );
    protocolDailyData.swapFee = integer.increment(
      protocolDailyData.swapFee,
      swapFee
    );
    protocolDailyData.cumulativeVolume = protocol.totalVolume;
    protocolDailyData.cumulativeFee = protocol.totalFee;
  }
  poolDailyData.save();
  protocolDailyData.save();
}

export function handleAddLiquidity(ev: AddLiquidity): void {
  let protocol = Protocol.load("1");
  let pool = Pool.load(ev.address.toHex());
  if (!pool || !protocol) return;
  let poolContract = PoolContract.bind(ev.address);
  let priceFeed = PriceFeed.bind(poolContract.oracle());
  let poolDailyData = storePoolDailyData(pool, ev);
  let protocolDailyData = loadOrCreateProtocolDailyData(ev.block.timestamp);
  let tokenPrice = priceFeed.getPrice(ev.params.token);
  if (tokenPrice) {
    let mintLpFee = ev.params.fee.times(tokenPrice);
    pool.totalFee = integer.increment(pool.totalFee, mintLpFee);
    poolDailyData.mintLpFee = integer.increment(
      poolDailyData.mintLpValue,
      ev.params.amount.times(tokenPrice)
    );
    poolDailyData.mintLpFee = integer.increment(
      poolDailyData.mintLpFee,
      mintLpFee
    );
    protocolDailyData.mintLpFee = integer.increment(
      protocolDailyData.mintLpValue,
      ev.params.amount.times(tokenPrice)
    );
    protocolDailyData.mintLpFee = integer.increment(
      protocolDailyData.mintLpFee,
      mintLpFee
    );
    protocolDailyData.cumulativeFee = protocol.totalFee;
  }
  storeUserDailyData(
    protocolDailyData,
    ev.transaction.from,
    "mint",
    ev.block.timestamp
  );
  poolDailyData.save();
}

export function handleRemoveLiquidity(ev: RemoveLiquidity): void {
  let protocol = Protocol.load("1");
  let pool = Pool.load(ev.address.toHex());
  if (!pool || !protocol) return;
  let poolContract = PoolContract.bind(ev.address);
  let priceFeed = PriceFeed.bind(poolContract.oracle());
  let poolDailyData = storePoolDailyData(pool, ev);
  let protocolDailyData = loadOrCreateProtocolDailyData(ev.block.timestamp);
  let tokenPrice = priceFeed.getPrice(ev.params.token);
  if (tokenPrice) {
    let burnLpFee = ev.params.fee
      .times(integer.fromNumber(10).pow(10))
      .times(tokenPrice)
      .div(poolContract.fee().getAdminFee());
    pool.totalFee = integer.increment(pool.totalFee, burnLpFee);
    poolDailyData.burnLpValue = integer.increment(
      poolDailyData.burnLpValue,
      ev.params.amountOut.times(tokenPrice)
    );
    poolDailyData.burnLpFee = integer.increment(
      poolDailyData.burnLpFee,
      burnLpFee
    );
    protocolDailyData.burnLpValue = integer.increment(
      protocolDailyData.burnLpValue,
      ev.params.amountOut.times(tokenPrice)
    );
    protocolDailyData.burnLpFee = integer.increment(
      protocolDailyData.burnLpFee,
      burnLpFee
    );
    protocolDailyData.cumulativeFee = protocol.totalFee;
  }
  storeUserDailyData(
    protocolDailyData,
    ev.transaction.from,
    "burn",
    ev.block.timestamp
  );
  poolDailyData.save();
  protocolDailyData.save();
}
