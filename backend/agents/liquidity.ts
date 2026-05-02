import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

type ChartQuote = {
  close?: number | null;
  volume?: number | null;
};

type ChartResultArray = {
  quotes?: ChartQuote[];
};

export interface LiquidityResult {
  ticker: string;
  status: 'passed' | 'failed';
  reasons: string[];
  metrics: {
    close: number;
    avgVolume20: number;
  };
}

export type LiquidityResults = LiquidityResult[] & {
  fetchStats?: StockMetricsFetchStats;
};

const MIN_PRICE = 10;
const MIN_AVG_VOLUME_20 = 2_000_000;
const MIN_HISTORY_BARS = 20;
const STOCK_METRICS_CACHE_TTL_MS = 60 * 60 * 1000;
const STOCK_METRICS_BATCH_SIZE = 50;
const STOCK_METRICS_CONCURRENCY = 3;
const STOCK_METRICS_MAX_TICKERS = 50_000;
const STOCK_METRICS_REQUESTS_PER_SECOND = 2;
const STOCK_METRICS_REQUEST_INTERVAL_MS = 1000 / STOCK_METRICS_REQUESTS_PER_SECOND;
const STOCK_METRICS_MAX_RETRIES = 3;
const STOCK_METRICS_RETRY_BASE_DELAY_MS = 5_000;

type StockMetricsCacheEntry = {
  result: LiquidityResult;
  fetchedAt: number;
};

type StockMetricsFetchStats = {
  requestedCount: number;
  processedCount: number;
  skippedCount: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  batches: number;
  batchSize: number;
  concurrency: number;
  cacheTtlMs: number;
  requestsPerSecond: number;
  maxRetries: number;
};

export type LiquidityUniverseKey = 'sp500' | 'nasdaq100' | 'nasdaq' | 'nyse' | 'us-listed' | 'default';

type WikipediaUniverseKey = Extract<LiquidityUniverseKey, 'sp500' | 'nasdaq100' | 'default'>;
type NasdaqTraderUniverseKey = Extract<LiquidityUniverseKey, 'nasdaq' | 'nyse' | 'us-listed'>;

export interface LiquidityUniverse {
  key: LiquidityUniverseKey;
  label: string;
  source: 'wikipedia-constituents' | 'nasdaq-trader-symbol-directory' | 'yahoo-finance2-top-holdings' | 'explicit-tickers' | 'fallback-default';
  sourceSymbol?: string;
  sourceUrl?: string;
  tickers: string[];
}

const FALLBACK_DEFAULT_TICKERS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'AMD', 'INTC',
  'CRM', 'ORCL', 'CSCO', 'ADBE', 'QCOM', 'TXN', 'AVGO', 'MU', 'LRCX', 'KLAC',
  'SPY', 'QQQ', 'IWM', 'VTI', 'VOO', 'BND', 'AGG', 'VEA', 'VWO', 'VIG',
];

const YAHOO_HOLDINGS_UNIVERSES: Record<WikipediaUniverseKey, { label: string; sourceSymbol: string }> = {
  default: { label: 'Default US stock universe via SPY holdings', sourceSymbol: 'SPY' },
  sp500: { label: 'S&P 500 via SPY holdings', sourceSymbol: 'SPY' },
  nasdaq100: { label: 'Nasdaq 100 via QQQ holdings', sourceSymbol: 'QQQ' },
};

const WIKIPEDIA_CONSTITUENT_UNIVERSES: Record<WikipediaUniverseKey, { label: string; sourceUrl: string }> = {
  default: {
    label: 'Default US stock universe via S&P 500 constituents',
    sourceUrl: 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies',
  },
  sp500: {
    label: 'S&P 500 constituents',
    sourceUrl: 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies',
  },
  nasdaq100: {
    label: 'Nasdaq 100 constituents',
    sourceUrl: 'https://en.wikipedia.org/wiki/Nasdaq-100',
  },
};

const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';
const stockMetricsCache = new Map<string, StockMetricsCacheEntry>();
const pendingStockMetrics = new Map<string, Promise<LiquidityResult>>();
let nextStockMetricsRequestAt = 0;

type YahooTopHolding = {
  symbol?: string;
};

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase().replace('.', '-');
}

function uniqueTickers(tickers: string[]) {
  return [...new Set(tickers.map(normalizeTicker).filter((ticker) => /^[A-Z][A-Z0-9-]{0,9}$/.test(ticker)))];
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStockMetricsRateLimit() {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextStockMetricsRequestAt);
  nextStockMetricsRequestAt = scheduledAt + STOCK_METRICS_REQUEST_INTERVAL_MS;

  const waitMs = scheduledAt - now;
  if (waitMs > 0) {
    await delay(waitMs);
  }
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );

  return results;
}

