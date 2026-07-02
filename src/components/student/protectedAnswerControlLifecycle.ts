export type ProtectedAnswerLifecycleSource =
  | 'focusout'
  | 'visibility_hidden'
  | 'pagehide'
  | 'beforeunload'
  | 'freeze';

export interface ProtectedAnswerControlRegistration {
  element: HTMLElement;
  commitDomValue: (source: ProtectedAnswerLifecycleSource) => void;
  scheduleDeferredCommit?: (() => void) | undefined;
}

const controls = new Set<ProtectedAnswerControlRegistration>();
const controlsByElement = new WeakMap<HTMLElement, ProtectedAnswerControlRegistration>();
let installed = false;

function findControlForTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  let node: HTMLElement | null = target;
  while (node) {
    const control = controlsByElement.get(node);
    if (control) {
      return control;
    }
    node = node.parentElement;
  }

  return null;
}

function commitAll(source: ProtectedAnswerLifecycleSource) {
  controls.forEach((control) => control.commitDomValue(source));
}

function installGlobalListeners() {
  if (installed || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  installed = true;

  document.addEventListener(
    'focusout',
    (event) => {
      const control = findControlForTarget(event.target);
      if (!control) {
        return;
      }
      control.commitDomValue('focusout');
      control.scheduleDeferredCommit?.();
    },
    true,
  );

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      commitAll('visibility_hidden');
    }
  });

  document.addEventListener('freeze', () => {
    commitAll('freeze');
  });

  window.addEventListener('pagehide', () => {
    commitAll('pagehide');
  });

  window.addEventListener('beforeunload', () => {
    commitAll('beforeunload');
  });
}

export function registerProtectedAnswerControlLifecycle(
  registration: ProtectedAnswerControlRegistration,
) {
  installGlobalListeners();
  controls.add(registration);
  controlsByElement.set(registration.element, registration);

  return () => {
    controls.delete(registration);
    controlsByElement.delete(registration.element);
  };
}
