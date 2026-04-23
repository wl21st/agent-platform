# Multi-Agent Platform

A modern multi-agent system built with Next.js, featuring **true parallel execution** of intelligent agents. Users can request multiple independent tasks simultaneously (e.g., "summarize this webpage and get the weather"), with agents executing concurrently for optimal performance. Built with advanced LLM orchestration for intelligent intent detection and response synthesis.

## Features

- **True Parallel Agent Execution**: Multiple independent agents execute concurrently for optimal performance
- **Intelligent Multi-Intent Detection**: Automatically detects when to run tasks in parallel vs. sequential
- **Intelligent Agents**: Specialized agents for weather, search, webpage summarization, financial data, news, and more
- **Natural Language Interface**: Chat with agents using conversational AI powered by OpenAI
- **Real-time Data**: Integration with external APIs for live weather, financial data, and news
- **Modular Architecture**: Extensible agent system with easy-to-add new capabilities
- **Responsive UI**: Modern web interface with agent overview and detailed interactions
- **Live Task Streaming**: Real-time progress updates as agents complete tasks

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

## Parallel Agent Execution

This platform features **true parallel execution** of multiple independent agents, enabling users to request multiple tasks simultaneously for optimal performance. When a user asks for multiple unrelated things (e.g., "summarize this webpage and get the weather in Tokyo"), the system detects independent intents and executes all agents concurrently.

### Parallel Processing Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│               User Query: Multi-Intent Detection                │
│   "Summarize https://example.com and get weather in Tokyo"      │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              LLM Intent Classification                          │
│  Detects 2 independent intents:                                │
│  • webpage-summarize (url: https://example.com)               │
│  • weather (location: Tokyo, timeframe: current)              │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              Parallel Agent Execution                          │
│                                                                 │
│    ┌─────────────────┐    ┌─────────────────┐                   │
│    │ Webpage Agent   │    │  Weather Agent  │                   │
│    │ (1.5s network)  │    │  (0.4s network) │                   │
│    │                 │    │                  │                   │
│    │ ├─ Scrape HTML  │    │ ├─ API call      │                   │
│    │ ├─ Extract text │    │ ├─ Parse JSON    │                   │
│    │ └─ Generate     │    │ └─ Format        │                   │
│    │    summary      │    │    response      │                   │
│    └─────────────────┘    └─────────────────┘                   │
│           │                       │                             │
│           └─────────┬─────────────┘                             │
│                     ▼                                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │        Task Status Updates (Live Streaming)             │   │
│   │  • Webpage Summarize Agent: Running → Completed (1.5s)  │   │
│   │  • Weather Agent: Running → Completed (0.4s)            │   │
│   └─────────────────────────────────────────────────────────┘   │
│                     │                                           │
│                     ▼                                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │        LLM Response Synthesis                           │   │
│   │  Combines all agent results into single numbered reply   │   │
│   │  (1., 2., 3.) with clear section titles and formatting    │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Benefits

- **Reduced Latency**: Total response time equals the slowest agent, not the sum
- **Independent Failures**: One agent failure doesn't block others
- **Live Progress**: Task status updates stream in real-time as agents complete
- **Intelligent Merging**: LLM synthesizes multiple results into a single, coherent response
- **Automatic Detection**: System automatically detects when tasks can run in parallel vs. sequential

### Examples

**Parallel (Independent Tasks):**
- "Summarize https://example.com and get the weather in Paris"
- "Check AAPL stock data and search for latest AI news"
- "Get news for TSLA and analyze cosmetic ingredients from this URL"

**Sequential (Dependent Tasks):**
- "Scrape ingredients from this URL and check their safety" → Single ingredients-scrape agent
- "Get news about AAPL and summarize the sentiment" → Single news-summary agent

### Technical Implementation

- **Promise.all()**: Concurrent agent execution via JavaScript promises
- **Completion-Order Streaming**: Results stream as they finish, not start order
- **LLM Intent Detection**: Advanced prompt engineering detects independent vs. dependent tasks
- **Response Merging**: Specialized LLM prompt combines parallel results into numbered sections (1., 2., 3.) with clear titles

### Key Components

#### Frontend
- **Next.js 15**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **Responsive Design**: Mobile-first approach with adaptive layouts

#### Backend
- **Agent Orchestrator**: Routes user requests to appropriate specialized agents with parallel execution support
- **Tool Agents**: Individual agents with specific capabilities, executing concurrently when independent
- **Parallel Workflow Engine**: Promise.all()-based concurrent execution with completion-order streaming
- **LLM Intent Classification**: Advanced multi-intent detection for automatic parallel vs. sequential routing
- **Response Synthesis**: Intelligent merging of parallel agent results into cohesive replies
- **Memory System**: Session-based conversation persistence
- **LLM Integration**: OpenAI API for intelligent response generation and result merging

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
