export interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  icon: string;
}

export const agents: Agent[] = [
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
  }
];