import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export type ScreenHit = {
  ticker: string;
  setupType: "trend" | "pullback" | "momentum";
  passed: boolean;
  score: number;
  metrics: Record<string, number>;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateAtr14(bars: Array<{ high?: number | null; low?: number | null; close?: number | null }>, closes: number[]) {
  const trueRanges = bars.slice(-14).map((bar, index) => {
    const absoluteIndex = bars.length - 14 + index;
    const high = bar.high || 0;
    const low = bar.low || 0;
    const previousClose = closes[absoluteIndex - 1] || bar.close || 0;
    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    );
  });

  return average(trueRanges);
}

/**
 * Screen stocks for uptrend: close > sma20 > sma50 > sma200, volume > 1.5 * volAvg20, close <= 1.15 * sma50, >= 200 bars
 */
export async function screenTrend(tickers: string[]): Promise<ScreenHit[]> {
  const results: ScreenHit[] = [];

  for (const ticker of tickers) {
    try {
      const end = new Date();
      const start = new Date();
      start.setFullYear(end.getFullYear() - 2); // 2 years for SMA200

      const chart = await yahooFinance.chart(ticker, {
        period1: start.toISOString().split('T')[0],
        period2: end.toISOString().split('T')[0],
        interval: '1d',
      });

      const bars = chart.quotes;
      if (!bars || bars.length < 200) continue;

      // Calculate SMAs
      const closes = bars.map(b => b.close || 0);
      const highs = bars.map(b => b.high || 0);
      const volumes = bars.map(b => b.volume || 0);
      const sma20 = average(closes.slice(-20));
      const sma50 = average(closes.slice(-50));
      const sma200 = average(closes.slice(-200));
      const volAvg20 = average(volumes.slice(-20));
      const currentPrice = closes[closes.length - 1];
      const currentVolume = volumes[volumes.length - 1];
      const close20dAgo = closes[closes.length - 21] || 0;
      const return20d = close20dAgo > 0 ? (currentPrice - close20dAgo) / close20dAgo : 0;
      const atr14 = calculateAtr14(bars, closes);
      const volRatio = volAvg20 > 0 ? currentVolume / volAvg20 : 0;

      const passed = currentPrice > sma20 && sma20 > sma50 && sma50 > sma200 && currentVolume > 1.5 * volAvg20 && currentPrice <= 1.15 * sma50;
      if (!passed) continue;

      const base =
        40 * ((sma20 - sma50) / sma50) +
        30 * ((sma50 - sma200) / sma200) +
        15 * Math.min(volRatio, 4) +
        15 * Math.max(0, 1 - ((currentPrice - sma20) / (2 * atr14)));
      const penalty =
        25 * Math.max(0, (currentPrice / sma50) - 1.08) +
        20 * Math.max(0, return20d - 0.25);
      const score = Math.max(0, base - penalty);

      results.push({
        ticker,
        setupType: 'trend',
        passed: true,
        score,
        metrics: {
          close: currentPrice,
          sma20,
          sma50,
          sma200,
          volume: currentVolume,
          volAvg20,
          volRatio,
          atr14,
          return20d,
          scoreBase: base,
          scorePenalty: penalty,
        },
      });
    } catch (error) {
      // Skip on error
    }
  }

  return results;
}

/**
 * Screen stocks for pullback: close > sma200, sma50 > sma200, close < sma20, close > sma50 * 0.97, volume < 1.5 * volAvg20, >= 200 bars
 */
export async function screenPullback(tickers: string[]): Promise<ScreenHit[]> {
  const results: ScreenHit[] = [];

  for (const ticker of tickers) {
    try {
      const end = new Date();
      const start = new Date();
      start.setFullYear(end.getFullYear() - 2); // 2 years for SMA200

      const chart = await yahooFinance.chart(ticker, {
        period1: start.toISOString().split('T')[0],
        period2: end.toISOString().split('T')[0],
        interval: '1d',
      });

      const bars = chart.quotes;
      if (!bars || bars.length < 200) continue;

      const closes = bars.map(b => b.close || 0);
      const volumes = bars.map(b => b.volume || 0);
      const sma20 = average(closes.slice(-20));
      const sma50 = average(closes.slice(-50));
      const sma200 = average(closes.slice(-200));
      const volAvg20 = average(volumes.slice(-20));
      const currentPrice = closes[closes.length - 1];
      const currentVolume = volumes[volumes.length - 1];
      const highs = bars.map(b => b.high || 0);
      const high60d = Math.max(...highs.slice(-61, -1));
      const atr14 = calculateAtr14(bars, closes);
      const volRatio = volAvg20 > 0 ? currentVolume / volAvg20 : 0;

      const passed = currentPrice > sma200 && sma50 > sma200 && currentPrice < sma20 && currentPrice > sma50 * 0.97 && currentVolume < 1.5 * volAvg20;
      if (!passed) continue;

      const depthDenominator = sma20 - sma50;
      const depth = depthDenominator > 0
        ? clamp((sma20 - currentPrice) / depthDenominator, 0, 1)
        : 0;
      const trendStrength = (sma50 - sma200) / sma200;
      const base =
        45 * depth +
        30 * trendStrength +
        15 * Math.max(0, 1.5 - volRatio) +
        10 * Math.max(0, 1 - (Math.abs(currentPrice - sma50) / (1.5 * atr14)));
      const penalty =
        20 * Math.max(0, ((sma20 - currentPrice) / currentPrice) - 0.06) +
        20 * Math.max(0, 0.99 - (currentPrice / sma50));
      const score = Math.max(0, base - penalty);

      results.push({
        ticker,
        setupType: 'pullback',
        passed: true,
        score,
        metrics: {
          close: currentPrice,
          sma20,
          sma50,
          sma200,
          high60d,
          volume: currentVolume,
          volAvg20,
          volRatio,
          atr14,
          depth,
          trendStrength,
          scoreBase: base,
          scorePenalty: penalty,
        },
      });
    } catch (error) {
      // Skip on error
    }
  }

  return results;
}