function createDataFetchErrorResult(ticker: string): LiquidityResult {
  return {
    ticker,
    status: 'failed',
    reasons: ['data_fetch_error'],
    metrics: {
      close: 0,
      avgVolume20: 0,
    },
  };
}

function isRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|too many requests|rate limit/i.test(message);
}

function parsePipeDelimitedRows(text: string) {
  const lines = text.trim().split(/\r?\n/).filter((line) => line.includes('|'));
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine?.split('|') ?? [];

  return dataLines.flatMap((line) => {
    const values = line.split('|');
    if (values.length !== headers.length) return [];

    return [Object.fromEntries(headers.map((header, index) => [header, values[index]])) as Record<string, string>];
  });
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'agentsplatform-liquidity-agent/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#160;|&nbsp;/g, ' ')
    .trim();
}

function extractFirstColumnTickersFromHtmlTable(html: string) {
  const tableMatch = html.match(/<table[^>]*id="constituents"[^>]*>[\s\S]*?<\/table>/i);
  const tableHtml = tableMatch?.[0] ?? html;
  const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

  return uniqueTickers(
    rows.flatMap((row) => {
      const cells = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
      const firstCell = cells[0];
      if (!firstCell) return [];
      return [stripHtml(firstCell)];
    }),
  );
}

async function fetchWikipediaConstituentTickers(key: WikipediaUniverseKey): Promise<LiquidityUniverse> {
  const config = WIKIPEDIA_CONSTITUENT_UNIVERSES[key];
  const html = await fetchText(config.sourceUrl);
  const tickers = extractFirstColumnTickersFromHtmlTable(html);

  if (tickers.length === 0) {
    throw new Error(`No constituents found at ${config.sourceUrl}`);
  }

  return {
    key,
    label: config.label,
    source: 'wikipedia-constituents',
    sourceUrl: config.sourceUrl,
    tickers,
  };
}

async function fetchNasdaqListedTickers() {
  const text = await fetchText(NASDAQ_LISTED_URL);
  const rows = parsePipeDelimitedRows(text);

  return uniqueTickers(
    rows.flatMap((row) => {
      if (row['Test Issue'] !== 'N' || row.ETF !== 'N') return [];
      return [row.Symbol ?? ''];
    }),
  );
}

async function fetchOtherListedTickers(exchange: string) {
  const text = await fetchText(OTHER_LISTED_URL);
  const rows = parsePipeDelimitedRows(text);

  return uniqueTickers(
    rows.flatMap((row) => {
      if (row.Exchange !== exchange || row['Test Issue'] !== 'N' || row.ETF !== 'N') return [];
      return [row['ACT Symbol'] ?? ''];
    }),
  );
}

async function fetchNasdaqTraderUniverseTickers(key: NasdaqTraderUniverseKey): Promise<LiquidityUniverse> {
  if (key === 'nasdaq') {
    return {
      key,
      label: 'NASDAQ listed common stocks',
      source: 'nasdaq-trader-symbol-directory',
      sourceUrl: NASDAQ_LISTED_URL,
      tickers: await fetchNasdaqListedTickers(),
    };
  }

  if (key === 'nyse') {
    return {
      key,
      label: 'NYSE listed common stocks',
      source: 'nasdaq-trader-symbol-directory',
      sourceUrl: OTHER_LISTED_URL,
      tickers: await fetchOtherListedTickers('N'),
    };
  }

  const [nasdaqTickers, nyseTickers] = await Promise.all([
    fetchNasdaqListedTickers(),
    fetchOtherListedTickers('N'),
  ]);

  return {
    key,
    label: 'NASDAQ + NYSE listed common stocks',
    source: 'nasdaq-trader-symbol-directory',
    sourceUrl: `${NASDAQ_LISTED_URL}, ${OTHER_LISTED_URL}`,
    tickers: uniqueTickers([...nasdaqTickers, ...nyseTickers]),
  };
}

export function extractTickersFromInput(input: string) {
  return uniqueTickers(
    input
      .split(/[,;\s]+/)
      .map((token) => token.replace(/^\$/, ''))
      .filter((token) => /^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(token)),
  );
}

