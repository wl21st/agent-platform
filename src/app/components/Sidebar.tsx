'use client';

type View = 'agents' | 'chat' | 'jobs';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

const NAV_ITEMS: { view: View; icon: string; title: string }[] = [
  { view: 'agents', icon: '🤖', title: 'Agents' },
  { view: 'chat', icon: '💬', title: 'Chat' },
  { view: 'jobs', icon: '⚙️', title: 'Jobs' },
];

export default function Sidebar({ currentView, onViewChange }: SidebarProps) {
  return (
    <>
      {/* Mobile: fixed bottom navigation bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 h-16 z-20 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center justify-around px-4">
        {NAV_ITEMS.map(({ view, icon, title }) => (
          <button
            key={view}
            onClick={() => onViewChange(view)}
            className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-colors ${
              currentView === view
                ? 'text-blue-500'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
            title={title}
          >
            <span className="text-xl leading-none">{icon}</span>
            <span className="text-[10px] font-medium">{title}</span>
          </button>
        ))}
      </nav>

      {/* Desktop (sm+): fixed left sidebar */}
      <nav className="hidden sm:flex fixed left-0 top-0 w-16 h-screen z-20 bg-gray-100 dark:bg-gray-800 flex-col items-center py-4 space-y-4">
        {NAV_ITEMS.map(({ view, icon, title }) => (
          <button
            key={view}
            onClick={() => onViewChange(view)}
            className={`p-3 rounded-lg transition-colors ${
              currentView === view
                ? 'bg-blue-500 text-white'
                : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
            }`}
            title={title}
          >
            {icon}
          </button>
        ))}
      </nav>
    </>
  );
}