/**
 * Screen stocks for momentum: gap > 5%, close > open, volume > 2 * volAvg20, close > sma50, 5-day return <= 30%, >= 60 bars
 */
export async function screenMomentum(tickers: string[]): Promise<ScreenHit[]> {
  const results: ScreenHit[] = [];

  for (const ticker of tickers) {
    try {
      const end = new Date();
      const start = new Date();
      start.setMonth(end.getMonth() - 6); // 6 months

      const chart = await yahooFinance.chart(ticker, {
        period1: start.toISOString().split('T')[0],
        period2: end.toISOString().split('T')[0],
        interval: '1d',
      });

      const bars = chart.quotes;
      if (!bars || bars.length < 60) continue;

      const closes = bars.map(b => b.close || 0);
      const opens = bars.map(b => b.open || 0);
      const highs = bars.map(b => b.high || 0);
      const lows = bars.map(b => b.low || 0);
      const volumes = bars.map(b => b.volume || 0);

      const currentClose = closes[closes.length - 1];
      const currentOpen = opens[opens.length - 1];
      const currentVolume = volumes[volumes.length - 1];
      const previousClose = closes[closes.length - 2] || 0;

      const sma20 = average(closes.slice(-20));
      const sma50 = average(closes.slice(-50));
      const volAvg20 = average(volumes.slice(-20));
      const close5dAgo = closes[closes.length - 6] || 0;
      const return5d = (currentClose - close5dAgo) / close5dAgo;
      const gap = previousClose > 0 ? (currentOpen - previousClose) / previousClose : 0;
      const gapPct = gap * 100;
      const volRatio = volAvg20 > 0 ? currentVolume / volAvg20 : 0;
      const atr14 = calculateAtr14(bars, closes);
      const holdStrength = atr14 > 0 ? (currentClose - currentOpen) / atr14 : 0;
      const high20d = Math.max(...highs.slice(-21, -1));

      const passed = gapPct > 5 && currentClose > currentOpen && currentVolume > 2 * volAvg20 && currentClose > sma50 && return5d <= 0.3;
      if (!passed) continue;

      const base =
        35 * gap +
        25 * Math.min(volRatio, 6) +
        20 * Math.max(0, holdStrength) +
        20 * Math.max(0, (currentClose - sma50) / sma50);
      const penalty =
        30 * Math.max(0, return5d - 0.18) +
        20 * Math.max(0, (currentClose / sma20) - 1.08) +
        20 * Math.max(0, (currentClose - high20d * 0.98) / currentClose);
      const score = Math.max(0, base - penalty);

      results.push({
        ticker,
        setupType: 'momentum',
        passed: true,
        score,
        metrics: {
          close: currentClose,
          open: currentOpen,
          gapPct,
          volume: currentVolume,
          volAvg20,
          volRatio,
          sma20,
          sma50,
          atr14,
          holdStrength,
          high20d,
          return5d,
          scoreBase: base,
          scorePenalty: penalty,
        },
      });
    } catch (error) {
      // Skip on error
    }
  }

  return results;
}

// If run as a script, accept method and tickers as arguments
// Usage: node --loader ts-node/esm screening.ts trend NVDA AAPL MSFT
// or: node --loader ts-node/esm screening.ts pullback NVDA AAPL
// or: node --loader ts-node/esm screening.ts momentum NVDA AAPL
if (import.meta.url === `file://${process.argv[1]}`) {
  const [method, ...tickers] = process.argv.slice(2);
  if (!method || tickers.length === 0) {
    console.error('Usage: node --loader ts-node/esm screening.ts <method> TICKER1 TICKER2 ...');
    console.error('Methods: trend, pullback, momentum');
    process.exit(1);
  }

  let fn: (tickers: string[]) => Promise<ScreenHit[]>;
  switch (method) {
    case 'trend':
      fn = screenTrend;
      break;
    case 'pullback':
      fn = screenPullback;
      break;
    case 'momentum':
      fn = screenMomentum;
      break;
    default:
      console.error('Invalid method. Use: trend, pullback, or momentum');
      process.exit(1);
  }

  fn(tickers).then((results) => {
    console.log(JSON.stringify(results, null, 2));
  }).catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
