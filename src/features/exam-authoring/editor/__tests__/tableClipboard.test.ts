import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composerBaseExtensions, SAT_CHOICE_COMPOSER_CAPABILITIES, SAT_RICH_COMPOSER_CAPABILITIES } from '../RichQuestionComposer';
import { copiedTableSlice, copyCurrentTable, tableClipboardContent } from '../tableClipboard';
import { INGESTION_LIMITS } from '../ingestion/domain/limits';

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function make() {
  const editor = new Editor({ extensions: composerBaseExtensions(false), content: '<p>Before</p>' });
  editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
  editors.push(editor);
  return editor;
}

describe('whole-table clipboard', () => {
  it('sanitizes forged copy markers without admitting executable HTML or unsafe images', () => {
    const editor = make();
    const slice = copiedTableSlice(editor.view, '<table data-sat-table-copy="1" data-cell-alignment="center" onclick="alert(1)"><tr><td><p><strong>4</strong><script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)"><img src="blob:temporary"></p></td></tr></table>');
    expect(slice?.content.firstChild?.attrs['cellAlignment']).toBe('center');
    expect(slice?.content.firstChild?.textContent).toBe('4');
    expect(JSON.stringify(slice?.toJSON())).not.toMatch(/alert|javascript|blob:|image|onclick|onerror/);
    expect(slice?.content.firstChild?.firstChild?.firstChild?.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold');
  });

  it('leaves ordinary HTML and excessive spans to the existing import pipeline', () => {
    const editor = make();
    expect(copiedTableSlice(editor.view, '<table><tr><td>4</td></tr></table>')).toBeNull();
    expect(copiedTableSlice(editor.view, '<table data-sat-table-copy="1"><tr><td colspan="1000000">4</td></tr></table>')).toBeNull();
    expect(copiedTableSlice(editor.view, '<table data-sat-table-copy="1"><tr><td><p>' + 'x'.repeat(INGESTION_LIMITS.textNodeChars + 1) + '</p></td></tr></table>')).toBeNull();
  });

  it('retains vertical merges and header cells through a rich clipboard import', () => {
    const editor = make();
    const slice = copiedTableSlice(editor.view, '<table data-sat-table-copy="1"><tr><th rowspan="2"><p>Answer</p></th><td><p>3.5</p></td></tr><tr><td><p>3.50</p></td></tr></table>');
    const table = slice?.content.firstChild;
    expect(table?.childCount).toBe(2);
    expect(table?.child(0).child(0).type.name).toBe('tableHeader');
    expect(table?.child(0).child(0).attrs['rowspan']).toBe(2);
    expect(table?.child(1).childCount).toBe(1);
    expect(table?.child(1).textContent).toBe('3.50');
  });

  it('preserves significant spaces and code formatting in cell values', () => {
    const editor = make();
    const slice = copiedTableSlice(editor.view, '\n<table data-sat-table-copy="1"><tr><td><p>  4 +  5  </p><pre><code class="language-latex">x  + y</code></pre></td></tr></table>\n');
    const cell = slice?.content.firstChild?.firstChild?.firstChild;
    expect(cell?.child(0).textContent).toBe('  4 +  5  ');
    expect(cell?.child(1).type.name).toBe('codeBlock');
    expect(cell?.child(1).attrs['language']).toBe('latex');
    expect(cell?.child(1).textContent).toBe('x  + y');
  });

  it('respects the destination capabilities instead of admitting disabled formatting through a copy marker', () => {
    const editor = make();
    const html = '<table data-sat-table-copy="1"><tr><td><h2>Heading</h2><ul><li><p>Value</p></li></ul></td></tr></table>';
    expect(copiedTableSlice(editor.view, html, SAT_RICH_COMPOSER_CAPABILITIES)).not.toBeNull();
    expect(copiedTableSlice(editor.view, html, SAT_CHOICE_COMPOSER_CAPABILITIES)).toBeNull();
  });

  it('copies both rich and plain representations through the native fallback without changing selection', async () => {
    const editor = make();
    document.body.appendChild(editor.view.dom);
    vi.stubGlobal('ClipboardItem', undefined);
    const data: Record<string, string> = {};
    const command = vi.fn(() => {
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData: (kind: string, value: string) => { data[kind] = value; } } });
      editor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: command });
    try {
      const before = editor.getJSON();
      const selection = editor.state.selection.toJSON();
      await copyCurrentTable(editor.view);
      expect(command).toHaveBeenCalledWith('copy');
      expect(data['text/html']).toContain('data-sat-table-copy="1"');
      expect(data['text/plain']).toBe('\t\n\t');
      expect(editor.getJSON()).toEqual(before);
      expect(editor.state.selection.toJSON()).toEqual(selection);
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
      editor.view.dom.remove();
    }
  });

  it('rejects blocked clipboard writes instead of reporting a successful plain-text-only copy', async () => {
    const editor = make();
    vi.stubGlobal('ClipboardItem', class { constructor(_data: Record<string, Blob>) {} });
    const write = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', new Proxy(navigator, {
      get: (target, property) => property === 'clipboard' ? { write } : Reflect.get(target, property, target),
    }));
    await expect(copyCurrentTable(editor.view)).rejects.toThrow('Clipboard copy was blocked.');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does not copy other content when the selection is outside a table', () => {
    const editor = make();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(() => tableClipboardContent(editor.view)).toThrow('Select a table cell first.');
  });
});
