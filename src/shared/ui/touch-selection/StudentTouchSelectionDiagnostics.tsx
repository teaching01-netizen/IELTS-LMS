import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { describeTouchSelectionNode, type TouchSelectionDiagnostics } from './touchSelectionDiagnostics';

interface SurfaceConfig {
  surface: string;
  enabled: boolean;
  ownedTouchSelection: boolean;
  toolModeOrAnnotationMode: string | boolean;
}

const EMPTY_GESTURE = {
  pointerDownSeen: false, pointerMoveSeen: false, pointerUpSeen: false, pointerCancelSeen: false,
  targetInsideRoot: null, startCaretResolved: null, focusCaretResolved: null,
  claimed: false, rangeText: '', rangeCollapsed: null, rangeRectCount: 0,
  onSelectCalled: false, captureSucceeded: null, mutationApplied: null,
};

interface SurfaceTrace extends TouchSelectionDiagnostics {
  snapshot: () => Record<string, unknown>;
  observe: (event: PointerEvent) => boolean;
}

interface DiagnosticStore {
  surfaces: Map<string, SurfaceTrace>;
  activeId: string | null;
  documentEvents: Record<string, unknown>[];
  snapshot: () => { version: 1; userAgent: string; activeId: string | null; documentEvents: Record<string, unknown>[]; surfaces: Record<string, unknown>[] };
}

declare global {
  interface Window {
    __studentTouchSelectionDebug?: Pick<DiagnosticStore, 'snapshot'>;
  }
}

const DiagnosticsContext = createContext<DiagnosticStore | null>(null);

/** Each surface keeps its own trace; the panel never re-renders the exam. */
export function useStudentTouchSelectionDiagnostics(
  rootRef: RefObject<HTMLElement | null>,
  config: SurfaceConfig,
): TouchSelectionDiagnostics | undefined {
  const store = useContext(DiagnosticsContext);
  const id = useId();
  const currentConfig = useRef(config);
  currentConfig.current = config;
  const trace = useMemo<SurfaceTrace | undefined>(() => {
    if (!store) return undefined;
    let listenerRoot: HTMLElement | null = null;
    let rootExistsAtEffect: boolean | null = null;
    let pointerId: number | null = null;
    let values: Record<string, unknown> = { ...EMPTY_GESTURE };
    const events: Record<string, unknown>[] = [];
    const record: TouchSelectionDiagnostics['record'] = (stage, details = {}) => {
      if (stage === 'listener:effect') rootExistsAtEffect = details['rootExistsAtEffect'] === true;
      values = { ...values, ...details, lastStage: stage };
      events.push({ ms: Math.round(performance.now()), stage, ...details });
      // Retain the start/caret path AND the release of a long drag.
      if (events.length > 120) events.splice(40, 1);
    };
    return {
      record,
      listener: (root) => { listenerRoot = root; record(root ? 'listener:attached' : 'listener:detached-or-missing'); },
      snapshot: () => {
        const root = rootRef.current;
        const style = root ? getComputedStyle(root) : null;
        return {
          id, ...currentConfig.current,
          coarse: typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)').matches : null,
          rootExists: !!root, rootConnected: root?.isConnected ?? false, rootExistsAtEffect,
          listenerAttached: !!listenerRoot, listenerRootMatches: !!root && listenerRoot === root,
          markerPresent: root?.dataset['studentOwnedTouchSelection'] === 'true',
          computedUserSelect: style?.getPropertyValue('user-select') ?? '',
          computedWebkitUserSelect: style?.getPropertyValue('-webkit-user-select') ?? '',
          computedTouchAction: style?.touchAction ?? '', computedDisplay: style?.display ?? '',
          examClassPresent: document.documentElement.classList.contains('student-exam-active'),
          nativeSelectionRangeCount: window.getSelection()?.rangeCount ?? 0,
          renderedMarkCount: root?.querySelectorAll('mark[data-highlighted="true"], [data-sat-highlight="true"]').length ?? 0,
          ...values, events: [...events],
        };
      },
      observe: (event) => {
        const inside = event.target instanceof Node && !!rootRef.current?.contains(event.target);
        if (event.type === 'pointerdown') {
          if (!inside) return false;
          values = { ...EMPTY_GESTURE };
          events.length = 0;
          pointerId = event.pointerId;
        } else if (pointerId === null || event.pointerId !== pointerId) return false;
        const root = rootRef.current;
        const style = root ? getComputedStyle(root) : null;
        const targetStyle = event.target instanceof Element ? getComputedStyle(event.target) : null;
        record(`dom:${event.type}`, {
          pointerId: event.pointerId, pointerType: event.pointerType, trusted: event.isTrusted,
          eventTarget: describeTouchSelectionNode(event.target instanceof Node ? event.target : null),
          targetInsideRoot: inside, clientX: event.clientX, clientY: event.clientY,
          defaultPrevented: event.defaultPrevented,
          // Snapshot BEFORE the handler, so arming after pointerdown cannot hide a bad initial style.
          markerAtEvent: root?.dataset['studentOwnedTouchSelection'] === 'true',
          touchActionAtEvent: style?.touchAction ?? '',
          userSelectAtEvent: style?.getPropertyValue('-webkit-user-select') || style?.getPropertyValue('user-select') || '',
          targetUserSelect: targetStyle?.getPropertyValue('-webkit-user-select') || targetStyle?.getPropertyValue('user-select') || '',
          targetTouchAction: targetStyle?.touchAction ?? '',
        });
        if (event.type === 'pointerup' || event.type === 'pointercancel') pointerId = null;
        return true;
      },
    };
  }, [id, rootRef, store]);

  useLayoutEffect(() => {
    if (!trace || !store) return;
    store.surfaces.set(id, trace);
    return () => { store.surfaces.delete(id); };
  }, [id, store, trace]);
  return trace;
}

