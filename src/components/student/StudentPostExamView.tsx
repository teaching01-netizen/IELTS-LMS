import React from "react";
import { Button } from "../ui/Button";
import type { ExamType } from "../../types";
import type { StudentScoreSummary } from "../../types/studentAttempt";

interface StudentPostExamViewProps {
  examType?: ExamType | undefined;
  isProctorTerminated: boolean;
  proctorNote: string | null;
  studentInfo: Array<{ label: string; value: string }>;
  score?: StudentScoreSummary | undefined;
  onExit: () => void;
  finalSubmitOverlay: React.ReactNode;
}

export function StudentPostExamView({
  examType = "Academic",
  isProctorTerminated,
  proctorNote,
  studentInfo,
  score,
  onExit,
  finalSubmitOverlay,
}: StudentPostExamViewProps) {
  const examLabel = examType === "ACT" ? "ACT" : "IELTS";

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-gray-50 p-4 font-sans text-gray-900">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <main id="main-content" role="main" className="flex flex-col items-center justify-center">
        <div className="bg-white p-6 md:p-8 rounded-lg shadow-md max-w-2xl w-full text-center">
          <h1 className="text-3xl font-bold mb-4">
            {isProctorTerminated ? "Session terminated" : `${examLabel} Examination Complete!`}
          </h1>
          {isProctorTerminated ? (
            <div className="text-gray-600 mb-8 space-y-3">
              <p>Your session was terminated by the proctor.</p>
              {proctorNote ? <p className="text-gray-700">{proctorNote}</p> : null}
            </div>
          ) : (
            <p className="text-gray-600 mb-8">
              Congratulations! You have completed the {examLabel} examination.
            </p>
          )}

          {studentInfo.length > 0 ? (
            <div className="mb-8 rounded-sm border border-gray-200 bg-gray-50 p-4 text-left">
              <div className="grid gap-3 sm:grid-cols-2">
                {studentInfo.map((item) => (
                  <div key={item.label}>
                    <p className="text-[length:var(--student-meta-font-size)] font-bold uppercase tracking-[0.2em] text-gray-500">
                      {item.label}
                    </p>
                    <p className="mt-1 break-words text-sm font-semibold text-gray-900">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {examType === "ACT" && score ? (
            <div className="mb-8 rounded-sm border border-violet-200 bg-violet-50 p-5 text-left">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-700">
                Science Score
              </p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <p className="text-3xl font-black text-gray-900">
                  {score.correctCount}/{score.totalQuestions}
                </p>
                <p className="text-2xl font-bold text-violet-700">{score.percentage.toFixed(2)}%</p>
              </div>
            </div>
          ) : null}
          <Button onClick={onExit}>Exit Exam Platform</Button>
        </div>
      </main>
      {finalSubmitOverlay}
    </div>
  );
}
