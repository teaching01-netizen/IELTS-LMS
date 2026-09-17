import { useEditorState, type Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Image as ImageIcon,
  Italic,
  Minus,
  MoreHorizontal,
  Plus,
  Redo2,
  Sigma,
  Table as TableIcon,
  Undo2,
} from 'lucide-react';
import { SatMenu, type SatMenuItem } from '@/src/products/sat/ui/Menu';
import { EditorControl } from './EditorControl';
import type { RichComposerCapabilities } from './RichQuestionComposer';
import { resolveComposerContext, selectionKindOf, type ComposerContext } from './composerContext';
import type { EditorFeedbackPublisher } from './editorFeedbackCopy';

export interface ComposerToolbarProps {
  editor: Editor;
  capabilities: Readonly<RichComposerCapabilities>;
  onOpenDialog: (dialog: 'math' | 'image', context?: ComposerContext) => void;
  onTableMutation: () => void;
  onFeedback: EditorFeedbackPublisher;
}

/**
 * The stable half of the editor's interaction model.
 *
 * One row, one order, in every state: style, marks, math, insert, more, history.
 * Object controls never join this row — an image or an equation carries its own
 * controls (see ObjectControls) — and table structure gets its own strip *below*
 * this row, inside the same toolbar. That is what keeps the author's spatial
 * memory intact: typing, selecting text, picking an image, or landing inside a
 * table never moves Bold.
 *
 * Controls a context cannot act on dim (disabled) instead of disappearing, so
 * the row never re-learns itself.
 *
 * Every control is an `EditorControl`, the same one the contextual surfaces use:
 * there is one button recipe in the editor, not one per surface.
 */
