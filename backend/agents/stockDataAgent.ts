import YahooFinance from 'yahoo-finance2';

import { STOCK_DATA_AGENT } from '@/lib/agent-chat';
import type { ToolExecutionContext, ToolExecutionResult } from '@backend/agents/toolAgents';
import { FinancialData } from '@/lib/stockAnalysisInterfaces';

const yahooFinance = new YahooFinance();

/* ──────────────────────────────────────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────────────────────────────────── */

interface FTSRow {
  date: Date;
  periodType: string;
  // Financials (Income Statement)
  totalRevenue?: number;
  costOfRevenue?: number;
  grossProfit?: number;
  operatingExpense?: number;
  operatingIncome?: number;
  netIncome?: number;
  EBITDA?: number;
  EBIT?: number;
  researchAndDevelopment?: number;
  sellingGeneralAndAdministration?: number;
  basicEPS?: number;
  dilutedEPS?: number;
  // Balance Sheet
  totalAssets?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  totalLiabilitiesNetMinorityInterest?: number;
  stockholdersEquity?: number;
  longTermDebt?: number;
  totalDebt?: number;
  cashAndCashEquivalents?: number;
  inventory?: number;
  accountsReceivable?: number;
  accountsPayable?: number;
  retainedEarnings?: number;
  workingCapital?: number;
  netDebt?: number;
  // Cash Flow
  operatingCashFlow?: number;
  investingCashFlow?: number;
  financingCashFlow?: number;
  capitalExpenditure?: number;
  freeCashFlow?: number;
  depreciationAndAmortization?: number;
  repurchaseOfCapitalStock?: number;
  commonStockDividendPaid?: number;
  [key: string]: unknown;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Helpers — formatting
 * ─────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────────
 * Helpers — financial data conversion
 * ─────────────────────────────────────────────────────────────────────────── */

function fmtNum(value: number | undefined | null, decimals = 2): string {
  if (value == null || isNaN(value)) return '—';
  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(decimals)}T`;
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(decimals)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(decimals)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(decimals)}K`;
  return value.toFixed(decimals);
}

function fmtPct(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '—';
  return `${(value * 100).toFixed(2)}%`;
}

function fmtDate(date: Date | string | undefined | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0] ?? '—';
}

function safeDiv(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator == null || denominator == null || denominator === 0) return undefined;
  return numerator / denominator;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Helpers — financial data conversion
 * ─────────────────────────────────────────────────────────────────────────── */

function calculateGrowthRate(current: number | undefined, previous: number | undefined): number | undefined {
  if (current == null || previous == null || previous === 0) return undefined;
  return (current - previous) / Math.abs(previous);
}

