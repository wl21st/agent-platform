export interface FinancialData {
  ticker: string;
  timestamp: string; // ISO timestamp when data was fetched
  fundamentals: {
    // Income Statement
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
  };
  
  ratios: {
    // Profitability
    grossMargin?: number;
    operatingMargin?: number;
    netMargin?: number;
    EBITDAMargin?: number;
    
    // Liquidity
    currentRatio?: number;
    quickRatio?: number;
    
    // Leverage
    debtToEquity?: number;
    assetLiabilityRatio?: number;
    
    // Efficiency
    assetTurnover?: number;
    receivablesTurnover?: number;
    
    // Growth (YoY)
    revenueGrowthYoY?: number;
    netIncomeGrowthYoY?: number;
    operatingIncomeGrowthYoY?: number;
  };
  
  priceInfo?: {
    shortName?: string;
    longName?: string;
    regularMarketPrice?: number;
    marketCap?: number;
    currency?: string;
    exchange?: string;
  };
}

export interface NewsData {
  ticker: string;
  timestamp: string;
  articles: Array<{
    title: string;
    url: string;
    publishedDate: string;
    source?: string;
    sentimentScore?: number; // -1 to 1, where -1 is very negative, 1 is very positive
    sentimentLabel?: 'negative' | 'neutral' | 'positive';
  }>;
  summary?: string;
  overallSentiment?: {
    score: number; // -1 to 1
    label: 'negative' | 'neutral' | 'positive';
  };
}

export interface TechnicalData {
  ticker: string;
  timestamp: string;
  indicators: {
    // Trend Indicators
    sma20?: number; // 20-day Simple Moving Average
    sma50?: number; // 50-day Simple Moving Average
    sma200?: number; // 200-day Simple Moving Average
    ema12?: number; // 12-day Exponential Moving Average
    ema26?: number; // 26-day Exponential Moving Average
    
    // Momentum Indicators
    rsi14?: number; // 14-day Relative Strength Index
    macd?: number; // MACD Line
    macdSignal?: number; // MACD Signal Line
    macdHistogram?: number; // MACD Histogram
    
    // Volatility Indicators
    bollingerUpper?: number; // Bollinger Bands Upper
    bollingerLower?: number; // Bollinger Bands Lower
    atr14?: number; // 14-day Average True Range
    
    // Volume Indicators
    volumeSma20?: number; // 20-day Volume Simple Moving Average
    obv?: number; // On-Balance Volume
  };
  
  priceData: {
    currentPrice: number;
    change24h?: number;
    changePercent24h?: number;
    change7d?: number;
    changePercent7d?: number;
    change30d?: number;
    changePercent30d?: number;
    high52w?: number;
    low52w?: number;
  };
  
  signals: {
    trend: 'bullish' | 'bearish' | 'neutral';
    momentum: 'bullish' | 'bearish' | 'neutral';
    volatility: 'high' | 'medium' | 'low';
    volume: 'increasing' | 'decreasing' | 'stable';
    overall: 'bullish' | 'bearish' | 'neutral';
  };
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Normalized Scores — standardized 0-100 output from each analysis dimension
 * ─────────────────────────────────────────────────────────────────────────── */

export interface NormalizedScores {
  ticker: string;
  timestamp: string;
  /** Fundamental financial health score (0-100, higher = healthier) */
  financialScore: number;
  /** News sentiment score (0-100, higher = more positive) */
  newsScore: number;
  /** Technical analysis score (0-100, higher = more bullish signals) */
  technicalScore: number;
  /** Overall weighted composite score (financial 40% + news 25% + technical 35%) */
  overallScore: number;
  weights: {
    financial: number; // e.g. 0.40
    news: number;      // e.g. 0.25
    technical: number; // e.g. 0.35
  };
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Risk Assessment — output of the Risk Agent
 * ─────────────────────────────────────────────────────────────────────────── */

export interface RiskAssessmentData {
  ticker: string;
  timestamp: string;
  riskScores: {
    overallRisk: number;     // 0-100, where 0 is lowest risk, 100 is highest risk
    marketRisk: number;      // 0-100
    financialRisk: number;   // 0-100
    operationalRisk: number; // 0-100
    liquidityRisk: number;   // 0-100
  };
  riskFactors: Array<{
    factor: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
  }>;
  riskSummary: string;
  /** Suggested stop-loss price level */
  stopLossPrice?: number;
  /** Suggested take-profit price targets */
  takeProfitTargets?: Array<{
    label: string;  // e.g. "Target 1 (conservative)", "Target 2 (moderate)"
    price: number;
  }>;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Decision Data — final output of the Decision Agent
 * ─────────────────────────────────────────────────────────────────────────── */

export interface DecisionData {
  ticker: string;
  timestamp: string;
  /** Primary investment recommendation */
  recommendation: 'buy' | 'hold' | 'sell';
  /** Confidence in the recommendation (0-100) */
  confidenceScore: number;
  /** Suggested entry price */
  entryPrice?: number;
  /** Suggested stop-loss price */
  stopLossPrice?: number;
  /** Multiple take-profit price targets */
  takeProfitTargets?: Array<{
    label: string;
    price: number;
  }>;
  /** Suggested time horizon for the trade */
  timeHorizon?: 'short-term' | 'medium-term' | 'long-term';
  /** Detailed reasoning for the recommendation */
  reasoning: string;
  /** Key bullish factors */
  keyBullishFactors?: string[];
  /** Key bearish / risk factors */
  keyBearishFactors?: string[];
  /** Approximate risk-to-reward ratio */
  riskRewardRatio?: number;
  /** Component scores from each analysis dimension */
  componentScores: {
    financialScore: number;  // 0-100
    newsScore: number;       // 0-100
    technicalScore: number;  // 0-100
    overallScore: number;    // 0-100 weighted composite
  };
  /** Risk assessment summary embedded in the decision */
  riskAssessment?: RiskAssessmentData;
}
