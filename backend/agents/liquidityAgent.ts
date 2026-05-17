import { LIQUIDITY_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';
import {
  getDefaultMaxTickersForUniverse,
  getStocksLiquidityMetrics,
  resolveLiquidityUniverseFromInput,
} from './liquidity';

export async function runLiquidityAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { input } = context;

  try {
    const universe = await resolveLiquidityUniverseFromInput(input);
    // Broad universes (full NASDAQ / NYSE / us-listed) need a higher cap than
    // the default 500 so we don't silently truncate a "scan Nasdaq" request
    // to the first 500 alphabetical symbols.
    const maxTickers = getDefaultMaxTickersForUniverse(universe.key);
    console.info(`[liquidityAgent] Starting liquidity filter for ${universe.label} (${universe.tickers.length} tickers loaded, cap ${maxTickers})`);

    const allResults = await getStocksLiquidityMetrics(universe.tickers, {
      logProgress: true,
      logLabel: universe.label,
      maxTickers,
    });

    const passedResults = allResults.filter((result) => result.status === 'passed');
    const fetchStats = allResults.fetchStats;
    const summary = `Found ${passedResults.length} liquid stocks out of ${allResults.length} screened.`;
    const cacheSummary = fetchStats
      ? `Used ${fetchStats.batches} batched Yahoo quote() requests (up to ${fetchStats.batchSize} tickers each, batch concurrency ${fetchStats.concurrency}) in ${(fetchStats.durationMs / 1000).toFixed(2)}s; cache hits ${fetchStats.cacheHits}, misses ${fetchStats.cacheMisses}.`
      : '';

    const markdown = [
      '# 💧 Liquidity Filter Agent',
      '',
      `Scanned ${allResults.length} of ${universe.tickers.length} loaded stocks from ${universe.label} and found ${passedResults.length} stocks passing the liquidity filter.`,
      fetchStats && fetchStats.skippedCount > 0 ? `${fetchStats.skippedCount} stocks were skipped by the scan cap (cap = ${maxTickers}).` : '',
      cacheSummary,
    ].join('\n');

    console.info(`[liquidityAgent] Completed liquidity filter for ${universe.label}: ${passedResults.length}/${allResults.length} passed`);

    return {
      agent: LIQUIDITY_AGENT,
      summary,
      markdown,
      metadata: {
        tickers: universe.tickers,
        universe,
        fetchStats,
        results: passedResults,
        liquidCount: passedResults.length,
        screenedCount: allResults.length,
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[liquidityAgent] Error:', errMsg);

    return {
      agent: LIQUIDITY_AGENT,
      summary: 'Failed to filter stocks for liquidity.',
      markdown: [
        '# 💧 Liquidity Filter Agent',
        '',
        `**Error:** Failed to filter stocks.`,
        '',
        `Reason: ${errMsg}`,
      ].join('\n'),
      metadata: { error: errMsg },
    };
  }
}
