import React from 'react';

/**
 * Phase 04 ACT reconciliation: provider-aware completion copy.
 * The default (omitted) provider preserves the exact IELTS strings so
 * existing IELTS surfaces do not regress; "act" renders ACT Science copy.
 */
export type StudentPostExamProvider = "ielts" | "sat" | "act";

interface StudentPostExamViewProps {
  isProctorTerminated: boolean;
  proctorNote: string | null;
  studentInfo: Array<{ label: string; value: string }>;
  onExit: () => void;
  finalSubmitOverlay: React.ReactNode;
  provider?: StudentPostExamProvider | undefined;
}

export function StudentPostExamView({
  isProctorTerminated,
  proctorNote,
  studentInfo,
  finalSubmitOverlay,
  provider = "ielts",
}: StudentPostExamViewProps) {
  const completionHeading =
    provider === "act" ? "ACT Science Complete!" : provider === "sat" ? "SAT Complete!" : "IELTS Examination Complete!";
  const completionBody =
    provider === "act"
      ? "Congratulations! You have completed the ACT Science section. Your answers were submitted for server scoring."
      : provider === "sat"
        ? "Congratulations! You have completed all modules of the SAT."
        : "Congratulations! You have completed all modules of the IELTS examination.";
  return (
    <div className="flex min-h-screen min-h-[100dvh] w-full flex-col items-center justify-center bg-gray-50 p-4 font-sans text-gray-900">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <main id="main-content" role="main" className="flex w-full max-w-5xl flex-col items-center justify-center">
        <div className="w-full rounded-lg bg-white p-6 text-center shadow-md md:p-8">
          <h1 className="text-3xl font-bold mb-4">
            {isProctorTerminated ? 'Session terminated' : completionHeading}
          </h1>
          {isProctorTerminated ? (
            <div className="text-gray-600 mb-8 space-y-3">
              <p>Your session was terminated by the proctor.</p>
              {proctorNote ? (
                <p className="text-gray-700">{proctorNote}</p>
              ) : null}
            </div>
          ) : (
            <div className="mb-8 space-y-3 text-gray-600">
              <p>{completionBody}</p>
              <p>You may now close this tab.</p>
            </div>
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
        </div>
      </main>
      {finalSubmitOverlay}
    </div>
  );
}
