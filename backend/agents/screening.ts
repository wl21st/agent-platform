import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export type ScreenHit = {
  ticker: string;
  setupType: "trend" | "pullback" | "momentum";
  passed: boolean;
  score: number;
  metrics: Record<string, number>;
};

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
      const volumes = bars.map(b => b.volume || 0);
      const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
      const volAvg20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const currentPrice = closes[closes.length - 1];
      const currentVolume = volumes[volumes.length - 1];

      const passed = currentPrice > sma20 && sma20 > sma50 && sma50 > sma200 && currentVolume > 1.5 * volAvg20 && currentPrice <= 1.15 * sma50;
      if (!passed) continue;

      const score = 1; // Simple score for passed hits

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
      const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
      const volAvg20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const currentPrice = closes[closes.length - 1];
      const currentVolume = volumes[volumes.length - 1];
      const highs = bars.map(b => b.high || 0);
      const high60d = Math.max(...highs.slice(-61, -1));

      const passed = currentPrice > sma200 && sma50 > sma200 && currentPrice < sma20 && currentPrice > sma50 * 0.97 && currentVolume < 1.5 * volAvg20;
      if (!passed) continue;

      const score = 1; // Simple score for passed hits

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

      const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      const volAvg20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const close5dAgo = closes[closes.length - 6] || 0;
      const return5d = (currentClose - close5dAgo) / close5dAgo;
      const gapPct = ((currentOpen - previousClose) / previousClose) * 100;
      const trueRanges = bars.slice(-14).map((bar, index) => {
        const absoluteIndex = bars.length - 14 + index;
        const previousBarClose = closes[absoluteIndex - 1] || bar.close || 0;
        return Math.max(
          highs[absoluteIndex] - lows[absoluteIndex],
          Math.abs(highs[absoluteIndex] - previousBarClose),
          Math.abs(lows[absoluteIndex] - previousBarClose),
        );
      });
      const atr14 = trueRanges.reduce((sum, trueRange) => sum + trueRange, 0) / trueRanges.length;

      const passed = gapPct > 5 && currentClose > currentOpen && currentVolume > 2 * volAvg20 && currentClose > sma50 && return5d <= 0.3;
      if (!passed) continue;

      const score = 1; // Simple score for passed hits

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
          sma50,
          atr14,
          return5d,
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
