import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export type SetupType = 'trend' | 'pullback' | 'momentum';

interface ChartBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartQuote {
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  adjclose?: number | null;
  volume?: number | null;
}

interface ChartResult {
  quotes?: ChartQuote[];
}

export interface ScreenHit {
  ticker: string;
  setupType: SetupType;
  passed: true;
  score: number;
  metrics: Record<string, number>;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculateAtr14(bars: ChartBar[], closes: number[]): number {
  if (bars.length < 2) return 0;

  const trueRanges: number[] = [];
  const start = Math.max(1, bars.length - 14);

  for (let i = start; i < bars.length; i += 1) {
    const high = bars[i].high;
    const low = bars[i].low;
    const previousClose = closes[i - 1] || bars[i - 1].close;
    trueRanges.push(Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    ));
  }

  return average(trueRanges);
}

async function fetchScreeningBars(ticker: string): Promise<ChartBar[]> {
  const period1 = new Date();
  period1.setMonth(period1.getMonth() - 18);

  const chartResult = await yahooFinance.chart(ticker, {
    period1: period1.toISOString().split('T')[0]!,
    interval: '1d',
  }, {
    validateResult: false,
  }) as unknown as ChartResult;

  return (chartResult.quotes ?? [])
    .map((quote) => {
      const close = quote.close ?? quote.adjclose ?? 0;
      const open = quote.open ?? close;
      const high = quote.high ?? close;
      const low = quote.low ?? close;

      return {
        open,
        high,
        low,
        close,
        volume: quote.volume ?? 0,
      };
    })
    .filter((bar) => bar.close > 0 && bar.high > 0 && bar.low > 0 && bar.open > 0);
}

function evaluateTrend(ticker: string, bars: ChartBar[]): ScreenHit | null {
  if (bars.length < 200) return null;

  const closes = bars.map((bar) => bar.close || 0);
  const volumes = bars.map((bar) => bar.volume || 0);
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
  if (!passed) return null;

  const base =
    40 * ((sma20 - sma50) / sma50) +
    30 * ((sma50 - sma200) / sma200) +
    15 * Math.min(volRatio, 4) +
    15 * Math.max(0, 1 - ((currentPrice - sma20) / (2 * atr14)));
  const penalty =
    25 * Math.max(0, (currentPrice / sma50) - 1.08) +
    20 * Math.max(0, return20d - 0.25);
  const score = Math.max(0, base - penalty);

  return {
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
  };
}

function evaluatePullback(ticker: string, bars: ChartBar[]): ScreenHit | null {
  if (bars.length < 200) return null;

  const closes = bars.map((bar) => bar.close || 0);
  const highs = bars.map((bar) => bar.high || 0);
  const volumes = bars.map((bar) => bar.volume || 0);
  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));
  const sma200 = average(closes.slice(-200));
  const volAvg20 = average(volumes.slice(-20));
  const currentPrice = closes[closes.length - 1];
  const currentVolume = volumes[volumes.length - 1];
  const high60d = Math.max(...highs.slice(-61, -1));
  const atr14 = calculateAtr14(bars, closes);
  const volRatio = volAvg20 > 0 ? currentVolume / volAvg20 : 0;

  const passed = currentPrice > sma200 && sma50 > sma200 && currentPrice < sma20 && currentPrice > sma50 * 0.97 && currentVolume < 1.5 * volAvg20;
  if (!passed) return null;

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

  return {
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
  };
}

