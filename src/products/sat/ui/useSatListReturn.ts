import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

type ListReturnState = { satLastOpened?: unknown } | null;

const LIST_RETURN_PREFIX = 'sat-list-return:';

/**
 * Where a staff list was left (its URL with filters, and the record opened
 * from it), so an in-app "back to the list" control lands on the same view
 * instead of a reset one. Falls back to the bare list path.
 */
export function satListReturnTarget(listPath: string): { to: string; state?: { satLastOpened: string } } {
  try {
    const raw = window.sessionStorage.getItem(LIST_RETURN_PREFIX + listPath);
    const saved = raw ? (JSON.parse(raw) as { href?: unknown; id?: unknown }) : null;
    if (saved && typeof saved.href === 'string' && saved.href.startsWith(listPath)) {
      return typeof saved.id === 'string' ? { to: saved.href, state: { satLastOpened: saved.id } } : { to: saved.href };
    }
  } catch {
    // Unreadable storage: the bare list is always a valid destination.
  }
  return { to: listPath };
}

/**
 * Remembers which record a staff member opened from a list, on the list's own
 * history entry. Coming back (browser Back or an in-app back link that pops)
 * marks that row and returns keyboard focus to it, so reviewing records one by
 * one never means hunting for your place again.
 */
export function useSatListReturn(ready: boolean): {
  lastOpenedId: string | null;
  openRecord: (id: string, to: string, state?: Record<string, unknown>) => void;
} {
  const navigate = useNavigate();
  const location = useLocation();
  const raw = (location.state as ListReturnState)?.satLastOpened;
  const lastOpenedId = typeof raw === 'string' ? raw : null;

  const openRecord = useCallback(
    (id: string, to: string, state?: Record<string, unknown>) => {
      const current = (location.state && typeof location.state === 'object' ? location.state : {}) as Record<string, unknown>;
      const href = location.pathname + location.search;
      try {
        window.sessionStorage.setItem(LIST_RETURN_PREFIX + location.pathname, JSON.stringify({ href, id }));
      } catch {
        // Storage blocked: Back still works through history state below.
      }
      navigate(href, { replace: true, state: { ...current, satLastOpened: id } });
      navigate(to, state ? { state } : undefined);
    },
    [location.pathname, location.search, location.state, navigate],
  );

  const focusedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !lastOpenedId || focusedFor.current === location.key) return;
    const row = document.querySelector<HTMLElement>(`[data-sat-row-id="${CSS.escape(lastOpenedId)}"]`);
    if (!row) return;
    focusedFor.current = location.key;
    row.focus({ preventScroll: true });
  }, [lastOpenedId, location.key, ready]);

  return { lastOpenedId, openRecord };
}

const SCROLL_KEY_PREFIX = 'sat-scroll:';

function readScroll(key: string): number | null {
  try {
    const value = window.sessionStorage.getItem(SCROLL_KEY_PREFIX + key);
    const parsed = value === null ? Number.NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeScroll(key: string, value: number): void {
  try {
    window.sessionStorage.setItem(SCROLL_KEY_PREFIX + key, String(Math.round(value)));
  } catch {
    // Storage full or blocked: scroll memory is a convenience, never a failure.
  }
}

/**
 * Window scroll memory for the SAT staff shell, keyed by URL (path + query)
 * so the history-state marker written by `openRecord` never orphans it. The
 * offset is tracked while the page is in use (not read at teardown, when the
 * next page's DOM may already have clamped it) and restored when the staff
 * member returns: browser Back / Forward, or an in-app link back to a list.
 */
export function useSatScrollMemory(): void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const key = location.pathname + location.search;

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        writeScroll(key, window.scrollY);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);

  const returning = navigationType === 'POP' || Boolean((location.state as ListReturnState)?.satLastOpened);
  useLayoutEffect(() => {
    if (!returning) return;
    const saved = readScroll(key);
    if (saved === null) return;
    // One frame lets cached list data render before the offset is applied.
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: saved }));
    return () => window.cancelAnimationFrame(frame);
  }, [key, location.key, returning]);
}
