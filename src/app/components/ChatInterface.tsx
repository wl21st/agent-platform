'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { agents } from '../data/agents';

interface DropdownMenuProps {
  onStartNewConversation: () => void;
  onClearHistory: () => void;
}

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  agent?: {
    name: string;
    icon: string;
  };
}

interface Task {
  id: string;
  description: string;
  completed: boolean;
}

function DropdownMenu({ onStartNewConversation, onClearHistory }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
        title="Chat options"
      >
        ⋮
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-10">
          <button
            onClick={() => {
              onStartNewConversation();
              setIsOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t-md"
          >
            Start New Conversation
          </button>
          <button
            onClick={() => {
              onClearHistory();
              setIsOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Clear History
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-b-md"
          >
            View History
          </button>
        </div>
      )}
    </div>
  );
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'Hello! I\'m here to help you with various tasks. What would you like to do?',
      isUser: false,
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [tasks, setTasks] = useState<Task[]>([
    { id: '1', description: 'Get weather for New York', completed: false },
    { id: '2', description: 'Calculate 15 * 23', completed: true },
    { id: '3', description: 'Translate "Hello" to Spanish', completed: false }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputValue,
      isUser: true,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');

    // Simulate bot response with agent selection
    setTimeout(() => {
      const selectedAgent = agents[Math.floor(Math.random() * agents.length)];
      let responseText = '';

      // Generate different responses based on the agent
      switch (selectedAgent.id) {
        case 'getweather':
          responseText = `# Weather Report\n\n**Current Conditions:** Sunny, 72°F\n\n**Forecast:**\n- Today: Mostly sunny, high 75°F\n- Tomorrow: Partly cloudy, high 68°F\n\n*Data provided by Weather Agent*`;
          break;
        case 'calculator':
          responseText = `# Calculation Result\n\n**Expression:** 15 × 23\n\n**Result:** 345\n\n**Additional Operations:**\n- 15 + 23 = 38\n- 15 ÷ 23 ≈ 0.652\n\n*Processed by Calculator Agent*`;
          break;
        case 'translator':
          responseText = `# Translation Complete\n\n**Original:** Hello, how are you?\n\n**Translated to Spanish:** Hola, ¿cómo estás?\n\n**Pronunciation:** /ˈola ˌkoˈmo esˈtas/\n\n*Translated by Translation Agent*`;
          break;
        case 'scheduler':
          responseText = `# Schedule Updated\n\n✅ **Appointment Booked:**\n- **Date:** Tomorrow at 2:00 PM\n- **Duration:** 1 hour\n- **Location:** Conference Room A\n\n📅 **Your Schedule:**\n- 9:00 AM: Team Meeting\n- 2:00 PM: New Appointment\n- 4:00 PM: Project Review\n\n*Managed by Scheduler Agent*`;
          break;
        case 'search':
          responseText = `# Search Results\n\n**Query:** Latest AI developments\n\n🔍 **Top Results:**\n1. **GPT-4 Release** - New language model with enhanced capabilities\n2. **Neural Networks** - Breakthrough in machine learning\n3. **AI Ethics** - Guidelines for responsible AI development\n\n📊 **Summary:** The field of AI continues to evolve rapidly with new models and applications emerging regularly.\n\n*Researched by Search Agent*`;
          break;
        default:
          responseText = `I received your message: "${userMessage.text}". This is a demo response from the system.`;
      }

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: responseText,
        isUser: false,
        timestamp: new Date(),
        agent: {
          name: selectedAgent.name,
          icon: selectedAgent.icon
        }
      };
      setMessages(prev => [...prev, botMessage]);
    }, 1000);
  };

  const toggleTaskCompletion = (taskId: string) => {
    setTasks(prev => prev.map(task =>
      task.id === taskId ? { ...task, completed: !task.completed } : task
    ));
  };

  const handleNewChat = () => {
    setMessages([
      {
        id: Date.now().toString(),
        text: 'Hello! I\'m here to help you with various tasks. What would you like to do?',
        isUser: false,
        timestamp: new Date()
      }
    ]);
    setTasks([
      { id: '1', description: 'Get weather for New York', completed: false },
      { id: '2', description: 'Calculate 15 * 23', completed: false },
      { id: '3', description: 'Translate "Hello" to Spanish', completed: false }
    ]);
  };

  return (
    <div className="flex-1 bg-white dark:bg-gray-900 flex flex-col">
      {/* Header with Dropdown Menu */}
      <div className="bg-gray-50 dark:bg-gray-800 p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200">Chat</h3>
        <DropdownMenu
          onStartNewConversation={handleNewChat}
          onClearHistory={() => setMessages([])}
        />
      </div>

      {/* Tasks Status Bar */}
      <div className="bg-gray-50 dark:bg-gray-800 p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-2">Active Tasks</h3>
        <div className="space-y-2">
          {tasks.map(task => (
            <div key={task.id} className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={task.completed}
                onChange={() => toggleTaskCompletion(task.id)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className={`text-sm ${task.completed ? 'line-through text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                {task.description}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                message.isUser
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              }`}
            >
              {!message.isUser && message.agent && (
                <div className="flex items-center space-x-2 mb-2 pb-2 border-b border-gray-200 dark:border-gray-600">
                  <span className="text-lg">{message.agent.icon}</span>
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    {message.agent.name}
                  </span>
                </div>
              )}
              <div className="text-sm">
                {message.isUser ? (
                  <p>{message.text}</p>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown
                      components={{
                        h1: ({children}) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
                        h2: ({children}) => <h2 className="text-base font-semibold mb-1">{children}</h2>,
                        p: ({children}) => <p className="mb-2">{children}</p>,
                        ul: ({children}) => <ul className="list-disc list-inside mb-2">{children}</ul>,
                        ol: ({children}) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
                        li: ({children}) => <li className="mb-1">{children}</li>,
                        strong: ({children}) => <strong className="font-semibold">{children}</strong>,
                        em: ({children}) => <em className="italic">{children}</em>,
                        code: ({children}) => <code className="bg-gray-200 dark:bg-gray-600 px-1 py-0.5 rounded text-xs">{children}</code>,
                      }}
                    >
                      {message.text}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
              <p className="text-xs opacity-70 mt-1">
                {message.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-4">
        <div className="flex space-x-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Type your message..."
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
          <button
            onClick={handleSendMessage}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}