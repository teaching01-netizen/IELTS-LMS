import {
  discardIeltsOfflinePackage,
  listIeltsOfflinePackagesForAttempt,
} from '../infrastructure/ieltsOfflinePackageStore';
import { deleteIeltsOfflineMedia } from '../infrastructure/ieltsOfflineMediaCache';
import { unpinIeltsOfflineShell } from '../infrastructure/ieltsOfflineShell';

/**
 * Removes the offline package, verified media and pinned shell build after a
 * server receipt and an acknowledged evidence ledger (INV-8). Answers and
 * quarantined drafts live in the durability store and are never touched here.
 * Best-effort: a storage failure cannot undo a committed receipt.
 */
export async function cleanupIeltsOfflineArtifacts(attemptId: string): Promise<void> {
  if (!attemptId) return;
  const packages = await listIeltsOfflinePackagesForAttempt(attemptId).catch(() => []);
  await Promise.allSettled(packages.map((record) => discardIeltsOfflinePackage(record)));
  await deleteIeltsOfflineMedia(attemptId).catch(() => undefined);
  await unpinIeltsOfflineShell(attemptId).catch(() => undefined);
  // Server-confirmed answers are part of the submitted record now; the local
  // copy was only the offline reload fallback.
  try {
    globalThis.localStorage?.removeItem(`v2_confirmed_answers:${attemptId}`);
  } catch {
    // Best effort: a locked storage cannot undo the receipt.
  }
}