export function resolveLiquidityUniverseKey(input: string): LiquidityUniverseKey {
  const mentionsNyse = /(nyse|new\s+york\s+stock\s+exchange|纽交所|紐交所|纽约证券交易所|紐約證券交易所)/i.test(input);
  const mentionsNasdaq = /(nasdaq|纳斯达克|納斯達克)/i.test(input);

  if (mentionsNyse && mentionsNasdaq) {
    return 'us-listed';
  }

  if (/(s\s*&\s*p\s*500|sp\s*500|sp500|标普\s*500|標普\s*500|spy)/i.test(input)) {
    return 'sp500';
  }

  if (/(nasdaq\s*100|nasdaq100|纳斯达克\s*100|納斯達克\s*100|纳指\s*100|納指\s*100|qqq)/i.test(input)) {
    return 'nasdaq100';
  }

  if (/(all\s+us|us\s+listed|u\.s\.\s+listed|美国全市场|美股全市场)/i.test(input)) {
    return 'us-listed';
  }

  if (mentionsNyse) {
    return 'nyse';
  }

  if (mentionsNasdaq) {
    return 'nasdaq';
  }

  return 'default';
}

export async function fetchUniverseTickersFromYahooFinance(key: LiquidityUniverseKey): Promise<LiquidityUniverse> {
  if (key === 'nasdaq' || key === 'nyse' || key === 'us-listed') {
    return fetchNasdaqTraderUniverseTickers(key);
  }

  try {
    return await fetchWikipediaConstituentTickers(key);
  } catch (error) {
    console.error(`Failed to fetch ${key} constituents from Wikipedia:`, error);
  }

  const config = YAHOO_HOLDINGS_UNIVERSES[key];

  try {
    const summary = await yahooFinance.quoteSummary(config.sourceSymbol, {
      modules: ['topHoldings'],
    });

    const holdings = summary.topHoldings?.holdings ?? [];
    const tickers = uniqueTickers(
      holdings.map((holding: YahooTopHolding) => holding.symbol ?? ''),
    );

    if (tickers.length === 0) {
      throw new Error(`Yahoo Finance returned no holdings for ${config.sourceSymbol}`);
    }

    return {
      key,
      label: config.label,
      source: 'yahoo-finance2-top-holdings',
      sourceSymbol: config.sourceSymbol,
      tickers,
    };
  } catch (error) {
    if (key !== 'default') {
      throw error;
    }

    return {
      key,
      label: 'Default US stock universe',
      source: 'fallback-default',
      tickers: FALLBACK_DEFAULT_TICKERS,
    };
  }
}

export async function resolveLiquidityUniverseFromInput(input: string): Promise<LiquidityUniverse> {
  const universeKey = resolveLiquidityUniverseKey(input);
  if (universeKey !== 'default') {
    return fetchUniverseTickersFromYahooFinance(universeKey);
  }

  const explicitTickers = extractTickersFromInput(input);

  if (explicitTickers.length > 0 && input.includes(',')) {
    return {
      key: 'default',
      label: 'User-provided tickers',
      source: 'explicit-tickers',
      tickers: explicitTickers,
    };
  }

  return fetchUniverseTickersFromYahooFinance(universeKey);
}

async function fetchStockMetrics(ticker: string): Promise<LiquidityResult> {
  let quotes: ChartQuote[] | undefined;

  for (let attempt = 0; attempt <= STOCK_METRICS_MAX_RETRIES; attempt += 1) {
    try {
      await waitForStockMetricsRateLimit();

      const chart = await yahooFinance.chart(ticker, {
        period1: '2023-01-01',
        period2: new Date(),
        interval: '1d',
        return: 'array',
      }, {
        validateResult: false,
      }) as unknown as ChartResultArray;
      quotes = chart.quotes;
      break;
    } catch (error) {
      if (!isRateLimitError(error) || attempt === STOCK_METRICS_MAX_RETRIES) {
        throw error;
      }

      const backoffMs = STOCK_METRICS_RETRY_BASE_DELAY_MS * (2 ** attempt);
      await delay(backoffMs);
    }
  }

  if (!quotes || quotes.length < MIN_HISTORY_BARS) {
    return {
      ticker,
      status: 'failed',
      reasons: ['not_enough_data'],
      metrics: {
        close: 0,
        avgVolume20: 0,
      },
    };
  }

  const latest = quotes[quotes.length - 1];
  const last20 = quotes.slice(-20);
  const close = latest.close ?? 0;
  const avgVolume20 = Math.round(
    last20.reduce((sum, day) => sum + (day.volume || 0), 0) / MIN_HISTORY_BARS,
  );

  const reasons: string[] = [];
  if (close < MIN_PRICE) {
    reasons.push('price_below_10');
  }
  if (avgVolume20 < MIN_AVG_VOLUME_20) {
    reasons.push('avg_volume20_below_2m');
  }

  return {
    ticker,
    status: reasons.length === 0 ? 'passed' : 'failed',
    reasons,
    metrics: {
      close,
      avgVolume20,
    },
  };
}

