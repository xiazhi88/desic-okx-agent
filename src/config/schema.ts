import { z } from "zod";

export const AccountSchema = z.strictObject({
  environment: z.enum(["demo", "live"]).default("demo"),
  apiKey: z.string().min(1),
  secretKey: z.string().min(1),
  passphrase: z.string().min(1)
});

export const RuntimeConfigSchema = z.strictObject({
  defaultAccount: z.string().min(1).optional(),
  accounts: z.record(z.string(), AccountSchema).default({}),
  market: z.strictObject({
    prewarm: z.array(z.string().min(1)).default(["BTC-USDT-SWAP", "ETH-USDT-SWAP"]),
    bars: z.array(z.string().min(1)).default(["1m", "5m", "15m", "1H", "4H", "1D"]),
    idleSubscriptionMs: z.number().int().min(60_000).default(900_000),
    maxSnapshotSkewMs: z.number().int().positive().default(1_000),
    orderBookDepth: z.number().int().min(5).max(400).default(50),
    recentTradeLimit: z.number().int().min(10).max(10_000).default(1_000)
  }).prefault({}),
  proxy: z.strictObject({
    url: z.string().url().optional()
  }).default({}),
  intelligence: z.strictObject({
    newsPollSeconds: z.number().int().min(30).default(120),
    sentimentPollMinutes: z.number().int().min(1).default(15),
    smartMoneyPollMinutes: z.number().int().min(1).default(15),
    retentionDays: z.number().int().min(1).default(30)
  }).prefault({})
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type StoredAccount = z.infer<typeof AccountSchema>;

export const DEFAULT_CONFIG: RuntimeConfig = RuntimeConfigSchema.parse({});
