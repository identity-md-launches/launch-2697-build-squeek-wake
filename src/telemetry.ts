// Live sources: Squeekchain status/economy JSON and SqueekMining.checkpointStatus() over Sepolia JSON-RPC.

export const STATUS_URL = "https://api.squeekchain.com/v1/status";
export const ECONOMY_URL = "https://api.squeekchain.com/v1/economy/state";
export const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
export const MINING = "0xcd46990f8349057335289ef282c276204b6cdc62";
export const SQK_TOKEN = "0x5501e1fa81be1c3f49225fa7668da0245d07db60";
const CHECKPOINT_STATUS_SELECTOR = "0x001c856f";

export interface WheelReading {
  freshness: string;
  coreStatus: string;
  rpm: number;
  speed: number;
  km: number;
  work: bigint | null;
  blockHeight: string;
  blockProgress: number; // 0..1
  settledThroughRound: string;
  observedAt: string | null;
  running: boolean;
}

export interface EconomyReading {
  currentRound: string;
  mintedSqk: number;
  processedThroughRound: string;
  fundedBlocks: string;
}

export interface CheckpointStatus {
  corePaused: boolean;
  nextRound: bigint;
  roundSettled: boolean;
}

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const big = (v: unknown): bigint | null => {
  try {
    return v === undefined || v === null || v === "" ? null : BigInt(String(v));
  } catch {
    return null;
  }
};

async function getJson(url: string, timeoutMs = 8000): Promise<Json> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return obj(await res.json());
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Parse /v1/status. `previousWork` is the cumulativeWorkUnits seen on the last poll, so a counter that
 * moved between polls also counts as running.
 */
export function parseStatus(body: Json, previousWork: bigint | null): WheelReading {
  const m = obj(body.measurement);
  const anchor = obj(obj(body.builder).anchor);
  const freshness = str(m.freshness);
  const coreStatus = str(m.coreStatus);
  const rpmMilli = num(m.rpmMilli);
  const speedMm = num(m.speedMmPerSecond);
  const work = big(m.cumulativeWorkUnits);
  const workMoved = previousWork !== null && work !== null && work > previousWork;
  const running = freshness === "online" && (coreStatus === "ACTIVE" || rpmMilli > 0 || speedMm > 0 || workMoved);
  return {
    freshness,
    coreStatus,
    rpm: rpmMilli / 1000,
    speed: speedMm / 1000,
    km: num(m.distanceMm) / 1e6,
    work,
    blockHeight: str(anchor.blockHeight),
    blockProgress: Math.min(1, Math.max(0, num(anchor.blockProgress) / 1e9)),
    settledThroughRound: str(anchor.settledThroughRound),
    observedAt: m.observedAt ? str(m.observedAt) : null,
    running,
  };
}

export function parseEconomy(body: Json): EconomyReading {
  const minted = big(obj(body.supply).totalMintedBaseUnits) ?? 0n;
  // Keep 6 decimals of precision before converting to a float for display.
  const mintedSqk = Number(minted / 10n ** 12n) / 1e6;
  return {
    currentRound: str(obj(body.lifecycle).currentRound),
    mintedSqk,
    processedThroughRound: str(obj(body.mining).processedThroughRound),
    fundedBlocks: str(obj(body.mining).fundedBlocks),
  };
}

export const fetchStatus = (previousWork: bigint | null) => getJson(STATUS_URL).then((b) => parseStatus(b, previousWork));
export const fetchEconomy = () => getJson(ECONOMY_URL).then(parseEconomy);

let rpcId = 1;
export async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(SEPOLIA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const body = obj(await res.json());
    if (body.error) throw new Error(str(obj(body.error).message) || "RPC error");
    return body.result as T;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Decode three 32-byte words: (bool corePaused, uint64 nextRound, bool roundSettled). */
export function decodeCheckpointStatus(hex: string): CheckpointStatus {
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(data) || data.length < 192) throw new Error("Unexpected checkpointStatus() result");
  const word = (i: number) => BigInt("0x" + data.slice(i * 64, i * 64 + 64));
  return { corePaused: word(0) !== 0n, nextRound: word(1) & 0xffffffffffffffffn, roundSettled: word(2) !== 0n };
}

export const fetchCheckpointStatus = () =>
  rpc<string>("eth_call", [{ to: MINING, data: CHECKPOINT_STATUS_SELECTOR }, "latest"]).then(decodeCheckpointStatus);