export async function getStockMetrics(ticker: string): Promise<LiquidityResult> {
  const normalizedTicker = normalizeTicker(ticker);
  const cached = stockMetricsCache.get(normalizedTicker);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < STOCK_METRICS_CACHE_TTL_MS) {
    return cached.result;
  }

  const pending = pendingStockMetrics.get(normalizedTicker);
  if (pending) {
    return pending;
  }

  const fetchPromise = fetchStockMetrics(normalizedTicker)
    .then((result) => {
      stockMetricsCache.set(normalizedTicker, {
        result,
        fetchedAt: Date.now(),
      });
      return result;
    })
    .finally(() => {
      pendingStockMetrics.delete(normalizedTicker);
    });

  pendingStockMetrics.set(normalizedTicker, fetchPromise);
  return fetchPromise;
}

export function getStockMetricsCacheStats() {
  return {
    entries: stockMetricsCache.size,
    pending: pendingStockMetrics.size,
    ttlMs: STOCK_METRICS_CACHE_TTL_MS,
  };
}

/**
 * Extracts liquidity metrics for every ticker in the stock pool.
 * Results include both passed and failed tickers so the caller can inspect the full pool.
 */
export async function getStocksLiquidityMetrics(tickers: string[]): Promise<LiquidityResults> {
  const uniqueRequestedTickers = uniqueTickers(tickers);
  const selectedTickers = uniqueRequestedTickers.slice(0, STOCK_METRICS_MAX_TICKERS);
  const batches = chunkArray(selectedTickers, STOCK_METRICS_BATCH_SIZE);
  const results: LiquidityResult[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  let errors = 0;

  for (const batch of batches) {
    const batchResults = await runWithConcurrency(batch, STOCK_METRICS_CONCURRENCY, async (ticker) => {
      const cached = stockMetricsCache.get(ticker);

      if (cached && Date.now() - cached.fetchedAt < STOCK_METRICS_CACHE_TTL_MS) {
        cacheHits += 1;
      } else {
        cacheMisses += 1;
      }

      try {
        return await getStockMetrics(ticker);
      } catch (error) {
        errors += 1;
        console.error(`Error processing ${ticker}:`, error);
        const result = createDataFetchErrorResult(ticker);
        stockMetricsCache.set(ticker, {
          result,
          fetchedAt: Date.now(),
        });
        return result;
      }
    });

    results.push(...batchResults);
  }

  const stats: StockMetricsFetchStats = {
    requestedCount: uniqueRequestedTickers.length,
    processedCount: selectedTickers.length,
    skippedCount: Math.max(0, uniqueRequestedTickers.length - selectedTickers.length),
    cacheHits,
    cacheMisses,
    errors,
    batches: batches.length,
    batchSize: STOCK_METRICS_BATCH_SIZE,
    concurrency: STOCK_METRICS_CONCURRENCY,
    cacheTtlMs: STOCK_METRICS_CACHE_TTL_MS,
    requestsPerSecond: STOCK_METRICS_REQUESTS_PER_SECOND,
    maxRetries: STOCK_METRICS_MAX_RETRIES,
  };

  Object.defineProperty(results, 'fetchStats', {
    value: stats,
    enumerable: false,
  });

  return results as LiquidityResults;
}

/**
 * Backwards-compatible helper for callers that only need stocks passing liquidity criteria.
 */
export async function filterStocksLiquidity(tickers: string[]): Promise<LiquidityResult[]> {
  const results = await getStocksLiquidityMetrics(tickers);
  return results.filter((result) => result.status === 'passed');
}

// If run as a script, accept tickers as command line arguments
if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv.slice(2).join(' ');
  if (!input.trim()) {
    console.error('Usage: node --loader ts-node/esm liquidity.ts TICKER1 TICKER2 ...');
    console.error('   or: node --loader ts-node/esm liquidity.ts "scan S&P 500"');
    console.error('   or: node --loader ts-node/esm liquidity.ts "scan Nasdaq 100"');
    process.exit(1);
  }

  resolveLiquidityUniverseFromInput(input).then(async (universe) => {
    console.log('Universe:', universe.label);
    console.log('Source:', universe.source);
    if (universe.sourceSymbol) {
      console.log('Source symbol:', universe.sourceSymbol);
    }
    if (universe.sourceUrl) {
      console.log('Source URL:', universe.sourceUrl);
    }
    console.log('Universe ticker count:', universe.tickers.length);
    console.log('Tickers:', universe.tickers.join(', '));

    const results = await filterStocksLiquidity(universe.tickers);
    console.log(JSON.stringify({ universe, results }, null, 2));
  }).catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
