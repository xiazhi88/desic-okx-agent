import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATABASE_PATH } from "../config/paths.js";

export interface ExecutionRecord {
  executionKey: string;
  operation: string;
  requestHash: string;
  status: string;
  response: unknown;
  updatedAt: number;
}

export class RuntimeDatabase {
  readonly db: Database.Database;

  constructor(databasePath = DATABASE_PATH) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  saveCandles(instId: string, bar: string, candles: unknown[]): void {
    setImmediate(() => {
      if (!this.db.open) return;
      const statement = this.db.prepare(
        "INSERT INTO candles(inst_id,bar,ts,data_json) VALUES(?,?,?,?) ON CONFLICT(inst_id,bar,ts) DO UPDATE SET data_json=excluded.data_json"
      );
      const transaction = this.db.transaction((items: unknown[]) => {
        for (const candle of items) {
          const values = Array.isArray(candle) ? candle : [];
          const ts = Number(values[0]);
          if (Number.isFinite(ts)) statement.run(instId, bar, ts, JSON.stringify(candle));
        }
      });
      transaction(candles);
    });
  }

  loadCandles(instId: string, bar: string, limit = 300): unknown[] {
    const rows = this.db
      .prepare("SELECT data_json FROM candles WHERE inst_id=? AND bar=? ORDER BY ts DESC LIMIT ?")
      .all(instId, bar, limit) as Array<{ data_json: string }>;
    return rows.reverse().map((row) => JSON.parse(row.data_json));
  }

  upsertIntelligence(kind: string, id: string, ts: number, data: unknown): void {
    setImmediate(() => {
      if (!this.db.open) return;
      this.db.prepare(
        "INSERT INTO intelligence(kind,id,ts,data_json) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET ts=excluded.ts,data_json=excluded.data_json"
      ).run(kind, id, ts, JSON.stringify(data));
    });
  }

  queryIntelligence(kind: string, limit = 100, since = 0): unknown[] {
    const rows = this.db.prepare(
      "SELECT data_json FROM intelligence WHERE kind=? AND ts>=? ORDER BY ts DESC LIMIT ?"
    ).all(kind, since, limit) as Array<{ data_json: string }>;
    return rows.map((row) => JSON.parse(row.data_json));
  }

  getExecution(executionKey: string): ExecutionRecord | undefined {
    const row = this.db.prepare(
      "SELECT execution_key,operation,request_hash,status,response_json,updated_at FROM executions WHERE execution_key=?"
    ).get(executionKey) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      executionKey: String(row.execution_key),
      operation: String(row.operation),
      requestHash: String(row.request_hash),
      status: String(row.status),
      response: row.response_json ? JSON.parse(String(row.response_json)) : null,
      updatedAt: Number(row.updated_at)
    };
  }

  beginExecution(executionKey: string, operation: string, requestHash: string): ExecutionRecord | undefined {
    const existing = this.getExecution(executionKey);
    if (existing) return existing;
    this.db.prepare(
      "INSERT INTO executions(execution_key,operation,request_hash,status,response_json,updated_at) VALUES(?,?,?,'submitting','null',?)"
    ).run(executionKey, operation, requestHash, Date.now());
    return undefined;
  }

  finishExecution(executionKey: string, status: string, response: unknown): void {
    this.db.prepare("UPDATE executions SET status=?,response_json=?,updated_at=? WHERE execution_key=?")
      .run(status, JSON.stringify(response), Date.now(), executionKey);
  }

  retainIntelligence(days: number): void {
    const cutoff = Date.now() - days * 86_400_000;
    this.db.prepare("DELETE FROM intelligence WHERE ts<?").run(cutoff);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS candles (
        inst_id TEXT NOT NULL,
        bar TEXT NOT NULL,
        ts INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY(inst_id,bar,ts)
      );
      CREATE TABLE IF NOT EXISTS intelligence (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY(kind,id)
      );
      CREATE INDEX IF NOT EXISTS idx_intelligence_kind_ts ON intelligence(kind,ts DESC);
      CREATE TABLE IF NOT EXISTS executions (
        execution_key TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        response_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }
}
