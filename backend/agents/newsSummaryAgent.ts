import { runWebpageSummarizeAgent } from '@backend/agents/webpageSummarizeAgent';
import { NEWS_SUMMARY_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';
import { isAbortError, throwIfAborted } from '@/lib/cancellation';

/* ──────────────────────────────────────────────────────────────────────────────
 * Types for news analysis
 * ─────────────────────────────────────────────────────────────────────────── */

interface NewsItem {
  url: string;
  title: string;
  summary: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Summarize individual news article with sentiment
 * ─────────────────────────────────────────────────────────────────────────── */

async function summarizeNewsArticle(url: string, title: string, signal?: AbortSignal): Promise<{summary: string, sentiment: 'bullish' | 'bearish' | 'neutral'}> {
  try {
    throwIfAborted(signal);
    const result = await runWebpageSummarizeAgent({
      input: `Please summarize this news article in 2-3 sentences and analyze the sentiment impact on the stock/company mentioned: ${url}`,
      preferences: { recentSearchTopics: [] },
      signal,
    });

    // Extract summary and sentiment from the webpage summary
    const content = result.markdown;
    const summaryMatch = content.match(/## 📋 Details\s*\n([\s\S]*?)(?:\n##|$)/);
    const summary = summaryMatch?.[1]?.trim() || content.replace(/^#.*?\n\n/, '').split('\n\n')[0] || 'Summary not available';

    // Simple sentiment detection based on keywords
    const lowerContent = content.toLowerCase();
    let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';

    if (lowerContent.includes('bullish') || lowerContent.includes('positive') ||
        lowerContent.includes('upgrade') || lowerContent.includes('surprise') ||
        lowerContent.includes('beat expectations') || lowerContent.includes('strong growth') ||
        lowerContent.includes('record high') || lowerContent.includes('gains')) {
      sentiment = 'bullish';
    } else if (lowerContent.includes('bearish') || lowerContent.includes('negative') ||
               lowerContent.includes('downgrade') || lowerContent.includes('disappointment') ||
               lowerContent.includes('miss expectations') || lowerContent.includes('decline') ||
               lowerContent.includes('losses') || lowerContent.includes('concerns')) {
      sentiment = 'bearish';
    }

    return { summary, sentiment };
  } catch (error) {
    if (isAbortError(error, signal)) {
      throw error;
    }
    console.error(`Failed to summarize ${url}:`, error);
    return {
      summary: `Failed to summarize article: ${title}`,
      sentiment: 'neutral'
    };
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Analyze overall news sentiment and generate structured report
 * ─────────────────────────────────────────────────────────────────────────── */

function analyzeOverallSentiment(newsItems: NewsItem[]): {
  overallSentiment: 'bullish' | 'bearish' | 'neutral';
  summary: string;
  bullishPoints: string[];
  bearishPoints: string[];
  mostImportantNews: { title: string; reason: string };
} {
  const sentiments = newsItems.map(item => item.sentiment);
  const bullishCount = sentiments.filter(s => s === 'bullish').length;
  const bearishCount = sentiments.filter(s => s === 'bearish').length;
  const neutralCount = sentiments.filter(s => s === 'neutral').length;

  // Determine overall sentiment
  let overallSentiment: 'bullish' | 'bearish' | 'neutral';
  if (bullishCount > bearishCount + neutralCount) {
    overallSentiment = 'bullish';
  } else if (bearishCount > bullishCount + neutralCount) {
    overallSentiment = 'bearish';
  } else {
    overallSentiment = 'neutral';
  }

  // Generate 2-4 sentence summary of main themes
  const summaries = newsItems.map(item => item.summary);
  const summary = `Today's news coverage focuses on ${newsItems.length} key developments. ` +
    `${bullishCount} articles show positive sentiment, ${bearishCount} negative, and ${neutralCount} neutral. ` +
    `Key themes include earnings performance, market reactions, and industry developments. ` +
    `The overall market sentiment appears ${overallSentiment} based on the news coverage.`;

  // Extract 3 bullish and 3 bearish points
  const bullishPoints: string[] = [];
  const bearishPoints: string[] = [];

  newsItems.forEach(item => {
    if (item.sentiment === 'bullish' && bullishPoints.length < 3) {
      bullishPoints.push(item.summary);
    } else if (item.sentiment === 'bearish' && bearishPoints.length < 3) {
      bearishPoints.push(item.summary);
    }
  });

  // Ensure we have at least some points
  while (bullishPoints.length < 3) {
    bullishPoints.push('No additional bullish points identified from recent news.');
  }
  while (bearishPoints.length < 3) {
    bearishPoints.push('No additional bearish points identified from recent news.');
  }

  // Find most important news (prioritize bullish > bearish > neutral)
  const sortedNews = [...newsItems].sort((a, b) => {
    const sentimentOrder = { bullish: 3, bearish: 2, neutral: 1 };
    return sentimentOrder[b.sentiment] - sentimentOrder[a.sentiment];
  });

  const mostImportant = sortedNews[0] || newsItems[0];
  const reason = mostImportant.sentiment === 'bullish'
    ? 'This article contains the most positive market-moving information with significant bullish implications.'
    : mostImportant.sentiment === 'bearish'
    ? 'This article contains the most negative market-moving information with significant bearish implications.'
    : 'This article represents the most significant neutral development in today\'s news coverage.';

  return {
    overallSentiment,
    summary,
    bullishPoints: bullishPoints.slice(0, 3),
    bearishPoints: bearishPoints.slice(0, 3),
    mostImportantNews: {
      title: mostImportant.title,
      reason
    }
  };
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Build the comprehensive news summary report
 * ─────────────────────────────────────────────────────────────────────────── */

function buildNewsSummaryReport(ticker: string, newsItems: NewsItem[], analysis: ReturnType<typeof analyzeOverallSentiment>): string {
  const lines: string[] = [];

  lines.push(`# 📝 News Summary Analysis for ${ticker}`);
  lines.push('');

  // 1. Overall sentiment
  const sentimentEmoji = analysis.overallSentiment === 'bullish' ? '📈' : analysis.overallSentiment === 'bearish' ? '📉' : '➡️';
  lines.push(`## 1. Overall News Sentiment: ${sentimentEmoji} ${analysis.overallSentiment.toUpperCase()}`);
  lines.push('');

  // 2. Main news themes summary
  lines.push('## 2. Main News Themes Summary');
  lines.push(analysis.summary);
  lines.push('');

  // Individual news summaries with sentiment
  lines.push('## Individual News Summaries');
  lines.push('');
  newsItems.forEach((item, index) => {
    const emoji = item.sentiment === 'bullish' ? '🟢' : item.sentiment === 'bearish' ? '🔴' : '🟡';
    lines.push(`**${index + 1}. ${item.title}** ${emoji}`);
    lines.push(`   ${item.summary}`);
    lines.push('');
  });

  // 3. Bullish points
  lines.push('## 3. Key Bullish Developments');
  analysis.bullishPoints.forEach(point => {
    lines.push(`- ${point}`);
  });
  lines.push('');

  // 4. Bearish points
  lines.push('## 4. Key Bearish Concerns');
  analysis.bearishPoints.forEach(point => {
    lines.push(`- ${point}`);
  });
  lines.push('');

  // 5. Most important news
  lines.push('## 5. Most Important News Article');
  lines.push(`**${analysis.mostImportantNews.title}**`);
  lines.push(`*Reason: ${analysis.mostImportantNews.reason}*`);
  lines.push('');

  lines.push('> ⚠️ **Disclaimer:** This news analysis is for informational purposes only and does not constitute investment advice. News sentiment can change rapidly, and individual articles may not reflect the full market context.');
  lines.push('');
  lines.push('*Analysis based on top 5 recent news articles from reliable financial sources.*');

  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Public: run the News Summary Agent
 * ─────────────────────────────────────────────────────────────────────────── */

export async function runNewsSummaryAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { input } = context;

  // Extract news URLs from input (assuming they come from news-scrape agent metadata)
  let newsUrls: Array<{url: string, title: string}> = [];

  if (context.extractedNewsUrls) {
    newsUrls = context.extractedNewsUrls;
  } else {
    // Try to extract URLs from the input text
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const matches = input.match(urlPattern);
    if (matches) {
      newsUrls = matches.map(url => ({ url, title: 'News Article' }));
    }
  }

  if (newsUrls.length === 0) {
    return {
      agent: NEWS_SUMMARY_AGENT,
      summary: 'No news URLs found to summarize.',
      markdown: [
        '# 📝 News Summary Agent',
        '',
        '**Error:** No news URLs found in the input.',
        '',
        'Please provide news URLs to summarize, or run the News Scrape Agent first to get news articles.',
      ].join('\n'),
      metadata: { error: 'no_urls' },
    };
  }

  // Extract ticker symbol
  const ticker = extractTickerSymbol(input);

  try {
    // Summarize each news article with sentiment
    const newsItems: NewsItem[] = [];
    for (const { url, title } of newsUrls.slice(0, 5)) { // Limit to 5 articles
      throwIfAborted(context.signal);
      const { summary, sentiment } = await summarizeNewsArticle(url, title, context.signal);
      newsItems.push({ url, title, summary, sentiment });
    }

    // Analyze overall sentiment and generate structured report
    const analysis = analyzeOverallSentiment(newsItems);
    const markdown = buildNewsSummaryReport(ticker || 'Stock', newsItems, analysis);

    return {
      agent: NEWS_SUMMARY_AGENT,
      summary: `News summary analysis completed for ${ticker || 'stock'} with ${newsItems.length} articles. Overall sentiment: ${analysis.overallSentiment}.`,
      markdown,
      metadata: {
        ticker,
        overallSentiment: analysis.overallSentiment,
        newsCount: newsItems.length,
        bullishCount: newsItems.filter(n => n.sentiment === 'bullish').length,
        bearishCount: newsItems.filter(n => n.sentiment === 'bearish').length,
        neutralCount: newsItems.filter(n => n.sentiment === 'neutral').length,
      },
    };
  } catch (error) {
    if (isAbortError(error, context.signal)) {
      throw error;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[newsSummaryAgent] Failed to summarize news:', errMsg);

    return {
      agent: NEWS_SUMMARY_AGENT,
      summary: 'Failed to summarize news articles.',
      markdown: [
        '# 📝 News Summary Agent',
        '',
        '**Error:** Failed to summarize news articles.',
        '',
        `Reason: ${errMsg}`,
        '',
        'Please try again or provide different news URLs.',
      ].join('\n'),
      metadata: { error: errMsg },
    };
  }
}

// Helper function (duplicate from other agents for now)
function extractTickerSymbol(input: string, extractedTicker?: string): string {
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
