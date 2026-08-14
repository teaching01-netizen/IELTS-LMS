import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const outDir = 'e2e/.generated/overview-shots';
mkdirSync(outDir, { recursive: true });

const storyName = process.argv[2] ?? 'populated';
const outPath = `${outDir}/${storyName}.png`;

const child = execFile(
  'npm',
  ['run', 'storybook', '--', '--no-open'],
  {
    cwd: process.cwd(),
    env: { ...process.env, CI: '1' },
    detached: true,
  },
  (error) => {
    if (error && error.code !== 'null' && !String(error.message).includes('SIGTERM')) {
      console.error('storybook exited:', error.message);
    }
  },
);

const waitForHttp = async (url, timeoutMs) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
};

const shutdown = async () => {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
};

try {
  await waitForHttp('http://127.0.0.1:6006/', 90_000);

  const indexResponse = await fetch('http://127.0.0.1:6006/index.json');
  const index = await indexResponse.json();
  const entry = Object.values(index.entries).find(
    (candidate) =>
      candidate.type === 'story' &&
      String(candidate.title).toLowerCase().includes('overall answer check'),
  );
  if (!entry) {
    const titles = Object.values(index.entries)
      .filter((candidate) => candidate.type === 'story')
      .map((candidate) => candidate.title)
      .slice(0, 30);
    throw new Error(`Story not found. Known titles: ${titles.join(', ')}`);
  }

  const storyUrl = `http://127.0.0.1:6006/iframe.html?id=${entry.id}&viewMode=story`;
  const width = Number(process.env['SHOT_WIDTH'] ?? '1440');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.goto(storyUrl, { waitUntil: 'networkidle' });
  await page.locator('h2', { hasText: 'Overall exam answer check' }).waitFor({ timeout: 30_000 });
  if (process.env['SHOW_ALL'] === '1') {
    await page.getByRole('button', { name: /^All/ }).click();
  }
  // Allow the audit section and fonts to settle.
  await page.waitForTimeout(1200);
  if (process.env['PROBE'] === '1') {
    const strays = await page.evaluate(() => {
      const results = [];
      for (const el of document.querySelectorAll('section > div > div, span, div')) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width > 0 && rect.width < 30 && rect.height > 0 && rect.height < 30) {
          results.push({
            tag: el.tagName,
            cls: String(el.className).slice(0, 90),
            text: (el.textContent || '').trim().slice(0, 40),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            display: style.display,
            content: style.content,
          });
        }
      }
      return results.slice(0, 25);
    });
    console.log('PROBE strays:', JSON.stringify(strays, null, 2));
  }
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`saved ${outPath}`);
  await browser.close();
} finally {
  await shutdown();
}
