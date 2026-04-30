import { SCREEN_HIT_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';
import { screenTrend, screenPullback, screenMomentum, type ScreenHit } from './screening';

export async function runScreenHitAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { input } = context;

  // Parse input for setup type and tickers
  // Expected formats: "trend AAPL MSFT NVDA" or "Screen for pullback: AAPL, MSFT"
  const lowerInput = input.toLowerCase();
  let setupType: 'trend' | 'pullback' | 'momentum' | 'all' | null = null;
  let tickers: string[] = [];

  if (lowerInput.includes('all setups') || lowerInput.includes('all')) {
    setupType = 'all';
  } else if (lowerInput.includes('trend')) {
    setupType = 'trend';
  } else if (lowerInput.includes('pullback')) {
    setupType = 'pullback';
  } else if (lowerInput.includes('momentum')) {
    setupType = 'momentum';
  }

  if (!setupType) {
    // Try to extract from text
    const trendMatch = input.match(/trend[:\s]+(.+)/i);
    if (trendMatch) setupType = 'trend';
    const pullbackMatch = input.match(/pullback[:\s]+(.+)/i);
    if (pullbackMatch) setupType = 'pullback';
    const momentumMatch = input.match(/momentum[:\s]+(.+)/i);
    if (momentumMatch) setupType = 'momentum';
  }

  if (!setupType) {
    return {
      agent: SCREEN_HIT_AGENT,
      summary: 'Could not determine screening setup type from input.',
      markdown: [
        '# 🎯 Screen Hit Agent',
        '',
        '**Error:** Could not identify screening type (trend, pullback, momentum, or all) from your message.',
        '',
        'Please specify the setup type, e.g., "Screen for trend: AAPL, MSFT", "momentum NVDA TSLA", or "all setups: AAPL, MSFT".',
      ].join('\n'),
      metadata: { error: 'no_setup_type' },
    };
  }

  // Extract tickers
  let tickerString = input;
  if (tickerString.includes(':')) {
    tickerString = tickerString.split(':')[1];
  }
  tickers = tickerString.split(/[,;\s]+/).map(t => t.trim().toUpperCase()).filter(t => t && t.length <= 5 && /^[A-Z]+$/.test(t));

  if (tickers.length === 0) {
    return {
      agent: SCREEN_HIT_AGENT,
      summary: 'No valid stock tickers found in input.',
      markdown: [
        '# 🎯 Screen Hit Agent',
        '',
        '**Error:** No valid stock tickers found.',
        '',
        'Please provide comma-separated tickers like "AAPL, MSFT, NVDA".',
      ].join('\n'),
      metadata: { error: 'no_tickers' },
    };
  }

  try {
    let results: ScreenHit[] = [];
    switch (setupType) {
      case 'all': {
        const [trendHits, pullbackHits, momentumHits] = await Promise.all([
          screenTrend(tickers),
          screenPullback(tickers),
          screenMomentum(tickers),
        ]);
        results = [...trendHits, ...pullbackHits, ...momentumHits];
        break;
      }
      case 'trend':
        results = await screenTrend(tickers);
        break;
      case 'pullback':
        results = await screenPullback(tickers);
        break;
      case 'momentum':
        results = await screenMomentum(tickers);
        break;
    }

    const summary = `Screened ${tickers.length} stocks for ${setupType}: ${results.length} hits found.`;

    const markdown = [
      '# 🎯 Screen Hit Agent',
      '',
      `**Setup Type:** ${setupType}`,
      `**Stocks Screened:** ${tickers.length}`,
      `**Hits Found:** ${results.length}`,
      '',
      results.length > 0 ? '## Screening Results' : '## No Stocks Passed Screening',
      '',
      results.length > 0 ? '```json' : '',
      results.length > 0 ? JSON.stringify(results, null, 2) : 'No stocks met the strict screening criteria.',
      results.length > 0 ? '```' : '',
    ].join('\n');

    return {
      agent: SCREEN_HIT_AGENT,
      summary,
      markdown,
      metadata: {
        setupType,
        tickers,
        results,
        hitsCount: results.length,
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[screenHitAgent] Error:', errMsg);

    return {
      agent: SCREEN_HIT_AGENT,
      summary: 'Failed to screen stocks.',
      markdown: [
        '# 🎯 Screen Hit Agent',
        '',
        `**Error:** Failed to screen stocks.`,
        '',
        `Reason: ${errMsg}`,
      ].join('\n'),
      metadata: { error: errMsg },
    };
  }
}
