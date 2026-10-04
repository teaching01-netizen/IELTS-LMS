import { useEditorState, type Editor } from '@tiptap/react';
import { useState } from 'react';
import {
  Bold,
  Code,
  Image as ImageIcon,
  Italic,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Plus,
  Redo2,
  Sigma,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { SatMenu, type SatMenuItem } from '@/src/products/sat/ui/Menu';
import { EditorControl } from './EditorControl';
import type { RichComposerCapabilities } from './RichQuestionComposer';
import { resolveComposerContext, selectionKindOf, type ComposerContext } from './composerContext';
import type { EditorFeedbackPublisher } from './editorFeedbackCopy';
import { insertEquationInPlace } from './objectOps';
import { storedTextAlignment, type TextAlignment } from '../api/textAlignment';
import { copyCurrentTable } from './tableClipboard';

const ALIGNMENTS: ReadonlyArray<{ id: TextAlignment; label: string; shortcut: string; icon: LucideIcon }> = [
  { id: 'left', label: 'Align left', shortcut: '⇧⌘L', icon: TextAlignStart },
  { id: 'center', label: 'Align center', shortcut: '⇧⌘E', icon: TextAlignCenter },
  { id: 'right', label: 'Align right', shortcut: '⇧⌘R', icon: TextAlignEnd },
  { id: 'justify', label: 'Justify', shortcut: '⇧⌘J', icon: TextAlignJustify },
];

// Characters an SAT author types often and a keyboard does not offer. The menu
// face shows the glyph; the accessible name is the spoken one.
const SYMBOLS: ReadonlyArray<{ id: string; label: string; text: string }> = [
  { id: 'blank', label: 'Blank', text: '______' },
  { id: 'em-dash', label: 'Em dash', text: '—' },
  { id: 'en-dash', label: 'En dash', text: '–' },
  { id: 'ellipsis', label: 'Ellipsis', text: '…' },
  { id: 'degree', label: 'Degree', text: '°' },
  { id: 'plus-minus', label: 'Plus or minus', text: '±' },
  { id: 'times', label: 'Multiplication sign', text: '×' },
  { id: 'divide', label: 'Division sign', text: '÷' },
  { id: 'leq', label: 'Less than or equal to', text: '≤' },
  { id: 'geq', label: 'Greater than or equal to', text: '≥' },
  { id: 'neq', label: 'Not equal to', text: '≠' },
  { id: 'pi', label: 'Pi', text: 'π' },
];

export interface ComposerToolbarProps {
  editor: Editor;
  capabilities: Readonly<RichComposerCapabilities>;
  onOpenDialog: (dialog: 'image', context?: ComposerContext) => void;
  onTableMutation: () => void;
  onFeedback: EditorFeedbackPublisher;
  /** Opens the workspace keyboard-shortcut sheet; the menu item hides without it. */
  onOpenShortcutHelp?: (() => void) | undefined;
}

/**
 * The stable half of the editor's interaction model.
 *
 * One row, one order, in every state, laid out like a word processor: history,
 * style, marks, scripts, lists, alignment, math, insert, more.
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
export function ComposerToolbar({ editor, capabilities: c, onOpenDialog, onTableMutation, onFeedback, onOpenShortcutHelp }: ComposerToolbarProps) {
  const [copyingTable, setCopyingTable] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      context: resolveComposerContext(e.state),
      selection: selectionKindOf(e.state),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      superscript: e.isActive('superscript'),
      subscript: e.isActive('subscript'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      code: e.isActive('codeBlock'),
      align: storedTextAlignment(e.getAttributes(e.isActive('heading') ? 'heading' : 'paragraph')['textAlign']) ?? 'left',
      canIndent: e.can().sinkListItem('listItem'),
      canOutdent: e.can().liftListItem('listItem'),
      style: e.isActive('heading', { level: 2 }) ? 'heading2' : e.isActive('heading', { level: 3 }) ? 'heading3' : 'paragraph',
      undo: typeof e.can().undo === 'function' ? e.can().undo() : false,
      redo: typeof e.can().redo === 'function' ? e.can().redo() : false,
      history: typeof e.can().undo === 'function',
      mergeCells: e.can().mergeCells(),
      splitCell: e.can().splitCell(),
      inTable: e.isActive('table'),
      centeredTable: e.getAttributes('table')['cellAlignment'] === 'center',
    }),
  });
  const context = state.context;
  // A node selection (image, equation) cannot carry text marks, so those
  // controls dim rather than vanish.
  const nodeSelection = state.selection === 'node';
  const styleLabel = state.style === 'heading2' ? 'Heading' : state.style === 'heading3' ? 'Subheading' : 'Paragraph';
  // Groups are clustered (history / style / marks / scripts / lists / align /
  // math / insert / more) so the row reads as grouped actions rather than one
  // long string of icons.
  const group = (name: string, content: React.ReactNode) => (
    <span className="sat-rich-editor__toolbar-group" data-toolbar-group={name}>
      {content}
    </span>
  );
  // `+ Insert` is the discoverability surface: labelled, icon-led, ordered by
  // authoring frequency, then the symbols a keyboard lacks. `···` carries only
  // housekeeping, so it never means "everything that didn't fit".
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
  // mounts once, first in the row (where word processors put it), so a mistake
  // anywhere is still one click away.
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
      {c.underline ? (
        <EditorControl label="Underline (⌘U)" tooltipLabel="Underline" shortcut="⌘U" active={state.underline} disabled={nodeSelection} onSelect={() => { editor.chain().focus().toggleUnderline().run(); }}>
          <Underline size={15} />
        </EditorControl>
      ) : null}
      <EditorControl label="Strikethrough (⇧⌘S)" tooltipLabel="Strikethrough" shortcut="⇧⌘S" active={state.strike} disabled={nodeSelection} onSelect={() => { editor.chain().focus().toggleStrike().run(); }}>
        <Strikethrough size={15} />
      </EditorControl>
    </>
  );
  const scriptGroup = group(
    'script',
    <>
      <EditorControl label="Superscript (⌘.)" tooltipLabel="Superscript" shortcut="⌘." active={state.superscript} disabled={nodeSelection} onSelect={() => { editor.chain().focus().toggleSuperscript().run(); }}>
        <Superscript size={15} />
      </EditorControl>
      <EditorControl label="Subscript (⌘,)" tooltipLabel="Subscript" shortcut="⌘," active={state.subscript} disabled={nodeSelection} onSelect={() => { editor.chain().focus().toggleSubscript().run(); }}>
        <Subscript size={15} />
      </EditorControl>
    </>
  );
  // Indent and outdent nest list items (Tab / ⇧Tab do the same); outside a
  // list there is nothing to nest, so they dim.
  const listGroup = c.lists
    ? group(
        'lists',
        <>
          <EditorControl label="Bulleted list (⇧⌘8)" tooltipLabel="Bulleted list" shortcut="⇧⌘8" active={state.bullet} onSelect={() => { editor.chain().focus().toggleBulletList().run(); }}>
            <List size={15} />
          </EditorControl>
          <EditorControl label="Numbered list (⇧⌘7)" tooltipLabel="Numbered list" shortcut="⇧⌘7" active={state.ordered} onSelect={() => { editor.chain().focus().toggleOrderedList().run(); }}>
            <ListOrdered size={15} />
          </EditorControl>
          <EditorControl label="Decrease indent (⇧Tab)" tooltipLabel="Decrease indent" shortcut="⇧Tab" disabled={!state.canOutdent} onSelect={() => { editor.chain().focus().liftListItem('listItem').run(); }}>
            <ListIndentDecrease size={15} />
          </EditorControl>
          <EditorControl label="Increase indent (Tab)" tooltipLabel="Increase indent" shortcut="Tab" disabled={!state.canIndent} onSelect={() => { editor.chain().focus().sinkListItem('listItem').run(); }}>
            <ListIndentIncrease size={15} />
          </EditorControl>
        </>
      )
    : null;
  const currentAlignment = ALIGNMENTS.find((option) => option.id === state.align) ?? ALIGNMENTS[0]!;
  const CurrentAlignmentIcon = currentAlignment.icon;
  const alignGroup = c.blockStyles
    ? group(
        'align',
        <div className="sat-spine__menu">
          <SatMenu
            label="Text alignment"
            align="start"
            width={208}
            triggerClassName="sat-rich-editor__menu-trigger"
            triggerContent={<CurrentAlignmentIcon size={15} aria-hidden="true" />}
            items={ALIGNMENTS.map((option) => ({
              id: option.id,
              label: `${option.label} (${option.shortcut})`,
              icon: option.icon,
              current: state.align === option.id,
              onSelect: () => { editor.chain().focus().setTextAlign(option.id).run(); },
            }))}
          />
        </div>
      )
    : null;
  const moreItems: SatMenuItem[] = [{
    id: 'clear',
    label: 'Clear formatting',
    onSelect: () => {
      editor.chain().focus().unsetAllMarks().clearNodes().run();
      onFeedback({ message: 'Formatting cleared', undoable: true });
    },
  }];
  if (onOpenShortcutHelp) moreItems.push({ id: 'shortcuts', label: 'Keyboard shortcuts (⌘/)', separatorBefore: true, onSelect: onOpenShortcutHelp });
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
        <EditorControl label="Insert equation" onSelect={() => { insertEquationInPlace(editor); }}>
          <Sigma size={15} />
        </EditorControl>
      )
    : null;
  const insert: SatMenuItem[] = [];
  if (c.image) insert.push({ id: 'image', label: 'Insert image or graph', icon: ImageIcon, onSelect: () => onOpenDialog('image') });
  if (c.equation) insert.push({ id: 'equation', label: 'Insert equation', icon: Sigma, onSelect: () => { insertEquationInPlace(editor); } });
  if (c.table) insert.push({ id: 'table', label: 'Insert table', icon: TableIcon, onSelect: () => table(() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }) });
  if (c.blockStyles) insert.push({ id: 'divider', label: 'Divider', icon: Minus, separatorBefore: true, onSelect: () => { editor.chain().focus().setHorizontalRule().run(); } });
  if (c.code) insert.push({ id: 'code', label: 'Code block', icon: Code, current: state.code, onSelect: () => { editor.chain().focus().toggleCodeBlock().run(); } });
  SYMBOLS.forEach((symbol, index) => insert.push({
    id: symbol.id,
    label: symbol.label,
    separatorBefore: index === 0,
    preview: (
      <span className="sat-rich-editor__symbol-option">
        <span className="sat-rich-editor__symbol-glyph" aria-hidden="true">{symbol.text}</span>
        {symbol.label}
      </span>
    ),
    onSelect: () => { editor.chain().focus().insertContent(symbol.text).run(); },
  }));
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
        {historyGroup}
        {styleGroup}
        {formatGroup}
        {scriptGroup}
        {listGroup}
        {alignGroup}
        {mathGroup}
        {insertGroup}
        {moreGroup}
      </div>
      {state.inTable ? (
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
            <EditorControl
              className="sat-rich-editor__toolbar-button sat-rich-editor__table-action"
              label="Center all cells"
              tooltipLabel="Center every cell horizontally and vertically"
              active={state.centeredTable}
              disabled={!editor.isEditable}
              onSelect={() => {
                const applied = editor.chain().focus().command(({ tr }) => {
                  const $from = tr.selection.$from;
                  for (let depth = $from.depth; depth > 0; depth--) {
                    if ($from.node(depth).type.name !== 'table') continue;
                    tr.setNodeAttribute($from.before(depth), 'cellAlignment', state.centeredTable ? null : 'center');
                    return true;
                  }
                  return false;
                }).run();
                if (!applied) return;
                onTableMutation();
                onFeedback({ message: state.centeredTable ? 'Table cell alignment restored' : 'All table cells centered horizontally and vertically', undoable: true });
              }}
            >
              Center all cells
            </EditorControl>
            <EditorControl
              className="sat-rich-editor__toolbar-button sat-rich-editor__table-action"
              label="Copy table"
              tooltipLabel="Copy the entire table with contents and formatting"
              disabled={copyingTable}
              onSelect={async () => {
                setCopyingTable(true);
                try {
                  await copyCurrentTable(editor.view);
                  onFeedback({ message: 'Table copied with contents and formatting' });
                } catch {
                  onFeedback({ message: 'Could not copy the table. Check clipboard access and try again.' });
                } finally {
                  setCopyingTable(false);
                }
              }}
            >
              {copyingTable ? 'Copying…' : 'Copy table'}
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