function buildFinancialData(ticker: string, annual: FTSRow[], quarterly: FTSRow[], price?: { shortName?: string; longName?: string; regularMarketPrice?: number; marketCap?: number; currency?: string; exchange?: string }): FinancialData {
  const latestAnnual = annual.length > 0 ? annual[annual.length - 1] : undefined;
  const previousAnnual = annual.length >= 2 ? annual[annual.length - 2] : undefined;
  
  // Calculate ratios for latest annual data
  const grossMargin = safeDiv(latestAnnual?.grossProfit, latestAnnual?.totalRevenue);
  const operatingMargin = safeDiv(latestAnnual?.operatingIncome, latestAnnual?.totalRevenue);
  const netMargin = safeDiv(latestAnnual?.netIncome, latestAnnual?.totalRevenue);
  const ebitdaMargin = safeDiv(latestAnnual?.EBITDA, latestAnnual?.totalRevenue);
  
  const currentRatio = safeDiv(latestAnnual?.currentAssets, latestAnnual?.currentLiabilities);
  const quickRatio = safeDiv((latestAnnual?.currentAssets ?? 0) - (latestAnnual?.inventory ?? 0), latestAnnual?.currentLiabilities);
  const debtToEquity = safeDiv(latestAnnual?.totalLiabilitiesNetMinorityInterest, latestAnnual?.stockholdersEquity);
  const assetLiabilityRatio = safeDiv(latestAnnual?.totalLiabilitiesNetMinorityInterest, latestAnnual?.totalAssets);
  const assetTurnover = safeDiv(latestAnnual?.totalRevenue, latestAnnual?.totalAssets);
  const receivablesTurnover = safeDiv(latestAnnual?.totalRevenue, latestAnnual?.accountsReceivable);
  
  // Calculate YoY growth
  const revenueGrowthYoY = calculateGrowthRate(latestAnnual?.totalRevenue, previousAnnual?.totalRevenue);
  const netIncomeGrowthYoY = calculateGrowthRate(latestAnnual?.netIncome, previousAnnual?.netIncome);
  const operatingIncomeGrowthYoY = calculateGrowthRate(latestAnnual?.operatingIncome, previousAnnual?.operatingIncome);
  
  return {
    ticker,
    timestamp: new Date().toISOString(),
    fundamentals: {
      // Income Statement
      totalRevenue: latestAnnual?.totalRevenue,
      costOfRevenue: latestAnnual?.costOfRevenue,
      grossProfit: latestAnnual?.grossProfit,
      operatingExpense: latestAnnual?.operatingExpense,
      operatingIncome: latestAnnual?.operatingIncome,
      netIncome: latestAnnual?.netIncome,
      EBITDA: latestAnnual?.EBITDA,
      EBIT: latestAnnual?.EBIT,
      researchAndDevelopment: latestAnnual?.researchAndDevelopment,
      sellingGeneralAndAdministration: latestAnnual?.sellingGeneralAndAdministration,
      basicEPS: latestAnnual?.basicEPS,
      dilutedEPS: latestAnnual?.dilutedEPS,
      
      // Balance Sheet
      totalAssets: latestAnnual?.totalAssets,
      currentAssets: latestAnnual?.currentAssets,
      currentLiabilities: latestAnnual?.currentLiabilities,
      totalLiabilitiesNetMinorityInterest: latestAnnual?.totalLiabilitiesNetMinorityInterest,
      stockholdersEquity: latestAnnual?.stockholdersEquity,
      longTermDebt: latestAnnual?.longTermDebt,
      totalDebt: latestAnnual?.totalDebt,
      cashAndCashEquivalents: latestAnnual?.cashAndCashEquivalents,
      inventory: latestAnnual?.inventory,
      accountsReceivable: latestAnnual?.accountsReceivable,
      accountsPayable: latestAnnual?.accountsPayable,
      retainedEarnings: latestAnnual?.retainedEarnings,
      workingCapital: latestAnnual?.workingCapital,
      netDebt: latestAnnual?.netDebt,
      
      // Cash Flow
      operatingCashFlow: latestAnnual?.operatingCashFlow,
      investingCashFlow: latestAnnual?.investingCashFlow,
      financingCashFlow: latestAnnual?.financingCashFlow,
      capitalExpenditure: latestAnnual?.capitalExpenditure,
      freeCashFlow: latestAnnual?.freeCashFlow,
      depreciationAndAmortization: latestAnnual?.depreciationAndAmortization,
      repurchaseOfCapitalStock: latestAnnual?.repurchaseOfCapitalStock,
      commonStockDividendPaid: latestAnnual?.commonStockDividendPaid,
    },
    ratios: {
      // Profitability
      grossMargin,
      operatingMargin,
      netMargin,
      EBITDAMargin: ebitdaMargin,
      
      // Liquidity
      currentRatio,
      quickRatio,
      
      // Leverage
      debtToEquity,
      assetLiabilityRatio,
      
      // Efficiency
      assetTurnover,
      receivablesTurnover,
      
      // Growth (YoY)
      revenueGrowthYoY,
      netIncomeGrowthYoY,
      operatingIncomeGrowthYoY,
    },
    priceInfo: price
  };
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Extract ticker symbol from user input
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
 * Core: fetch financial data via fundamentalsTimeSeries
 * ─────────────────────────────────────────────────────────────────────────── */

async function fetchFinancialTimeSeries(ticker: string) {
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

  const [annualData, quarterlyData, priceData] = await Promise.all([
    yahooFinance.fundamentalsTimeSeries(ticker, {
      period1: fiveYearsAgo.toISOString().split('T')[0]!,
      type: 'annual',
      module: 'all',
    }) as Promise<FTSRow[]>,
    yahooFinance.fundamentalsTimeSeries(ticker, {
      period1: fiveYearsAgo.toISOString().split('T')[0]!,
      type: 'quarterly',
      module: 'all',
    }) as Promise<FTSRow[]>,
    yahooFinance.quoteSummary(ticker, { modules: ['price'] }).catch(() => null),
  ]);

  return {
    annual: annualData,
    quarterly: quarterlyData,
    price: (priceData as { price?: { shortName?: string; longName?: string; regularMarketPrice?: number; marketCap?: number; currency?: string; exchange?: string } })?.price,
  };
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Build multi-period table rows
 * ─────────────────────────────────────────────────────────────────────────── */

function buildTableRow(label: string, rows: FTSRow[], getter: (r: FTSRow) => number | undefined, fmt: (v: number | undefined) => string = (v) => fmtNum(v)): string {
  const values = rows.map((r) => fmt(getter(r)));
  return `| ${label} | ${values.join(' | ')} |`;
}

function buildRatioRow(label: string, rows: FTSRow[], getter: (r: FTSRow) => number | undefined): string {
  const values = rows.map((r) => {
    const v = getter(r);
    return v != null ? fmtPct(v) : '—';
  });
  return `| ${label} | ${values.join(' | ')} |`;
}

function buildNumericRow(label: string, rows: FTSRow[], getter: (r: FTSRow) => number | undefined): string {
  const values = rows.map((r) => {
    const v = getter(r);
    return v != null ? v.toFixed(2) : '—';
  });
  return `| ${label} | ${values.join(' | ')} |`;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Build the comprehensive financial report
 * ─────────────────────────────────────────────────────────────────────────── */

function buildFinancialReport(
  ticker: string,
  annual: FTSRow[],
  quarterly: FTSRow[],
  price?: { shortName?: string; longName?: string; regularMarketPrice?: number; marketCap?: number; currency?: string; exchange?: string },
): string {
  const companyName = price?.longName || price?.shortName || ticker;
  const currency = price?.currency || 'USD';
  const lines: string[] = [];

  /* ── Header ──────────────────────────────────────────────────────────── */
  lines.push(`# 📊 Financial Analysis Report: ${companyName} (${ticker})`);
  lines.push('');
  if (price?.regularMarketPrice) lines.push(`**Current Price:** ${currency} ${price.regularMarketPrice.toFixed(2)}`);
  if (price?.marketCap) lines.push(`**Market Cap:** ${currency} ${fmtNum(price.marketCap)}`);
  if (price?.exchange) lines.push(`**Exchange:** ${price.exchange}`);
  lines.push('');

  /* ══════════════════════════════════════════════════════════════════════
   * ANNUAL FINANCIAL STATEMENTS
   * ══════════════════════════════════════════════════════════════════════ */

  const sortedAnnual = [...annual].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const recentAnnual = sortedAnnual.slice(-4); // Last 4 years

  if (recentAnnual.length > 0) {
    const headerDates = recentAnnual.map((r) => fmtDate(r.date));
    const separator = recentAnnual.map(() => '---');

    /* ── Income Statement (Annual) ─────────────────────────────────────── */
    lines.push('---');
    lines.push('## 📈 Income Statement (Annual)');
    lines.push('');
    lines.push(`| Metric | ${headerDates.join(' | ')} |`);
    lines.push(`| --- | ${separator.join(' | ')} |`);
    lines.push(buildTableRow('Total Revenue', recentAnnual, (r) => r.totalRevenue));
    lines.push(buildTableRow('Cost of Revenue', recentAnnual, (r) => r.costOfRevenue));
    lines.push(buildTableRow('Gross Profit', recentAnnual, (r) => r.grossProfit));
    lines.push(buildTableRow('Operating Expense', recentAnnual, (r) => r.operatingExpense));
    lines.push(buildTableRow('Operating Income', recentAnnual, (r) => r.operatingIncome));
    lines.push(buildTableRow('Net Income', recentAnnual, (r) => r.netIncome));
    lines.push(buildTableRow('EBITDA', recentAnnual, (r) => r.EBITDA));
    lines.push(buildTableRow('R&D Expense', recentAnnual, (r) => r.researchAndDevelopment));
    lines.push(buildTableRow('SG&A Expense', recentAnnual, (r) => r.sellingGeneralAndAdministration));
    lines.push(buildNumericRow('Basic EPS', recentAnnual, (r) => r.basicEPS));
    lines.push(buildNumericRow('Diluted EPS', recentAnnual, (r) => r.dilutedEPS));
    lines.push('');

    // Profitability ratios
    lines.push('**Profitability Margins (Annual):**');
    lines.push('');
    lines.push(`| Ratio | ${headerDates.join(' | ')} |`);
    lines.push(`| --- | ${separator.join(' | ')} |`);
    lines.push(buildRatioRow('Gross Margin', recentAnnual, (r) => safeDiv(r.grossProfit, r.totalRevenue)));
    lines.push(buildRatioRow('Operating Margin', recentAnnual, (r) => safeDiv(r.operatingIncome, r.totalRevenue)));
    lines.push(buildRatioRow('Net Margin', recentAnnual, (r) => safeDiv(r.netIncome, r.totalRevenue)));
    lines.push(buildRatioRow('EBITDA Margin', recentAnnual, (r) => safeDiv(r.EBITDA, r.totalRevenue)));
    lines.push('');

    // YoY growth
    if (recentAnnual.length >= 2) {
      lines.push('**Year-over-Year Growth:**');
      lines.push('');
      const growthHeaders = headerDates.slice(1);
      const growthSep = growthHeaders.map(() => '---');
      lines.push(`| Metric | ${growthHeaders.join(' | ')} |`);
      lines.push(`| --- | ${growthSep.join(' | ')} |`);

      const growthRow = (label: string, getter: (r: FTSRow) => number | undefined) => {
        const values: string[] = [];
        for (let i = 1; i < recentAnnual.length; i++) {
          const curr = getter(recentAnnual[i]!);
          const prev = getter(recentAnnual[i - 1]!);
          if (curr != null && prev != null && prev !== 0) {
            values.push(fmtPct((curr - prev) / Math.abs(prev)));
          } else {
            values.push('—');
          }
        }
        return `| ${label} | ${values.join(' | ')} |`;
      };

      lines.push(growthRow('Revenue Growth', (r) => r.totalRevenue));
      lines.push(growthRow('Net Income Growth', (r) => r.netIncome));
      lines.push(growthRow('Operating Income Growth', (r) => r.operatingIncome));
      lines.push('');
    }

    /* ── Balance Sheet (Annual) ────────────────────────────────────────── */
    lines.push('---');
    lines.push('## 🏦 Balance Sheet (Annual)');
    lines.push('');
    lines.push(`| Metric | ${headerDates.join(' | ')} |`);
    lines.push(`| --- | ${separator.join(' | ')} |`);
    lines.push(buildTableRow('Total Assets', recentAnnual, (r) => r.totalAssets));
    lines.push(buildTableRow('Current Assets', recentAnnual, (r) => r.currentAssets));
    lines.push(buildTableRow('Cash & Equivalents', recentAnnual, (r) => r.cashAndCashEquivalents));
    lines.push(buildTableRow('Inventory', recentAnnual, (r) => r.inventory));
    lines.push(buildTableRow('Accounts Receivable', recentAnnual, (r) => r.accountsReceivable));
    lines.push(buildTableRow('Total Liabilities', recentAnnual, (r) => r.totalLiabilitiesNetMinorityInterest));
    lines.push(buildTableRow('Current Liabilities', recentAnnual, (r) => r.currentLiabilities));
    lines.push(buildTableRow('Long-term Debt', recentAnnual, (r) => r.longTermDebt));
    lines.push(buildTableRow('Total Debt', recentAnnual, (r) => r.totalDebt));
    lines.push(buildTableRow('Net Debt', recentAnnual, (r) => r.netDebt));
    lines.push(buildTableRow('Stockholder Equity', recentAnnual, (r) => r.stockholdersEquity));
    lines.push(buildTableRow('Retained Earnings', recentAnnual, (r) => r.retainedEarnings));
    lines.push(buildTableRow('Working Capital', recentAnnual, (r) => r.workingCapital));
    lines.push('');

    // Financial health ratios
    lines.push('**Financial Health Ratios (Annual):**');
    lines.push('');
    lines.push(`| Ratio | ${headerDates.join(' | ')} |`);
    lines.push(`| --- | ${separator.join(' | ')} |`);
    lines.push(buildNumericRow('Current Ratio', recentAnnual, (r) => safeDiv(r.currentAssets, r.currentLiabilities)));
    lines.push(buildNumericRow('Quick Ratio', recentAnnual, (r) => safeDiv((r.currentAssets ?? 0) - (r.inventory ?? 0), r.currentLiabilities)));
    lines.push(buildNumericRow('Debt-to-Equity', recentAnnual, (r) => safeDiv(r.totalLiabilitiesNetMinorityInterest, r.stockholdersEquity)));
    lines.push(buildRatioRow('Asset-Liability Ratio', recentAnnual, (r) => safeDiv(r.totalLiabilitiesNetMinorityInterest, r.totalAssets)));
    lines.push(buildNumericRow('Asset Turnover', recentAnnual, (r) => safeDiv(r.totalRevenue, r.totalAssets)));
    lines.push('');

    /* ── Cash Flow (Annual) ────────────────────────────────────────────── */
    lines.push('---');
    lines.push('## 💰 Cash Flow Statement (Annual)');
    lines.push('');
    lines.push(`| Metric | ${headerDates.join(' | ')} |`);
    lines.push(`| --- | ${separator.join(' | ')} |`);
    lines.push(buildTableRow('Operating Cash Flow', recentAnnual, (r) => r.operatingCashFlow));
    lines.push(buildTableRow('Investing Cash Flow', recentAnnual, (r) => r.investingCashFlow));
    lines.push(buildTableRow('Financing Cash Flow', recentAnnual, (r) => r.financingCashFlow));
    lines.push(buildTableRow('Capital Expenditure', recentAnnual, (r) => r.capitalExpenditure));
    lines.push(buildTableRow('Free Cash Flow', recentAnnual, (r) => r.freeCashFlow));
    lines.push(buildTableRow('D&A', recentAnnual, (r) => r.depreciationAndAmortization));
    lines.push(buildTableRow('Stock Buybacks', recentAnnual, (r) => r.repurchaseOfCapitalStock));
    lines.push(buildTableRow('Dividends Paid', recentAnnual, (r) => r.commonStockDividendPaid));
    lines.push('');
  }

  /* ══════════════════════════════════════════════════════════════════════
   * QUARTERLY FINANCIAL STATEMENTS (last 4 quarters)
   * ══════════════════════════════════════════════════════════════════════ */

  const sortedQuarterly = [...quarterly].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const recentQuarterly = sortedQuarterly.slice(-4);

  if (recentQuarterly.length > 0) {
    const qHeaderDates = recentQuarterly.map((r) => fmtDate(r.date));
    const qSeparator = recentQuarterly.map(() => '---');

    lines.push('---');
    lines.push('## 📈 Income Statement (Quarterly — Last 4 Quarters)');
    lines.push('');
    lines.push(`| Metric | ${qHeaderDates.join(' | ')} |`);
    lines.push(`| --- | ${qSeparator.join(' | ')} |`);
    lines.push(buildTableRow('Total Revenue', recentQuarterly, (r) => r.totalRevenue));
    lines.push(buildTableRow('Gross Profit', recentQuarterly, (r) => r.grossProfit));
    lines.push(buildTableRow('Operating Income', recentQuarterly, (r) => r.operatingIncome));
    lines.push(buildTableRow('Net Income', recentQuarterly, (r) => r.netIncome));
    lines.push(buildRatioRow('Gross Margin', recentQuarterly, (r) => safeDiv(r.grossProfit, r.totalRevenue)));
    lines.push(buildRatioRow('Net Margin', recentQuarterly, (r) => safeDiv(r.netIncome, r.totalRevenue)));
    lines.push(buildNumericRow('Diluted EPS', recentQuarterly, (r) => r.dilutedEPS));
    lines.push('');

    lines.push('## 🏦 Balance Sheet (Quarterly — Last 4 Quarters)');
    lines.push('');
    lines.push(`| Metric | ${qHeaderDates.join(' | ')} |`);
    lines.push(`| --- | ${qSeparator.join(' | ')} |`);
    lines.push(buildTableRow('Total Assets', recentQuarterly, (r) => r.totalAssets));
    lines.push(buildTableRow('Cash & Equivalents', recentQuarterly, (r) => r.cashAndCashEquivalents));
    lines.push(buildTableRow('Total Liabilities', recentQuarterly, (r) => r.totalLiabilitiesNetMinorityInterest));
    lines.push(buildTableRow('Stockholder Equity', recentQuarterly, (r) => r.stockholdersEquity));
    lines.push(buildNumericRow('Current Ratio', recentQuarterly, (r) => safeDiv(r.currentAssets, r.currentLiabilities)));
    lines.push('');

    lines.push('## 💰 Cash Flow (Quarterly — Last 4 Quarters)');
    lines.push('');
    lines.push(`| Metric | ${qHeaderDates.join(' | ')} |`);
    lines.push(`| --- | ${qSeparator.join(' | ')} |`);
    lines.push(buildTableRow('Operating Cash Flow', recentQuarterly, (r) => r.operatingCashFlow));
    lines.push(buildTableRow('Investing Cash Flow', recentQuarterly, (r) => r.investingCashFlow));
    lines.push(buildTableRow('Financing Cash Flow', recentQuarterly, (r) => r.financingCashFlow));
    lines.push(buildTableRow('Free Cash Flow', recentQuarterly, (r) => r.freeCashFlow));
    lines.push('');
  }

  /* ══════════════════════════════════════════════════════════════════════
   * COMPREHENSIVE ANALYSIS
   * ══════════════════════════════════════════════════════════════════════ */

  lines.push('---');
  lines.push('## 🔍 Comprehensive Analysis');
  lines.push('');

  const latest = recentAnnual[recentAnnual.length - 1];
  const prev = recentAnnual.length >= 2 ? recentAnnual[recentAnnual.length - 2] : undefined;

  if (latest) {
    const grossMargin = safeDiv(latest.grossProfit, latest.totalRevenue);
    const operatingMargin = safeDiv(latest.operatingIncome, latest.totalRevenue);
    const netMargin = safeDiv(latest.netIncome, latest.totalRevenue);
    const currentRatio = safeDiv(latest.currentAssets, latest.currentLiabilities);
    const quickRatio = safeDiv((latest.currentAssets ?? 0) - (latest.inventory ?? 0), latest.currentLiabilities);
    const debtToEquity = safeDiv(latest.totalLiabilitiesNetMinorityInterest, latest.stockholdersEquity);
    const assetLiabilityRatio = safeDiv(latest.totalLiabilitiesNetMinorityInterest, latest.totalAssets);
    const assetTurnover = safeDiv(latest.totalRevenue, latest.totalAssets);

    let revenueGrowth: number | undefined;
    if (prev?.totalRevenue && latest.totalRevenue) {
      revenueGrowth = (latest.totalRevenue - prev.totalRevenue) / Math.abs(prev.totalRevenue);
    }
    let netIncomeGrowth: number | undefined;
    if (prev?.netIncome && latest.netIncome) {
      netIncomeGrowth = (latest.netIncome - prev.netIncome) / Math.abs(prev.netIncome);
    }

    // 1. Profitability
    lines.push('### 1. Profitability');
    if (grossMargin != null) {
      lines.push(`- **Gross Margin** (${fmtPct(grossMargin)}): ${grossMargin > 0.5 ? '✅ Strong pricing power' : grossMargin > 0.3 ? '⚠️ Moderate pricing power' : '❌ Weak pricing power'}`);
    }
    if (operatingMargin != null) {
      lines.push(`- **Operating Margin** (${fmtPct(operatingMargin)}): ${operatingMargin > 0.2 ? '✅ Efficient operations' : operatingMargin > 0.1 ? '⚠️ Average operational efficiency' : '❌ Low operational efficiency'}`);
    }
    if (netMargin != null) {
      lines.push(`- **Net Margin** (${fmtPct(netMargin)}): ${netMargin > 0.15 ? '✅ Strong profitability' : netMargin > 0.05 ? '⚠️ Moderate profitability' : '❌ Thin profit margins'}`);
    }
    if (revenueGrowth != null) {
      lines.push(`- **Revenue Growth (YoY)** (${fmtPct(revenueGrowth)}): ${revenueGrowth > 0.1 ? '✅ Strong growth' : revenueGrowth > 0 ? '⚠️ Modest growth' : '❌ Declining revenue'}`);
    }
    if (netIncomeGrowth != null) {
      lines.push(`- **Net Income Growth (YoY)** (${fmtPct(netIncomeGrowth)}): ${netIncomeGrowth > 0.1 ? '✅ Earnings expanding' : netIncomeGrowth > 0 ? '⚠️ Modest earnings growth' : '❌ Earnings declining'}`);
    }
    lines.push('');

    // 2. Financial health
    lines.push('### 2. Financial Health & Leverage');
    if (currentRatio != null) {
      lines.push(`- **Current Ratio** (${currentRatio.toFixed(2)}): ${currentRatio > 2 ? '✅ Strong liquidity' : currentRatio > 1 ? '⚠️ Adequate liquidity' : '❌ Potential liquidity risk'}`);
    }
    if (quickRatio != null) {
      lines.push(`- **Quick Ratio** (${quickRatio.toFixed(2)}): ${quickRatio > 1.5 ? '✅ Excellent short-term solvency' : quickRatio > 1 ? '⚠️ Adequate solvency' : '❌ May struggle with short-term obligations'}`);
    }
    if (debtToEquity != null) {
      lines.push(`- **Debt-to-Equity** (${debtToEquity.toFixed(2)}): ${debtToEquity < 0.5 ? '✅ Conservative leverage' : debtToEquity < 1.5 ? '⚠️ Moderate leverage' : '❌ High financial leverage'}`);
    }
    if (assetLiabilityRatio != null) {
      lines.push(`- **Asset-Liability Ratio** (${fmtPct(assetLiabilityRatio)}): ${assetLiabilityRatio < 0.4 ? '✅ Low debt dependency' : assetLiabilityRatio < 0.6 ? '⚠️ Moderate debt load' : '❌ Heavy reliance on debt'}`);
    }
    lines.push('');

    // 3. Cash flow quality
    lines.push('### 3. Cash Flow Quality');
    if (latest.operatingCashFlow != null) {
      lines.push(`- **Operating Cash Flow** (${currency} ${fmtNum(latest.operatingCashFlow)}): ${(latest.operatingCashFlow ?? 0) > 0 ? '✅ Positive operating cash generation' : '❌ Negative operating cash flow'}`);
    }
    if (latest.freeCashFlow != null) {
      lines.push(`- **Free Cash Flow** (${currency} ${fmtNum(latest.freeCashFlow)}): ${(latest.freeCashFlow ?? 0) > 0 ? '✅ Company generates free cash' : '⚠️ Negative FCF'}`);
    }
    if (latest.investingCashFlow != null) {
      lines.push(`- **Investing Cash Flow** (${currency} ${fmtNum(latest.investingCashFlow)}): ${(latest.investingCashFlow ?? 0) < 0 ? 'Actively investing in growth' : 'Divesting or receiving investment income'}`);
    }
    if (latest.financingCashFlow != null) {
      lines.push(`- **Financing Cash Flow** (${currency} ${fmtNum(latest.financingCashFlow)}): ${(latest.financingCashFlow ?? 0) < 0 ? 'Returning capital / repaying debt' : 'Raising capital'}`);
    }
    lines.push('');

    // 4. Efficiency
    lines.push('### 4. Efficiency');
    if (assetTurnover != null) {
      lines.push(`- **Total Asset Turnover** (${assetTurnover.toFixed(2)}x): ${assetTurnover > 1 ? '✅ Efficient asset utilization' : assetTurnover > 0.5 ? '⚠️ Average asset utilization' : '❌ Low asset turnover'}`);
    }
    const receivablesTurnover = safeDiv(latest.totalRevenue, latest.accountsReceivable);
    if (receivablesTurnover != null) {
      const daysSales = 365 / receivablesTurnover;
      lines.push(`- **Receivables Turnover** (${receivablesTurnover.toFixed(2)}x, ~${Math.round(daysSales)} days): ${daysSales < 45 ? '✅ Efficient collection' : daysSales < 90 ? '⚠️ Average collection period' : '❌ Slow collection'}`);
    }
    lines.push('');

    // 5. Risk points
    lines.push('### 5. ⚠️ Key Risk Points');
    const risks: string[] = [];
    if (netMargin != null && netMargin < 0.05) risks.push('Thin profit margins leave little room for economic downturns');
    if (currentRatio != null && currentRatio < 1) risks.push('Current ratio below 1.0 — short-term liquidity concern');
    if (debtToEquity != null && debtToEquity > 2) risks.push('High debt-to-equity ratio — significant leverage risk');
    if (latest.operatingCashFlow != null && latest.operatingCashFlow < 0) risks.push('Negative operating cash flow');
    if (latest.freeCashFlow != null && latest.freeCashFlow < 0) risks.push('Negative free cash flow — external financing dependency');
    if (revenueGrowth != null && revenueGrowth < 0) risks.push('Declining revenue — potential market share loss');
    if (netIncomeGrowth != null && netIncomeGrowth < -0.2) risks.push('Significant net income decline (>20%) year-over-year');
    if (risks.length === 0) risks.push('No major red flags identified based on available data');
    for (const risk of risks) lines.push(`- ${risk}`);
    lines.push('');

    // 6. Investment considerations
    lines.push('### 6. 💡 Investment Considerations');
    const positives: string[] = [];
    const negatives: string[] = [];

    if (grossMargin != null && grossMargin > 0.4) positives.push('strong gross margins');
    if (netMargin != null && netMargin > 0.15) positives.push('healthy net profitability');
    if (currentRatio != null && currentRatio > 1.5) positives.push('solid liquidity');
    if (latest.freeCashFlow != null && latest.freeCashFlow > 0) positives.push('positive free cash flow');
    if (revenueGrowth != null && revenueGrowth > 0.1) positives.push('strong revenue growth');
    if (debtToEquity != null && debtToEquity < 0.5) positives.push('conservative leverage');

    if (netMargin != null && netMargin < 0.05) negatives.push('thin profit margins');
    if (debtToEquity != null && debtToEquity > 1.5) negatives.push('elevated leverage');
    if (latest.freeCashFlow != null && latest.freeCashFlow < 0) negatives.push('negative free cash flow');
    if (revenueGrowth != null && revenueGrowth < 0) negatives.push('declining revenue');

    if (positives.length > 0) lines.push(`- **Strengths:** ${positives.join(', ')}`);
    if (negatives.length > 0) lines.push(`- **Concerns:** ${negatives.join(', ')}`);
    lines.push('');
  }

  lines.push('> ⚠️ **Disclaimer:** This analysis is based on historical financial data and is for informational purposes only. It does not constitute investment advice. Always conduct your own research and consult a financial advisor before making investment decisions.');
  lines.push('');
  lines.push('*Data provided by Yahoo Finance via yahoo-finance2 fundamentalsTimeSeries*');

  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Public: run the Stock Data Agent
 * ─────────────────────────────────────────────────────────────────────────── */

export async function runStockDataAgent(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { input } = context;
  const ticker = extractTickerSymbol(input, context.extractedTicker);

  if (!ticker) {
    return {
      agent: STOCK_DATA_AGENT,
      summary: 'Could not identify a stock ticker symbol from input.',
      markdown: [
        '# 📊 Stock Data Agent',
        '',
        '**Error:** Could not identify a stock ticker symbol from your message.',
        '',
        'Please provide a valid ticker symbol (e.g., **AAPL**, **MSFT**, **GOOGL**, **$TSLA**, or Chinese stock codes like **600519**).',
      ].join('\n'),
      metadata: { error: 'no_ticker' },
    };
  }

  try {
    const { annual, quarterly, price } = await fetchFinancialTimeSeries(ticker);

    if (annual.length === 0 && quarterly.length === 0) {
      return {
        agent: STOCK_DATA_AGENT,
        summary: `No financial data found for ${ticker}.`,
        markdown: [
          '# 📊 Stock Data Agent',
          '',
          `**Warning:** No financial statement data was returned for **${ticker}**.`,
          '',
          'This could mean the ticker is incorrect, or historical financials are not available for this security.',
        ].join('\n'),
        metadata: { ticker, error: 'no_data' },
      };
    }

    const markdown = buildFinancialReport(ticker, annual, quarterly, price);
    const companyName = price?.longName || price?.shortName || ticker;
    
    // Build standardized financial data
    const financialData = buildFinancialData(ticker, annual, quarterly, price);

    return {
      agent: STOCK_DATA_AGENT,
      summary: `Financial analysis report for ${companyName} (${ticker}) generated with ${annual.length} annual and ${quarterly.length} quarterly periods.`,
      markdown,
      metadata: {
        ticker,
        companyName,
        currency: price?.currency || 'USD',
        marketCap: price?.marketCap,
        currentPrice: price?.regularMarketPrice,
        annualPeriods: annual.length,
        quarterlyPeriods: quarterly.length,
        financialData, // Add the standardized JSON data
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[stockDataAgent] Failed to fetch data for ${ticker}:`, errMsg);

    return {
      agent: STOCK_DATA_AGENT,
      summary: `Failed to fetch financial data for ${ticker}.`,
      markdown: [
        '# 📊 Stock Data Agent',
        '',
        `**Error:** Failed to fetch financial data for **${ticker}**.`,
        '',
        `Reason: ${errMsg}`,
        '',
        'Please verify the ticker symbol is correct and try again.',
      ].join('\n'),
      metadata: { error: errMsg, ticker },
    };
  }
}
