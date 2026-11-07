import { useRef, useState } from 'react';
import { SatFormDialog } from './ConfirmDialog';
import { SatButton, SatField } from './SatPage';
import {
  applySATStaffControl,
  type SATStaffControlRequest,
  type SATStaffControlResult,
} from '../../../features/proctor/api/proctorRoomApi';
import type { ExamSessionRuntime } from '../../../types/domain';

export type SatControlTarget = {
  id: string;
  name: string;
  stage: string;
  remainingSeconds: number;
  stageKey?: string;
};

type Props = {
  scheduleId: string;
  targets: SatControlTarget[];
  action: SATStaffControlRequest['action'];
  plan: ExamSessionRuntime['examPlan'];
  wholeRoom?: boolean;
  blocked?: boolean;
  onClose: () => void;
  onApplied: () => void;
};

type Route = NonNullable<SATStaffControlRequest['route']>;
type Destination = {
  value: string;
  sectionKey: string;
  destination: NonNullable<SATStaffControlRequest['destination']>;
  label: string;
  seconds: number;
  routeSeconds?: Partial<Record<Route, number>>;
};

const ROUTE_LABEL: Record<Route, string> = {
  automatic: 'Automatic from Module 1 answers',
  lower: 'Easier Module 2',
  higher: 'Harder Module 2',
};

function destinationOptions(plan: Props['plan']): Destination[] {
  return (plan ?? []).flatMap(section => {
    const options: Destination[] = [];
    const base = section.modules?.find(module => module.adaptiveRole === 'base');
    const lower = section.modules?.find(module => module.adaptiveRole === 'lower_branch');
    const higher = section.modules?.find(module => module.adaptiveRole === 'higher_branch');
    const add = (destination: Destination['destination'], label: string, seconds: number, routeSeconds?: Destination['routeSeconds']) => {
      options.push({ value: `${section.sectionKey}:${destination}`, sectionKey: section.sectionKey, destination, label, seconds, ...(routeSeconds ? { routeSeconds } : {}) });
    };
    if (base) add('module_1', `${section.label} · Module 1`, base.durationMinutes * 60);
    const branch = lower ?? higher;
    if (branch) {
      add('module_2', `${section.label} · Module 2`, branch.durationMinutes * 60, {
        automatic: branch.durationMinutes * 60,
        ...(lower ? { lower: lower.durationMinutes * 60 } : {}),
        ...(higher ? { higher: higher.durationMinutes * 60 } : {}),
      });
    }
    if (section.gapAfterMinutes > 0) add('break', `Break after ${section.label}`, section.gapAfterMinutes * 60);
    return options;
  });
}

