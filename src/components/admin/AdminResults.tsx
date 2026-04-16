import React from 'react';
import { Search, Filter, Download, BarChart2, TrendingUp, Users } from 'lucide-react';

export function AdminResults() {
  const results = [
    { id: 'R-001', student: 'Wei Zhang', cohort: 'Spring 2024 Intake', exam: 'Academic PT v3', date: 'Jan 15, 2025', overall: 7.5, l: 8.0, r: 7.5, w: 7.0, s: 7.5 },
    { id: 'R-002', student: 'Maria Garcia', cohort: 'Spring 2024 Intake', exam: 'Academic PT v3', date: 'Jan 15, 2025', overall: 6.5, l: 7.0, r: 6.5, w: 6.0, s: 6.5 },
    { id: 'R-003', student: 'John Smith', cohort: 'Spring 2024 Intake', exam: 'Academic PT v3', date: 'Jan 15, 2025', overall: 6.5, l: 6.5, r: 6.5, w: 6.5, s: 6.5 },
    { id: 'R-004', student: 'Priya Sharma', cohort: 'Evening Batch', exam: 'GT Practice 5', date: 'Jan 14, 2025', overall: 6.0, l: 6.5, r: 6.0, w: 5.5, s: 6.0 },
    { id: 'R-005', student: 'Tom Wilson', cohort: 'Evening Batch', exam: 'GT Practice 5', date: 'Jan 14, 2025', overall: 7.0, l: 7.5, r: 7.0, w: 6.5, s: 7.0 },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Results & Analytics</h1>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Search results..." 
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
            <Filter size={16} />
            Filter
          </button>
          <button className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-md font-medium transition-colors">
            <Download size={18} />
            Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><BarChart2 size={20} /></div>
            <h3 className="font-medium text-gray-700">Avg Overall Band</h3>
          </div>
          <div className="flex items-end gap-3">
            <p className="text-3xl font-bold text-gray-900">6.4</p>
            <p className="text-sm text-emerald-600 font-medium mb-1 flex items-center"><TrendingUp size={14} className="mr-1"/> +0.2 this month</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg"><Users size={20} /></div>
            <h3 className="font-medium text-gray-700">Pass Rate (6.5+)</h3>
          </div>
          <div className="flex items-end gap-3">
            <p className="text-3xl font-bold text-gray-900">68%</p>
            <p className="text-sm text-emerald-600 font-medium mb-1 flex items-center"><TrendingUp size={14} className="mr-1"/> +5% this month</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><TrendingUp size={20} /></div>
            <h3 className="font-medium text-gray-700">Total Completions</h3>
          </div>
          <p className="text-3xl font-bold text-gray-900">1,248</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Recent Results</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                <th className="px-6 py-3 font-medium">Student</th>
                <th className="px-6 py-3 font-medium">Cohort</th>
                <th className="px-6 py-3 font-medium">Exam</th>
                <th className="px-6 py-3 font-medium">Date</th>
                <th className="px-6 py-3 font-medium text-center">L</th>
                <th className="px-6 py-3 font-medium text-center">R</th>
                <th className="px-6 py-3 font-medium text-center">W</th>
                <th className="px-6 py-3 font-medium text-center">S</th>
                <th className="px-6 py-3 font-medium text-center">Overall</th>
                <th className="px-6 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {results.map((result) => (
                <tr key={result.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{result.student}</td>
                  <td className="px-6 py-4 text-gray-500">{result.cohort}</td>
                  <td className="px-6 py-4 text-gray-700">{result.exam}</td>
                  <td className="px-6 py-4 text-gray-500">{result.date}</td>
                  <td className="px-6 py-4 text-center font-medium">{result.l.toFixed(1)}</td>
                  <td className="px-6 py-4 text-center font-medium">{result.r.toFixed(1)}</td>
                  <td className="px-6 py-4 text-center font-medium">{result.w.toFixed(1)}</td>
                  <td className="px-6 py-4 text-center font-medium">{result.s.toFixed(1)}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold text-lg ${
                      result.overall >= 7.0 ? 'bg-emerald-100 text-emerald-700' :
                      result.overall >= 6.0 ? 'bg-blue-100 text-blue-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {result.overall.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-blue-600 hover:text-blue-800 font-medium text-sm">
                      View Report
                    </button>
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
