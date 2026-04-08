'use client';

import { useState } from 'react';
import Sidebar from './components/Sidebar';
import AgentsList from './components/AgentsList';
import AgentDetails from './components/AgentDetails';
import ChatInterface from './components/ChatInterface';
import JobsInterface from './components/JobsInterface';
import { agents, Agent } from './data/agents';

type View = 'agents' | 'chat' | 'jobs';

export default function Home() {
  const [currentView, setCurrentView] = useState<View>('agents');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const handleViewChange = (view: View) => {
    setCurrentView(view);
    if (view === 'chat') {
      setSelectedAgent(null);
    }
  };

  const handleSelectAgent = (agent: Agent) => {
    setSelectedAgent(agent);
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <Sidebar currentView={currentView} onViewChange={handleViewChange} />

      {/* Main Content */}
      <div className="flex flex-1">
        {/* Agents List - Middle Column (only shown when agents view is active) */}
        {currentView === 'agents' && (
          <AgentsList
            agents={agents}
            selectedAgent={selectedAgent}
            onSelectAgent={handleSelectAgent}
          />
        )}

        {/* Right Column - Agent Details, Chat, or Jobs */}
        {currentView === 'agents' ? (
          <AgentDetails agent={selectedAgent} />
        ) : currentView === 'chat' ? (
          <ChatInterface />
        ) : (
          <JobsInterface />
        )}
      </div>
    </div>
  );
}
