import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExamSessionRuntime } from '../../../../types/domain';
import type { StudentAttempt } from '../../../../types/studentAttempt';
import { IeltsOfflineStatusNotice } from '../IeltsOfflineStatusNotice';
import type {
  IeltsOfflineContinuity,
  IeltsOfflinePackageStatus,
} from '../../hooks/useIeltsOfflineContinuity';
import type { IeltsLocalProjection } from '../../application/ieltsOfflineRuntime';
import type {
  IeltsOfflineManifest,
  IeltsOfflinePackage,
} from '../../infrastructure/ieltsOfflinePackageStore';
import { testManifest } from '../../infrastructure/__tests__/ieltsOfflineTestKit';

let online = true;
function setOnline(value: boolean) {
  online = value;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  });
}

const manifest: IeltsOfflineManifest = testManifest();
const record: IeltsOfflinePackage = {
  schemaVersion: 1,
  key: 'package-key',
  status: 'ready',
  userId: 'user-1',
  scheduleId: manifest.scheduleId,
  candidateId: 'W001',
  manifest,
  staticPayload: {},
  liveSnapshot: null,
  shellBuildId: 'build-1',
  media: [],
  clock: {
    serverNowMs: Date.parse(manifest.serverNow),
    receivedWallMs: Date.parse(manifest.serverNow),
    lastEstimatedServerNowMs: Date.parse(manifest.serverNow),
  },
  preparedAt: null,
  blocked: false,
};

const runtimeSnapshot = {
  id: 'rt-1',
  scheduleId: manifest.scheduleId,
  status: 'live',
  timingModel: 'ielts_shared_schedule_v1',
  serverNow: manifest.serverNow,
  sections: [],
} as unknown as ExamSessionRuntime;

const attemptSnapshot = { id: 'att-1', scheduleId: manifest.scheduleId } as unknown as StudentAttempt;

const verified: IeltsLocalProjection = {
  positionKind: 'working',
  scheduleRevision: 1,
  clockConfidence: 'verified',
  editableSectionKey: 'listening',
};

function continuity(
  packageStatus: IeltsOfflinePackageStatus,
  projection: IeltsLocalProjection | null = null,
): IeltsOfflineContinuity {
  return { runtimeSnapshot, packageStatus, projection, restoredOffline: false };
}

const FAILURE_PATTERN = /not ready|try again|couldn't be saved|tell your invigilator/i;

describe('IeltsOfflineStatusNotice', () => {
  beforeEach(() => setOnline(true));
  afterEach(() => setOnline(true));

  it.each([
    { state: 'unavailable' as const },
    { state: 'preparing' as const },
    { state: 'deferred' as const, reason: 'media_failed' as const, attempts: 1, retryAt: null },
    { state: 'deferred' as const, reason: 'audio_unavailable' as const, attempts: 2, retryAt: null },
    { state: 'deferred' as const, reason: 'quota' as const, attempts: 1, retryAt: null },
    { state: 'deferred' as const, reason: 'unexpected' as const, attempts: 4, retryAt: null },
  ])('renders nothing and announces nothing for %o while online', (packageStatus) => {
    const { container } = render(
      <IeltsOfflineStatusNotice
        continuity={continuity(packageStatus as IeltsOfflinePackageStatus)}
        attemptSnapshot={attemptSnapshot}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(FAILURE_PATTERN)).not.toBeInTheDocument();
  });

  it('keeps a deferred package silent even when a projection exists', () => {
    const { container } = render(
      <IeltsOfflineStatusNotice
        continuity={continuity({ state: 'deferred', reason: 'media_failed', attempts: 4, retryAt: null }, verified)}
        attemptSnapshot={attemptSnapshot}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still reports real offline state, and nothing about the download', () => {
    act(() => setOnline(false));
    render(
      <IeltsOfflineStatusNotice
        continuity={continuity({ state: 'prepared', record })}
        attemptSnapshot={attemptSnapshot}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent("You're offline");
    expect(screen.getByRole('status')).not.toHaveTextContent(FAILURE_PATTERN);

    act(() => setOnline(true));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reports local save and clock-estimate honesty without a failure notice', () => {
    render(
      <IeltsOfflineStatusNotice
        continuity={continuity({ state: 'deferred', reason: 'storage_failed', attempts: 3, retryAt: null }, {
          positionKind: 'complete',
          scheduleRevision: 1,
          clockConfidence: 'provisional',
          editableSectionKey: null,
        })}
        attemptSnapshot={attemptSnapshot}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Saved on this device');
    expect(status).toHaveTextContent('estimate until this device reconnects');
    expect(status).not.toHaveTextContent(FAILURE_PATTERN);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not claim anything before a package or projection exists', () => {
    const { container } = render(
      <IeltsOfflineStatusNotice
        continuity={continuity({ state: 'unavailable' })}
        attemptSnapshot={attemptSnapshot}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
