import crypto from "node:crypto";
import { OkxClient } from "../core/okx-client.js";
import { resultMeta, type ToolResult } from "../core/types.js";
import type { RuntimeDatabase } from "../storage/database.js";

export interface DerivativesQuery {
  instId: string;
  period?: string;
  begin?: number;
  end?: number;
  limit?: number;
}

export class DerivativesService {
  private nextRubikAt = 0;
  private rubikChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: OkxClient,
    private readonly database: RuntimeDatabase
  ) {}

  async positioning(query: DerivativesQuery): Promise<ToolResult<unknown[]>> {
    const data = await this.rubik("/api/v5/rubik/stat/contracts/open-interest-history", query);
    this.persist("positioning", query.instId, data);
    return wrap(data);
  }

  async takerFlow(query: DerivativesQuery): Promise<ToolResult<unknown[]>> {
    const data = await this.rubik("/api/v5/rubik/stat/taker-volume-contract", query, { unit: "2" });
    this.persist("taker_flow", query.instId, data);
    return wrap(data);
  }

  async crowding(query: DerivativesQuery): Promise<ToolResult<Record<string, unknown>>> {
    const paths = [
      "/api/v5/rubik/stat/contracts/long-short-account-ratio-contract",
      "/api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader",
      "/api/v5/rubik/stat/contracts/long-short-position-ratio-contract-top-trader"
    ];
    const [accountRatio, topAccountRatio, topPositionRatio] = await Promise.all(paths.map((path) => this.rubik(path, query)));
    const data = { accountRatio, topAccountRatio, topPositionRatio };
    this.persist("crowding", query.instId, [data]);
    return wrap(data);
  }

  async fundingBasis(query: DerivativesQuery): Promise<ToolResult<Record<string, unknown>>> {
    const family = query.instId.replace(/-SWAP$/, "");
    const [current, history, premium, mark, index] = await Promise.all([
      this.client.publicGet("/api/v5/public/funding-rate", { instId: query.instId }),
      this.client.publicGet("/api/v5/public/funding-rate-history", { instId: query.instId, limit: Math.min(query.limit ?? 100, 100) }),
      this.client.publicGet("/api/v5/public/premium-history", common(query)),
      this.client.publicGet("/api/v5/public/mark-price", { instType: "SWAP", instId: query.instId }),
      this.client.publicGet("/api/v5/market/index-tickers", { instId: family })
    ]);
    const data = { current, history, premium, mark, index };
    this.persist("funding_basis", query.instId, [data]);
    return wrap(data);
  }

  async liquidations(query: DerivativesQuery): Promise<ToolResult<unknown[]>> {
    const data = await this.client.publicGet("/api/v5/public/liquidation-orders", {
      instType: "SWAP",
      instFamily: query.instId.replace(/-SWAP$/, ""),
      state: "filled",
      limit: Math.min(query.limit ?? 100, 100)
    });
    this.persist("liquidations", query.instId, data);
    return wrap(data);
  }

  async systemStress(query: DerivativesQuery): Promise<ToolResult<Record<string, unknown>>> {
    const family = query.instId.replace(/-SWAP$/, "");
    const [insuranceFund, priceLimit, positionTiers] = await Promise.all([
      this.client.publicGet("/api/v5/public/insurance-fund", { instType: "SWAP", instFamily: family }),
      this.client.publicGet("/api/v5/public/price-limit", { instId: query.instId }),
      this.client.publicGet("/api/v5/public/position-tiers", { instType: "SWAP", tdMode: "cross", instFamily: family })
    ]);
    const data = { insuranceFund, priceLimit, positionTiers };
    this.persist("system_stress", query.instId, [data]);
    return wrap(data);
  }

  async positionChanges(query: DerivativesQuery): Promise<ToolResult<unknown[]>> {
    const positioning = await this.positioning(query);
    const rows = normalizeRows(positioning.data);
    const data = rows.slice(1).map((row, index) => {
      const previous = rows[index]!;
      const currentOi = numeric(row[1] ?? (row as unknown as Record<string, unknown>).oi);
      const previousOi = numeric(previous[1] ?? (previous as unknown as Record<string, unknown>).oi);
      return { current: row, previous, absoluteChange: currentOi - previousOi, percentChange: previousOi ? (currentOi - previousOi) / previousOi : null };
    });
    return { data, meta: { ...positioning.meta, source: "derived" } };
  }

  async consensus(query: DerivativesQuery): Promise<ToolResult<Record<string, unknown>>> {
    const [crowding, taker, positioning] = await Promise.all([this.crowding(query), this.takerFlow(query), this.positionChanges(query)]);
    return {
      data: { crowding: crowding.data, takerFlow: taker.data, positionChanges: positioning.data },
      meta: resultMeta({ source: "derived" })
    };
  }

  async decisionSnapshot(query: DerivativesQuery): Promise<ToolResult<Record<string, unknown>>> {
    const [positioning, takerFlow, fundingBasis, liquidations, systemStress, crowding] = await Promise.all([
      this.positioning(query), this.takerFlow(query), this.fundingBasis(query), this.liquidations(query), this.systemStress(query), this.crowding(query)
    ]);
    return {
      data: { instId: query.instId, asOf: Date.now(), positioning: positioning.data, takerFlow: takerFlow.data, fundingBasis: fundingBasis.data, liquidations: liquidations.data, systemStress: systemStress.data, crowding: crowding.data },
      meta: resultMeta({ source: "mixed" })
    };
  }

  private async rubik(path: string, query: DerivativesQuery, extra: Record<string, unknown> = {}): Promise<unknown[]> {
    let release!: () => void;
    const previous = this.rubikChain;
    this.rubikChain = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const wait = this.nextRubikAt - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      return await this.client.publicGet(path, { ...common(query), ...extra });
    } finally {
      this.nextRubikAt = Date.now() + 420;
      release();
    }
  }

  private persist(kind: string, instId: string, values: unknown[]): void {
    for (const value of values) {
      const text = JSON.stringify(value);
      const id = crypto.createHash("sha256").update(`${kind}:${instId}:${text}`).digest("hex").slice(0, 24);
      const timestamp = extractTimestamp(value) ?? Date.now();
      this.database.upsertIntelligence(`derivatives:${kind}:${instId}`, id, timestamp, value);
    }
  }
}

function common(query: DerivativesQuery): Record<string, unknown> {
  return { instId: query.instId, period: query.period ?? "5m", begin: query.begin, end: query.end, limit: Math.min(query.limit ?? 100, 100) };
}

function wrap<T>(data: T): ToolResult<T> {
  return { data, meta: resultMeta({ source: "rest" }) };
}

function normalizeRows(values: unknown[]): unknown[][] {
  return values.filter(Array.isArray) as unknown[][];
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractTimestamp(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    const parsed = Number(value[0]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const parsed = Number(object.ts ?? object.timestamp ?? object.fundingTime);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
