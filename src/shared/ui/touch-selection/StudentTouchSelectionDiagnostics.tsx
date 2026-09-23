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
  observe: (event: Event) => boolean;
}

function pointerTypeOf(event: Event): string | null {
  return 'pointerType' in event && typeof (event as PointerEvent).pointerType === 'string'
    ? (event as PointerEvent).pointerType
    : null;
}

function nodeInside(root: HTMLElement, node: Node | null | undefined): boolean {
  return node !== null && node !== undefined && root.contains(node);
}

function selectionIntersects(root: HTMLElement, selection: Selection | null): boolean {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    try {
      if (selection.getRangeAt(index).intersectsNode(root)) return true;
    } catch {
      // Detached ranges are not relevant to this surface.
    }
  }
  return (selection.anchorNode !== null && root.contains(selection.anchorNode))
    || (selection.focusNode !== null && root.contains(selection.focusNode));
}

function selectionRootForEvent(event: Event): HTMLElement | null {
  const target = event.target instanceof Element
    ? event.target
    : event.target instanceof Node
      ? event.target.parentElement
      : null;
  const root = target?.closest<HTMLElement>(
    '[data-sat-selection-protected="true"], [data-student-highlightable="true"]',
  );
  if (root) return root;
  return document.querySelector<HTMLElement>(
    '[data-sat-selection-protected="true"][data-student-selection-owner="app"], '
      + '[data-student-highlightable="true"][data-student-selection-owner="app"]',
  ) ?? document.querySelector<HTMLElement>(
    '[data-sat-selection-protected="true"], [data-student-highlightable="true"]',
  );
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
    let activePointerType: string | null = null;
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
        const nativeSelection = window.getSelection();
        return {
          id, ...currentConfig.current,
          coarse: typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)').matches : null,
          anyCoarse: typeof window.matchMedia === 'function' ? window.matchMedia('(any-pointer: coarse)').matches : null,
          maxTouchPoints: navigator.maxTouchPoints ?? 0,
          rootExists: !!root, rootConnected: root?.isConnected ?? false, rootExistsAtEffect,
          listenerAttached: !!listenerRoot, listenerRootMatches: !!root && listenerRoot === root,
          markerPresent: root?.dataset['studentOwnedTouchSelection'] === 'true',
          ownedTouchSelectionMarkerPresent: root?.dataset['studentOwnedTouchSelection'] === 'true',
          protectedRootPresent: root?.getAttribute('data-sat-selection-protected') === 'true',
          ownerMarkerPresent: root?.getAttribute('data-student-selection-owner') === 'app',
          computedUserSelect: style?.getPropertyValue('user-select') ?? '',
          computedWebkitUserSelect: style?.getPropertyValue('-webkit-user-select') ?? '',
          computedTouchAction: style?.touchAction ?? '', computedDisplay: style?.display ?? '',
          examClassPresent: document.documentElement.classList.contains('student-exam-active'),
          nativeSelectionRangeCount: nativeSelection?.rangeCount ?? 0,
          nativeSelectionCollapsed: nativeSelection?.isCollapsed ?? null,
          nativeAnchorInsideSatRoot: !!root && root.getAttribute('data-sat-selection-protected') === 'true' && nodeInside(root, nativeSelection?.anchorNode),
          nativeFocusInsideSatRoot: !!root && root.getAttribute('data-sat-selection-protected') === 'true' && nodeInside(root, nativeSelection?.focusNode),
          renderedMarkCount: root?.querySelectorAll('mark[data-highlighted="true"], [data-sat-highlight="true"]').length ?? 0,
          ...values, events: [...events],
        };
      },
      observe: (event) => {
        const pointerEvent = event.type.startsWith('pointer');
        const pointerIdForEvent = pointerEvent && typeof (event as PointerEvent).pointerId === 'number'
          ? (event as PointerEvent).pointerId
          : null;
        const inside = event.target instanceof Node && !!rootRef.current?.contains(event.target);
        if (event.type === 'pointerdown') {
          if (!inside) return false;
          values = { ...EMPTY_GESTURE };
          events.length = 0;
          pointerId = pointerIdForEvent;
          activePointerType = pointerTypeOf(event);
        } else if (event.type === 'selectstart') {
          if (!inside) return false;
        } else if (event.type === 'selectionchange') {
          const root = rootRef.current;
          if (!root || root.getAttribute('data-sat-selection-protected') !== 'true') return false;
          if (!selectionIntersects(root, window.getSelection()) && pointerId === null && root.getAttribute('data-student-selection-owner') !== 'app') return false;
        } else if (pointerEvent && (pointerId === null || pointerIdForEvent !== pointerId)) return false;
        else if (!pointerEvent) return false;
        const root = rootRef.current;
        const style = root ? getComputedStyle(root) : null;
        const targetStyle = event.target instanceof Element ? getComputedStyle(event.target) : null;
        const nativeSelection = window.getSelection();
        const pointer = pointerEvent ? event as PointerEvent : null;
        record(`dom:${event.type}`, {
          pointerId: pointerIdForEvent, pointerType: pointerTypeOf(event), activePointerType, trusted: event.isTrusted,
          coarse: typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)').matches : null,
          anyCoarse: typeof window.matchMedia === 'function' ? window.matchMedia('(any-pointer: coarse)').matches : null,
          maxTouchPoints: navigator.maxTouchPoints ?? 0,
          eventTarget: describeTouchSelectionNode(event.target instanceof Node ? event.target : null),
          targetInsideRoot: inside, clientX: pointer?.clientX ?? null, clientY: pointer?.clientY ?? null,
          defaultPrevented: event.defaultPrevented,
          // Snapshot BEFORE the handler, so arming after pointerdown cannot hide a bad initial style.
          markerAtEvent: root?.dataset['studentOwnedTouchSelection'] === 'true',
          ownedTouchSelectionMarkerAtEvent: root?.dataset['studentOwnedTouchSelection'] === 'true',
          protectedRootAtEvent: root?.getAttribute('data-sat-selection-protected') === 'true',
          ownerMarkerAtEvent: root?.getAttribute('data-student-selection-owner') === 'app',
          touchActionAtEvent: style?.touchAction ?? '',
          computedUserSelectAtEvent: style?.getPropertyValue('user-select') ?? '',
          computedWebkitUserSelectAtEvent: style?.getPropertyValue('-webkit-user-select') ?? '',
          userSelectAtEvent: style?.getPropertyValue('-webkit-user-select') || style?.getPropertyValue('user-select') || '',
          targetComputedUserSelect: targetStyle?.getPropertyValue('user-select') ?? '',
          targetComputedWebkitUserSelect: targetStyle?.getPropertyValue('-webkit-user-select') ?? '',
          targetUserSelect: targetStyle?.getPropertyValue('-webkit-user-select') || targetStyle?.getPropertyValue('user-select') || '',
          targetTouchAction: targetStyle?.touchAction ?? '',
          nativeSelectionRangeCount: nativeSelection?.rangeCount ?? 0,
          nativeSelectionCollapsed: nativeSelection?.isCollapsed ?? null,
          nativeAnchorInsideSatRoot: !!root && root.getAttribute('data-sat-selection-protected') === 'true' && nodeInside(root, nativeSelection?.anchorNode),
          nativeFocusInsideSatRoot: !!root && root.getAttribute('data-sat-selection-protected') === 'true' && nodeInside(root, nativeSelection?.focusNode),
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
    const observe = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-touch-selection-diagnostics]')) return;
      // Keep raw events even if every ref is missing or the target is outside
      // the registered roots; otherwise a missing listener could look like no input.
      if (event.type === 'pointerdown') store.documentEvents.length = 0;
      const pointer = event.type.startsWith('pointer') ? event as PointerEvent : null;
      const selection = window.getSelection();
      const surfaceRoot = selectionRootForEvent(event);
      store.documentEvents.push({
        ms: Math.round(performance.now()), stage: event.type,
        pointerId: pointer?.pointerId ?? null, pointerType: pointer?.pointerType ?? null,
        coarse: typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)').matches : null,
        anyCoarse: typeof window.matchMedia === 'function' ? window.matchMedia('(any-pointer: coarse)').matches : null,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
        clientX: pointer?.clientX ?? null, clientY: pointer?.clientY ?? null,
        trusted: event.isTrusted,
        eventTarget: describeTouchSelectionNode(event.target instanceof Node ? event.target : null),
        protectedRootPresent: surfaceRoot?.getAttribute('data-sat-selection-protected') === 'true',
        ownerMarkerPresent: surfaceRoot?.getAttribute('data-student-selection-owner') === 'app',
        nativeSelectionRangeCount: selection?.rangeCount ?? 0,
        nativeSelectionCollapsed: selection?.isCollapsed ?? null,
        nativeAnchorInsideSatRoot: !!surfaceRoot && surfaceRoot.getAttribute('data-sat-selection-protected') === 'true' && nodeInside(surfaceRoot, selection?.anchorNode),
        nativeFocusInsideSatRoot: !!surfaceRoot && surfaceRoot.getAttribute('data-sat-selection-protected') === 'true' && nodeInside(surfaceRoot, selection?.focusNode),
        nativeAnchorInsideSelectionRoot: !!surfaceRoot && nodeInside(surfaceRoot, selection?.anchorNode),
        nativeFocusInsideSelectionRoot: !!surfaceRoot && nodeInside(surfaceRoot, selection?.focusNode),
      });
      if (store.documentEvents.length > 120) store.documentEvents.splice(40, 1);
      for (const [id, trace] of store.surfaces) {
        if (trace.observe(event)) store.activeId = id;
      }
    };
    const events = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'selectstart', 'selectionchange'] as const;
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