export function ComposerToolbar({ editor, capabilities: c, onOpenDialog, onTableMutation, onFeedback }: ComposerToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      context: resolveComposerContext(e.state),
      selection: selectionKindOf(e.state),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      superscript: e.isActive('superscript'),
      subscript: e.isActive('subscript'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      code: e.isActive('codeBlock'),
      style: e.isActive('heading', { level: 2 }) ? 'heading2' : e.isActive('heading', { level: 3 }) ? 'heading3' : 'paragraph',
      undo: typeof e.can().undo === 'function' ? e.can().undo() : false,
      redo: typeof e.can().redo === 'function' ? e.can().redo() : false,
      history: typeof e.can().undo === 'function',
      mergeCells: e.can().mergeCells(),
      splitCell: e.can().splitCell(),
    }),
  });
  const context = state.context;
  // A node selection (image, equation) cannot carry text marks, so those
  // controls dim rather than vanish.
  const nodeSelection = state.selection === 'node';
  const styleLabel = state.style === 'heading2' ? 'Heading' : state.style === 'heading3' ? 'Subheading' : 'Paragraph';
  // Groups are clustered (style / format / math / insert / more / history) so
  // the row reads as grouped actions rather than one long string of icons.
  const group = (name: string, content: React.ReactNode) => (
    <span className="sat-rich-editor__toolbar-group" data-toolbar-group={name}>
      {content}
    </span>
  );
  // `+ Insert` is the discoverability surface: labelled, icon-led, ordered by
  // authoring frequency. `···` carries only advanced formatting, grouped by
  // concept, so it never means "everything that didn't fit".
  const insertMenu = (items: SatMenuItem[]) => (
    <div className="sat-spine__menu">
      <SatMenu
        label="Insert content"
        icon={Plus}
        align="end"
        width={208}
        triggerClassName="sat-rich-editor__menu-trigger"
        items={items}
        triggerContent={
          <span className="sat-rich-editor__insert-trigger">
            <Plus size={13} aria-hidden="true" />
            <span className="sat-rich-editor__toolbar-label">Insert</span>
          </span>
        }
      />
    </div>
  );
  const moreMenu = (items: SatMenuItem[]) => (
    <div className="sat-spine__menu">
      <SatMenu label="More formatting" compact icon={MoreHorizontal} align="end" items={items} />
    </div>
  );
  const table = (action: () => void) => {
    action();
    onTableMutation();
  };
  // Recoverability is a first-class control in every context: the history group
  // mounts once, last in the row, so a mistake anywhere is still one click away.
  const historyGroup =
    c.history && state.history
      ? group(
          'history',
          <>
            <EditorControl label="Undo (⌘Z)" tooltipLabel="Undo" shortcut="⌘Z" disabled={!state.undo} onSelect={() => { editor.chain().focus().undo().run(); }}>
              <Undo2 size={15} />
            </EditorControl>
            <EditorControl label="Redo (⇧⌘Z)" tooltipLabel="Redo" shortcut="⇧⌘Z" disabled={!state.redo} onSelect={() => { editor.chain().focus().redo().run(); }}>
              <Redo2 size={15} />
            </EditorControl>
          </>
        )
      : null;
  // Marks ride in every context at the same spot.
  const formatGroup = group(
    'format',
    <>
      <EditorControl label="Bold (⌘B)" tooltipLabel="Bold" shortcut="⌘B" active={state.bold} disabled={nodeSelection} onSelect={() => { editor.chain().focus().toggleBold().run(); }}>
        <Bold size={15} />
      </EditorControl>
      <EditorControl label="Italic (⌘I)" tooltipLabel="Italic" shortcut="⌘I" active={state.italic} disabled={nodeSelection} onSelect={() => { editor.chain().focus().toggleItalic().run(); }}>
        <Italic size={15} />
      </EditorControl>
    </>
  );
  const moreItems: SatMenuItem[] = [];
  if (c.underline) {
    moreItems.push({ id: 'underline', label: 'Underline (⌘U)', current: state.underline, onSelect: () => { editor.chain().focus().toggleUnderline().run(); } });
  }
  moreItems.push(
    { id: 'super', label: 'Superscript', current: state.superscript, separatorBefore: true, onSelect: () => { editor.chain().focus().toggleSuperscript().run(); } },
    { id: 'sub', label: 'Subscript', current: state.subscript, onSelect: () => { editor.chain().focus().toggleSubscript().run(); } }
  );
  if (c.lists) {
    moreItems.push(
      { id: 'bullet', label: 'Bulleted list', current: state.bullet, separatorBefore: true, onSelect: () => { editor.chain().focus().toggleBulletList().run(); } },
      { id: 'ordered', label: 'Numbered list', current: state.ordered, onSelect: () => { editor.chain().focus().toggleOrderedList().run(); } }
    );
  }
  moreItems.push({
    id: 'clear',
    label: 'Clear formatting',
    separatorBefore: true,
    onSelect: () => {
      editor.chain().focus().unsetAllMarks().clearNodes().run();
      onFeedback({ message: 'Formatting cleared', undoable: true });
    },
  });
  const moreGroup = group('more', moreMenu(moreItems));
  // The style control is a formatting command, not a form field: its trigger
  // carries the current style in plain text, and the menu renders every option
  // at the weight and size it applies, so the choice explains itself.
  const styleGroup = c.blockStyles
    ? group(
        'style',
        <div className="sat-spine__menu">
          <SatMenu
            label="Text style"
            align="start"
            width={176}
            triggerClassName="sat-rich-editor__menu-trigger"
            triggerContent={<span>{styleLabel}</span>}
            items={[
              { id: 'paragraph', label: 'Paragraph', current: state.style === 'paragraph', preview: <span className="sat-rich-editor__style-option sat-rich-editor__style-option--paragraph">Paragraph</span>, onSelect: () => { editor.chain().focus().setParagraph().run(); } },
              { id: 'heading2', label: 'Heading', current: state.style === 'heading2', preview: <span className="sat-rich-editor__style-option sat-rich-editor__style-option--heading">Heading</span>, onSelect: () => { editor.chain().focus().setHeading({ level: 2 }).run(); } },
              { id: 'heading3', label: 'Subheading', current: state.style === 'heading3', preview: <span className="sat-rich-editor__style-option sat-rich-editor__style-option--subheading">Subheading</span>, onSelect: () => { editor.chain().focus().setHeading({ level: 3 }).run(); } },
            ]}
          />
        </div>
      )
    : null;
  const mathGroup = c.equation
    ? group(
        'math',
        <EditorControl label="Insert equation" onSelect={() => onOpenDialog('math')}>
          <span className="sat-rich-editor__toolbar-action">
            <Sigma size={15} />
            Math
          </span>
        </EditorControl>
      )
    : null;
  const insert: SatMenuItem[] = [];
  if (c.image) insert.push({ id: 'image', label: 'Insert image or graph', icon: ImageIcon, onSelect: () => onOpenDialog('image') });
  if (c.equation) insert.push({ id: 'equation', label: 'Insert equation', icon: Sigma, onSelect: () => onOpenDialog('math') });
  if (c.table) insert.push({ id: 'table', label: 'Insert table', icon: TableIcon, onSelect: () => table(() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }) });
  if (c.blockStyles) insert.push({ id: 'divider', label: 'Divider', icon: Minus, separatorBefore: true, onSelect: () => { editor.chain().focus().setHorizontalRule().run(); } });
  if (c.code) insert.push({ id: 'code', label: 'Code block', icon: Code, current: state.code, onSelect: () => { editor.chain().focus().toggleCodeBlock().run(); } });
  const insertGroup = insert.length ? group('insert', insertMenu(insert)) : null;

  return (
    <div
      className="sat-rich-editor__toolbar"
      role="toolbar"
      aria-label="Formatting tools"
      data-composer-context={context.kind}
      data-selection-kind={state.selection}
    >
      <div className="sat-rich-editor__toolbar-row">
        {styleGroup}
        {formatGroup}
        {mathGroup}
        {insertGroup}
        {moreGroup}
        {historyGroup}
      </div>
      {context.kind === 'table' ? (
        // Table structure lives one row below the shared controls, inside the
        // same toolbar: the main row never changes shape, and the strip still
        // reads as "these actions belong to the table I am in".
        <div className="sat-rich-editor__table-toolbar" role="group" aria-label="Table tools">
          <div className="sat-rich-editor__table-toolbar-row">
            <span className="sat-rich-editor__table-label">Table</span>
            <EditorControl className="sat-rich-editor__table-action" label="Add row" onSelect={() => table(() => { editor.chain().focus().addRowAfter().run(); })}>
              Add row
            </EditorControl>
            <EditorControl className="sat-rich-editor__table-action" label="Add column" onSelect={() => table(() => { editor.chain().focus().addColumnAfter().run(); })}>
              Add column
            </EditorControl>
            <span className="sat-rich-editor__table-divider" aria-hidden="true" />
            <SatMenu
              label="Table actions"
              compact
              icon={MoreHorizontal}
              align="end"
              items={[
                { id: 'before-row', label: 'Add row before', onSelect: () => table(() => { editor.chain().focus().addRowBefore().run(); }) },
                { id: 'before-column', label: 'Add column before', onSelect: () => table(() => { editor.chain().focus().addColumnBefore().run(); }) },
                { id: 'header', label: 'Toggle header row', separatorBefore: true, onSelect: () => table(() => { editor.chain().focus().toggleHeaderRow().run(); }) },
                { id: 'merge', label: 'Merge cells', disabled: !state.mergeCells, onSelect: () => table(() => { editor.chain().focus().mergeCells().run(); }) },
                { id: 'split', label: 'Split cell', disabled: !state.splitCell, onSelect: () => table(() => { editor.chain().focus().splitCell().run(); }) },
                { id: 'row', label: 'Delete row', destructive: true, separatorBefore: true, onSelect: () => table(() => { editor.chain().focus().deleteRow().run(); }) },
                { id: 'column', label: 'Delete column', destructive: true, onSelect: () => table(() => { editor.chain().focus().deleteColumn().run(); }) },
                { id: 'table', label: 'Delete table', destructive: true, onSelect: () => table(() => { editor.chain().focus().deleteTable().run(); }) },
              ]}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
