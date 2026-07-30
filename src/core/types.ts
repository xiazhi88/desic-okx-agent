export type OkxEnvironment = "demo" | "live";

export interface AccountCredentials {
  name: string;
  environment: OkxEnvironment;
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export type DataSource = "memory" | "rest" | "websocket" | "sqlite" | "derived" | "mixed";

export interface ResultMeta {
  requestId: string;
  environment: OkxEnvironment | "public";
  source: DataSource;
  exchangeTs: number | null;
  receivedAt: number;
  ageMs: number | null;
  warnings: string[];
  account?: string;
}

export interface ToolResult<T = unknown> {
  data: T;
  meta: ResultMeta;
}

export interface OkxEnvelope<T = Record<string, unknown>> {
  code: string;
  msg: string;
  data: T[];
  inTime?: string;
  outTime?: string;
}

export interface TimedValue<T> {
  value: T;
  exchangeTs: number;
  receivedAt: number;
  source: DataSource;
}

export function requestId(): string {
  return crypto.randomUUID();
}

export function resultMeta(options: Partial<ResultMeta> & Pick<ResultMeta, "source">): ResultMeta {
  const receivedAt = options.receivedAt ?? Date.now();
  const exchangeTs = options.exchangeTs ?? null;
  return {
    requestId: options.requestId ?? requestId(),
    environment: options.environment ?? "public",
    source: options.source,
    exchangeTs,
    receivedAt,
    ageMs: exchangeTs === null ? null : Math.max(0, receivedAt - exchangeTs),
    warnings: options.warnings ?? [],
    ...(options.account ? { account: options.account } : {})
  };
}