function evaluateMomentum(ticker: string, bars: ChartBar[]): ScreenHit | null {
  if (bars.length < 60) return null;

  const closes = bars.map((bar) => bar.close || 0);
  const opens = bars.map((bar) => bar.open || 0);
  const highs = bars.map((bar) => bar.high || 0);
  const volumes = bars.map((bar) => bar.volume || 0);

  const currentClose = closes[closes.length - 1];
  const currentOpen = opens[opens.length - 1];
  const currentVolume = volumes[volumes.length - 1];
  const previousClose = closes[closes.length - 2] || 0;

  const sma20 = average(closes.slice(-20));
  const sma50 = average(closes.slice(-50));
  const volAvg20 = average(volumes.slice(-20));
  const close5dAgo = closes[closes.length - 6] || 0;
  const return5d = close5dAgo > 0 ? (currentClose - close5dAgo) / close5dAgo : 0;
  const gap = previousClose > 0 ? (currentOpen - previousClose) / previousClose : 0;
  const gapPct = gap * 100;
  const volRatio = volAvg20 > 0 ? currentVolume / volAvg20 : 0;
  const atr14 = calculateAtr14(bars, closes);
  const holdStrength = atr14 > 0 ? (currentClose - currentOpen) / atr14 : 0;
  const high20d = Math.max(...highs.slice(-21, -1));

  const passed = gapPct > 5 && currentClose > currentOpen && currentVolume > 2 * volAvg20 && currentClose > sma50 && return5d <= 0.3;
  if (!passed) return null;

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

  return {
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
  };
}

function evaluateSetups(ticker: string, bars: ChartBar[], setupTypes: SetupType[]) {
  return setupTypes.flatMap((setupType) => {
    const hit = setupType === 'trend'
      ? evaluateTrend(ticker, bars)
      : setupType === 'pullback'
        ? evaluatePullback(ticker, bars)
        : evaluateMomentum(ticker, bars);

    return hit ? [hit] : [];
  });
}

export async function screenSetups(tickers: string[], setupTypes: SetupType[]): Promise<ScreenHit[]> {
  const results: ScreenHit[] = [];

  for (const ticker of tickers) {
    try {
      const bars = await fetchScreeningBars(ticker);
      results.push(...evaluateSetups(ticker, bars, setupTypes));
    } catch (error) {
      console.error(`[screening] Error processing ${ticker}:`, error);
    }
  }

  return results;
}

/**
 * Screen stocks for uptrend: close > sma20 > sma50 > sma200, volume > 1.5 * volAvg20, close <= 1.15 * sma50, >= 200 bars
 */
export async function screenTrend(tickers: string[]): Promise<ScreenHit[]> {
  return screenSetups(tickers, ['trend']);
}

/**
 * Screen stocks for pullback: close > sma200, sma50 > sma200, close < sma20, close > sma50 * 0.97, volume < 1.5 * volAvg20, >= 200 bars
 */
export async function screenPullback(tickers: string[]): Promise<ScreenHit[]> {
  return screenSetups(tickers, ['pullback']);
}

/**
 * Screen stocks for momentum: gap > 5%, close > open, volume > 2 * volAvg20, close > sma50, 5-day return <= 30%, >= 60 bars
 */
export async function screenMomentum(tickers: string[]): Promise<ScreenHit[]> {
  return screenSetups(tickers, ['momentum']);
}

// If run as a script, accept method and tickers as arguments
// Usage: node --loader ts-node/esm screening.ts trend NVDA AAPL MSFT
// or: node --loader ts-node/esm screening.ts pullback NVDA AAPL
// or: node --loader ts-node/esm screening.ts momentum NVDA AAPL
// or: node --loader ts-node/esm screening.ts all NVDA AAPL
if (import.meta.url === `file://${process.argv[1]}`) {
  const [method, ...tickers] = process.argv.slice(2);
  if (!method || tickers.length === 0) {
    console.error('Usage: node --loader ts-node/esm screening.ts <method> TICKER1 TICKER2 ...');
    console.error('Methods: trend, pullback, momentum, all');
    process.exit(1);
  }

  const setupTypes: SetupType[] = method === 'all'
    ? ['trend', 'pullback', 'momentum']
    : method === 'trend' || method === 'pullback' || method === 'momentum'
      ? [method]
      : [];

  if (setupTypes.length === 0) {
    console.error('Invalid method. Use: trend, pullback, momentum, or all');
    process.exit(1);
  }

  screenSetups(tickers, setupTypes).then((results) => {
    console.log(JSON.stringify(results, null, 2));
  }).catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
