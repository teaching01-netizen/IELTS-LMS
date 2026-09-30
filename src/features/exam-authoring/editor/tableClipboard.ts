import DOMPurify from 'dompurify';
import { DOMParser as SchemaDOMParser, Fragment, Slice, type Node } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import { INGESTION_LIMITS } from './ingestion/domain/limits';
import { isDirectImageSource } from './schema/imageNode';
import type { RichComposerCapabilities } from './RichQuestionComposer';

export function currentTable(view: EditorView): { node: Node; pos: number } | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'table') return { node: $from.node(depth), pos: $from.before(depth) };
  }
  return null;
}

/** Serialize schema content, rather than copying editor controls or math node views. */
export function tableClipboardContent(view: EditorView): { html: string; text: string } {
  const table = currentTable(view);
  if (!table) throw new Error('Select a table cell first.');
  const { dom } = view.serializeForClipboard(new Slice(Fragment.from(table.node), 0, 0));
  const element = dom.querySelector('table')!;
  element.setAttribute('data-sat-table-copy', '1');
  element.style.borderCollapse = 'collapse';
  const liveCells = (view.nodeDOM(table.pos) as HTMLElement).querySelectorAll('td, th');
  // Inline presentation also makes the HTML useful in other rich-text apps.
  element.querySelectorAll<HTMLElement>('td, th').forEach((cell, index) => {
    const align = cell.style.textAlign;
    if (align) cell.setAttribute('align', align);
    const live = liveCells[index];
    if (!live) return;
    const style = getComputedStyle(live);
    for (const property of ['text-align', 'vertical-align', 'border', 'padding', 'background-color']) {
      cell.style.setProperty(property, style.getPropertyValue(property));
    }
  });
  // The schema's atom serializer stores LaTeX in attributes. Include a readable
  // value for destinations that do not understand our equation nodes.
  element.querySelectorAll<HTMLElement>('[data-latex]').forEach(math => {
    math.textContent = math.getAttribute('data-latex');
  });
  const rows: string[] = [];
  table.node.forEach(row => {
    const cells: string[] = [];
    row.forEach(cell => cells.push(cell.textBetween(0, cell.content.size, ' ', node =>
      node.type.name === 'inlineMath' || node.type.name === 'blockMath'
        ? String(node.attrs['latex'] ?? '') : String(node.attrs['alt'] ?? '')
    ).replace(/[\t\r\n]/g, ' ')));
    rows.push(cells.join('\t'));
  });
  return { html: dom.innerHTML, text: rows.join('\n') };
}

export async function copyCurrentTable(view: EditorView): Promise<void> {
  const content = tableClipboardContent(view);
  view.focus();
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([content.html], { type: 'text/html' }),
        'text/plain': new Blob([content.text], { type: 'text/plain' }),
      })]);
      return;
    } catch {
      // Some browsers expose the API but block writes; try the native copy event.
    }
  }
  let copied = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/html', content.html);
    event.clipboardData.setData('text/plain', content.text);
    event.preventDefault();
    event.stopPropagation();
    copied = true;
  };
  const document = view.dom.ownerDocument;
  document.addEventListener('copy', onCopy, true);
  try {
    if (!document.execCommand?.('copy') || !copied) throw new Error('Clipboard copy was blocked.');
  } finally {
    document.removeEventListener('copy', onCopy, true);
  }
}

/** The marker selects a format, never a trust level: sanitize and parse the shared schema. */
export function copiedTableSlice(view: EditorView, html: string | null, capabilities?: Readonly<RichComposerCapabilities>): Slice | null {
  if (!html?.includes('data-sat-table-copy') || html.length > INGESTION_LIMITS.clipboardChars) return null;
  try {
    return parseCopiedTable(view, html, capabilities);
  } catch {
    return null;
  }
}

function parseCopiedTable(view: EditorView, html: string, capabilities?: Readonly<RichComposerCapabilities>): Slice | null {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['table', 'colgroup', 'col', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
      'p', 'h2', 'h3', 'div', 'span', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
      'pre', 'code', 'ul', 'ol', 'li', 'hr', 'img', 'a'],
    ALLOWED_ATTR: ['data-sat-table-copy', 'data-cell-alignment', 'data-type', 'data-latex',
      'colspan', 'rowspan', 'colwidth', 'align', 'start', 'src', 'alt', 'title', 'assetid',
      'caption', 'data-align', 'data-size', 'href', 'target', 'rel', 'class'],
    ALLOW_DATA_ATTR: false,
  });
  const body = view.dom.ownerDocument.createElement('div');
  body.innerHTML = clean;
  const element = body.firstElementChild;
  if (body.children.length !== 1 || element?.tagName !== 'TABLE'
    || element.getAttribute('data-sat-table-copy') !== '1' || body.querySelectorAll('table').length !== 1) return null;
  const rows = element.querySelectorAll('tr');
  if (rows.length > INGESTION_LIMITS.tableRows) return null;
  let area = 0;
  for (const cell of element.querySelectorAll('td, th')) {
    const cols = Number(cell.getAttribute('colspan') ?? 1);
    const spans = Number(cell.getAttribute('rowspan') ?? 1);
    if (!Number.isInteger(cols) || cols < 1 || cols > INGESTION_LIMITS.tableCols
      || !Number.isInteger(spans) || spans < 1 || spans > rows.length) return null;
    area += cols * spans;
  }
  if (area > INGESTION_LIMITS.tableCells) return null;
  for (const image of element.querySelectorAll('img')) {
    if (!isDirectImageSource(image.getAttribute('src') ?? '')) image.remove();
  }
  body.replaceChildren(element);
  const table = SchemaDOMParser.fromSchema(view.state.schema).parse(body, { preserveWhitespace: true }).firstChild;
  if (table?.type.name !== 'table') return null;
  let withinLimits = true;
  table.descendants(node => {
    if ((node.text?.length ?? 0) > INGESTION_LIMITS.textNodeChars
      || String(node.attrs['latex'] ?? '').length > INGESTION_LIMITS.latexChars) withinLimits = false;
    if (capabilities && (
      (!capabilities.lists && ['bulletList', 'orderedList'].includes(node.type.name))
      || (!capabilities.blockStyles && ['heading', 'horizontalRule'].includes(node.type.name))
      || (!capabilities.equation && ['inlineMath', 'blockMath'].includes(node.type.name))
      || (!capabilities.image && node.type.name === 'image')
      || (!capabilities.code && node.type.name === 'codeBlock')
      || (!capabilities.underline && node.marks.some(mark => mark.type.name === 'underline'))
    )) withinLimits = false;
  });
  if (!withinLimits) return null;
  const map = TableMap.get(table);
  if (map.width > INGESTION_LIMITS.tableCols || map.width * map.height > INGESTION_LIMITS.tableCells) return null;
  return new Slice(Fragment.from(table), 0, 0);
}
