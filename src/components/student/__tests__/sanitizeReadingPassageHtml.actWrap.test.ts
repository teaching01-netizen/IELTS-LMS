import { describe, expect, it } from 'vitest';
import { sanitizeReadingPassageHtml } from '../sanitizeReadingPassageHtml';

describe('sanitizeReadingPassageHtml ACT line wrapping', () => {
  it('removes pasted word-breaking overrides while keeping emphasis and paragraph alignment', () => {
    const input =
      '<p style="text-align: justify; word-break: break-all; overflow-wrap: anywhere; white-space: pre-wrap; letter-spacing: 2px; font-weight: 700"><span style="white-space: nowrap; word-spacing: 4px">The result was consistent.</span></p>';

    const output = sanitizeReadingPassageHtml(input, {
      normalizeJustifiedText: true,
      normalizeLineWrapping: true,
    });
    const template = document.createElement('template');
    template.innerHTML = output;
    const paragraph = template.content.querySelector('p');
    const emphasizedText = template.content.querySelector('span');

    expect(paragraph?.style.textAlign).toBe('left');
    expect(paragraph?.style.wordBreak).toBe('');
    expect(paragraph?.style.overflowWrap).toBe('');
    expect(paragraph?.style.whiteSpace).toBe('');
    expect(paragraph?.style.letterSpacing).toBe('');
    expect(paragraph?.style.fontWeight).toBe('700');
    expect(emphasizedText?.getAttribute('style')).toBeNull();
    expect(paragraph?.textContent).toBe('The result was consistent.');
  });

  it('leaves IELTS passage inline wrapping styles untouched by default', () => {
    const output = sanitizeReadingPassageHtml(
      '<p style="word-break: break-all; white-space: pre-wrap">IELTS content.</p>',
    );
    const template = document.createElement('template');
    template.innerHTML = output;
    const paragraph = template.content.querySelector('p');

    expect(paragraph?.style.wordBreak).toBe('break-all');
    expect(paragraph?.style.whiteSpace).toBe('pre-wrap');
  });
});
