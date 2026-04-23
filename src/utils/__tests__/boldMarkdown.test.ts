import { describe, expect, it } from 'vitest';
import { isBoldHotkey, parseBoldMarkdown, stripBoldMarkdown, toggleBoldMarkers } from '../boldMarkdown';

describe('parseBoldMarkdown', () => {
  it('parses a single bold span', () => {
    expect(parseBoldMarkdown('Hello **bold** world')).toEqual([
      { text: 'Hello ', bold: false },
      { text: 'bold', bold: true },
      { text: ' world', bold: false },
    ]);
  });

  it('parses multiple bold spans', () => {
    expect(parseBoldMarkdown('a **b** c **d**')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c ', bold: false },
      { text: 'd', bold: true },
    ]);
  });

  it('treats unmatched markers as plain text', () => {
    expect(parseBoldMarkdown('a **b c')).toEqual([{ text: 'a **b c', bold: false }]);
  });
});

describe('stripBoldMarkdown', () => {
  it('removes all marker tokens', () => {
    expect(stripBoldMarkdown('a **b** c')).toBe('a b c');
  });
});

describe('toggleBoldMarkers', () => {
  it('wraps a selection in markers', () => {
    const result = toggleBoldMarkers('hello world', 6, 11);
    expect(result.nextValue).toBe('hello **world**');
    expect(result.nextSelectionStart).toBe(8);
    expect(result.nextSelectionEnd).toBe(13);
  });

  it('unwraps when the selection is already wrapped', () => {
    const result = toggleBoldMarkers('hello **world**', 8, 13);
    expect(result.nextValue).toBe('hello world');
    expect(result.nextSelectionStart).toBe(6);
    expect(result.nextSelectionEnd).toBe(11);
  });

  it('inserts markers for an empty selection and places caret inside', () => {
    const result = toggleBoldMarkers('hello', 5, 5);
    expect(result.nextValue).toBe('hello****');
    expect(result.nextSelectionStart).toBe(7);
    expect(result.nextSelectionEnd).toBe(7);
  });
});

describe('isBoldHotkey', () => {
  it('accepts ctrl/cmd + b', () => {
    expect(isBoldHotkey({ key: 'b', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isBoldHotkey({ key: 'B', ctrlKey: false, metaKey: true })).toBe(true);
  });

  it('rejects other keys and alt-modified combos', () => {
    expect(isBoldHotkey({ key: 'x', ctrlKey: true, metaKey: false })).toBe(false);
    expect(isBoldHotkey({ key: 'b', ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
  });
});

