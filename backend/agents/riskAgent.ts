import { RISK_ASSESSMENT_AGENT } from '@/lib/agent-chat';
import type {
  FinancialData,
  NewsData,
  NormalizedScores,
  RiskAssessmentData,
  TechnicalData,
} from '@/lib/stockAnalysisInterfaces';
import { generateRiskAssessment } from '@backend/llm/openai';

/* ──────────────────────────────────────────────────────────────────────────────
 * Score normalization utilities — converts raw agent outputs to 0-100 scores
 * ─────────────────────────────────────────────────────────────────────────── */

export function normalizeFinancialScore(financialData: FinancialData): number {
  let score = 50;
  const { ratios, fundamentals } = financialData;

  // Profitability
  if (ratios.grossMargin != null) {
    if (ratios.grossMargin > 0.5) score += 10;
    else if (ratios.grossMargin > 0.3) score += 5;
    else score -= 5;
  }
  if (ratios.operatingMargin != null) {
    if (ratios.operatingMargin > 0.2) score += 10;
    else if (ratios.operatingMargin > 0.1) score += 5;
    else if (ratios.operatingMargin < 0) score -= 10;
  }
  if (ratios.netMargin != null) {
    if (ratios.netMargin > 0.15) score += 10;
    else if (ratios.netMargin > 0.05) score += 5;
    else if (ratios.netMargin < 0) score -= 15;
    else score -= 5; // 0-5%: thin
  }

  // Liquidity
  if (ratios.currentRatio != null) {
    if (ratios.currentRatio > 2) score += 5;
    else if (ratios.currentRatio > 1) score += 2;
    else score -= 10;
  }
  if (ratios.quickRatio != null) {
    if (ratios.quickRatio > 1.5) score += 5;
    else if (ratios.quickRatio > 1) score += 2;
    else score -= 5;
  }

  // Leverage
  if (ratios.debtToEquity != null) {
    if (ratios.debtToEquity < 0.5) score += 5;
    else if (ratios.debtToEquity < 1.5) score += 2;
    else if (ratios.debtToEquity > 2) score -= 10;
  }

  // Cash flow quality
  if (fundamentals.freeCashFlow != null) {
    if (fundamentals.freeCashFlow > 0) score += 5;
    else score -= 5;
  }

  // Growth
  if (ratios.revenueGrowthYoY != null) {
    if (ratios.revenueGrowthYoY > 0.1) score += 5;
    else if (ratios.revenueGrowthYoY > 0) score += 2;
    else score -= 5;
  }
  if (ratios.netIncomeGrowthYoY != null) {
    if (ratios.netIncomeGrowthYoY > 0.1) score += 5;
    else if (ratios.netIncomeGrowthYoY > 0) score += 2;
    else if (ratios.netIncomeGrowthYoY < -0.2) score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

export function normalizeNewsScore(newsData: NewsData): number {
  if (!newsData.overallSentiment) return 50;
  // Map (-1 to 1) → (0 to 100)
  return Math.round(((newsData.overallSentiment.score + 1) / 2) * 100);
}

export function normalizeTechnicalScore(technicalData: TechnicalData): number {
  let score = 50;
  const { signals } = technicalData;

  if (signals.trend === 'bullish') score += 20;
  else if (signals.trend === 'bearish') score -= 20;

  if (signals.momentum === 'bullish') score += 20;
  else if (signals.momentum === 'bearish') score -= 20;

  if (signals.volume === 'increasing') score += 8;
  else if (signals.volume === 'decreasing') score -= 8;

  // Low volatility = slightly better for entry confirmation
  if (signals.volatility === 'low') score += 2;
  else if (signals.volatility === 'high') score -= 2;

  return Math.max(0, Math.min(100, score));
}

export function buildNormalizedScores(
  ticker: string,
  financialData: FinancialData,
  newsData: NewsData,
  technicalData: TechnicalData,
): NormalizedScores {
  const WEIGHTS = { financial: 0.40, news: 0.25, technical: 0.35 };

  const financialScore = normalizeFinancialScore(financialData);
  const newsScore = normalizeNewsScore(newsData);
  const technicalScore = normalizeTechnicalScore(technicalData);

  const overallScore = Math.round(
    financialScore * WEIGHTS.financial +
    newsScore * WEIGHTS.news +
    technicalScore * WEIGHTS.technical,
  );

  return {
    ticker,
    timestamp: new Date().toISOString(),
    financialScore,
    newsScore,
    technicalScore,
    overallScore,
    weights: WEIGHTS,
  };
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Build the risk assessment markdown report
 * ─────────────────────────────────────────────────────────────────────────── */

function severityEmoji(s: string): string {
  return s === 'high' ? '🔴' : s === 'medium' ? '🟡' : '🟢';
}

function buildRiskReport(ra: RiskAssessmentData, ns: NormalizedScores): string {
  const lines: string[] = [];

  lines.push(`# ⚠️ Risk Assessment Report: ${ra.ticker}`);
  lines.push('');

  // Score summary
  lines.push('## 📊 Normalized Scores (0-100)');
  lines.push('');
  lines.push('| Dimension | Score | Weight |');
  lines.push('|-----------|-------|--------|');
  lines.push(`| 📊 Fundamental Analysis | ${ns.financialScore}/100 | ${(ns.weights.financial * 100).toFixed(0)}% |`);
  lines.push(`| 📰 News Sentiment | ${ns.newsScore}/100 | ${(ns.weights.news * 100).toFixed(0)}% |`);
  lines.push(`| 📈 Technical Analysis | ${ns.technicalScore}/100 | ${(ns.weights.technical * 100).toFixed(0)}% |`);
  lines.push(`| **🎯 Overall Composite** | **${ns.overallScore}/100** | 100% |`);
  lines.push('');

  // Risk scores
  lines.push('## 🔢 Risk Scores (0=low risk, 100=high risk)');
  lines.push('');
  lines.push('| Risk Dimension | Score |');
  lines.push('|----------------|-------|');
  const riskEmoji = (v: number) => v > 65 ? '🔴' : v > 35 ? '🟡' : '🟢';
  lines.push(`| Overall Risk | ${riskEmoji(ra.riskScores.overallRisk)} ${ra.riskScores.overallRisk}/100 |`);
  lines.push(`| Market Risk | ${riskEmoji(ra.riskScores.marketRisk)} ${ra.riskScores.marketRisk}/100 |`);
  lines.push(`| Financial Risk | ${riskEmoji(ra.riskScores.financialRisk)} ${ra.riskScores.financialRisk}/100 |`);
  lines.push(`| Operational Risk | ${riskEmoji(ra.riskScores.operationalRisk)} ${ra.riskScores.operationalRisk}/100 |`);
  lines.push(`| Liquidity Risk | ${riskEmoji(ra.riskScores.liquidityRisk)} ${ra.riskScores.liquidityRisk}/100 |`);
  lines.push('');

  // Risk factors
  if (ra.riskFactors.length > 0) {
    lines.push('## ⚡ Risk Factors');
    lines.push('');
    lines.push('| Factor | Description | Severity | Impact |');
    lines.push('|--------|-------------|----------|--------|');
    for (const rf of ra.riskFactors) {
      lines.push(`| ${rf.factor} | ${rf.description} | ${severityEmoji(rf.severity)} ${rf.severity} | ${severityEmoji(rf.impact)} ${rf.impact} |`);
    }
    lines.push('');
  }

  // Stop-loss and take-profit
  lines.push('## 🎯 Price Targets');
  lines.push('');
  if (ra.stopLossPrice != null) {
    lines.push(`**🛑 Stop-Loss:** $${ra.stopLossPrice.toFixed(2)}`);
    lines.push('');
  }
  if (ra.takeProfitTargets && ra.takeProfitTargets.length > 0) {
    lines.push('**Take-Profit Targets:**');
    lines.push('');
    for (const tp of ra.takeProfitTargets) {
      lines.push(`- **${tp.label}:** $${tp.price.toFixed(2)}`);
    }
    lines.push('');
  }

  // Summary
  lines.push('## 📝 Risk Summary');
  lines.push('');
  lines.push(ra.riskSummary);
  lines.push('');

  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Public: run the Risk Assessment pipeline step
 * ─────────────────────────────────────────────────────────────────────────── */

export async function runRiskAssessment(params: {
  ticker: string;
  currentPrice: number;
  financialData: FinancialData;
  newsData: NewsData;
  technicalData: TechnicalData;
  normalizedScores: NormalizedScores;
}): Promise<{ riskData: RiskAssessmentData; markdown: string; agent: typeof RISK_ASSESSMENT_AGENT }> {
  const riskData = await generateRiskAssessment(params);
  const markdown = buildRiskReport(riskData, params.normalizedScores);

  return {
    riskData,
    markdown,
    agent: RISK_ASSESSMENT_AGENT,
  };
}
