import { afterEach, describe, expect, it, vi } from 'vitest';
import { getImageUrlCandidates, normalizeImageUrl, retryImageSourceLater } from '../imageUrl';

describe('imageUrl', () => {
  it('normalizes google drive share links to browser-loadable image urls', () => {
    expect(
      normalizeImageUrl('https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing'),
    ).toBe('https://drive.google.com/thumbnail?id=1AbCDefG123456&sz=w2000');
  });

  it('tries the google drive thumbnail endpoint before legacy uc endpoints', () => {
    expect(
      getImageUrlCandidates('https://drive.google.com/open?id=1AbCDefG123456')[0],
    ).toBe('https://drive.google.com/thumbnail?id=1AbCDefG123456&sz=w2000');
  });

  it('includes direct googleusercontent fallbacks for drive images', () => {
    const candidates = getImageUrlCandidates('https://drive.google.com/open?id=1AbCDefG123456');
    expect(candidates).toContain(
      'https://drive.usercontent.google.com/download?id=1AbCDefG123456&export=view',
    );
    expect(candidates).toContain('https://lh3.googleusercontent.com/d/1AbCDefG123456=s2000');
  });

  it('leaves non-drive urls unchanged', () => {
    expect(normalizeImageUrl('https://example.com/image.png')).toBe('https://example.com/image.png');
  });

  it('drops javascript:/vbscript:/data:text/html sources to an empty string', () => {
    expect(normalizeImageUrl('javascript:alert(1)')).toBe('');
    expect(normalizeImageUrl('  VbScript:msgbox(1)')).toBe('');
    expect(normalizeImageUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(getImageUrlCandidates('javascript:alert(1)')).toEqual([]);
  });

  it('keeps benign data:image sources', () => {
    expect(normalizeImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  describe('retryImageSourceLater', () => {
    afterEach(() => {
      vi.useRealTimers();
      document.body.innerHTML = '';
    });

    it('re-requests a failed image twice on a backoff, then gives up', () => {
      vi.useFakeTimers();
      const host = document.createElement('div');
      const image = document.createElement('img');
      image.setAttribute('src', '/api/v1/media/asset-1/content');
      image.setAttribute('tabindex', '0');
      host.append(image);
      document.body.append(host);
      image.focus();

      expect(retryImageSourceLater(image)).toBe(true);
      vi.advanceTimersByTime(999);
      expect(host.firstElementChild).toBe(image);
      vi.advanceTimersByTime(1);
      // A new element in its place (WebKit only re-requests a new one), same
      // source and attributes, focus carried over.
      const second = host.firstElementChild as HTMLImageElement;
      expect(second).not.toBe(image);
      expect(second).toHaveAttribute('src', '/api/v1/media/asset-1/content');
      expect(second).toHaveFocus();

      expect(retryImageSourceLater(second)).toBe(true);
      vi.advanceTimersByTime(3_000);
      const third = host.firstElementChild as HTMLImageElement;
      expect(third).not.toBe(second);

      // The retry count travels with the copies.
      expect(retryImageSourceLater(third)).toBe(false);
    });

    it('leaves a replaced or re-pointed image alone', () => {
      vi.useFakeTimers();
      const detached = document.createElement('img');
      detached.setAttribute('src', '/a.png');
      const moved = document.createElement('img');
      moved.setAttribute('src', '/a.png');
      document.body.append(moved);

      retryImageSourceLater(detached);
      retryImageSourceLater(moved);
      moved.src = '/b.png';
      vi.advanceTimersByTime(1_000);

      expect(detached.isConnected).toBe(false);
      expect(document.body.firstElementChild).toBe(moved);
    });
  });
});
