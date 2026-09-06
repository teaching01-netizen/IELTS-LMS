import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WritingAnnotationCanvas } from '../WritingAnnotationCanvasLegacy';
import type {
  CommentBankItem,
  DrawingAnnotation,
  WritingAnnotation,
} from '../../../types/grading';

// jsdom lacks canvas getContext — stub HTMLCanvasElement.prototype.getContext
// with a no-op 2d context (kept for parity with canvas-based annotation
// surfaces; this legacy component renders annotated text via divs/spans).
function stubCanvasContext() {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      fillRect() {},
      clearRect() {},
      getImageData: () => ({ data: [] }),
      putImageData() {},
      createImageData: () => [],
      setTransform() {},
      drawImage() {},
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      measureText: () => ({ width: 0 }),
    })),
  });
}

// Simulate a user selecting `selected` text starting at `preLength` chars
// into the student text, then firing mouseup (the component reads
// window.getSelection() in onMouseUp).
function mockTextSelection(selected: string, preLength = 0) {
  const fakeRange = {
    toString: () => selected,
    cloneRange: () => ({
      selectNodeContents: vi.fn(),
      setEnd: vi.fn(),
      toString: () => 'x'.repeat(preLength),
    }),
    startContainer: document.createTextNode('x'),
    startOffset: 0,
  };
  const selection = {
    rangeCount: 1,
    getRangeAt: () => fakeRange,
    removeAllRanges: vi.fn(),
  };
  vi.spyOn(window, 'getSelection').mockReturnValue(
    selection as unknown as Selection,
  );
}

function makeCallbacks() {
  return {
    onAnnotationAdd: vi.fn(),
    onAnnotationUpdate: vi.fn(),
    onAnnotationDelete: vi.fn(),
    onDrawingAdd: vi.fn(),
    onDrawingDelete: vi.fn(),
  };
}

type Callbacks = ReturnType<typeof makeCallbacks>;

const TASK_TEXT = 'Hello world, this is a writing sample.';

function renderCanvas(
  overrides: Partial<React.ComponentProps<typeof WritingAnnotationCanvas>> = {},
  callbacks: Callbacks = makeCallbacks(),
) {
  const props = {
    taskId: 'task-1',
    studentText: TASK_TEXT,
    annotations: [] as WritingAnnotation[],
    drawings: [] as DrawingAnnotation[],
    currentTeacherId: 'teacher-1',
    ...callbacks,
    ...overrides,
  };
  const result = render(<WritingAnnotationCanvas {...props} />);
  return { ...result, callbacks };
}

// Only valid when the full text renders as a single node (no annotations).
function selectText(selected: string, preLength = 0) {
  mockTextSelection(selected, preLength);
  fireEvent.mouseUp(screen.getByText(TASK_TEXT));
}

const COMMENT_BANK: CommentBankItem[] = [
  {
    id: 'cb-1',
    category: 'grammar',
    label: 'Grammar',
    text: 'Check verb tense',
    isStudentVisible: true,
    createdBy: 'teacher-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    usageCount: 0,
  },
  {
    id: 'cb-2',
    category: 'vocabulary',
    label: 'Vocab',
    text: 'Internal vocab note',
    isStudentVisible: false,
    createdBy: 'teacher-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    usageCount: 0,
  },
];

const SAMPLE_ANNOTATIONS: WritingAnnotation[] = [
  {
    id: 'a-1',
    taskId: 'task-1',
    type: 'highlight',
    startOffset: 6,
    endOffset: 11,
    selectedText: 'world',
    comment: '',
    visibility: 'student_visible',
    color: 'rgba(255, 255, 0, 0.5)',
    createdBy: 'teacher-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'a-2',
    taskId: 'task-1',
    type: 'inline_comment',
    startOffset: 0,
    endOffset: 5,
    selectedText: 'Hello',
    comment: 'Nice opening',
    visibility: 'internal_only',
    createdBy: 'teacher-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  stubCanvasContext();
});

