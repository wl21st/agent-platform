import YahooFinance from 'yahoo-finance2';
import { abortableDelay, throwIfAborted } from '@/lib/cancellation';

const yahooFinance = new YahooFinance();

/**
 * Liquidity result returned for every ticker in the requested universe.
 *
 * `avgVolume3Month` is Yahoo's `averageDailyVolume3Month` — a rolling 3-month
 * average daily volume reported on the quote endpoint. It replaced the
 * previous 20-day SMA volume so the whole liquidity filter can run in a few
 * batched HTTP requests instead of one chart fetch per ticker.
 *
 * `fiftyDayAverage` / `twoHundredDayAverage` are Yahoo's reported moving
 * averages. They are pulled "for free" alongside the liquidity check so the
 * pullback fast-path (`screenPullbackQuoteCandidates`) can prefilter the
 * universe to a small subset of pullback candidates without a per-ticker
 * chart fetch. Values may be undefined for very young listings.
 */
export interface LiquidityResult {
  ticker: string;
  status: 'passed' | 'failed';
  reasons: string[];
  metrics: {
    close: number;
    avgVolume3Month: number;
    fiftyDayAverage?: number;
    twoHundredDayAverage?: number;
  };
}

export type LiquidityResults = LiquidityResult[] & {
  fetchStats?: StockMetricsFetchStats;
};

const MIN_PRICE = 10;
const MIN_AVG_VOLUME = 2_000_000;
// Yahoo accepts ~250 symbols per quote() call in practice; 200 leaves headroom
// for URL length and avoids partial-batch truncation.
const STOCK_METRICS_BATCH_SIZE = 200;
// Default cap for narrow indexes (SP500, Nasdaq 100, user-supplied lists).
// Broad universes (full NASDAQ / NYSE / us-listed) override this via
// `getDefaultMaxTickersForUniverse` so a "scan Nasdaq" request actually
// covers the whole exchange instead of being silently truncated.
const STOCK_METRICS_DEFAULT_MAX_TICKERS = 500;
const STOCK_METRICS_BROAD_UNIVERSE_MAX_TICKERS = 5_000;
const STOCK_METRICS_CACHE_TTL_MS = 60 * 60 * 1000;
// Run liquidity batches in parallel; each batch is a single HTTP request,
// so 3 concurrent batches cover ~600 tickers in roughly one Yahoo RTT.
const STOCK_METRICS_BATCH_CONCURRENCY = 3;
const STOCK_METRICS_BATCH_MAX_RETRIES = 2;
const STOCK_METRICS_BATCH_RETRY_BASE_DELAY_MS = 1_500;

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
  durationMs: number;
};

export type StockMetricsScanOptions = {
  maxTickers?: number;
  logProgress?: boolean;
  logLabel?: string;
  signal?: AbortSignal;
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
      avgVolume3Month: 0,
    },
  };
}

function createMissingDataResult(ticker: string): LiquidityResult {
  return {
    ticker,
    status: 'failed',
    reasons: ['missing_quote_data'],
    metrics: {
      close: 0,
      avgVolume3Month: 0,
    },
  };
}

