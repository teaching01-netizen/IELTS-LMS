import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCsvRows, escapeCsvCell } from '../csvExport';

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

// jsdom exposes neither Blob.text() nor Blob.arrayBuffer(), so the captured
// blob is read through FileReader (the same fallback the app uses).
//
// readAsText UTF-8-decodes the payload and therefore drops a leading BOM, so the
// BOM is asserted from the raw bytes instead of from this string.
async function readBlobText(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('blob read failed'));
    reader.readAsText(blob);
  });
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('blob read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

type CapturedDownload = {
  bytes: Uint8Array;
  text: string;
  download: string | undefined;
  click: ReturnType<typeof vi.fn>;
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
};

async function captureDownload(run: () => void): Promise<CapturedDownload> {
  const createObjectURL = vi.fn(() => 'blob:sat-rawdata');
  const revokeObjectURL = vi.fn();
  const click = vi.fn();
  const anchors: HTMLAnchorElement[] = [];
  const originalCreateElement = document.createElement.bind(document);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    const element = originalCreateElement(tagName);
    if (tagName === 'a') {
      anchors.push(element as HTMLAnchorElement);
      Object.defineProperty(element, 'click', { configurable: true, value: click });
    }
    return element;
  }) as typeof document.createElement);

  run();

  const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
  return {
    bytes: await readBlobBytes(blob),
    text: await readBlobText(blob),
    download: anchors[0]?.download,
    click,
    createObjectURL,
    revokeObjectURL,
  };
}

describe('downloadCsvRows', () => {
  afterEach(async () => {
    // emitCsv revokes the object URL on a 0ms timer: let it fire while the URL
    // stub is still installed, otherwise it throws against jsdom's URL (which
    // has no revokeObjectURL).
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps every header row ahead of the body, with BOM and CRLF', async () => {
    const captured = await captureDownload(() =>
      downloadCsvRows(
        'sat-rawdata-practice-test-06-2026-09-28.csv',
        [['A', 'B', 'C'], ['email', 'Percentage', 'Q1']],
        [['a@example.com', '50.00%', '1']],
      ),
    );

    // UTF-8 BOM so Excel detects the encoding, then the payload.
    expect([...captured.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(captured.text).toBe(
      '"A","B","C"\r\n"email","Percentage","Q1"\r\n"a@example.com","50.00%","1"',
    );
    expect(captured.download).toBe('sat-rawdata-practice-test-06-2026-09-28.csv');
    expect(captured.click).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(captured.revokeObjectURL).toHaveBeenCalledWith('blob:sat-rawdata'),
    );
  });

  it('reuses the shared escaping and formula guard for header cells', async () => {
    const captured = await captureDownload(() =>
      downloadCsvRows('x.csv', [['h1', 'a,b'], ['=cmd()', 'plain']], []),
    );

    expect(captured.text).toBe('"h1","a,b"\r\n"\'=cmd()","plain"');
  });
});
