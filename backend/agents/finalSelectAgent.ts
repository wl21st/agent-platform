export type FinalCandidateInput = {
  ticker: string;
  setupType: "trend" | "pullback" | "momentum";
  score: number;
  metrics: {
    close: number;
    sma20?: number;
    sma50?: number;
    sma200?: number;
    atr14?: number;
    high60d?: number;
    open?: number;
    prevClose?: number;
  };
};

export type TradePlan = {
  ticker: string;
  setupType: "trend" | "pullback" | "momentum";
  score: number;
  entryZone: { low: number; high: number };
  stopLoss: number;
  target1: number;
  target2: number;
  summary: string;
};

import { FINAL_SELECT_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';

/**
 * Generate trade plans for final candidate stocks
 */
function generateTradePlan(candidate: FinalCandidateInput): TradePlan {
  const { ticker, setupType, score, metrics } = candidate;
  const { close, sma20, sma50, atr14, high60d, open, prevClose } = metrics;

  let entryZone: { low: number; high: number };
  let stopLoss: number;
  let target1: number;
  let target2: number;
  let summary: string;

  if (setupType === 'pullback') {
    // Pullback target 1 is mean reversion to SMA20; target 2 is the prior 60-day high.
    entryZone = {
      low: sma50 ? Math.max(sma50 * 0.99, close * 0.98) : close * 0.98,
      high: close * 1.01,
    };
    stopLoss = sma50 ? sma50 * 0.96 : close * 0.94;
    const risk = close - stopLoss;
    target1 = sma20 && sma20 > close ? sma20 : close + risk * 1.5;
    target2 = high60d && high60d > target1 ? high60d : Math.max(target1, close + risk * 2);
    summary = `Pullback entry near ${close.toFixed(2)}, target 1 mean reversion to SMA20 ${target1.toFixed(2)}, target 2 prior 60-day high ${target2.toFixed(2)}, stop near ${stopLoss.toFixed(2)}`;
  } else if (setupType === 'momentum') {
    // Momentum entry: gap up, entry above open
    const gapUp = open && prevClose ? (open - prevClose) / prevClose : 0;
    entryZone = {
      low: open || close * 0.98,
      high: close * 1.05,
    };
    stopLoss = Math.max(close * 0.92, (open || close) * 0.95);
    const risk = close - stopLoss;
    target1 = atr14 ? close + atr14 * 1.5 : close + risk * 2;
    target2 = close + risk * 3;
    summary = `Momentum gap ${(gapUp * 100).toFixed(1)}%, entry above ${open?.toFixed(2)}, target 1 at +1.5 ATR ${target1.toFixed(2)}, target 2 ${target2.toFixed(2)}, stop at ${stopLoss.toFixed(2)}`;
  } else {
    // Trend setups favor entries near the short-term moving average with stops under intermediate support.
    entryZone = {
      low: sma20 ? Math.min(close, sma20) : close * 0.98,
      high: close * 1.02,
    };
    stopLoss = sma50 ? sma50 * 0.96 : close * 0.9;
    const risk = close - stopLoss;
    target1 = close + risk * 1.5;
    target2 = close + risk * 2.5;
    summary = `Trend continuation above ${sma20?.toFixed(2) || 'short-term support'}, stop near ${stopLoss.toFixed(2)}, targets ${target1.toFixed(2)}/${target2.toFixed(2)}`;
  }

  return {
    ticker,
    setupType,
    score,
    entryZone,
    stopLoss,
    target1,
    target2,
    summary,
  };
}

export async function runFinalSelectAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { input } = context;

  // Parse input as JSON array of FinalCandidateInput
  let candidates: FinalCandidateInput[];
  try {
    candidates = JSON.parse(input);
    if (!Array.isArray(candidates)) {
      throw new Error('Input must be an array of FinalCandidateInput');
    }
  } catch {
    return {
      agent: FINAL_SELECT_AGENT,
      summary: 'Failed to parse candidate stocks input.',
      markdown: [
        '# 🎯 Final Select Agent',
        '',
        '**Error:** Failed to parse input as JSON array of FinalCandidateInput.',
        '',
        'Expected format: `[{"ticker": "AAPL", "setupType": "pullback", "score": 1, "metrics": {...}}]`',
      ].join('\n'),
      metadata: { error: 'invalid_input' },
    };
  }

  if (candidates.length === 0) {
    return {
      agent: FINAL_SELECT_AGENT,
      summary: 'No candidate stocks provided.',
      markdown: [
        '# 🎯 Final Select Agent',
        '',
        '**Warning:** No candidate stocks to process.',
      ].join('\n'),
      metadata: { candidatesCount: 0 },
    };
  }

  try {
    const tradePlans = candidates.map(generateTradePlan);

    // Sort by score descending and take top 10
    const topPlans = [...tradePlans]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const summary = `Generated trade plans for ${tradePlans.length} stocks, showing top ${topPlans.length}.`;

    // Build markdown table
    const tableHeader = '| Ticker | Setup | Score | Entry Low | Entry High | Stop Loss | Target 1 | Target 2 | Summary |\n|--------|-------|-------|-----------|------------|-----------|----------|----------|---------|';
    const tableRows = topPlans.map(plan => 
      `| ${plan.ticker} | ${plan.setupType} | ${plan.score.toFixed(2)} | ${plan.entryZone.low.toFixed(2)} | ${plan.entryZone.high.toFixed(2)} | ${plan.stopLoss.toFixed(2)} | ${plan.target1.toFixed(2)} | ${plan.target2.toFixed(2)} | ${plan.summary} |`
    ).join('\n');

    const markdown = [
      '# 🎯 Final Select Agent',
      '',
      `**Results:** Top ${topPlans.length} of ${candidates.length} candidates`,
      '',
      tableHeader,
      tableRows,
    ].join('\n');

    return {
      agent: FINAL_SELECT_AGENT,
      summary,
      markdown,
      metadata: {
        candidatesCount: candidates.length,
        plansCount: tradePlans.length,
        topPlansCount: topPlans.length,
        topTickers: topPlans.map((plan) => plan.ticker),
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[finalSelectAgent] Error:', errMsg);

    return {
      agent: FINAL_SELECT_AGENT,
      summary: 'Failed to generate trade plans.',
      markdown: [
        '# 🎯 Final Select Agent',
        '',
        `**Error:** Failed to generate trade plans.`,
        '',
        `Reason: ${errMsg}`,
      ].join('\n'),
      metadata: { error: errMsg },
    };
  }
}
