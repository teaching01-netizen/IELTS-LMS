import React from 'react';
import { ProtectedInput } from './ProtectedInput';
import { StudentQuestionText } from './StudentQuestionText';
import { StudentQuestionNumber } from './StudentQuestionNumber';
import type { StudentHighlightColor } from './highlightPalette';

export type TableCompletionSlotCellProps = {
  slotId: string;
  highlightSurfaceIdPrefix: string;
  isActive: boolean;
  isFlagged: boolean;
  promptPrefixText: string;
  promptSuffixText: string;
  slotNumber: number;
  answerValue: string;
  ariaLabel: string;
  highlightEnabled: boolean;
  highlightColor?: StudentHighlightColor | undefined;
  security: {
    preventAutofill: boolean;
    preventAutocorrect: boolean;
  };
  sessionId?: string | undefined;
  studentId?: string | undefined;
  onChange: (nextValue: string) => void;
  renderFlagButton: (slotId: string) => React.ReactNode;
};

export function TableCompletionSlotCell({
  slotId,
  highlightSurfaceIdPrefix,
  isActive,
  isFlagged,
  promptPrefixText,
  promptSuffixText,
  slotNumber,
  answerValue,
  ariaLabel,
  highlightEnabled,
  highlightColor,
  security,
  sessionId,
  studentId,
  onChange,
  renderFlagButton,
}: TableCompletionSlotCellProps) {
  return (
    <td
      id={`question-${slotId}`}
      className={`border border-gray-200 px-3 py-2 align-top ${isActive ? 'ring-2 ring-blue-800 ring-inset' : ''} ${isFlagged ? 'bg-amber-50' : ''}`}
    >
      <div className="space-y-2">
        <div className="text-[length:var(--student-control-font-size)] text-gray-800 [white-space:pre-wrap]">
          <StudentQuestionText
            as="span"
            className="text-[length:var(--student-control-font-size)] text-gray-800"
            text={promptPrefixText}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            highlightSurfaceId={`${highlightSurfaceIdPrefix}:prefix`}
          />
          <span className="mx-1 inline-flex items-center gap-2 align-middle">
            <StudentQuestionNumber number={slotNumber} isActive={isActive} />
            <span className="inline-block min-w-[11rem] max-w-full align-middle">
              <ProtectedInput
                type="text"
                name={slotId}
                value={answerValue}
                onChange={(event) => onChange(event.target.value)}
                className="w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-[length:var(--student-control-font-size)] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Enter answer..."
                security={security}
                sessionId={sessionId}
                studentId={studentId}
                aria-label={ariaLabel}
              />
            </span>
          </span>
          <StudentQuestionText
            as="span"
            className="text-[length:var(--student-control-font-size)] text-gray-800"
            text={promptSuffixText}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            highlightSurfaceId={`${highlightSurfaceIdPrefix}:suffix`}
          />
        </div>
        <div className="flex justify-end">
          <div className="mt-1">{renderFlagButton(slotId)}</div>
        </div>
      </div>
    </td>
  );
}
