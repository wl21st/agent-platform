import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export interface LiquidityResult {
  ticker: string;
  status: 'passed' | 'failed';
  reasons: string[];
  metrics: {
    close: number;
    avgVolume20: number;
  };
}

const MIN_PRICE = 10;
const MIN_AVG_VOLUME_20 = 2_000_000;
const MIN_HISTORY_BARS = 20;

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

type YahooTopHolding = {
  symbol?: string;
};

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase().replace('.', '-');
}

function uniqueTickers(tickers: string[]) {
  return [...new Set(tickers.map(normalizeTicker).filter((ticker) => /^[A-Z][A-Z0-9-]{0,9}$/.test(ticker)))];
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

export async function getStockMetrics(ticker: string): Promise<LiquidityResult> {
  const result = await yahooFinance.historical(ticker, {
    period1: '2023-01-01',
    period2: new Date(),
    interval: '1d',
  });

  if (!result || result.length < MIN_HISTORY_BARS) {
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

  const latest = result[result.length - 1];
  const last20 = result.slice(-20);
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

/**
 * Extracts liquidity metrics for every ticker in the stock pool.
 * Results include both passed and failed tickers so the caller can inspect the full pool.
 */
export async function getStocksLiquidityMetrics(tickers: string[]): Promise<LiquidityResult[]> {
  const results: LiquidityResult[] = [];

  for (const ticker of tickers) {
    try {
      results.push(await getStockMetrics(ticker));
    } catch (error) {
      console.error(`Error processing ${ticker}:`, error);
      results.push({
        ticker,
        status: 'failed',
        reasons: ['data_fetch_error'],
        metrics: {
          close: 0,
          avgVolume20: 0,
        },
      });
    }
  }

  return results;
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
