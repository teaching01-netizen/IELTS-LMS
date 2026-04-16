import React from 'react';
import { Search, Filter, CheckSquare, Clock, AlertCircle, Play } from 'lucide-react';
import { Button } from '../ui/Button';

export function AdminGrading() {
  const gradingTasks = [
    { id: 'G-001', exam: 'Academic PT v3', task: 'Writing Task 2', student: 'Wei Zhang', submitted: '2h ago', status: 'Pending', priority: 'High' },
    { id: 'G-002', exam: 'Academic PT v3', task: 'Writing Task 1', student: 'Wei Zhang', submitted: '2h ago', status: 'Pending', priority: 'Medium' },
    { id: 'G-003', exam: 'GT Practice 5', task: 'Speaking Part 2', student: 'Maria Garcia', submitted: '5h ago', status: 'In Progress', priority: 'Medium' },
    { id: 'G-004', exam: 'Diagnostic Q1', task: 'Writing Task 2', student: 'John Smith', submitted: '1d ago', status: 'Pending', priority: 'High' },
    { id: 'G-005', exam: 'Diagnostic Q1', task: 'Writing Task 1', student: 'John Smith', submitted: '1d ago', status: 'Pending', priority: 'Medium' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Grading Queue</h1>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Search submissions..." 
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
            <Filter size={16} />
            Filter
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 font-medium">To Grade</p>
            <p className="text-2xl font-bold text-gray-900">47</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
            <CheckSquare size={20} />
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 font-medium">High Priority</p>
            <p className="text-2xl font-bold text-red-600">12</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
            <AlertCircle size={20} />
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 font-medium">Avg Turnaround</p>
            <p className="text-2xl font-bold text-gray-900">24h</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
            <Clock size={20} />
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between">
          <button className="w-full h-full flex items-center justify-center gap-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors">
            <Play size={18} />
            Start Grading Session
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                <th className="px-6 py-3 font-medium w-8">
                  <input type="checkbox" className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                </th>
                <th className="px-6 py-3 font-medium">Exam & Task</th>
                <th className="px-6 py-3 font-medium">Student</th>
                <th className="px-6 py-3 font-medium">Submitted</th>
                <th className="px-6 py-3 font-medium">Priority</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {gradingTasks.map((task) => (
                <tr key={task.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <input type="checkbox" className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{task.task}</p>
                    <p className="text-xs text-gray-500">{task.exam}</p>
                  </td>
                  <td className="px-6 py-4 text-gray-700">{task.student}</td>
                  <td className="px-6 py-4 text-gray-500">{task.submitted}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      task.priority === 'High' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {task.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      task.status === 'In Progress' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {task.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="secondary" size="sm">
                      Grade
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
