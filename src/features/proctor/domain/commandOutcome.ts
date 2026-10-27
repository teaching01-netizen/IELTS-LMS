/** A staff command can be accepted even if its response or subsequent refresh is lost. */
export type CommandOutcome =
  | { kind: 'confirmed' }
  | { kind: 'rejected'; error: string }
  | { kind: 'uncertain'; error: string }
  | { kind: 'confirmed_refresh_failed'; error: string };

export interface DeliveryCommandResult {
  success: boolean;
  error?: string | undefined;
  errorCause?: unknown;
  commandDispatched?: boolean | undefined;
  refreshError?: string | undefined;
}

export function isCommandConfirmed(
  outcome: CommandOutcome,
): outcome is Extract<CommandOutcome, { kind: 'confirmed' | 'confirmed_refresh_failed' }> {
  return outcome.kind === 'confirmed' || outcome.kind === 'confirmed_refresh_failed';
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** An answered 4xx is a rejection; other transport failures are uncertain. */
export function classifyCommandError(error: unknown, fallback: string): CommandOutcome {
  const status = typeof (error as { status?: unknown } | null)?.status === 'number'
    ? (error as { status: number }).status
    : 0;
  const businessRejection = (error as { businessRejection?: unknown } | null)?.businessRejection === true;
  return businessRejection || (status >= 400 && status < 500)
    ? { kind: 'rejected', error: messageOf(error, fallback) }
    : { kind: 'uncertain', error: `${messageOf(error, fallback)} The action may have been applied. Check the room before trying again.` };
}

export function deliveryCommandOutcome(result: DeliveryCommandResult, fallback: string): CommandOutcome {
  if (result.success) {
    return result.refreshError
      ? { kind: 'confirmed_refresh_failed', error: result.refreshError }
      : { kind: 'confirmed' };
  }
  if (result.commandDispatched === false || result.errorCause === undefined) {
    return { kind: 'rejected', error: result.error ?? fallback };
  }
  return classifyCommandError(result.errorCause, result.error ?? fallback);
}
