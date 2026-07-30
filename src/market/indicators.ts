import type { RawCandle } from "./store.js";

export function calculateIndicators(candles: RawCandle[]): Record<string, unknown> {
  const closes = candles.map((row) => Number(row[4])).filter(Number.isFinite);
  const highs = candles.map((row) => Number(row[2])).filter(Number.isFinite);
  const lows = candles.map((row) => Number(row[3])).filter(Number.isFinite);
  const volumes = candles.map((row) => Number(row[5])).filter(Number.isFinite);
  const sma20 = sma(closes, 20);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = ema12 !== null && ema26 !== null ? ema12 - ema26 : null;
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(highs, lows, closes, 14);
  const std20 = standardDeviation(closes.slice(-20));
  const vwap = weightedAverage(closes.slice(-volumes.length), volumes);
  return {
    sampleSize: closes.length,
    sma20,
    ema12,
    ema26,
    macd,
    rsi14,
    atr14,
    bollinger20: sma20 === null || std20 === null ? null : { middle: sma20, upper: sma20 + 2 * std20, lower: sma20 - 2 * std20 },
    vwap
  };
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) current = (value - current) * multiplier + current;
  return current;
}

function rsi(values: number[], period: number): number | null {
  if (values.length <= period) return null;
  const deltas = values.slice(1).map((value, index) => value - values[index]!);
  const sample = deltas.slice(-period);
  const gains = sample.reduce((sum, value) => sum + Math.max(0, value), 0) / period;
  const losses = sample.reduce((sum, value) => sum + Math.max(0, -value), 0) / period;
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function atr(highs: number[], lows: number[], closes: number[], period: number): number | null {
  if (closes.length <= period || highs.length !== closes.length || lows.length !== closes.length) return null;
  const ranges = highs.slice(1).map((high, index) => {
    const previousClose = closes[index]!;
    return Math.max(high - lows[index + 1]!, Math.abs(high - previousClose), Math.abs(lows[index + 1]! - previousClose));
  });
  return sma(ranges, period);
}

function standardDeviation(values: number[]): number | null {
  if (values.length === 0) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function weightedAverage(values: number[], weights: number[]): number | null {
  if (!values.length || values.length !== weights.length) return null;
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  return values.reduce((sum, value, index) => sum + value * weights[index]!, 0) / total;
}
