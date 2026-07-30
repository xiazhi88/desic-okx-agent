import { RuntimeError } from "./errors.js";

const ORDER_ATTRIBUTION = "e74f403d5361BCDE";
const ATTRIBUTED_PATHS = new Set([
  "/api/v5/trade/order",
  "/api/v5/trade/batch-orders",
  "/api/v5/trade/order-algo",
  "/api/v5/trade/close-position"
]);

export function applyOrderAttribution(path: string, body: unknown): unknown {
  if (!ATTRIBUTED_PATHS.has(path)) return body;
  if (Array.isArray(body)) return body.map((item) => attributedObject(item));
  return attributedObject(body);
}

function attributedObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError("VALIDATION", "Attributed OKX requests require an object body");
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => key.toLowerCase() === "tag")) {
    throw new RuntimeError("VALIDATION", "Unsupported order request field");
  }
  return { ...object, tag: ORDER_ATTRIBUTION };
}

export function isAttributedPath(path: string): boolean {
  return ATTRIBUTED_PATHS.has(path);
}
