import React from 'react';
import { useStudentRuntimeClock } from './providers/StudentRuntimeProvider';

interface StudentWritingCountdownProps {
  durationSeconds: number;
  timeRemaining?: number | undefined;
}

function resolveRemainingSeconds(
  timeRemaining: number | undefined,
  runtimeClock: number | undefined,
  durationSeconds: number,
): number {
  if (Number.isFinite(timeRemaining) && (timeRemaining as number) >= 0) {
    return timeRemaining as number;
  }
  if (Number.isFinite(runtimeClock) && (runtimeClock as number) >= 0) {
    return runtimeClock as number;
  }
  return durationSeconds;
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function resolveCountdown(props: StudentWritingCountdownProps, runtimeClock: number | undefined) {
  const remaining = resolveRemainingSeconds(props.timeRemaining, runtimeClock, props.durationSeconds);
  const isCritical = remaining <= 300;
  const isWarning = remaining <= 600;
  const progress =
    props.durationSeconds > 0
      ? Math.max(0, Math.min(100, ((props.durationSeconds - remaining) / props.durationSeconds) * 100))
      : 0;
  return { remaining, isCritical, isWarning, progress };
}

// T2.5: the per-second runtime-clock subscription lives only in these memo leaf
// components, so typing in the writing editor no longer re-renders on every tick.
export const StudentWritingCountdownBar = React.memo(function StudentWritingCountdownBar(
  props: StudentWritingCountdownProps,
) {
  const runtimeClock = useStudentRuntimeClock();
  const { isCritical, isWarning, progress } = resolveCountdown(props, runtimeClock ?? undefined);
  return (
    <div
      className={`h-1.5 flex-shrink-0 transition-all ${
        isCritical ? 'bg-red-600' : isWarning ? 'bg-amber-700' : 'bg-blue-800'
      }`}
      style={{ width: `${progress}%` }}
    />
  );
});

export const StudentWritingCountdownBadge = React.memo(function StudentWritingCountdownBadge(
  props: StudentWritingCountdownProps,
) {
  const runtimeClock = useStudentRuntimeClock();
  const { remaining, isCritical, isWarning } = resolveCountdown(props, runtimeClock ?? undefined);
  return (
    <div
      role="timer"
      aria-label="Time remaining in writing section"
      className={`px-3 py-1 rounded-md text-sm font-semibold tabular-nums ${
        isCritical ? 'bg-red-100 text-red-700' : isWarning ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
      }`}
    >
      {formatCountdown(remaining)}
    </div>
  );
});
