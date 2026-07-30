import type { TimedValue } from "../core/types.js";

type Row = Record<string, unknown>;

export class AccountStore {
  readonly balances = new Map<string, TimedValue<Row[]>>();
  readonly positions = new Map<string, TimedValue<Row[]>>();
  readonly orders = new Map<string, TimedValue<Row[]>>();
  readonly algoOrders = new Map<string, TimedValue<Row[]>>();

  setBalances(account: string, rows: Row[]): void {
    this.balances.set(account, timed(rows));
  }

  mergePositions(account: string, rows: Row[]): void {
    const current = this.positions.get(account)?.value ?? [];
    const map = new Map(current.map((row) => [positionKey(row), row]));
    for (const row of rows) {
      const key = positionKey(row);
      if (Number(row.pos ?? 0) === 0) map.delete(key);
      else map.set(key, row);
    }
    this.positions.set(account, timed([...map.values()]));
  }

  mergeOrders(account: string, rows: Row[], algo = false): void {
    const target = algo ? this.algoOrders : this.orders;
    const current = target.get(account)?.value ?? [];
    const map = new Map(current.map((row) => [orderKey(row), row]));
    for (const row of rows) {
      const key = orderKey(row);
      if (terminal(String(row.state ?? ""))) map.delete(key);
      else map.set(key, row);
    }
    target.set(account, timed([...map.values()]));
  }
}

function timed<T>(value: T): TimedValue<T> {
  const now = Date.now();
  return { value, exchangeTs: now, receivedAt: now, source: "websocket" };
}

function positionKey(row: Row): string {
  return `${String(row.instId ?? "")}:${String(row.posSide ?? "net")}:${String(row.mgnMode ?? "")}`;
}

function orderKey(row: Row): string {
  return String(row.ordId ?? row.algoId ?? row.clOrdId ?? row.algoClOrdId ?? JSON.stringify(row));
}

function terminal(state: string): boolean {
  return ["filled", "canceled", "mmp_canceled", "order_failed", "effective"].includes(state);
}
