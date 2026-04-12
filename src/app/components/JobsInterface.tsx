'use client';

import { useState, useMemo } from 'react';

interface Job {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'pending';
  progress: number;
  startTimeLabel: string;
  description: string;
  agent?: string;
}

const INITIAL_JOBS: Job[] = [
  {
    id: '1',
    name: 'Weather Data Fetch',
    status: 'running',
    progress: 65,
    startTimeLabel: '5 minutes ago',
    description: 'Fetching weather data for multiple locations',
    agent: 'Weather Agent'
  },
  {
    id: '2',
    name: 'Translation Task',
    status: 'completed',
    progress: 100,
    startTimeLabel: '10 minutes ago',
    description: 'Translating documents from English to Spanish',
    agent: 'Translation Agent'
  },
  {
    id: '3',
    name: 'Data Analysis',
    status: 'failed',
    progress: 30,
    startTimeLabel: '15 minutes ago',
    description: 'Analyzing sales data and generating reports',
    agent: 'Search Agent'
  },
  {
    id: '4',
    name: 'Schedule Optimization',
    status: 'pending',
    progress: 0,
    startTimeLabel: '20 minutes ago',
    description: 'Optimizing appointment schedules',
    agent: 'Scheduler Agent'
  }
];

export default function JobsInterface() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');

  const [jobs] = useState<Job[]>(INITIAL_JOBS);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-blue-600 bg-blue-100';
      case 'completed': return 'text-green-600 bg-green-100';
      case 'failed': return 'text-red-600 bg-red-100';
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      const statusMatch = statusFilter === 'all' || job.status === statusFilter;
      const agentMatch = agentFilter === 'all' || job.agent === agentFilter;
      return statusMatch && agentMatch;
    });
  }, [jobs, statusFilter, agentFilter]);

  const filteredActiveJobs = useMemo(() => {
    return jobs.filter(job => job.status === 'running' && (agentFilter === 'all' || job.agent === agentFilter));
  }, [jobs, agentFilter]);

  const otherJobs = useMemo(() => {
    return filteredJobs.filter(job => job.status !== 'running');
  }, [filteredJobs]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return '🔄';
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'pending': return '⏳';
      default: return '❓';
    }
  };

  return (
    <div className="flex-1 bg-white dark:bg-gray-900 p-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-6">Background Jobs</h1>

        {/* Filter Controls */}
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg mb-6">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="all">All Status</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Agent
              </label>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="all">All Agents</option>
                <option value="Weather Agent">Weather Agent</option>
                <option value="Calculator Agent">Calculator Agent</option>
                <option value="Translation Agent">Translation Agent</option>
                <option value="Scheduler Agent">Scheduler Agent</option>
                <option value="Search Agent">Search Agent</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Active Tasks Column */}
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Active Tasks</h2>
            <div className="space-y-4">
              {filteredActiveJobs.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No active tasks.
                </div>
              ) : (
                filteredActiveJobs.map(job => (
                  <div key={job.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <span className="text-2xl">{getStatusIcon(job.status)}</span>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{job.name}</h3>
                          {job.agent && (
                            <p className="text-sm text-gray-600 dark:text-gray-400">Agent: {job.agent}</p>
                          )}
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(job.status)}`}>
                        {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                      </span>
                    </div>

                    <p className="text-gray-700 dark:text-gray-300 mb-4">{job.description}</p>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                        <span>Progress</span>
                        <span>{job.progress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            job.status === 'completed' ? 'bg-green-500' :
                            job.status === 'failed' ? 'bg-red-500' :
                            job.status === 'running' ? 'bg-blue-500' : 'bg-gray-400'
                          }`}
                          style={{ width: `${job.progress}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                      Started: {job.startTimeLabel}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Other Tasks Column */}
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Other Tasks</h2>
            <div className="space-y-4">
              {otherJobs.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No other tasks match the current filters.
                </div>
              ) : (
                otherJobs.map(job => (
                  <div key={job.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <span className="text-2xl">{getStatusIcon(job.status)}</span>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{job.name}</h3>
                          {job.agent && (
                            <p className="text-sm text-gray-600 dark:text-gray-400">Agent: {job.agent}</p>
                          )}
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(job.status)}`}>
                        {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                      </span>
                    </div>

                    <p className="text-gray-700 dark:text-gray-300 mb-4">{job.description}</p>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                        <span>Progress</span>
                        <span>{job.progress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            job.status === 'completed' ? 'bg-green-500' :
                            job.status === 'failed' ? 'bg-red-500' :
                            job.status === 'running' ? 'bg-blue-500' : 'bg-gray-400'
                          }`}
                          style={{ width: `${job.progress}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                      Started: {job.startTimeLabel}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
