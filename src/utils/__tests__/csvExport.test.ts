import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCsvRows, escapeCsvCell } from '../csvExport';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it('downloads complete rows with UTF-8, quoting, newline, and formula protections', () => {
    class CapturedBlob {
      parts: string[];
      type: string;

      constructor(parts: string[], options?: BlobPropertyBag) {
        this.parts = parts;
        this.type = options?.type ?? '';
      }
    }
    let capturedContent = '';
    let capturedType = '';
    const createObjectURL = vi.fn((blob: Blob) => {
      const captured = blob as unknown as CapturedBlob;
      capturedContent = captured.parts.join('');
      capturedType = captured.type;
      return 'blob:test';
    });
    const revokeObjectURL = vi.fn();
    vi.useFakeTimers();
    vi.stubGlobal('Blob', CapturedBlob);
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick() {
      expect(document.body.contains(this)).toBe(true);
      expect(this.download).toBe('sat.csv');
    });

    downloadCsvRows('sat.csv', [
      ['First name', 'เติมชุดข้อสอบ', 'RECHECK'],
      ['A, B', 'say "hi"\r\nnext', '=1+1'],
    ]);

    expect(click).toHaveBeenCalledOnce();
    expect(capturedType).toBe('text/csv;charset=utf-8;');
    expect(capturedContent).toBe('\uFEFF"First name","เติมชุดข้อสอบ","RECHECK"\r\n"A, B","say ""hi""\nnext","\'=1+1"');
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
