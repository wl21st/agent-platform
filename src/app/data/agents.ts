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
  }
];
