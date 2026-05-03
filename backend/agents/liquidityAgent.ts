import { LIQUIDITY_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';
import { getStocksLiquidityMetrics, resolveLiquidityUniverseFromInput } from './liquidity';

export async function runLiquidityAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { input } = context;

  try {
    const universe = await resolveLiquidityUniverseFromInput(input);
    console.info(`[liquidityAgent] Starting liquidity filter for ${universe.label} (${universe.tickers.length} tickers loaded)`);

    const allResults = await getStocksLiquidityMetrics(universe.tickers, {
      logProgress: true,
      logLabel: universe.label,
    });

    const passedResults = allResults.filter((result) => result.status === 'passed');
    const fetchStats = allResults.fetchStats;
    const summary = `Found ${passedResults.length} liquid stocks out of ${allResults.length} screened.`;
    const cacheSummary = fetchStats
      ? `Used ${fetchStats.batches} batches with ${fetchStats.concurrency} concurrent requests at ${fetchStats.requestsPerSecond} req/sec plus ${fetchStats.jitterMs}ms jitter; cache hits ${fetchStats.cacheHits}, misses ${fetchStats.cacheMisses}.`
      : '';

    const markdown = [
      '# 💧 Liquidity Filter Agent',
      '',
      `Scanned ${allResults.length} of ${universe.tickers.length} loaded stocks from ${universe.label} and found ${passedResults.length} stocks passing the liquidity filter.`,
      fetchStats && fetchStats.skippedCount > 0 ? `${fetchStats.skippedCount} stocks were skipped by the default scan cap to keep broad universe scans responsive.` : '',
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
