import { describe, expect, it } from 'vitest';
import { escapeCsvCell } from '../csvExport';

describe('escapeCsvCell', () => {
  it('always quotes cells (RFC 4180)', () => {
    expect(escapeCsvCell('plain')).toBe('"plain"');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('normalizes CRLF/CR to LF inside a cell', () => {
    expect(escapeCsvCell('a\r\nb')).toBe('"a\nb"');
    expect(escapeCsvCell('a\rb')).toBe('"a\nb"');
  });

  it('neutralizes spreadsheet formula prefixes', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell('+1')).toBe(`"'+1"`);
    expect(escapeCsvCell('@cmd')).toBe(`"'@cmd"`);
  });

  it('stringifies null/undefined/numbers safely', () => {
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
    expect(escapeCsvCell(42)).toBe('"42"');
  });
});
