import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../sanitizeHtml';

describe('sanitizeHtml', () => {
  it('removes script tags', () => {
    const result = sanitizeHtml('<script>alert(1)</script><p>Hello</p>');
    expect(result).not.toMatch(/<script/i);
    expect(result).toContain('<p>Hello</p>');
  });

  it('strips inline event handlers', () => {
    const result = sanitizeHtml('<img src="x" onerror="alert(1)" />');
    expect(result).not.toMatch(/onerror\s*=/i);
  });

  it('neutralizes javascript: URLs', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(result).not.toMatch(/javascript:/i);
  });

  it('drops javascript: image sources instead of emitting an executable src', () => {
    const result = sanitizeHtml('<p>Hi</p><img src="javascript:alert(1)" alt="x" />');
    expect(result).not.toMatch(/javascript:/i);
  });

  it('drops vbscript: and data:text/html image sources', () => {
    expect(sanitizeHtml('<img src="VbScript:msgbox(1)" />')).not.toMatch(/vbscript:/i);
    expect(sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>" />')).not.toMatch(
      /data:text\/html/i,
    );
  });

  it('keeps benign data:image sources', () => {
    const result = sanitizeHtml('<img src="data:image/png;base64,AAAA" alt="x" />');
    expect(result).toMatch(/data:image\/png/i);
  });

  it('scrubs unsafe xlink:href without throwing', () => {
    expect(() => sanitizeHtml('<svg><use xlink:href="javascript:alert(1)"></use></svg>')).not.toThrow();
    expect(sanitizeHtml('<svg><use xlink:href="javascript:alert(1)"></use></svg>')).not.toMatch(
      /javascript:/i,
    );
  });

  it('normalizes google drive image sources in rich html', () => {
    const result = sanitizeHtml(
      '<p>Diagram</p><img src="https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing" alt="Diagram" />',
    );

    expect(result).toContain(
      'src="https://drive.google.com/thumbnail?id=1AbCDefG123456&amp;sz=w2000"',
    );
  });
});
