import { useEditorState, type Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { Bold, Italic, MoreHorizontal, Plus, Redo2, Sigma, Undo2 } from 'lucide-react';
import { SatMenu, type SatMenuItem } from '@/src/products/sat/ui/Menu';
import type { RichComposerCapabilities } from './RichQuestionComposer';
import { resolveComposerContext, type ComposerContext } from './composerContext';

export interface ComposerToolbarProps {
  editor: Editor;
  capabilities: Readonly<RichComposerCapabilities>;
  onOpenDialog: (dialog: 'math' | 'image', context?: ComposerContext) => void;
  onTableMutation: () => void;
}

/**
 * The toolbar keeps one stable skeleton in every selection context: standard
 * controls hold their position, contextual actions join at the left, and
 * undo/redo anchor the right. Controls a node selection cannot act on dim
 * (disabled) instead of disappearing, so the row never re-learns itself.
 */
export function ComposerToolbar({ editor, capabilities: c, onOpenDialog, onTableMutation }: ComposerToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      context: resolveComposerContext(e.state),
      nodeSelection: e.state.selection instanceof NodeSelection,
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
    }),
  });
  const context = state.context;
  const menu = (label: string, items: SatMenuItem[], compact = false) => <div className="sat-spine__menu"><SatMenu label={label} compact icon={compact ? MoreHorizontal : Plus} triggerContent={compact ? undefined : <span className="flex items-center gap-1 whitespace-nowrap">{label === 'Insert content' ? <><Plus size={13} aria-hidden="true" />Insert</> : label}</span>} items={items} align="end" /></div>;
  const button = (label: string, action: () => void, content: React.ReactNode = label, active?: boolean, disabled?: boolean) => <button type="button" className="sat-rich-editor__toolbar-button" aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={action}>{content}</button>;
  // Controls are clustered into sets (context / style / format / math / insert /
  // more / history) so the toolbar reads as grouped actions rather than one
  // long string of icons.
  const group = (name: string, content: React.ReactNode) => <span className="sat-rich-editor__toolbar-group" data-toolbar-group={name}>{content}</span>;
  const contextLabel = (text: string) => <span className="sat-rich-editor__context-label">{text}</span>;
  const table = (action: () => void) => { action(); onTableMutation(); };
  // Recoverability is a first-class control in every context: the history
  // group mounts once, outside the context branches, so a mistake while
  // editing a table, equation, or image is still one click away. The buttons
  // disable (never hide) when the stack is empty, so nothing shifts position.
  const historyGroup = c.history && state.history ? group('history', <>
    {button('Undo (⌘Z)', () => { editor.chain().focus().undo().run(); }, <Undo2 size={15} />, undefined, !state.undo)}
    {button('Redo (⇧⌘Z)', () => { editor.chain().focus().redo().run(); }, <Redo2 size={15} />, undefined, !state.redo)}
  </>) : null;
  // Text formatting rides along in every context at the same spot; a node
  // selection (image, equation) cannot carry marks, so those controls dim
  // instead of vanishing and the row keeps its shape.
  const formatGroup = group('format', <>
    {button('Bold (⌘B)', () => { editor.chain().focus().toggleBold().run(); }, <Bold size={15} />, state.bold, state.nodeSelection)}
    {button('Italic (⌘I)', () => { editor.chain().focus().toggleItalic().run(); }, <Italic size={15} />, state.italic, state.nodeSelection)}
  </>);
  const moreItems: SatMenuItem[] = [];
  if (c.underline) moreItems.push({ id: 'underline', label: 'Underline (⌘U)', current: state.underline, onSelect: () => { editor.chain().focus().toggleUnderline().run(); } });
  moreItems.push({ id: 'super', label: 'Superscript', current: state.superscript, onSelect: () => { editor.chain().focus().toggleSuperscript().run(); } }, { id: 'sub', label: 'Subscript', current: state.subscript, onSelect: () => { editor.chain().focus().toggleSubscript().run(); } });
  if (c.lists) moreItems.push({ id: 'bullet', label: 'Bulleted list', current: state.bullet, onSelect: () => { editor.chain().focus().toggleBulletList().run(); } }, { id: 'ordered', label: 'Numbered list', current: state.ordered, onSelect: () => { editor.chain().focus().toggleOrderedList().run(); } });
  const moreGroup = group('more', menu('More formatting', moreItems, true));
  const styleGroup = c.blockStyles ? group('style', <select aria-label="Text style" className="sat-rich-editor__style-select" value={state.style} disabled={state.nodeSelection} onChange={e => { const ch = editor.chain().focus(); if (e.target.value === 'heading2') ch.setHeading({ level: 2 }).run(); else if (e.target.value === 'heading3') ch.setHeading({ level: 3 }).run(); else ch.setParagraph().run(); }}><option value="paragraph">Paragraph</option><option value="heading2">Heading</option><option value="heading3">Subheading</option></select>) : null;
  let contextual: React.ReactNode = null;
  let insertGroup: React.ReactNode = null;
  let mathGroup: React.ReactNode = null;
  if (context.kind === 'table') {
    contextual = <>{contextLabel('Table')}{button('Add row', () => table(() => { editor.chain().focus().addRowAfter().run(); }))}{button('Add column', () => table(() => { editor.chain().focus().addColumnAfter().run(); }))}{menu('Table actions', [
      { id: 'before-row', label: 'Add row before', onSelect: () => table(() => { editor.chain().focus().addRowBefore().run(); }) },
      { id: 'before-column', label: 'Add column before', onSelect: () => table(() => { editor.chain().focus().addColumnBefore().run(); }) },
      { id: 'header', label: 'Toggle header row', onSelect: () => table(() => { editor.chain().focus().toggleHeaderRow().run(); }) },
      { id: 'merge', label: 'Merge cells', disabled: !editor.can().mergeCells(), onSelect: () => table(() => { editor.chain().focus().mergeCells().run(); }) },
      { id: 'split', label: 'Split cell', disabled: !editor.can().splitCell(), onSelect: () => table(() => { editor.chain().focus().splitCell().run(); }) },
      { id: 'row', label: 'Delete row', destructive: true, onSelect: () => table(() => { editor.chain().focus().deleteRow().run(); }) },
      { id: 'column', label: 'Delete column', destructive: true, onSelect: () => table(() => { editor.chain().focus().deleteColumn().run(); }) },
      { id: 'table', label: 'Delete table', destructive: true, onSelect: () => table(() => { editor.chain().focus().deleteTable().run(); }) },
    ], true)}</>;
    mathGroup = c.equation ? group('math', button('Insert equation', () => onOpenDialog('math'), <span className="flex items-center gap-1"><Sigma size={15} />Math</span>)) : null;
  } else if (context.kind === 'equation') {
    const convert = (display: boolean) => { if (display === context.display) return; const node = editor.state.doc.nodeAt(context.pos); if (!node) return; editor.chain().focus().insertContentAt({ from: context.pos, to: context.pos + node.nodeSize }, { type: display ? 'blockMath' : 'inlineMath', attrs: { latex: context.latex } }).run(); };
    contextual = <>{contextLabel('Equation')}{button('Inline equation', () => convert(false), 'Inline', !context.display)}{button('Block equation', () => convert(true), 'Block', context.display)}{button('Edit equation', () => onOpenDialog('math', context), 'Edit')}{menu('Equation actions', [{ id: 'delete', label: 'Delete equation', destructive: true, onSelect: () => { editor.chain().focus().setNodeSelection(context.pos).deleteSelection().run(); } }], true)}</>;
  } else if (context.kind === 'image') {
    contextual = <>{contextLabel('Image')}{button('Replace image', () => onOpenDialog('image', context), 'Replace')}{button('Edit alternative text', () => onOpenDialog('image', context), 'Alt text')}{button('Delete image', () => { editor.chain().focus().setNodeSelection(context.pos).deleteSelection().run(); }, 'Delete')}</>;
  } else {
    const insert: SatMenuItem[] = [];
    if (c.image) insert.push({ id: 'image', label: 'Insert image or graph', onSelect: () => onOpenDialog('image') });
    if (c.table) insert.push({ id: 'table', label: 'Insert table', onSelect: () => table(() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }) });
    if (c.equation) insert.push({ id: 'equation', label: 'Insert equation', onSelect: () => onOpenDialog('math') });
    if (c.code) insert.push({ id: 'code', label: 'Code block', current: state.code, onSelect: () => { editor.chain().focus().toggleCodeBlock().run(); } });
    if (c.blockStyles) insert.push({ id: 'divider', label: 'Divider', onSelect: () => { editor.chain().focus().setHorizontalRule().run(); } });
    insertGroup = insert.length ? group('insert', menu('Insert content', insert)) : null;
    mathGroup = c.equation ? group('math', button('Insert equation', () => onOpenDialog('math'), <span className="flex items-center gap-1"><Sigma size={15} />Math</span>)) : null;
  }
  return <div className="sat-rich-editor__toolbar" role="toolbar" aria-label="Formatting tools" data-composer-context={context.kind}><div className="sat-rich-editor__toolbar-row">{contextual}{styleGroup}{formatGroup}{mathGroup}{insertGroup}{moreGroup}{historyGroup}</div></div>;
}
