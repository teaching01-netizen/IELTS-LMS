import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCallback, useState } from 'react';
import { createSatReadingPreferences } from '../../../domain/satReadingPreferences';
import { SatReadingLayoutProvider, useSatReadingLayout } from '../SatReadingLayoutContext';

/**
 * The measurement layer, on its own.
 *
 * Two things are worth pinning here and nowhere else: WHICH box the policy is
 * measured from (the logical layout box, never the transformed visual one — the
 * exam renders inside a `transform: scale()` plane, where those two numbers
 * differ by the zoom factor), and the drag latch that keeps a presentation still
 * while the student's finger is on the divider. The decision itself is proven by
 * the resolver's own test matrix.
 */

/** A ResizeObserver a test can fire by hand. */
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  emit(box: { width: number; height: number }): void {
    const target = this.observed[this.observed.length - 1];
    if (!target) throw new Error('nothing is observed');
    this.callback(
      [
        {
          target,
          contentBoxSize: [{ inlineSize: box.width, blockSize: box.height }],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
}

/** The logical box every element reports; the test moves it, the DOM cannot. */
let logicalBox = { width: 0, height: 0 };
const originalResizeObserver = globalThis.ResizeObserver;
const originalRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  ResizeObserverStub.instances = [];
  logicalBox = { width: 0, height: 0 };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => logicalBox.width,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => logicalBox.height,
  });
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  // The zoomed plane's visual geometry: deliberately unrelated to the logical
  // box, exactly as `transform: scale()` makes it in the exam.
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 2048, bottom: 1536, width: 2048, height: 1536, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  Element.prototype.getBoundingClientRect = originalRect;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});

function Probe() {
  const layout = useSatReadingLayout();
  return (
    <div
      data-testid="probe"
      data-measured={layout.measured ? 'true' : 'false'}
      data-width={layout.width}
      data-height={layout.height}
      data-presentation={layout.decision.presentation}
      data-reason={layout.decision.reason}
      data-display={layout.decision.displayPresentation}
    />
  );
}

/** Stands in for the workspace: registers the element it renders. */
function Workspace({ hasStimulus = true }: { hasStimulus?: boolean }) {
  const { registerWorkspace } = useSatReadingLayout();
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      setNode(element);
      registerWorkspace(element, hasStimulus);
    },
    [hasStimulus, registerWorkspace],
  );
  return <div data-testid="workspace" ref={attach} data-node={node ? 'set' : 'none'} />;
}

function renderLayout(options: { withWorkspace?: boolean; textScale?: number } = {}) {
  const preferences = { ...createSatReadingPreferences(), textScale: options.textScale ?? 1 };
  return render(
    <SatReadingLayoutProvider preferences={preferences}>
      {options.withWorkspace === false ? null : <Workspace />}
      <Probe />
    </SatReadingLayoutProvider>,
  );
}