function evaluateLiquidityFromQuote(
  ticker: string,
  close: number,
  avgVolume3Month: number,
  fiftyDayAverage: number | undefined,
  twoHundredDayAverage: number | undefined,
): LiquidityResult {
  const reasons: string[] = [];
  if (close <= 0 || avgVolume3Month <= 0) {
    return createMissingDataResult(ticker);
  }
  if (close < MIN_PRICE) {
    reasons.push('price_below_10');
  }
  if (avgVolume3Month < MIN_AVG_VOLUME) {
    reasons.push('avg_volume_below_2m');
  }

  return {
    ticker,
    status: reasons.length === 0 ? 'passed' : 'failed',
    reasons,
    metrics: {
      close,
      avgVolume3Month,
      fiftyDayAverage: fiftyDayAverage && fiftyDayAverage > 0 ? fiftyDayAverage : undefined,
      twoHundredDayAverage: twoHundredDayAverage && twoHundredDayAverage > 0 ? twoHundredDayAverage : undefined,
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

async function fetchText(url: string, signal?: AbortSignal) {
  throwIfAborted(signal);
  const response = await fetch(url, {
    headers: {
      'user-agent': 'agentsplatform-liquidity-agent/1.0',
    },
    signal,
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

async function fetchWikipediaConstituentTickers(key: WikipediaUniverseKey, signal?: AbortSignal): Promise<LiquidityUniverse> {
  const config = WIKIPEDIA_CONSTITUENT_UNIVERSES[key];
  const html = await fetchText(config.sourceUrl, signal);
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

async function fetchNasdaqListedTickers(signal?: AbortSignal) {
  const text = await fetchText(NASDAQ_LISTED_URL, signal);
  const rows = parsePipeDelimitedRows(text);

  return uniqueTickers(
    rows.flatMap((row) => {
      if (row['Test Issue'] !== 'N' || row.ETF !== 'N') return [];
      return [row.Symbol ?? ''];
    }),
  );
}

async function fetchOtherListedTickers(exchange: string, signal?: AbortSignal) {
  const text = await fetchText(OTHER_LISTED_URL, signal);
  const rows = parsePipeDelimitedRows(text);

  return uniqueTickers(
    rows.flatMap((row) => {
      if (row.Exchange !== exchange || row['Test Issue'] !== 'N' || row.ETF !== 'N') return [];
      return [row['ACT Symbol'] ?? ''];
    }),
  );
}

async function fetchNasdaqTraderUniverseTickers(key: NasdaqTraderUniverseKey, signal?: AbortSignal): Promise<LiquidityUniverse> {
  if (key === 'nasdaq') {
    return {
      key,
      label: 'NASDAQ listed common stocks',
      source: 'nasdaq-trader-symbol-directory',
      sourceUrl: NASDAQ_LISTED_URL,
      tickers: await fetchNasdaqListedTickers(signal),
    };
  }

  if (key === 'nyse') {
    return {
      key,
      label: 'NYSE listed common stocks',
      source: 'nasdaq-trader-symbol-directory',
      sourceUrl: OTHER_LISTED_URL,
      tickers: await fetchOtherListedTickers('N', signal),
    };
  }

  const [nasdaqTickers, nyseTickers] = await Promise.all([
    fetchNasdaqListedTickers(signal),
    fetchOtherListedTickers('N', signal),
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

/**
 * Returns the default ticker cap to use when scanning a given universe.
 *
 * Narrow indexes like SP500 / Nasdaq 100 / user-supplied ticker lists keep
 * the conservative 500 cap. Broad exchange universes (full NASDAQ ~3.5k,
 * NYSE ~2.8k, combined us-listed ~6k) get a much higher cap so scans like
 * "scan Nasdaq" actually cover the whole exchange instead of silently
 * truncating to the first 500 alphabetically.
 *
 * The return value is intended to be passed as `maxTickers` to
 * `getStocksLiquidityMetrics`.
 */
export function getDefaultMaxTickersForUniverse(key: LiquidityUniverseKey): number {
  if (key === 'nasdaq' || key === 'nyse' || key === 'us-listed') {
    return STOCK_METRICS_BROAD_UNIVERSE_MAX_TICKERS;
  }

  return STOCK_METRICS_DEFAULT_MAX_TICKERS;
}

export async function fetchUniverseTickersFromYahooFinance(key: LiquidityUniverseKey, signal?: AbortSignal): Promise<LiquidityUniverse> {
  throwIfAborted(signal);
  if (key === 'nasdaq' || key === 'nyse' || key === 'us-listed') {
    return fetchNasdaqTraderUniverseTickers(key, signal);
  }

  try {
    return await fetchWikipediaConstituentTickers(key, signal);
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    console.error(`Failed to fetch ${key} constituents from Wikipedia:`, error);
  }

  const config = YAHOO_HOLDINGS_UNIVERSES[key];

  try {
    throwIfAborted(signal);
    const summary = await yahooFinance.quoteSummary(config.sourceSymbol, {
      modules: ['topHoldings'],
    });
    throwIfAborted(signal);

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
    if (signal?.aborted) {
      throw error;
    }
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

export async function resolveLiquidityUniverseFromInput(input: string, signal?: AbortSignal): Promise<LiquidityUniverse> {
  throwIfAborted(signal);
  const universeKey = resolveLiquidityUniverseKey(input);
  if (universeKey !== 'default') {
    return fetchUniverseTickersFromYahooFinance(universeKey, signal);
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

  return fetchUniverseTickersFromYahooFinance(universeKey, signal);
}

type YahooQuoteLike = {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  averageDailyVolume3Month?: number;
  averageDailyVolume10Day?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
};

/**
 * Fetch one batch of liquidity metrics in a single Yahoo `quote(...)` call.
 * Returns a result for every ticker in the batch (passed/failed/error), keyed
 * by the normalized ticker. Retries the batch on transient 429s.
 */
async function fetchLiquidityBatch(tickers: string[], signal?: AbortSignal): Promise<Map<string, LiquidityResult>> {
  throwIfAborted(signal);
  const results = new Map<string, LiquidityResult>();

  let quotes: YahooQuoteLike[] = [];
  let lastError: unknown;
  for (let attempt = 0; attempt <= STOCK_METRICS_BATCH_MAX_RETRIES; attempt += 1) {
    try {
      const response = await yahooFinance.quote(tickers, {
        fields: [
          'symbol',
          'regularMarketPrice',
          'regularMarketPreviousClose',
          'averageDailyVolume3Month',
          'averageDailyVolume10Day',
          // Pulled here so the pullback Stage-1 prefilter can run without an
          // additional HTTP call per ticker.
          'fiftyDayAverage',
          'twoHundredDayAverage',
        ],
      }, {
        validateResult: false,
      });
      throwIfAborted(signal);
      quotes = (response as unknown as YahooQuoteLike[]) ?? [];
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === STOCK_METRICS_BATCH_MAX_RETRIES) {
        break;
      }

      const backoffMs = STOCK_METRICS_BATCH_RETRY_BASE_DELAY_MS * (2 ** attempt);
      console.warn(`[liquidity] Batch rate-limited (size=${tickers.length}); retrying in ${Math.round(backoffMs / 1000)}s`);
      await abortableDelay(backoffMs, signal);
    }
  }

  if (lastError) {
    console.error(`[liquidity] Batch fetch failed for ${tickers.length} tickers:`, lastError);
    for (const ticker of tickers) {
      results.set(ticker, createDataFetchErrorResult(ticker));
    }
    return results;
  }

  // Index quotes by ticker so we can map even if Yahoo reorders or drops symbols.
  const bySymbol = new Map<string, YahooQuoteLike>();
  for (const quote of quotes) {
    if (quote.symbol) {
      bySymbol.set(normalizeTicker(quote.symbol), quote);
    }
  }

  for (const ticker of tickers) {
    const quote = bySymbol.get(ticker);
    if (!quote) {
      results.set(ticker, createMissingDataResult(ticker));
      continue;
    }

    const close = quote.regularMarketPrice ?? quote.regularMarketPreviousClose ?? 0;
    // Prefer 3-month ADV; fall back to 10-day ADV for newer listings.
    const avgVolume3Month = quote.averageDailyVolume3Month ?? quote.averageDailyVolume10Day ?? 0;
    results.set(
      ticker,
      evaluateLiquidityFromQuote(
        ticker,
        close,
        Math.round(avgVolume3Month),
        quote.fiftyDayAverage,
        quote.twoHundredDayAverage,
      ),
    );
  }

  return results;
}

/**
 * Fetch liquidity metrics for a single ticker by going through the batch path.
 * Kept for callers that only need one ticker; cache-aware so repeat calls in
 * a workflow don't re-hit Yahoo.
 */
export async function getStockMetrics(ticker: string, signal?: AbortSignal): Promise<LiquidityResult> {
  throwIfAborted(signal);
  const normalizedTicker = normalizeTicker(ticker);
  const cached = stockMetricsCache.get(normalizedTicker);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < STOCK_METRICS_CACHE_TTL_MS) {
    return cached.result;
  }

  const batch = await fetchLiquidityBatch([normalizedTicker], signal);
  const result = batch.get(normalizedTicker) ?? createMissingDataResult(normalizedTicker);
  stockMetricsCache.set(normalizedTicker, {
    result,
    fetchedAt: Date.now(),
  });
  return result;
}

export function getStockMetricsCacheStats() {
  return {
    entries: stockMetricsCache.size,
    ttlMs: STOCK_METRICS_CACHE_TTL_MS,
  };
}

function logStockMetricsProgress(enabled: boolean, message: string) {
  if (enabled) {
    console.info(`[liquidity] ${message}`);
  }
}

/**
 * Extracts liquidity metrics for every ticker in the stock pool.
 * Results include both passed and failed tickers so the caller can inspect the full pool.
 *
 * Implementation notes:
 *   - Uses Yahoo's batched `quote()` endpoint, which accepts ~200 tickers per
 *     HTTP request, so SP500 (~500 tickers) becomes ~3 HTTP requests.
 *   - Multiple batches run in parallel up to `STOCK_METRICS_BATCH_CONCURRENCY`.
 *   - Per-ticker results are cached for `STOCK_METRICS_CACHE_TTL_MS` so repeat
 *     workflows in the same session re-use prior metrics instead of re-hitting
 *     Yahoo.
 */
export async function getStocksLiquidityMetrics(tickers: string[], options: StockMetricsScanOptions = {}): Promise<LiquidityResults> {
  throwIfAborted(options.signal);
  const startedAt = Date.now();
  const uniqueRequestedTickers = uniqueTickers(tickers);
  const maxTickers = options.maxTickers ?? STOCK_METRICS_DEFAULT_MAX_TICKERS;
  const selectedTickers = uniqueRequestedTickers.slice(0, maxTickers);
  const logPrefix = options.logLabel ? `${options.logLabel}: ` : '';

  // Step 1: serve cache hits straight from memory; collect uncached tickers.
  const resultsByTicker = new Map<string, LiquidityResult>();
  const tickersToFetch: string[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  const now = Date.now();

  for (const ticker of selectedTickers) {
    throwIfAborted(options.signal);
    const cached = stockMetricsCache.get(ticker);
    if (cached && now - cached.fetchedAt < STOCK_METRICS_CACHE_TTL_MS) {
      resultsByTicker.set(ticker, cached.result);
      cacheHits += 1;
    } else {
      tickersToFetch.push(ticker);
      cacheMisses += 1;
    }
  }

  const batches = chunkArray(tickersToFetch, STOCK_METRICS_BATCH_SIZE);

  logStockMetricsProgress(
    Boolean(options.logProgress),
    `${logPrefix}starting liquidity metrics for ${selectedTickers.length}/${uniqueRequestedTickers.length} tickers (cache hits ${cacheHits}, ${batches.length} batches × up to ${STOCK_METRICS_BATCH_SIZE} via Yahoo quote(); batch concurrency ${STOCK_METRICS_BATCH_CONCURRENCY})`,
  );

  // Step 2: fetch the misses in parallel batches, each one a single HTTP request.
  let errors = 0;
  await runWithConcurrency(batches, STOCK_METRICS_BATCH_CONCURRENCY, async (batch, batchIndex) => {
    throwIfAborted(options.signal);
    logStockMetricsProgress(
      Boolean(options.logProgress),
      `${logPrefix}batch ${batchIndex + 1}/${batches.length} started (${batch.length} tickers)`,
    );

    const batchStart = Date.now();
    const batchResults = await fetchLiquidityBatch(batch, options.signal);
    throwIfAborted(options.signal);

    for (const ticker of batch) {
      throwIfAborted(options.signal);
      const result = batchResults.get(ticker) ?? createMissingDataResult(ticker);
      if (result.reasons.includes('data_fetch_error')) {
        errors += 1;
      }
      stockMetricsCache.set(ticker, {
        result,
        fetchedAt: Date.now(),
      });
      resultsByTicker.set(ticker, result);
    }

    logStockMetricsProgress(
      Boolean(options.logProgress),
      `${logPrefix}batch ${batchIndex + 1}/${batches.length} completed in ${Date.now() - batchStart}ms`,
    );
  });

  // Step 3: assemble in original input order so callers can rely on alignment.
  const results: LiquidityResult[] = selectedTickers.map(
    (ticker) => resultsByTicker.get(ticker) ?? createDataFetchErrorResult(ticker),
  );

  const stats: StockMetricsFetchStats = {
    requestedCount: uniqueRequestedTickers.length,
    processedCount: selectedTickers.length,
    skippedCount: Math.max(0, uniqueRequestedTickers.length - selectedTickers.length),
    cacheHits,
    cacheMisses,
    errors,
    batches: batches.length,
    batchSize: STOCK_METRICS_BATCH_SIZE,
    concurrency: STOCK_METRICS_BATCH_CONCURRENCY,
    cacheTtlMs: STOCK_METRICS_CACHE_TTL_MS,
    durationMs: Date.now() - startedAt,
  };

  logStockMetricsProgress(
    Boolean(options.logProgress),
    `${logPrefix}completed liquidity metrics in ${stats.durationMs}ms; passed ${results.filter((result) => result.status === 'passed').length}/${results.length}, errors ${errors}, skipped ${stats.skippedCount}`,
  );

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
