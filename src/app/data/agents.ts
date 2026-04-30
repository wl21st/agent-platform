export interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  icon: string;
}

export const agents: Agent[] = [
  {
    id: 'orchestrator',
    name: 'Orchestrator Agent',
    description: 'Coordinates user requests, selects the right specialized tool agents, manages session memory, and synthesizes the final response.',
    capabilities: ['Task routing', 'Session memory', 'Streaming coordination'],
    icon: '🧠'
  },
  {
    id: 'getweather',
    name: 'Weather Agent',
    description: 'Provides current weather information and forecasts for any location. Can get real-time data from weather APIs and present it in a user-friendly format.',
    capabilities: ['Weather forecasting', 'Location-based data', 'Real-time updates'],
    icon: '🌤️'
  },
  {
    id: 'calculator',
    name: 'Calculator Agent',
    description: 'Performs complex mathematical calculations, including basic arithmetic, advanced functions, and unit conversions.',
    capabilities: ['Arithmetic operations', 'Advanced math', 'Unit conversion'],
    icon: '🧮'
  },
  {
    id: 'translator',
    name: 'Translation Agent',
    description: 'Translates text between multiple languages with high accuracy. Supports over 100 languages and maintains context.',
    capabilities: ['Multi-language support', 'Context preservation', 'Real-time translation'],
    icon: '🌐'
  },
  {
    id: 'scheduler',
    name: 'Scheduler Agent',
    description: 'Manages appointments, reminders, and schedules. Can integrate with calendar systems and send notifications.',
    capabilities: ['Appointment booking', 'Reminders', 'Calendar integration'],
    icon: '📅'
  },
  {
    id: 'search',
    name: 'Search Agent',
    description: 'Performs intelligent web searches and summarizes information from reliable sources. Can answer questions and provide research.',
    capabilities: ['Web search', 'Information summarization', 'Question answering'],
    icon: '🔍'
  },
  {
    id: 'webpage-summarize',
    name: 'Webpage Summarize Agent',
    description: 'Fetches a webpage by URL, extracts its text content, and provides a concise summary. Supports any publicly accessible HTML page.',
    capabilities: ['URL fetching', 'HTML content extraction', 'Page summarization'],
    icon: '📄'
  },
  {
    id: 'cosmetic-safe-check',
    name: 'Cosmetic Safe Check Agent',
    description: 'Analyzes cosmetic and skincare product ingredients for safety risks. Provides a risk rating (high, medium, low) and highlights harmful ingredients with detailed explanations.',
    capabilities: ['Ingredient safety analysis', 'Risk rating', 'Harmful ingredient detection', 'Safety recommendations'],
    icon: '🧴'
  },
  {
    id: 'ingredients-scrape',
    name: 'Ingredients Scrape Agent',
    description: 'Scrapes product ingredients from a given URL and automatically runs a cosmetic safety check. Extracts ingredient lists from product pages using multiple strategies (JSON-LD, HTML patterns, plain text).',
    capabilities: ['URL ingredient extraction', 'HTML scraping', 'Automatic safety analysis', 'Multi-strategy parsing'],
    icon: '🔬'
  },
  {
    id: 'stock-data',
    name: 'Stock Data Agent',
    description: 'Fetches and analyzes financial statements (income statement, balance sheet, cash flow) for any publicly traded stock. Provides comprehensive financial analysis including profitability ratios, leverage metrics, cash flow quality, and investment considerations.',
    capabilities: ['Income statement analysis', 'Balance sheet analysis', 'Cash flow analysis', 'Financial ratio calculation', 'Risk assessment', 'Investment recommendations'],
    icon: '📊'
  },
  {
    id: 'news-scrape',
    name: 'News Scrape Agent',
    description: 'Searches and scrapes recent news articles about stocks from reliable financial sources. Returns top 5 news articles in a structured table format with titles, dates, and direct links.',
    capabilities: ['News search', 'Article scraping', 'Financial news aggregation', 'Real-time news updates', 'Source credibility filtering'],
    icon: '📰'
  },
  {
    id: 'news-summary',
    name: 'News Summary Agent',
    description: 'Analyzes multiple news articles about a stock to provide overall sentiment analysis. Summarizes individual articles, determines bullish/bearish sentiment, and provides comprehensive market assessment with key insights.',
    capabilities: ['News summarization', 'Sentiment analysis', 'Market sentiment aggregation', 'Trend identification', 'Investment signal analysis'],
    icon: '📝'
  },
  {
    id: 'technical-analysis',
    name: 'Technical Analysis Agent',
    description: 'Performs comprehensive technical analysis on stocks using 14 months of daily OHLCV price data. Calculates moving averages (SMA 20/50/200, EMA 12/26), RSI, MACD, Bollinger Bands, ATR, and OBV. Derives actionable trend, momentum, volatility, and volume signals.',
    capabilities: ['Moving averages (SMA/EMA)', 'RSI & MACD momentum', 'Bollinger Bands & ATR volatility', 'Volume & OBV analysis', 'Trend/momentum signal generation', '52-week range positioning'],
    icon: '📈'
  },
  {
    id: 'risk-assessment',
    name: 'Risk Assessment Agent',
    description: 'Synthesizes fundamental, news sentiment, and technical data into a composite risk profile. Scores overall, market, financial, operational, and liquidity risk on a 0–100 scale. Identifies specific risk factors with severity ratings, and calculates stop-loss and take-profit price targets.',
    capabilities: ['Composite risk scoring (0–100)', 'Market / financial / operational risk', 'Risk factor identification & severity', 'Stop-loss price calculation', 'Take-profit target levels', 'Multi-dimension risk aggregation'],
    icon: '⚠️'
  },
  {
    id: 'stock-decision',
    name: 'Investment Decision Agent',
    description: 'Produces the final AI-powered investment recommendation (Buy / Hold / Sell) by combining fundamental analysis, news sentiment, technical indicators, and risk assessment. Provides confidence scores, suggested entry price, stop-loss, take-profit targets, risk/reward ratio, and key bullish and bearish factors with full reasoning.',
    capabilities: ['Buy / Hold / Sell recommendation', 'Confidence score (0–100)', 'Entry, stop-loss & take-profit levels', 'Risk/reward ratio', 'Bullish & bearish factor summary', 'Time horizon guidance'],
    icon: '🎯'
  },
  {
    id: 'liquidity-filter',
    name: 'Liquidity Filter Agent',
    description: 'Filters stocks based on liquidity criteria: price >= $10 and average daily volume >= 2M shares over the last 20 trading days. Returns filtered stock list in JSON format.',
    capabilities: ['Stock liquidity filtering', 'Volume analysis', 'Price screening', 'Bulk stock processing'],
    icon: '💧'
  },
  {
    id: 'screen-hit',
    name: 'Screen Hit Agent',
    description: 'Screens stocks for technical setups (trend, pullback, momentum) using strict criteria. Returns only stocks that pass screening in ScreenHit format, optimized for LLM consumption.',
    capabilities: ['Trend screening', 'Pullback screening', 'Momentum screening', 'Technical analysis', 'Token-efficient output'],
    icon: '🎯'
  },
  {
    id: 'final-select',
    name: 'Final Select Agent',
    description: 'Displays the final top 10 stocks from the orchestrated US stock scan workflow after liquidity filtering and technical screening, with entry zones, stops, and targets in table format.',
    capabilities: ['Final top 10 selection', 'Trade plan generation', 'Risk management', 'Entry/exit strategy', 'Investment planning'],
    icon: '📋'
  }
];
