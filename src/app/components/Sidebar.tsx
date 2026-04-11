'use client';

type View = 'agents' | 'chat' | 'jobs';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

export default function Sidebar({ currentView, onViewChange }: SidebarProps) {
  return (
    <div className="w-16 bg-gray-100 dark:bg-gray-800 h-screen flex flex-col items-center py-4 space-y-4">
      <button
        onClick={() => onViewChange('agents')}
        className={`p-3 rounded-lg transition-colors ${
          currentView === 'agents'
            ? 'bg-blue-500 text-white'
            : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
        }`}
        title="Agents"
      >
        🤖
      </button>
      <button
        onClick={() => onViewChange('chat')}
        className={`p-3 rounded-lg transition-colors ${
          currentView === 'chat'
            ? 'bg-blue-500 text-white'
            : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
        }`}
        title="Chat"
      >
        💬
      </button>
      <button
        onClick={() => onViewChange('jobs')}
        className={`p-3 rounded-lg transition-colors ${
          currentView === 'jobs'
            ? 'bg-blue-500 text-white'
            : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
        }`}
        title="Jobs"
      >
        ⚙️
      </button>
    </div>
  );
}
