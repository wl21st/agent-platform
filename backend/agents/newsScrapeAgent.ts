import Exa from 'exa-js';

import { NEWS_SCRAPE_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';

const exa = new Exa(process.env.EXA_API_KEY || '');

/* ──────────────────────────────────────────────────────────────────────────────
 * Extract ticker symbol from user input (reuse from stockDataAgent)
 * ─────────────────────────────────────────────────────────────────────────── */

export function extractTickerSymbol(input: string, extractedTicker?: string): string {
  if (extractedTicker?.trim()) return extractedTicker.trim().toUpperCase();

  const dollarMatch = input.match(/\$([A-Za-z]{1,6})/);
  if (dollarMatch?.[1]) return dollarMatch[1].toUpperCase();

  const tickerMatch = input.match(/\bticker[:\s]+([A-Za-z]{1,6})\b/i);
  if (tickerMatch?.[1]) return tickerMatch[1].toUpperCase();

  const standaloneMatch = input.match(/\b([A-Z]{2,5})\b/);
  if (standaloneMatch?.[1]) return standaloneMatch[1];

  const cnMatch = input.match(/\b(\d{6})\b/);
  if (cnMatch?.[1]) {
    const code = cnMatch[1];
    if (code.startsWith('6')) return `${code}.SS`;
    if (code.startsWith('0') || code.startsWith('3')) return `${code}.SZ`;
    return code;
  }

  const hkMatch = input.match(/\b(0?\d{4,5})\.?HK\b/i);
  if (hkMatch?.[1]) return `${hkMatch[1].replace(/^0+/, '')}.HK`;

  return '';
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Search news using Exa API
 * ─────────────────────────────────────────────────────────────────────────── */

async function searchStockNews(ticker: string): Promise<Array<{title: string, url: string, publishedDate: string}>> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const query = `${ticker} stock news OR ${ticker} financial news OR ${ticker} earnings OR ${ticker} analyst OR ${ticker} shares`;

  const result = await exa.search(query, {
    type: 'instant',
    numResults: 5,
    includeDomains: [
      'bloomberg.com',
      'reuters.com',
      'cnbc.com',
      'wsj.com',
      'ft.com',
      'yahoo.com',
      'marketwatch.com',
      'investing.com',
      'seekingalpha.com',
      'fool.com',
      'nasdaq.com',
      'nytimes.com',
      'businessinsider.com'
    ],
    startPublishedDate: yesterday.toISOString().split('T')[0],
  });

  return result.results.map(item => ({
    title: item.title || 'No title',
    url: item.url || '',
    publishedDate: item.publishedDate ? new Date(item.publishedDate).toLocaleDateString() : 'Unknown date',
  }));
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Build markdown table with news links
 * ─────────────────────────────────────────────────────────────────────────── */

function buildNewsTable(newsItems: Array<{title: string, url: string, publishedDate: string}>, ticker: string): string {
  const lines: string[] = [];

  lines.push(`# 📰 Latest News for ${ticker}`);
  lines.push('');
  lines.push('| # | Title | Published | Link |');
  lines.push('|---|-------|-----------|------|');

  newsItems.forEach((item, index) => {
    const title = item.title.length > 80 ? item.title.substring(0, 77) + '...' : item.title;
    const link = `[View Article](${item.url})`;
    lines.push(`| ${index + 1} | ${title} | ${item.publishedDate} | ${link} |`);
  });

  lines.push('');
  lines.push(`*Top 5 recent news articles about ${ticker} from reliable financial sources.*`);

  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Public: run the News Scrape Agent
 * ─────────────────────────────────────────────────────────────────────────── */

export async function runNewsScrapeAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { input } = context;
  const ticker = extractTickerSymbol(input, context.extractedTicker);

  if (!ticker) {
    return {
      agent: NEWS_SCRAPE_AGENT,
      summary: 'Could not identify a stock ticker symbol from input.',
      markdown: [
        '# 📰 News Scrape Agent',
        '',
        '**Error:** Could not identify a stock ticker symbol from your message.',
        '',
        'Please provide a valid ticker symbol (e.g., **AAPL**, **MSFT**, **GOOGL**, **$TSLA**, or Chinese stock codes like **600519**).',
      ].join('\n'),
      metadata: { error: 'no_ticker' },
    };
  }

  if (!process.env.EXA_API_KEY) {
    return {
      agent: NEWS_SCRAPE_AGENT,
      summary: 'EXA_API_KEY not configured.',
      markdown: [
        '# 📰 News Scrape Agent',
        '',
        '**Error:** EXA_API_KEY environment variable is not set.',
        '',
        'Please configure your EXA API key in the environment variables.',
      ].join('\n'),
      metadata: { error: 'missing_api_key' },
    };
  }

  try {
    const newsItems = await searchStockNews(ticker);
    const markdown = buildNewsTable(newsItems, ticker);

    return {
      agent: NEWS_SCRAPE_AGENT,
      summary: `Found ${newsItems.length} recent news articles about ${ticker}.`,
      markdown,
      metadata: {
        ticker,
        newsCount: newsItems.length,
        newsItems: newsItems.map(item => ({
          title: item.title,
          url: item.url,
          publishedDate: item.publishedDate,
        })),
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[newsScrapeAgent] Failed to fetch news for ${ticker}:`, errMsg);

    return {
      agent: NEWS_SCRAPE_AGENT,
      summary: `Failed to fetch news for ${ticker}.`,
      markdown: [
        '# 📰 News Scrape Agent',
        '',
        `**Error:** Failed to fetch news for **${ticker}**.`,
        '',
        `Reason: ${errMsg}`,
        '',
        'Please try again later or check the ticker symbol.',
      ].join('\n'),
      metadata: { error: errMsg, ticker },
    };
  }
}