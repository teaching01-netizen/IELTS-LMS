import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart2, LoaderCircle, Search, Users } from 'lucide-react';
import { gradingRepository, gradingService } from '../../features/grading/infrastructure/gradingGateway';
import type { ActScienceScoreReport, StudentResult } from '../../types/grading';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function matchesSearch(search: string, values: string[]): boolean {
  const query = search.trim().toLowerCase();
  return !query || values.join(' ').toLowerCase().includes(query);
}

export function AdminResults() {
  const [ieltsResults, setIeltsResults] = useState<StudentResult[]>([]);
  const [actReports, setActReports] = useState<ActScienceScoreReport[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let active = true;

    void Promise.allSettled([
      gradingRepository.getAllStudentResults(),
      gradingService.getActScienceReports(),
    ]).then(([ieltsResult, actResult]) => {
      if (!active) return;

      const nextErrors: string[] = [];
      if (ieltsResult.status === 'fulfilled') {
        setIeltsResults(ieltsResult.value);
      } else {
        nextErrors.push(`Unable to load IELTS results: ${ieltsResult.reason}`);
      }

      if (actResult.status === 'fulfilled' && actResult.value.success) {
        setActReports(actResult.value.data ?? []);
      } else if (actResult.status === 'fulfilled') {
        nextErrors.push(actResult.value.error ?? 'Unable to load ACT Science reports.');
      } else {
        nextErrors.push(`Unable to load ACT Science reports: ${actResult.reason}`);
      }

      setErrors(nextErrors);
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const filteredIeltsResults = useMemo(
    () => ieltsResults.filter((result) => matchesSearch(search, [result.studentName, 'IELTS'])),
    [ieltsResults, search],
  );
  const filteredActReports = useMemo(
    () =>
      actReports.filter((report) =>
        matchesSearch(search, [report.studentName, report.cohortName, report.examTitle, 'ACT Science']),
      ),
    [actReports, search],
  );

  const averageActPercentage = actReports.length
    ? actReports.reduce((sum, report) => sum + report.score.percentage, 0) / actReports.length
    : 0;
  const publishedQuestionCount = actReports.reduce(
    (maximum, report) => Math.max(maximum, report.score.totalQuestions),
    0,
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Results &amp; Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">IELTS results and ACT Science submissions from backend grading</p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search results..."
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><BarChart2 size={20} /></div>
            <h3 className="font-medium text-gray-700">IELTS Results</h3>
          </div>
          <p className="text-3xl font-bold text-gray-900">{ieltsResults.length}</p>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg"><Users size={20} /></div>
            <h3 className="font-medium text-gray-700">ACT Science Submissions</h3>
          </div>
          <p className="text-3xl font-bold text-gray-900">{actReports.length}</p>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><BarChart2 size={20} /></div>
            <h3 className="font-medium text-gray-700">Average ACT Percentage</h3>
          </div>
          <p className="text-3xl font-bold text-gray-900">{averageActPercentage.toFixed(2)}%</p>
          <p className="text-xs text-gray-500 mt-1">Max published questions: {publishedQuestionCount}</p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 space-y-1">
          {errors.map((error) => (
            <p key={error} className="flex items-center gap-2"><AlertCircle size={16} />{error}</p>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-12 text-center text-gray-500 flex items-center justify-center gap-2">
          <LoaderCircle className="animate-spin" size={18} /> Loading results...
        </div>
      ) : (
        <>
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">IELTS Results</h2>
            </div>
            {filteredIeltsResults.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-500">No IELTS results found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                      <th className="px-6 py-3 font-medium">Student</th>
                      <th className="px-6 py-3 font-medium">Updated</th>
                      <th className="px-6 py-3 font-medium text-center">L</th>
                      <th className="px-6 py-3 font-medium text-center">R</th>
                      <th className="px-6 py-3 font-medium text-center">W</th>
                      <th className="px-6 py-3 font-medium text-center">S</th>
                      <th className="px-6 py-3 font-medium text-center">Overall</th>
                      <th className="px-6 py-3 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 text-sm">
                    {filteredIeltsResults.map((result) => (
                      <tr key={result.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 font-medium text-gray-900">{result.studentName}</td>
                        <td className="px-6 py-4 text-gray-500">{formatDate(result.updatedAt)}</td>
                        <td className="px-6 py-4 text-center font-medium">{result.sectionBands.listening.toFixed(1)}</td>
                        <td className="px-6 py-4 text-center font-medium">{result.sectionBands.reading.toFixed(1)}</td>
                        <td className="px-6 py-4 text-center font-medium">{result.sectionBands.writing.toFixed(1)}</td>
                        <td className="px-6 py-4 text-center font-medium">{result.sectionBands.speaking.toFixed(1)}</td>
                        <td className="px-6 py-4 text-center font-semibold">{result.overallBand.toFixed(1)}</td>
                        <td className="px-6 py-4 text-right text-gray-600">{result.releaseStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">ACT Science Reports</h2>
            </div>
            {filteredActReports.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-500">No ACT Science submissions found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                      <th className="px-6 py-3 font-medium">Student</th>
                      <th className="px-6 py-3 font-medium">Cohort</th>
                      <th className="px-6 py-3 font-medium">Exam</th>
                      <th className="px-6 py-3 font-medium">Submitted</th>
                      <th className="px-6 py-3 font-medium text-center">Raw Score</th>
                      <th className="px-6 py-3 font-medium text-center">Percentage</th>
                      <th className="px-6 py-3 font-medium text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 text-sm">
                    {filteredActReports.map((report) => (
                      <tr key={report.submissionId} className="hover:bg-gray-50">
                        <td className="px-6 py-4 font-medium text-gray-900">{report.studentName}</td>
                        <td className="px-6 py-4 text-gray-500">{report.cohortName}</td>
                        <td className="px-6 py-4 text-gray-700">{report.examTitle}</td>
                        <td className="px-6 py-4 text-gray-500">{formatDate(report.submittedAt)}</td>
                        <td className="px-6 py-4 text-center font-semibold text-gray-900">
                          {report.score.correctCount}/{report.score.totalQuestions}
                        </td>
                        <td className="px-6 py-4 text-center font-semibold text-blue-700">
                          {report.score.percentage.toFixed(2)}%
                        </td>
                        <td className="px-6 py-4 text-right text-gray-600">{report.gradingStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
