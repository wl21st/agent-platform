import { STOCK_DECISION_AGENT } from '@/lib/agent-chat';
import type {
  DecisionData,
  FinancialData,
  NewsData,
  NormalizedScores,
  RiskAssessmentData,
  TechnicalData,
} from '@/lib/stockAnalysisInterfaces';
import { generateInvestmentDecision } from '@backend/llm/openai';

/* ──────────────────────────────────────────────────────────────────────────────
 * Build the final investment decision markdown report
 * ─────────────────────────────────────────────────────────────────────────── */

function recommendationEmoji(rec: 'buy' | 'hold' | 'sell'): string {
  return rec === 'buy' ? '✅ BUY' : rec === 'sell' ? '❌ SELL' : '⏸️ HOLD';
}

function confidenceBar(score: number): string {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${score}/100`;
}

function buildDecisionReport(dd: DecisionData): string {
  const lines: string[] = [];

  lines.push(`# 🎯 Investment Decision: ${dd.ticker}`);
  lines.push('');

  // Primary recommendation
  lines.push('---');
  lines.push(`## ${recommendationEmoji(dd.recommendation)}`);
  lines.push('');
  lines.push(`**Confidence Score:** \`${confidenceBar(dd.confidenceScore)}\``);
  if (dd.timeHorizon) lines.push(`**Time Horizon:** ${dd.timeHorizon}`);
  lines.push('');

  // Entry / exit levels
  lines.push('---');
  lines.push('## 💰 Entry & Exit Levels');
  lines.push('');
  if (dd.entryPrice != null) lines.push(`**📥 Suggested Entry:** $${dd.entryPrice.toFixed(2)}`);
  if (dd.stopLossPrice != null) lines.push(`**🛑 Stop-Loss:** $${dd.stopLossPrice.toFixed(2)}`);
  if (dd.takeProfitTargets && dd.takeProfitTargets.length > 0) {
    lines.push('');
    lines.push('**🎯 Take-Profit Targets:**');
    for (const tp of dd.takeProfitTargets) {
      lines.push(`- **${tp.label}:** $${tp.price.toFixed(2)}`);
    }
  }
  if (dd.riskRewardRatio != null) {
    lines.push('');
    lines.push(`**⚖️ Risk/Reward Ratio:** ${dd.riskRewardRatio.toFixed(2)}:1`);
  }
  lines.push('');

  // Component scores
  lines.push('---');
  lines.push('## 📊 Analysis Scores Summary');
  lines.push('');
  lines.push('| Dimension | Score |');
  lines.push('|-----------|-------|');
  lines.push(`| 📊 Fundamentals | ${dd.componentScores.financialScore}/100 |`);
  lines.push(`| 📰 News Sentiment | ${dd.componentScores.newsScore}/100 |`);
  lines.push(`| 📈 Technical | ${dd.componentScores.technicalScore}/100 |`);
  lines.push(`| **🎯 Overall** | **${dd.componentScores.overallScore}/100** |`);
  lines.push('');

  // Key factors
  if (dd.keyBullishFactors && dd.keyBullishFactors.length > 0) {
    lines.push('---');
    lines.push('## ✅ Key Bullish Factors');
    lines.push('');
    for (const f of dd.keyBullishFactors) lines.push(`- ${f}`);
    lines.push('');
  }
  if (dd.keyBearishFactors && dd.keyBearishFactors.length > 0) {
    lines.push('---');
    lines.push('## ⚠️ Key Risk Factors');
    lines.push('');
    for (const f of dd.keyBearishFactors) lines.push(`- ${f}`);
    lines.push('');
  }

  // Reasoning
  lines.push('---');
  lines.push('## 📝 Reasoning');
  lines.push('');
  lines.push(dd.reasoning);
  lines.push('');

  lines.push('---');
  lines.push('> ⚠️ **Disclaimer:** This AI-generated analysis is for informational purposes only and does not constitute investment advice. Always conduct your own research and consult a licensed financial advisor before making investment decisions. Past performance is not indicative of future results.');
  lines.push('');

  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Public: run the Investment Decision pipeline step
 * ─────────────────────────────────────────────────────────────────────────── */

export async function runInvestmentDecision(params: {
  ticker: string;
  currentPrice: number;
  normalizedScores: NormalizedScores;
  riskAssessment: RiskAssessmentData;
  financialData: FinancialData;
  technicalData: TechnicalData;
  newsData: NewsData;
}): Promise<{ decisionData: DecisionData; markdown: string; agent: typeof STOCK_DECISION_AGENT }> {
  const decisionData = await generateInvestmentDecision(params);
  const markdown = buildDecisionReport(decisionData);

  return {
    decisionData,
    markdown,
    agent: STOCK_DECISION_AGENT,
  };
}
