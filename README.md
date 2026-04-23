# Multi-Agent Platform

A modern multi-agent system built with Next.js, featuring intelligent agents that can perform various tasks through natural language interaction. Users can select specialized agents, engage in conversations, and leverage external APIs for real-time data retrieval.

## Features

- **Intelligent Agents**: Specialized agents for weather, search, webpage summarization, financial data, news, and more
- **Natural Language Interface**: Chat with agents using conversational AI powered by OpenAI
- **Real-time Data**: Integration with external APIs for live weather, financial data, and news
- **Modular Architecture**: Extensible agent system with easy-to-add new capabilities
- **Responsive UI**: Modern web interface with agent overview and detailed interactions

## Project Structure

This project implements a multi-agent system where users interact with specialized AI agents through a web interface. Each agent has access to tools that provide real-time data and capabilities.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js App)                       │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                Components                                    │ │
│  │  ├─ Sidebar: Navigation between agents/chat/jobs           │ │
│  │  ├─ AgentsList: Collapsible sidebar with agent overview     │ │
│  │  ├─ AgentDetails: Card-based agent selection & details      │ │
│  │  ├─ ChatInterface: Conversational UI with agents            │ │
│  │  └─ JobsInterface: Task management and execution status     │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                API Routes                                    │ │
│  │  └─ /api/chat: Handles chat interactions                     │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Multi-Agent System)                │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                Orchestrator                                  │ │
│  │  └─ Coordinates agent selection and task routing           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                Agents                                        │ │
│  │  ├─ Weather Agent: Fetches live weather data               │ │
│  │  ├─ Search Agent: Performs intelligent web searches        │ │
│  │  ├─ Webpage Summarize Agent: Extracts and summarizes web    │ │
│  │  │                     content                               │ │
│  │  ├─ Stock Data Agent: Retrieves financial statements        │ │
│  │  ├─ News Scrape Agent: Gathers recent news articles         │ │
│  │  ├─ News Summary Agent: Analyzes news sentiment             │ │
│  │  ├─ Cosmetic Safe Check Agent: Analyzes product safety      │ │
│  │  └─ Ingredients Scrape Agent: Extracts product ingredients  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                Tools & Integrations                          │ │
│  │  ├─ LLM Integration: OpenAI GPT for response synthesis      │ │
│  │  ├─ WeatherAPI: Real-time weather data                      │ │
│  │  ├─ Session Store: In-memory conversation persistence       │ │
│  │  └─ External APIs: Various data sources for agents          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

#### Frontend
- **Next.js 15**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **Responsive Design**: Mobile-first approach with adaptive layouts

#### Backend
- **Agent Orchestrator**: Routes user requests to appropriate specialized agents
- **Tool Agents**: Individual agents with specific capabilities
- **Memory System**: Session-based conversation persistence
- **LLM Integration**: OpenAI API for intelligent response generation

#### Tools & APIs
- **OpenAI API**: Powers agent responses and intention detection
- **WeatherAPI**: Provides real-time weather data
- **Web Scraping**: For news, ingredients, and webpage content
- **Financial APIs**: Stock data and market information

## Getting Started

### Prerequisites

- Node.js 18+
- npm, yarn, pnpm, or bun
- OpenAI API key
- WeatherAPI key (optional, for weather agent)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd agentsplatform
```

2. Install dependencies:
```bash
npm install
# or
yarn install
# or
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

Edit `.env.local` and add your API keys:
```env
OPENAI_API_KEY=your_openai_api_key_here
WEATHERAPI_API_KEY=your_weather_api_key_here
```

4. Run the development server:
```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. **Select an Agent**: Use the sidebar to browse available agents or view the overview cards
2. **Chat**: Engage in natural language conversations with selected agents
3. **Tools**: Agents automatically use appropriate tools based on your requests
4. **Monitor**: Check the Jobs interface for task execution status

## Available Agents

- **Orchestrator Agent**: Coordinates complex multi-step tasks
- **Weather Agent**: Provides current and forecast weather information
- **Search Agent**: Performs intelligent web searches and summarization
- **Webpage Summarize Agent**: Extracts and condenses webpage content
- **Stock Data Agent**: Analyzes financial statements and market data
- **News Agents**: Scrape and summarize financial news
- **Cosmetic Analysis Agents**: Check product safety and ingredients

## Development

### Project Structure Details

```
/
├── src/
│   ├── app/                    # Next.js app directory
│   │   ├── components/         # React components
│   │   │   ├── AgentsList.tsx  # Agent selection sidebar
│   │   │   ├── AgentDetails.tsx # Agent overview & details
│   │   │   ├── ChatInterface.tsx # Chat UI
│   │   │   └── JobsInterface.tsx # Task management
│   │   ├── data/               # Static data
│   │   └── api/                # API routes
│   └── lib/                    # Shared utilities
│       └── agent-chat.ts       # Agent definitions & types
├── backend/
│   ├── agents/                 # Individual agent implementations
│   ├── orchestrator/           # Agent coordination logic
│   ├── memory/                 # Session management
│   └── llm/                    # LLM integrations
└── public/                     # Static assets
```

### Adding New Agents

1. Create agent file in `backend/agents/`
2. Implement `run[AgentName]Agent` function
3. Add to `TOOL_REGISTRY` in `toolAgents.ts`
4. Update agent data in `src/app/data/agents.ts`
5. Add UI components if needed

## API Keys

- **OPENAI_API_KEY**: Required for LLM responses
- **WEATHERAPI_API_KEY**: Required for weather agent functionality

## Technologies Used

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Backend**: Node.js, TypeScript
- **AI/ML**: OpenAI GPT API
- **APIs**: WeatherAPI, various financial/news APIs
- **Deployment**: Vercel-ready configuration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.
