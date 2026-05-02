import { LIQUIDITY_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';
import { getStocksLiquidityMetrics, resolveLiquidityUniverseFromInput } from './liquidity';

export async function runLiquidityAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { input } = context;

  try {
    const universe = await resolveLiquidityUniverseFromInput(input);
    const allResults = await getStocksLiquidityMetrics(universe.tickers);
    const passedResults = allResults.filter((result) => result.status === 'passed');
    const fetchStats = allResults.fetchStats;
    const summary = `Found ${passedResults.length} liquid stocks out of ${allResults.length} screened.`;
    const cacheSummary = fetchStats
      ? `Used ${fetchStats.batches} batches with ${fetchStats.concurrency} concurrent requests at ${fetchStats.requestsPerSecond} req/sec; cache hits ${fetchStats.cacheHits}, misses ${fetchStats.cacheMisses}.`
      : '';

    const markdown = [
      '# 💧 Liquidity Filter Agent',
      '',
      `Scanned ${allResults.length} stocks from ${universe.label} and found ${passedResults.length} stocks passing the liquidity filter.`,
      cacheSummary,
    ].join('\n');

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
