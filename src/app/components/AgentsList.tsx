'use client';

import { Agent } from '../data/agents';

function getRole(name: string): string {
  return name.split(' ')[0];
}

interface AgentsListProps {
  agents: Agent[];
  selectedAgent: Agent | null;
  onSelectAgent: (agent: Agent | null) => void;
  onDeselect: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export default function AgentsList({ agents, selectedAgent, onSelectAgent, onDeselect, isOpen, onToggle }: AgentsListProps) {
  const sortedAgents = agents.sort((a, b) => a.name.localeCompare(b.name));

  if (!isOpen) {
    return (
      <div className="hidden md:block w-12 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
        <div className="pt-20 pb-4 flex justify-center">
          <button
            onClick={onToggle}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
            title="Open Agents List"
          >
            ➡️
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hidden md:block w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
      <div className="px-4 pt-20 pb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400" onClick={onDeselect}>Agents Overview</h2>
          <button
            onClick={onToggle}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
            title="Close Sidebar"
          >
            ⬅️
          </button>
        </div>
        <div className="space-y-1">
          {sortedAgents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent)}
              className={`w-full text-left p-2 rounded-lg transition-colors ${
                selectedAgent?.id === agent.id
                  ? 'bg-blue-100 dark:bg-blue-900 border-blue-300 dark:border-blue-600'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800 border-transparent'
              } border`}
            >
              <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{agent.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}