describe('SatReadingLayoutProvider measurement', () => {
  it('keeps the classic two-pane baseline until a workspace registers', () => {
    renderLayout({ withWorkspace: false });
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-measured', 'false');
    expect(probe).toHaveAttribute('data-presentation', 'split');
    expect(ResizeObserverStub.instances).toHaveLength(0);
  });

  it('measures the workspace’s logical box, never its transformed visual box', () => {
    // 390px of logical workspace inside a plane that reports 2048px on screen:
    // the panes are laid out against the logical width, so that is the width the
    // decision has to be made about. Reading the rect here is exactly the Screen
    // Zoom bug this protects against.
    logicalBox = { width: 390, height: 844 };
    renderLayout();
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-measured', 'true');
    expect(probe).toHaveAttribute('data-width', '390');
    expect(probe).toHaveAttribute('data-height', '844');
    expect(probe).toHaveAttribute('data-presentation', 'stacked');
  });

  it('observes the element it registered, and decides again when it resizes', () => {
    logicalBox = { width: 1024, height: 768 };
    renderLayout();
    expect(screen.getByTestId('probe')).toHaveAttribute('data-presentation', 'split');
    const observer = ResizeObserverStub.instances[0]!;
    expect(observer.observed).toEqual([screen.getByTestId('workspace')]);

    act(() => observer.emit({ width: 390, height: 844 }));
    expect(screen.getByTestId('probe')).toHaveAttribute('data-presentation', 'stacked');
    expect(screen.getByTestId('probe')).toHaveAttribute('data-width', '390');
    // The compact sheet is the only presentation a stacked layout can be in.
    expect(screen.getByTestId('probe')).toHaveAttribute('data-display', 'compact');
  });

  it('falls back to the document viewport for an element that has no box at all', () => {
    // A hidden (or not yet laid out) workspace cannot answer the question, and
    // resolving 0px to "stacked" would reflow the exam for a pane nobody sees.
    logicalBox = { width: 0, height: 0 };
    renderLayout();
    expect(screen.getByTestId('probe')).toHaveAttribute('data-measured', 'true');
    expect(screen.getByTestId('probe')).toHaveAttribute('data-width', String(window.innerWidth));
    expect(screen.getByTestId('probe')).toHaveAttribute('data-presentation', 'split');
  });

  it('rebuilds the observation when the workspace registers again, and tears it down on unmount', () => {
    logicalBox = { width: 1024, height: 768 };
    const view = renderLayout();
    const first = ResizeObserverStub.instances[0]!;
    view.unmount();
    expect(first.disconnected).toBe(true);
  });

  it('tears the previous observation down when the workspace registers again', () => {
    logicalBox = { width: 1024, height: 768 };
    const view = renderLayout();
    const first = ResizeObserverStub.instances[0]!;
    expect(first.observed).toEqual([screen.getByTestId('workspace')]);

    // The workspace re-registers — its own props changed identity, which is how a
    // question hands itself over. The observation it replaces has to go with it:
    // two live observers for one layout is two sources of truth, and the one left
    // over would keep reporting a box nothing is laid out in any more.
    view.rerender(
      <SatReadingLayoutProvider preferences={createSatReadingPreferences()}>
        <Workspace hasStimulus={false} />
        <Probe />
      </SatReadingLayoutProvider>,
    );

    expect(first.disconnected).toBe(true);
    expect(ResizeObserverStub.instances).toHaveLength(2);
    expect(ResizeObserverStub.instances[1]!.observed).toEqual([screen.getByTestId('workspace')]);
    // And the registration's other answer is current too: with no passage there is
    // one pane and no presentation to choose.
    expect(screen.getByTestId('probe')).toHaveAttribute('data-presentation', 'single');
  });

  it('lets the student’s text size raise the bar without touching the measurement', () => {
    logicalBox = { width: 1024, height: 768 };
    const view = renderLayout();
    expect(screen.getByTestId('probe')).toHaveAttribute('data-presentation', 'split');
    view.rerender(
      <SatReadingLayoutProvider preferences={{ ...createSatReadingPreferences(), textScale: 2 }}>
        <Workspace />
        <Probe />
      </SatReadingLayoutProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveAttribute('data-width', '1024');
    expect(screen.getByTestId('probe')).toHaveAttribute('data-presentation', 'stacked');
  });

  it('starts the workspace over when a different question is registered', () => {
    logicalBox = { width: 1024, height: 768 };
    const view = renderLayout();

    // A question with no stimulus: one pane, so the presentation is "single" and
    // the passage/question split stops being a question at all.
    view.rerender(
      <SatReadingLayoutProvider preferences={createSatReadingPreferences()}>
        <Workspace hasStimulus={false} />
        <Probe />
      </SatReadingLayoutProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveAttribute('data-presentation', 'single');
    expect(screen.getByTestId('probe')).toHaveAttribute('data-reason', 'single-question');
  });
});

describe('SatReadingLayoutProvider split drag latch', () => {
  function LatchProbe() {
    const layout = useSatReadingLayout();
    return (
      <>
        <Probe />
        <button
          type="button"
          aria-label="Start dragging the divider"
          data-testid="latch"
          onClick={() => layout.setSplitInteractionActive(true)}
        />
        <button
          type="button"
          aria-label="Release the divider"
          data-testid="release"
          onClick={() => layout.setSplitInteractionActive(false)}
        />
      </>
    );
  }

  it('holds the presentation still while the divider is being dragged', () => {
    logicalBox = { width: 1024, height: 768 };
    render(
      <SatReadingLayoutProvider preferences={createSatReadingPreferences()}>
        <Workspace />
        <LatchProbe />
      </SatReadingLayoutProvider>,
    );
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-presentation', 'split');

    act(() => screen.getByTestId('latch').click());
    // The student drags the divider until the question pane is under the
    // readable budget: the panes must NOT restack under the pointer, because the
    // element holding pointer capture would be unmounted mid-gesture.
    act(() => ResizeObserverStub.instances[0]!.emit({ width: 660, height: 900 }));
    expect(probe).toHaveAttribute('data-presentation', 'split');
    expect(probe).toHaveAttribute('data-width', '660');

    // Releasing commits the measurement: a layout that really is unreadable ends
    // up stacked, one gesture later.
    act(() => screen.getByTestId('release').click());
    expect(probe).toHaveAttribute('data-presentation', 'stacked');
  });

  it('ignores a release that never followed a drag', () => {
    logicalBox = { width: 390, height: 844 };
    render(
      <SatReadingLayoutProvider preferences={createSatReadingPreferences()}>
        <Workspace />
        <LatchProbe />
      </SatReadingLayoutProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveAttribute('data-presentation', 'stacked');
    act(() => screen.getByTestId('release').click());
    expect(screen.getByTestId('probe')).toHaveAttribute('data-presentation', 'stacked');
  });
});
