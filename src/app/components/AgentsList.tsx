'use client';

import { Agent } from '../data/agents';

interface AgentsListProps {
  agents: Agent[];
  selectedAgent: Agent | null;
  onSelectAgent: (agent: Agent) => void;
}

export default function AgentsList({ agents, selectedAgent, onSelectAgent }: AgentsListProps) {
  return (
    <div className="w-80 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
      <div className="p-4">
        <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-gray-200">Agents List</h2>
        <div className="space-y-2">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent)}
              className={`w-full text-left p-3 rounded-lg transition-colors ${
                selectedAgent?.id === agent.id
                  ? 'bg-blue-100 dark:bg-blue-900 border-blue-300 dark:border-blue-600'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800 border-transparent'
              } border`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{agent.icon}</span>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{agent.name}</h3>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}