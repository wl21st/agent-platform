'use client';

import { Agent } from '../data/agents';

interface AgentDetailsProps {
  agent: Agent | null;
}

export default function AgentDetails({ agent }: AgentDetailsProps) {
  if (!agent) {
    return (
      <div className="flex-1 bg-white dark:bg-gray-900 p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🤖</div>
          <h2 className="text-2xl font-semibold text-gray-600 dark:text-gray-400 mb-2">
            Select an Agent
          </h2>
          <p className="text-gray-500 dark:text-gray-500">
            Choose an agent from the list to view its details
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white dark:bg-gray-900 p-6 overflow-y-auto">
      <div className="max-w-2xl">
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