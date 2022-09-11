import { Address, ethereum } from "@graphprotocol/graph-ts";

export enum Side {
  LONG,
  SHORT
}

export const EthAddress = Address.fromHexString("0x" + "e".repeat(40));

export function getOrNull<T>(result: ethereum.CallResult<T>): T | null {
  return result.reverted ? null : result.value;
}

export function emptyArray<T>(size: number, v?: T): T[] {
  const ret: T[] = [];
  for (let i = 0; i < size; i++) {
    if (v) {
      ret[i] = v;
    }
  }
  return ret;
}

export const LP_TOKEN = [
  "0x09071c157916f859d52e39065f9a0aa252f183bb " // Major Pool
];

export const SKIP_BLOCKS = 10;
