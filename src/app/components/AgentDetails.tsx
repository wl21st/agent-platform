'use client';

import { Agent } from '../data/agents';

interface AgentDetailsProps {
  agent: Agent | null;
  agents: Agent[];
  onSelectAgent: (agent: Agent | null) => void;
}

function getRole(name: string): string {
  return name.split(' ')[0];
}

function getCardStyle(role: string): string {
  const styles: Record<string, string> = {
    'Orchestrator': 'bg-gradient-to-br from-purple-100 to-purple-200 dark:from-purple-900 dark:to-purple-800 border-purple-300 dark:border-purple-600',
    'Weather': 'bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900 dark:to-blue-800 border-blue-300 dark:border-blue-600',
    'Calculator': 'bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900 dark:to-green-800 border-green-300 dark:border-green-600',
    'Translation': 'bg-gradient-to-br from-yellow-100 to-yellow-200 dark:from-yellow-900 dark:to-yellow-800 border-yellow-300 dark:border-yellow-600',
    'Scheduler': 'bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900 dark:to-red-800 border-red-300 dark:border-red-600',
    'Search': 'bg-gradient-to-br from-indigo-100 to-indigo-200 dark:from-indigo-900 dark:to-indigo-800 border-indigo-300 dark:border-indigo-600',
    'Webpage': 'bg-gradient-to-br from-teal-100 to-teal-200 dark:from-teal-900 dark:to-teal-800 border-teal-300 dark:border-teal-600',
    'Cosmetic': 'bg-gradient-to-br from-pink-100 to-pink-200 dark:from-pink-900 dark:to-pink-800 border-pink-300 dark:border-pink-600',
    'Ingredients': 'bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-900 dark:to-orange-800 border-orange-300 dark:border-orange-600',
    'Stock': 'bg-gradient-to-br from-cyan-100 to-cyan-200 dark:from-cyan-900 dark:to-cyan-800 border-cyan-300 dark:border-cyan-600',
    'News': 'bg-gradient-to-br from-lime-100 to-lime-200 dark:from-lime-900 dark:to-lime-800 border-lime-300 dark:border-lime-600',
  };
  return styles[role] || 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 border-gray-300 dark:border-gray-600';
}

export default function AgentDetails({ agent, agents, onSelectAgent }: AgentDetailsProps) {
  if (!agent) {
    return (
      <div className="flex-1 bg-white dark:bg-gray-900 p-6 overflow-y-auto">
        <h2 className="text-2xl font-semibold mb-6 text-gray-800 dark:text-gray-200">Type of Agents</h2>
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-3 gap-8">
            {agents.map((agentItem) => (
              <div
                key={agentItem.id}
                onClick={() => onSelectAgent(agentItem)}
                className={`cursor-pointer p-8 rounded-lg shadow-md border transition-all hover:shadow-lg text-center min-h-48 flex flex-col justify-center ${getCardStyle(getRole(agentItem.name))}`}
              >
                <span className="text-4xl block mb-2">{agentItem.icon}</span>
                <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">{agentItem.name}</h3>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white dark:bg-gray-900 p-6 overflow-y-auto">
      <div className="max-w-2xl">
        <button
          onClick={() => onSelectAgent(null)}
          className="mb-4 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
        >
          ← Back to Agents Overview
        </button>
        <div className="flex items-center space-x-4 mb-6">
          <span className="text-4xl">{agent.icon}</span>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{agent.name}</h1>
            <p className="text-gray-600 dark:text-gray-400">Agent ID: {agent.id}</p>
          </div>
        </div>

        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-200">Description</h2>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{agent.description}</p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-200">Capabilities</h2>
          <div className="flex flex-wrap gap-2">
            {agent.capabilities.map((capability, index) => (
              <span
                key={index}
                className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-medium"
              >
                {capability}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}