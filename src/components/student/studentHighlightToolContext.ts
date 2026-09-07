export function isStudentHighlightToolContextActive(input: {
  phase: string;
  module: string;
  blockingReason: string | null;
  submitConfirmOpen: boolean;
  finalSubmitIdle: boolean;
}): boolean {
  return (
    input.phase === 'exam' &&
    (input.module === 'reading' ||
      input.module === 'listening' ||
      input.module === 'writing' ||
      input.module === 'science') &&
    input.blockingReason === null &&
    !input.submitConfirmOpen &&
    input.finalSubmitIdle
  );
}