function clock(seconds: number): string {
  const whole = Math.floor(Math.max(0, seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function SatStaffControlDialog({
  scheduleId, targets, action, plan, wholeRoom = targets.length > 1, blocked = false, onClose, onApplied,
}: Props) {
  const destinations = destinationOptions(plan);
  const [destinationValue, setDestinationValue] = useState(destinations[0]?.value ?? '');
  const destination = destinations.find(item => item.value === destinationValue);
  const [route, setRoute] = useState<Route>('automatic');
  const [time, setTime] = useState(() => clock(action === 'move' ? destination?.seconds ?? 0 : targets[0]?.remainingSeconds ?? 0));
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SATStaffControlResult | null>(null);
  const requestRef = useRef<SATStaffControlRequest | null>(null);
  const applyingRef = useRef(false);
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(time.trim());
  const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  const validTime = Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86400;
  const ready = validTime && targets.length > 0 && (action !== 'move' || destination !== undefined);

  const apply = async () => {
    if (!ready || blocked || applyingRef.current) return;
    applyingRef.current = true;
    setPending(true);
    setError(null);
    // Keep the reviewed roster and operation identity across a lost reply.
    const request = requestRef.current ?? {
      operationId: crypto.randomUUID(),
      attemptIds: targets.map(target => target.id),
      action,
      remainingSeconds: seconds,
      ...(action === 'set_time' ? {
        expectedStages: Object.fromEntries(targets.flatMap(target => target.stageKey ? [[target.id, target.stageKey]] : [])),
      } : {}),
      ...(action === 'move' && destination ? {
        sectionKey: destination.sectionKey,
        destination: destination.destination,
        ...(destination.routeSeconds ? { route } : {}),
      } : {}),
    };
    requestRef.current = request;
    try {
      setResult(await applySATStaffControl(scheduleId, request));
      onApplied();
    } catch {
      setError('The change could not be confirmed. Retry to check and apply this same change safely.');
    } finally {
      applyingRef.current = false;
      setPending(false);
    }
  };

  const applied = result?.outcomes.filter(outcome => outcome.applied).length ?? 0;
  const failed = result?.outcomes.filter(outcome => !outcome.applied) ?? [];
  const actionLabel = reviewing ? requestRef.current ? 'Retry change' : 'Apply change' : 'Review change';
  const summary = action === 'move'
    ? `${destination?.label}${destination?.routeSeconds ? ` · ${ROUTE_LABEL[route]}` : ''}`
    : 'Current module or break';

  return (
    <SatFormDialog
      open
      eyebrow={wholeRoom ? 'Whole room' : 'Selected student'}
      title={action === 'set_time' ? 'Edit remaining time' : 'Move module'}
      onClose={() => { if (!pending) onClose(); }}
      footer={(
        <div className="flex justify-end gap-2 px-6 py-4">
          <SatButton variant="quiet" disabled={pending} onClick={onClose}>{result ? 'Done' : 'Cancel'}</SatButton>
          {!result || failed.length > 0 ? (
            <SatButton variant="primary" disabled={pending || blocked || !ready} pending={pending} onClick={() => { if (reviewing) void apply(); else setReviewing(true); }}>
              {actionLabel}
            </SatButton>
          ) : null}
        </div>
      )}
    >
      <div className="space-y-4 px-6 pb-6">
        {reviewing ? (
          <>
            <p className="font-semibold">{summary} · {clock(seconds)} remaining.</p>
            <p className="text-sm">Running clocks start from Apply. Paused students stay paused. Disconnected students receive the change when they reconnect.</p>
            <p className="text-sm font-medium">{targets.length} {targets.length === 1 ? 'student' : 'students'} affected</p>
            <ul className="max-h-48 overflow-y-auto" aria-label="Affected students">
              {targets.map(target => (
                <li key={target.id} className="border-b border-[var(--sat-staff-border-hairline)] py-2">
                  <span className="font-semibold">{target.name}</span>
                  <span className="ml-2 text-sm">{target.stage} · {clock(target.remainingSeconds)}</span>
                </li>
              ))}
            </ul>
            {!pending && !requestRef.current ? <SatButton variant="quiet" onClick={() => setReviewing(false)}>Back to editing</SatButton> : null}
          </>
        ) : (
          <>
            {action === 'move' ? (
              <SatField label="Destination">
                {control => (
                  <select {...control} className="sat-input" value={destinationValue} onChange={event => {
                    const next = destinations.find(item => item.value === event.target.value);
                    setDestinationValue(event.target.value);
                    setRoute('automatic');
                    if (next) setTime(clock(next.seconds));
                  }}>
                    {destinations.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                )}
              </SatField>
            ) : null}
            {destination?.routeSeconds && action === 'move' ? (
              <SatField label="Module 2 selection">
                {control => (
                  <select {...control} className="sat-input" value={route} onChange={event => {
                    const next = event.target.value as Route;
                    setRoute(next);
                    setTime(clock(destination.routeSeconds?.[next] ?? destination.seconds));
                  }}>
                    {(Object.keys(ROUTE_LABEL) as Route[]).filter(key => destination.routeSeconds?.[key] !== undefined).map(key => <option key={key} value={key}>{ROUTE_LABEL[key]}</option>)}
                  </select>
                )}
              </SatField>
            ) : null}
            <SatField label="Remaining time (mm:ss)" help="Use minutes:seconds. Setting 00:00 ends the time window." error={validTime ? null : 'Enter a time between 00:00 and 1440:00.'}>
              {control => <input {...control} className="sat-input" value={time} onChange={event => setTime(event.target.value)} />}
            </SatField>
          </>
        )}
        {blocked ? <p role="status">Refresh the room before applying this change.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {result ? (
          <div role="status">
            <p>Change applied to {applied} {applied === 1 ? 'student' : 'students'}.</p>
            {failed.length ? <ul>{failed.map(outcome => <li key={outcome.attemptId}>{targets.find(target => target.id === outcome.attemptId)?.name ?? 'Student'}: {outcome.error ?? 'Not applied. Retry this change.'}</li>)}</ul> : null}
          </div>
        ) : null}
      </div>
    </SatFormDialog>
  );
}
