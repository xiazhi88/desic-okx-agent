import type { AccountCredentials } from "./types.js";

const PRIVATE_KEYS = /^(tag|api[-_]?key|secret(?:[-_]?key)?|passphrase|ok-access-(?:key|sign|passphrase))$/i;

export function sanitizeValue<T>(value: T, accounts: Iterable<AccountCredentials> = []): T {
  const secrets = [...accounts].flatMap((account) => [account.apiKey, account.secretKey, account.passphrase]).filter(Boolean);
  return sanitizeInner(value, secrets) as T;
}

function sanitizeInner(value: unknown, secrets: string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeInner(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !PRIVATE_KEYS.test(key))
        .map(([key, item]) => [key, sanitizeInner(item, secrets)])
    );
  }
  if (typeof value === "string") {
    return secrets.reduce((text, secret) => (secret ? text.split(secret).join("[REDACTED]") : text), value);
  }
  return value;
}
