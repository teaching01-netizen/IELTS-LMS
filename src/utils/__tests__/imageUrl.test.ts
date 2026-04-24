import { describe, expect, it } from 'vitest';
import { getImageUrlCandidates, normalizeImageUrl } from '../imageUrl';

describe('imageUrl', () => {
  it('normalizes google drive share links to direct download urls', () => {
    expect(
      normalizeImageUrl('https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing'),
    ).toBe('https://drive.google.com/uc?export=view&id=1AbCDefG123456');
  });

  it('provides a thumbnail fallback for drive images', () => {
    expect(
      getImageUrlCandidates('https://drive.google.com/open?id=1AbCDefG123456')[1],
    ).toBe('https://drive.google.com/thumbnail?id=1AbCDefG123456&sz=w2000');
  });

  it('leaves non-drive urls unchanged', () => {
    expect(normalizeImageUrl('https://example.com/image.png')).toBe('https://example.com/image.png');
  });
});
