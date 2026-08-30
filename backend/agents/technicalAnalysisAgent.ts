import YahooFinance from 'yahoo-finance2';

import { TECHNICAL_ANALYSIS_AGENT } from '@/lib/agent-chat';
import type { TechnicalData } from '@/lib/stockAnalysisInterfaces';
import { extractTickerSymbol } from '@backend/agents/stockDataAgent';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';
import { isAbortError, throwIfAborted } from '@/lib/cancellation';

const yahooFinance = new YahooFinance();

/* ──────────────────────────────────────────────────────────────────────────────
 * Technical indicator calculation helpers
 * ─────────────────────────────────────────────────────────────────────────── */

function calcSMA(prices: number[], period: number): number[] {
  return prices.map((_, i) => {
    if (i < period - 1) return NaN;
    const slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  // Seed with first SMA
  const seed = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else if (i === period - 1) {
      result.push(seed);
    } else {
      result.push(prices[i] * k + result[i - 1] * (1 - k));
    }
  }
  return result;
}

function calcRSI(prices: number[], period = 14): number[] {
  const result: number[] = new Array(period).fill(NaN);
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map(c => Math.max(c, 0));
  const losses = changes.map(c => Math.max(-c, 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function calcBollingerBands(prices: number[], period = 20, mult = 2) {
  const sma = calcSMA(prices, period);
  const upper = prices.map((_, i) => {
    if (i < period - 1) return NaN;
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const variance = slice.reduce((s, p) => s + (p - mean) ** 2, 0) / period;
    return mean + mult * Math.sqrt(variance);
  });
  const lower = prices.map((_, i) => {
    if (i < period - 1) return NaN;
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const variance = slice.reduce((s, p) => s + (p - mean) ** 2, 0) / period;
    return mean - mult * Math.sqrt(variance);
  });
  return { upper, lower, middle: sma };
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const result: number[] = new Array(period - 1).fill(NaN);
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(atr);
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result.push(atr);
  }
  return result;
}

function calcOBV(closes: number[], volumes: number[]): number[] {
  const result = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) result.push(result[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) result.push(result[i - 1] - volumes[i]);
    else result.push(result[i - 1]);
  }
  return result;
}

function last(arr: number[]): number | undefined {
  const v = arr[arr.length - 1];
  return isNaN(v) ? undefined : v;
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * calcPriceAtOffset — price N trading days ago (0-based index from end)
 * ─────────────────────────────────────────────────────────────────────────── */

function priceAtOffset(closes: number[], offset: number): number | undefined {
  const idx = closes.length - 1 - offset;
  return idx >= 0 ? closes[idx] : undefined;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Build TechnicalData from raw OHLCV arrays
 * ─────────────────────────────────────────────────────────────────────────── */

function buildTechnicalData(
  ticker: string,
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
): TechnicalData {
  const n = closes.length;
  if (n === 0) {
    return {
      ticker,
      timestamp: new Date().toISOString(),
      indicators: {},
      priceData: { currentPrice: 0 },
      signals: { trend: 'neutral', momentum: 'neutral', volatility: 'medium', volume: 'stable', overall: 'neutral' },
    };
  }

  const currentPrice = closes[n - 1];

  /* ── Moving averages ────────────────────────────────────────────────── */
  const sma20Arr = calcSMA(closes, 20);
  const sma50Arr = calcSMA(closes, 50);
  const sma200Arr = calcSMA(closes, 200);
  const ema12Arr = calcEMA(closes, 12);
  const ema26Arr = calcEMA(closes, 26);

  const sma20 = last(sma20Arr);
  const sma50 = last(sma50Arr);
  const sma200 = last(sma200Arr);
  const ema12 = last(ema12Arr);
  const ema26 = last(ema26Arr);

  /* ── MACD ────────────────────────────────────────────────────────────── */
  const macdLine = ema12Arr.map((e12, i) => (isNaN(e12) || isNaN(ema26Arr[i])) ? NaN : e12 - ema26Arr[i]);
  const validMacd = macdLine.filter(v => !isNaN(v));
  const macdSignalArr = validMacd.length >= 9 ? calcEMA(validMacd, 9) : [];
  // Align back to full-length array
  const macdSignalPadded = new Array(n - macdSignalArr.length).fill(NaN).concat(macdSignalArr);

  const macd = last(macdLine);
  const macdSignal = macdSignalPadded.length > 0 ? last(macdSignalPadded) : undefined;
  const macdHistogram = (macd != null && macdSignal != null) ? macd - macdSignal : undefined;

  /* ── RSI ───────────────────────────────────────────────────────────── */
  const rsiArr = calcRSI(closes, 14);
  const rsi14 = last(rsiArr);

  /* ── Bollinger Bands ───────────────────────────────────────────────── */
  const bb = calcBollingerBands(closes, 20);
  const bollingerUpper = last(bb.upper);
  const bollingerLower = last(bb.lower);

  /* ── ATR ────────────────────────────────────────────────────────────── */
  const atrArr = calcATR(highs, lows, closes, 14);
  const atr14 = last(atrArr);

  /* ── Volume ─────────────────────────────────────────────────────────── */
  const recentVolumes = volumes.slice(-20);
  const volumeSma20 = avg(recentVolumes);
  const volume5avg = avg(volumes.slice(-5));

  /* ── OBV ────────────────────────────────────────────────────────────── */
  const obvArr = calcOBV(closes, volumes);
  const obv = last(obvArr);

  /* ── Price changes ───────────────────────────────────────────────────── */
  const price1dAgo = priceAtOffset(closes, 1);
  const price7dAgo = priceAtOffset(closes, 5);   // ~1 trading week
  const price30dAgo = priceAtOffset(closes, 21); // ~1 trading month

  const change24h = price1dAgo != null ? currentPrice - price1dAgo : undefined;
  const changePercent24h = price1dAgo != null && price1dAgo !== 0 ? (change24h! / price1dAgo) * 100 : undefined;
  const change7d = price7dAgo != null ? currentPrice - price7dAgo : undefined;
  const changePercent7d = price7dAgo != null && price7dAgo !== 0 ? (change7d! / price7dAgo) * 100 : undefined;
  const change30d = price30dAgo != null ? currentPrice - price30dAgo : undefined;
  const changePercent30d = price30dAgo != null && price30dAgo !== 0 ? (change30d! / price30dAgo) * 100 : undefined;

  const high52w = Math.max(...closes);
  const low52w = Math.min(...closes);

  /* ── Derive signals ─────────────────────────────────────────────────── */

  // Trend: bullish when price > SMA50 > SMA200, bearish when reversed
  let trend: TechnicalData['signals']['trend'] = 'neutral';
  if (sma50 != null && sma200 != null) {
    if (currentPrice > sma50 && sma50 > sma200) trend = 'bullish';
    else if (currentPrice < sma50 && sma50 < sma200) trend = 'bearish';
  } else if (sma50 != null) {
    trend = currentPrice > sma50 ? 'bullish' : 'bearish';
  }

  // Momentum: RSI + MACD alignment
  let momentum: TechnicalData['signals']['momentum'] = 'neutral';
  const rsiMom = rsi14 != null ? (rsi14 > 55 ? 'bullish' : rsi14 < 45 ? 'bearish' : 'neutral') : 'neutral';
  const macdMom = (macd != null && macdSignal != null) ? (macd > macdSignal ? 'bullish' : 'bearish') : 'neutral';
  if (rsiMom === 'bullish' && macdMom === 'bullish') momentum = 'bullish';
  else if (rsiMom === 'bearish' && macdMom === 'bearish') momentum = 'bearish';
  else if (rsiMom === macdMom) momentum = rsiMom;

  // Volatility: ATR as % of price
  let volatility: TechnicalData['signals']['volatility'] = 'medium';
  if (atr14 != null) {
    const atrPct = atr14 / currentPrice;
    if (atrPct > 0.03) volatility = 'high';
    else if (atrPct < 0.01) volatility = 'low';
  }

  // Volume: recent 5-day avg vs 20-day avg
  let volume: TechnicalData['signals']['volume'] = 'stable';
  if (volumeSma20 > 0) {
    const ratio = volume5avg / volumeSma20;
    if (ratio > 1.2) volume = 'increasing';
    else if (ratio < 0.8) volume = 'decreasing';
  }

  // Overall signal: majority vote
  const bullishCount = [trend, momentum, volume === 'increasing' ? 'bullish' : volume === 'decreasing' ? 'bearish' : 'neutral'].filter(s => s === 'bullish').length;
  const bearishCount = [trend, momentum, volume === 'increasing' ? 'bullish' : volume === 'decreasing' ? 'bearish' : 'neutral'].filter(s => s === 'bearish').length;
  const overall: TechnicalData['signals']['overall'] =
    bullishCount > bearishCount ? 'bullish' : bearishCount > bullishCount ? 'bearish' : 'neutral';

  return {
    ticker,
    timestamp: new Date().toISOString(),
    indicators: {
      sma20,
      sma50,
      sma200,
      ema12,
      ema26,
      rsi14,
      macd,
      macdSignal,
      macdHistogram,
      bollingerUpper,
      bollingerLower,
      atr14,
      volumeSma20,
      obv,
    },
    priceData: {
      currentPrice,
      change24h,
      changePercent24h,
      change7d,
      changePercent7d,
      change30d,
      changePercent30d,
      high52w,
      low52w,
    },
    signals: {
      trend,
      momentum,
      volatility,
      volume,
      overall,
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Build the technical analysis markdown report
 * ─────────────────────────────────────────────────────────────────────────── */

function fmtN(v: number | undefined, d = 2): string { return v != null ? v.toFixed(d) : '—'; }
function fmtPct(v: number | undefined): string { return v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—'; }
function signalEmoji(s: string): string {
  return s === 'bullish' || s === 'increasing' || s === 'low' ? '🟢' :
         s === 'bearish' || s === 'decreasing' || s === 'high' ? '🔴' : '🟡';
}

function buildTechnicalReport(td: TechnicalData): string {
  const { ticker, indicators: ind, priceData: pd, signals: sig } = td;
  const lines: string[] = [];

  lines.push(`# 📈 Technical Analysis Report: ${ticker}`);
  lines.push('');
  lines.push(`**Current Price:** $${fmtN(pd.currentPrice)}`);
  lines.push(`**24h Change:** ${fmtPct(pd.changePercent24h)}`);
  lines.push(`**7d Change:** ${fmtPct(pd.changePercent7d)}`);
  lines.push(`**30d Change:** ${fmtPct(pd.changePercent30d)}`);
  lines.push('');

  lines.push('---');
  lines.push('## 📊 Signal Summary');
  lines.push('');
  lines.push('| Signal | Result |');
  lines.push('|--------|--------|');
  lines.push(`| Trend | ${signalEmoji(sig.trend)} **${sig.trend.toUpperCase()}** |`);
  lines.push(`| Momentum | ${signalEmoji(sig.momentum)} **${sig.momentum.toUpperCase()}** |`);
  lines.push(`| Volume | ${signalEmoji(sig.volume)} **${sig.volume.toUpperCase()}** |`);
  lines.push(`| Volatility | ${sig.volatility === 'high' ? '🔴' : sig.volatility === 'low' ? '🟢' : '🟡'} **${sig.volatility.toUpperCase()}** |`);
  lines.push(`| **Overall** | ${signalEmoji(sig.overall)} **${sig.overall.toUpperCase()}** |`);
  lines.push('');

  lines.push('---');
  lines.push('## 📉 Moving Averages & Trend');
  lines.push('');
  lines.push('| Indicator | Value | vs Price |');
  lines.push('|-----------|-------|----------|');
  if (ind.sma20 != null) lines.push(`| SMA 20 | $${fmtN(ind.sma20)} | ${pd.currentPrice > ind.sma20 ? '🟢 Above' : '🔴 Below'} |`);
  if (ind.sma50 != null) lines.push(`| SMA 50 | $${fmtN(ind.sma50)} | ${pd.currentPrice > ind.sma50 ? '🟢 Above' : '🔴 Below'} |`);
  if (ind.sma200 != null) lines.push(`| SMA 200 | $${fmtN(ind.sma200)} | ${pd.currentPrice > ind.sma200 ? '🟢 Above' : '🔴 Below'} |`);
  if (ind.ema12 != null) lines.push(`| EMA 12 | $${fmtN(ind.ema12)} | — |`);
  if (ind.ema26 != null) lines.push(`| EMA 26 | $${fmtN(ind.ema26)} | — |`);
  lines.push('');

  lines.push('---');
  lines.push('## ⚡ Momentum Indicators');
  lines.push('');
  if (ind.rsi14 != null) {
    const rsiStatus = ind.rsi14 > 70 ? '🔴 Overbought' : ind.rsi14 < 30 ? '🟢 Oversold (buy zone)' : '🟡 Neutral';
    lines.push(`**RSI (14):** ${fmtN(ind.rsi14)} — ${rsiStatus}`);
    lines.push('');
  }
  if (ind.macd != null) {
    lines.push('| MACD Indicator | Value |');
    lines.push('|---------------|-------|');
    lines.push(`| MACD Line | ${fmtN(ind.macd, 3)} |`);
    if (ind.macdSignal != null) lines.push(`| Signal Line | ${fmtN(ind.macdSignal, 3)} |`);
    if (ind.macdHistogram != null) lines.push(`| Histogram | ${ind.macdHistogram >= 0 ? '🟢' : '🔴'} ${fmtN(ind.macdHistogram, 3)} |`);
    lines.push('');
  }

  lines.push('---');
  lines.push('## 🎯 Volatility & Bollinger Bands');
  lines.push('');
  if (ind.bollingerUpper != null && ind.bollingerLower != null) {
    lines.push('| Band | Value |');
    lines.push('|------|-------|');
    lines.push(`| Upper Band | $${fmtN(ind.bollingerUpper)} |`);
    lines.push(`| Current Price | $${fmtN(pd.currentPrice)} |`);
    lines.push(`| Lower Band | $${fmtN(ind.bollingerLower)} |`);
    const width = ind.bollingerUpper - ind.bollingerLower;
    lines.push(`| Band Width | $${fmtN(width)} |`);
    lines.push('');
    const pctB = (pd.currentPrice - ind.bollingerLower) / (ind.bollingerUpper - ind.bollingerLower) * 100;
    lines.push(`**%B:** ${fmtN(pctB)}% (${pctB > 80 ? '🔴 Near upper band — caution' : pctB < 20 ? '🟢 Near lower band — potential buy' : '🟡 Mid-band zone'})`);
    lines.push('');
  }
  if (ind.atr14 != null) {
    lines.push(`**ATR (14):** $${fmtN(ind.atr14)} — ${sig.volatility} volatility`);
    lines.push('');
  }

  lines.push('---');
  lines.push('## 📦 Volume Analysis');
  lines.push('');
  if (ind.volumeSma20 != null) {
    lines.push(`**20-day Average Volume:** ${(ind.volumeSma20 / 1e6).toFixed(2)}M`);
    lines.push(`**Volume Trend:** ${signalEmoji(sig.volume)} ${sig.volume.toUpperCase()}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('## 📅 52-Week Range');
  lines.push('');
  if (pd.high52w != null && pd.low52w != null) {
    const range = pd.high52w - pd.low52w;
    const pctFromLow = range > 0 ? ((pd.currentPrice - pd.low52w) / range) * 100 : 50;
    lines.push(`| | Price |`);
    lines.push(`|---|---|`);
    lines.push(`| 52-Week High | $${fmtN(pd.high52w)} |`);
    lines.push(`| Current Price | $${fmtN(pd.currentPrice)} |`);
    lines.push(`| 52-Week Low | $${fmtN(pd.low52w)} |`);
    lines.push(`| Position in Range | ${fmtN(pctFromLow)}% from 52-week low |`);
    lines.push('');
  }

  lines.push('> *Technical analysis based on historical price data. Not investment advice.*');
  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Public: run the Technical Analysis Agent
 * ─────────────────────────────────────────────────────────────────────────── */

export async function runTechnicalAnalysisAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { input } = context;
  throwIfAborted(context.signal);
  const ticker = extractTickerSymbol(input, context.extractedTicker);

  if (!ticker) {
    return {
      agent: TECHNICAL_ANALYSIS_AGENT,
      summary: 'Could not identify a stock ticker symbol from input.',
      markdown: [
        '# 📈 Technical Analysis Agent',
        '',
        '**Error:** Could not identify a stock ticker symbol from your message.',
        '',
        'Please provide a valid ticker symbol (e.g., **AMD**, **AAPL**, **MSFT**).',
      ].join('\n'),
      metadata: { error: 'no_ticker' },
    };
  }

  try {
    // Fetch roughly 14 months of daily data to ensure 200-period calculations
    const period1 = new Date();
    period1.setMonth(period1.getMonth() - 14);

    const chartResult = await yahooFinance.chart(ticker, {
      period1: period1.toISOString().split('T')[0]!,
      interval: '1d',
    });
    throwIfAborted(context.signal);

    const quotes = chartResult.quotes ?? [];
    if (quotes.length === 0) {
      return {
        agent: TECHNICAL_ANALYSIS_AGENT,
        summary: `No price history data found for ${ticker}.`,
        markdown: `# 📈 Technical Analysis Agent\n\n**Warning:** No historical price data returned for **${ticker}**.`,
        metadata: { ticker, error: 'no_data' },
      };
    }

    const closes = quotes.map(q => (q.close ?? q.adjclose ?? 0) as number).filter(v => v > 0);
    const highs = quotes.map(q => (q.high ?? q.close ?? 0) as number).filter(v => v > 0);
    const lows = quotes.map(q => (q.low ?? q.close ?? 0) as number).filter(v => v > 0);
    const volumes = quotes.map(q => (q.volume ?? 0) as number);

    const minLen = Math.min(closes.length, highs.length, lows.length, volumes.length);
    const technicalData = buildTechnicalData(
      ticker,
      closes.slice(-minLen),
      highs.slice(-minLen),
      lows.slice(-minLen),
      volumes.slice(-minLen),
    );

    const markdown = buildTechnicalReport(technicalData);

    return {
      agent: TECHNICAL_ANALYSIS_AGENT,
      summary: `Technical analysis for ${ticker}: Overall signal ${technicalData.signals.overall.toUpperCase()}, RSI=${technicalData.indicators.rsi14?.toFixed(1) ?? '—'}, Price $${technicalData.priceData.currentPrice.toFixed(2)}.`,
      markdown,
      metadata: {
        ticker,
        technicalData,
      },
    };
  } catch (error) {
    if (isAbortError(error, context.signal)) {
      throw error;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[technicalAnalysisAgent] Failed to fetch data for ${ticker}:`, errMsg);
    return {
      agent: TECHNICAL_ANALYSIS_AGENT,
      summary: `Failed to fetch technical data for ${ticker}.`,
      markdown: [
        '# 📈 Technical Analysis Agent',
        '',
        `**Error:** Failed to fetch price data for **${ticker}**.`,
        '',
        `Reason: ${errMsg}`,
      ].join('\n'),
      metadata: { error: errMsg, ticker },
    };
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Export helpers used by other agents
 * ─────────────────────────────────────────────────────────────────────────── */

export { buildTechnicalData };