/** Session boundary opt-in. Data stays in memory until explicitly saved locally. */
export function StudentTouchSelectionDiagnosticsProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const store = useMemo<DiagnosticStore | null>(() => {
    if (!enabled) return null;
    const value: DiagnosticStore = {
      surfaces: new Map(), activeId: null, documentEvents: [],
      snapshot: () => ({ version: 1, userAgent: navigator.userAgent, activeId: value.activeId, documentEvents: [...value.documentEvents], surfaces: [...value.surfaces.values()].map((trace) => trace.snapshot()) }),
    };
    return value;
  }, [enabled]);

  useEffect(() => {
    if (!store) return;
    const debug = { snapshot: store.snapshot };
    window.__studentTouchSelectionDebug = debug;
    const observe = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-touch-selection-diagnostics]')) return;
      // Keep raw events even if every ref is missing or the target is outside
      // the registered roots; otherwise a missing listener could look like no input.
      if (event.type === 'pointerdown') store.documentEvents.length = 0;
      store.documentEvents.push({ ms: Math.round(performance.now()), stage: event.type, pointerId: event.pointerId, pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY, trusted: event.isTrusted, eventTarget: describeTouchSelectionNode(event.target instanceof Node ? event.target : null) });
      if (store.documentEvents.length > 120) store.documentEvents.splice(40, 1);
      for (const [id, trace] of store.surfaces) {
        if (trace.observe(event)) store.activeId = id;
      }
    };
    const events = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;
    for (const event of events) document.addEventListener(event, observe, { capture: true, passive: true });
    return () => {
      for (const event of events) document.removeEventListener(event, observe, true);
      if (window.__studentTouchSelectionDebug === debug) delete window.__studentTouchSelectionDebug;
    };
  }, [store]);

  return <DiagnosticsContext.Provider value={store}>
    {children}
    {store ? <DiagnosticPanel store={store} /> : null}
  </DiagnosticsContext.Provider>;
}

function DiagnosticPanel({ store }: { store: DiagnosticStore }) {
  const [snapshot, setSnapshot] = useState(store.snapshot);
  useEffect(() => {
    const timer = window.setInterval(() => setSnapshot(store.snapshot()), 250);
    return () => window.clearInterval(timer);
  }, [store]);
  const active = snapshot.surfaces.find((surface) => surface['id'] === snapshot.activeId) ?? snapshot.surfaces[0];
  const save = () => {
    const blob = new Blob([JSON.stringify(store.snapshot(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'touch-selection-trace.json';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return createPortal(
    <aside aria-label="Touch selection diagnostics" role="region" data-touch-selection-diagnostics
      style={{ position: 'fixed', right: 8, bottom: 8, zIndex: 9999, maxWidth: 'min(440px, 95vw)', background: 'white', color: '#111', border: '1px solid #777', borderRadius: 6, padding: 8, fontSize: 12 }}>
      <details>
        <summary>Touch selection diagnostics ({snapshot.surfaces.length} surfaces)</summary>
        <p>Local trace · includes up to 200 selected characters. No upload.</p>
        <button type="button" onClick={save}>Save trace</button>
        <textarea readOnly aria-label="Selection trace" rows={10} style={{ display: 'block', width: '100%', maxHeight: '28vh', fontSize: 11, fontFamily: 'monospace' }} value={JSON.stringify({ ...active, lastDocumentEvent: snapshot.documentEvents.at(-1) }, null, 2)} />
      </details>
    </aside>, document.body,
  );
}