describe('WritingAnnotationCanvasLegacy', () => {
  it('renders student text, canvas area, and toolbar tools with minimal props', () => {
    renderCanvas();

    // Task text + text canvas area
    expect(screen.getByText(TASK_TEXT)).toBeInTheDocument();

    // Toolbar tools
    expect(screen.getByTitle('Select')).toBeInTheDocument();
    expect(screen.getByTitle('Highlight')).toBeInTheDocument();
    expect(screen.getByTitle('Underline')).toBeInTheDocument();
    expect(screen.getByTitle('Strike Through')).toBeInTheDocument();
    expect(screen.getByTitle('Add Comment')).toBeInTheDocument();

    // Visibility toggle defaults to student-visible
    expect(screen.getByTitle('Student Visible')).toBeInTheDocument();

    // Color swatches
    expect(screen.getByTitle('Yellow')).toBeInTheDocument();
    expect(screen.getByTitle('Red')).toBeInTheDocument();
    expect(screen.getByTitle('Blue')).toBeInTheDocument();
    expect(screen.getByTitle('Green')).toBeInTheDocument();

    // Empty states: no quick comments, no annotations list
    expect(screen.queryByText('Quick Comments')).not.toBeInTheDocument();
    expect(screen.queryByText(/Annotations \(/)).not.toBeInTheDocument();
  });

  it('renders empty state without crashing when text and lists are empty', () => {
    const { container } = renderCanvas({ studentText: '' });

    expect(container.firstChild).toBeInTheDocument();
    expect(screen.queryByText('Quick Comments')).not.toBeInTheDocument();
    expect(screen.queryByText(/Annotations \(/)).not.toBeInTheDocument();
  });

  it('switches the active tool when toolbar buttons are clicked', () => {
    renderCanvas();

    expect(screen.getByTitle('Select')).toHaveClass('bg-blue-100');

    fireEvent.click(screen.getByTitle('Highlight'));
    expect(screen.getByTitle('Highlight')).toHaveClass('bg-blue-100');
    expect(screen.getByTitle('Select')).not.toHaveClass('bg-blue-100');

    fireEvent.click(screen.getByTitle('Underline'));
    expect(screen.getByTitle('Underline')).toHaveClass('bg-blue-100');
    expect(screen.getByTitle('Highlight')).not.toHaveClass('bg-blue-100');

    fireEvent.click(screen.getByTitle('Strike Through'));
    expect(screen.getByTitle('Strike Through')).toHaveClass('bg-blue-100');
  });

  it('toggles visibility between student visible and internal only', () => {
    renderCanvas();

    fireEvent.click(screen.getByTitle('Student Visible'));
    expect(screen.getByTitle('Internal Only')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Internal Only'));
    expect(screen.getByTitle('Student Visible')).toBeInTheDocument();
  });

  it('changes the active color when a swatch is clicked', () => {
    renderCanvas();

    expect(screen.getByTitle('Yellow')).toHaveClass('ring-2');
    fireEvent.click(screen.getByTitle('Red'));
    expect(screen.getByTitle('Red')).toHaveClass('ring-2');
    expect(screen.getByTitle('Yellow')).not.toHaveClass('ring-2');
  });

  it('adds a highlight annotation after text selection when the highlight tool is clicked', () => {
    const { callbacks } = renderCanvas();

    selectText('world', 6);
    fireEvent.click(screen.getByTitle('Highlight'));

    expect(callbacks.onAnnotationAdd).toHaveBeenCalledTimes(1);
    expect(callbacks.onAnnotationAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        type: 'highlight',
        startOffset: 6,
        endOffset: 11,
        selectedText: 'world',
        createdBy: 'teacher-1',
      }),
    );
  });

  it('adds an underline annotation via the toolbar', () => {
    const { callbacks } = renderCanvas();

    selectText('Hello', 0);
    fireEvent.click(screen.getByTitle('Underline'));

    expect(callbacks.onAnnotationAdd).toHaveBeenCalledTimes(1);
    expect(callbacks.onAnnotationAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'underline',
        startOffset: 0,
        endOffset: 5,
        selectedText: 'Hello',
      }),
    );
  });

  it('adds a strike-through annotation via the toolbar', () => {
    const { callbacks } = renderCanvas();

    selectText('lo wo', 3);
    fireEvent.click(screen.getByTitle('Strike Through'));

    expect(callbacks.onAnnotationAdd).toHaveBeenCalledTimes(1);
    expect(callbacks.onAnnotationAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'strike_through',
        startOffset: 3,
        endOffset: 8,
        selectedText: 'lo wo',
      }),
    );
  });

  it('adds an inline comment through the comment popup', () => {
    const { callbacks } = renderCanvas();

    fireEvent.click(screen.getByTitle('Add Comment'));
    selectText('world', 6);

    const textarea = screen.getByPlaceholderText('Add your comment...');
    expect(textarea).toBeInTheDocument();
    // Empty comment cannot be submitted
    expect(screen.getByText('Add Comment')).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'Good word choice' } });
    fireEvent.click(screen.getByText('Add Comment'));

    expect(callbacks.onAnnotationAdd).toHaveBeenCalledTimes(1);
    expect(callbacks.onAnnotationAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'inline_comment',
        comment: 'Good word choice',
        startOffset: 6,
        endOffset: 11,
        selectedText: 'world',
      }),
    );
    // Popup closes after submit
    expect(
      screen.queryByPlaceholderText('Add your comment...'),
    ).not.toBeInTheDocument();
  });

  it('cancels the comment popup without adding an annotation', () => {
    const { callbacks } = renderCanvas();

    fireEvent.click(screen.getByTitle('Add Comment'));
    selectText('world', 6);
    fireEvent.change(screen.getByPlaceholderText('Add your comment...'), {
      target: { value: 'draft never saved' },
    });
    fireEvent.click(screen.getByText('Cancel'));

    expect(callbacks.onAnnotationAdd).not.toHaveBeenCalled();
    expect(
      screen.queryByPlaceholderText('Add your comment...'),
    ).not.toBeInTheDocument();
  });

  it('renders quick comments when a comment bank is provided', () => {
    renderCanvas({ commentBank: COMMENT_BANK });

    expect(screen.getByText('Quick Comments')).toBeInTheDocument();
    expect(screen.getByTitle('Check verb tense')).toHaveTextContent('Grammar');
    expect(screen.getByTitle('Internal vocab note')).toHaveTextContent('Vocab');
  });

  it('applies a comment-bank item directly when text is selected', () => {
    const { callbacks } = renderCanvas({ commentBank: COMMENT_BANK });

    selectText('world', 6);
    fireEvent.click(screen.getByTitle('Internal vocab note'));

    expect(callbacks.onAnnotationAdd).toHaveBeenCalledTimes(1);
    expect(callbacks.onAnnotationAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'inline_comment',
        comment: 'Internal vocab note',
        selectedText: 'world',
        // isStudentVisible: false maps to internal_only
        visibility: 'internal_only',
      }),
    );
  });

  it('does not add an annotation when a comment-bank item is clicked without a selection', () => {
    const { callbacks } = renderCanvas({ commentBank: COMMENT_BANK });

    fireEvent.click(screen.getByTitle('Check verb tense'));

    expect(callbacks.onAnnotationAdd).not.toHaveBeenCalled();
  });

  it('renders existing annotations and fires delete from the annotations list', () => {
    const { callbacks, container } = renderCanvas({
      annotations: SAMPLE_ANNOTATIONS,
    });

    expect(screen.getByText('Annotations (2)')).toBeInTheDocument();
    // Quoted selected text + comment body render in the list
    expect(screen.getByText('"world"')).toBeInTheDocument();
    expect(screen.getByText('"Hello"')).toBeInTheDocument();
    expect(screen.getAllByText('Nice opening')).toHaveLength(2);
    // Annotated span exposes the comment via title tooltip
    expect(screen.getByTitle('Nice opening')).toBeInTheDocument();

    const deleteButtons = container.querySelectorAll('.bg-gray-50 button');
    expect(deleteButtons).toHaveLength(2);

    fireEvent.click(deleteButtons[0] as HTMLButtonElement);
    expect(callbacks.onAnnotationDelete).toHaveBeenCalledTimes(1);
    expect(callbacks.onAnnotationDelete).toHaveBeenCalledWith('a-1');

    fireEvent.click(deleteButtons[1] as HTMLButtonElement);
    expect(callbacks.onAnnotationDelete).toHaveBeenCalledWith('a-2');
  });

  it('does not fire update/drawing callbacks for list actions (legacy component has no UI trigger for them)', () => {
    const { callbacks, container } = renderCanvas({
      annotations: [SAMPLE_ANNOTATIONS[0] as WritingAnnotation],
    });

    const deleteButton = container.querySelector(
      '.bg-gray-50 button',
    ) as HTMLButtonElement;
    fireEvent.click(deleteButton);

    expect(callbacks.onAnnotationDelete).toHaveBeenCalledWith('a-1');
    expect(callbacks.onAnnotationUpdate).not.toHaveBeenCalled();
    expect(callbacks.onDrawingAdd).not.toHaveBeenCalled();
    expect(callbacks.onDrawingDelete).not.toHaveBeenCalled();
  });

  it('accepts drawings without crashing (legacy surface renders text annotations only)', () => {
    const drawings: DrawingAnnotation[] = [
      {
        id: 'd-1',
        taskId: 'task-1',
        type: 'freehand_draw',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        color: 'red',
        strokeWidth: 2,
        visibility: 'student_visible',
        createdBy: 'teacher-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    renderCanvas({ drawings });
    expect(screen.getByText(TASK_TEXT)).toBeInTheDocument();
  });
});
