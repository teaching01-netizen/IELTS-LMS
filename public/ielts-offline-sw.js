/* IELTS offline exam shell (docs/superpowers/plans/2026-10-30-ielts-shared-clock-offline-continuity.md §4.6).
 *
 * Scope is deliberately narrow:
 *   - student exam navigations (/student/:scheduleId/:studentId): network first,
 *     cached document of a pinned/installed build only when the network fails;
 *   - immutable build assets listed in /ielts-offline-assets.json: cache first.
 * Nothing else is intercepted: no API, login, staff HTML or credentialed fetch
 * is ever cached. No skipWaiting: a running exam keeps its build. A build
 * pinned by an active exam is never deleted.
 */
'use strict';

const SHELL_PREFIX = 'ielts-shell-v1:';
const META_CACHE = 'ielts-shell-meta-v1';
const PINS_KEY = '/__ielts-shell/pins';
const BUILD_KEY = (id) => `/__ielts-shell/build/${id}`;
const STUDENT_EXAM_PATH = /^\/student\/[^/]+\/[^/]+\/?$/;
const MAX_UNPINNED_BUILDS = 2;

async function readJson(cache, key) {
  const response = await cache.match(key);
  return response ? response.json() : null;
}

async function writeJson(cache, key, value) {
  await cache.put(key, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }));
}

async function builds() {
  const meta = await caches.open(META_CACHE);
  const out = [];
  for (const request of await meta.keys()) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/__ielts-shell/build/')) continue;
    const build = await readJson(meta, request);
    if (build) out.push(build);
  }
  return out.sort((a, b) => b.installedAt - a.installedAt);
}

async function pins() {
  return (await readJson(await caches.open(META_CACHE), PINS_KEY)) || {};
}

/** Caches one build completely, or not at all. */
async function installCurrentBuild() {
  const manifestResponse = await fetch('/ielts-offline-assets.json', { cache: 'no-store', credentials: 'same-origin' });
  if (!manifestResponse.ok) throw new Error('shell manifest unavailable');
  const manifest = await manifestResponse.json();
  if (manifest.schemaVersion !== 1 || typeof manifest.buildId !== 'string' || !Array.isArray(manifest.assets)) {
    throw new Error('shell manifest invalid');
  }
  const meta = await caches.open(META_CACHE);
  if (await readJson(meta, BUILD_KEY(manifest.buildId))) return manifest;
  const cacheName = SHELL_PREFIX + manifest.buildId;
  const cache = await caches.open(cacheName);
  try {
    for (const asset of manifest.assets) {
      if (await cache.match(asset)) continue;
      const response = await fetch(asset, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok || response.type !== 'basic') throw new Error(`asset ${asset} unavailable`);
      await cache.put(asset, response);
    }
    const documentResponse = await fetch(manifest.document, { cache: 'no-store', credentials: 'same-origin' });
    const html = documentResponse.ok ? await documentResponse.text() : '';
    // The document must belong to this build, not a deployment that raced us.
    if (!manifest.assets.some((asset) => html.includes(asset))) throw new Error('document is from another build');
    await cache.put(manifest.document, new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
  await writeJson(meta, BUILD_KEY(manifest.buildId), {
    buildId: manifest.buildId,
    document: manifest.document,
    assets: manifest.assets,
    installedAt: Date.now(),
  });
  return manifest;
}

async function buildComplete(build) {
  const cache = await caches.open(SHELL_PREFIX + build.buildId);
  for (const asset of [...build.assets, build.document]) {
    if (!(await cache.match(asset))) return false;
  }
  return true;
}

async function findBuildForAsset(assetPath) {
  return (await builds()).find((build) => build.assets.includes(assetPath)) || null;
}

/** Drops old unpinned builds; pinned (active exam) builds always survive. */
async function pruneBuilds() {
  const pinned = new Set(Object.values(await pins()));
  const meta = await caches.open(META_CACHE);
  const unpinned = (await builds()).filter((build) => !pinned.has(build.buildId));
  for (const build of unpinned.slice(MAX_UNPINNED_BUILDS)) {
    await caches.delete(SHELL_PREFIX + build.buildId);
    await meta.delete(BUILD_KEY(build.buildId));
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(installCurrentBuild().catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(pruneBuilds().then(() => self.clients.claim()));
});

async function cachedDocument() {
  const pinned = new Set(Object.values(await pins()));
  const all = await builds();
  const ordered = [...all.filter((b) => pinned.has(b.buildId)), ...all.filter((b) => !pinned.has(b.buildId))];
  for (const build of ordered) {
    const response = await (await caches.open(SHELL_PREFIX + build.buildId)).match(build.document);
    if (response) return response;
  }
  return null;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    if (!STUDENT_EXAM_PATH.test(url.pathname)) return;
    event.respondWith(
      fetch(request).catch(async () => (await cachedDocument()) || Response.error()),
    );
    return;
  }
  // Only Vite's immutable asset directory; API and every other path pass by.
  if (!url.pathname.startsWith('/assets/')) return;
  event.respondWith(
    (async () => {
      const build = await findBuildForAsset(url.pathname);
      if (build) {
        const hit = await (await caches.open(SHELL_PREFIX + build.buildId)).match(url.pathname);
        if (hit) return hit;
      }
      return fetch(request);
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];
  const reply = (value) => port && port.postMessage(value);
  event.waitUntil(
    (async () => {
      try {
        if (data.type === 'verify' && typeof data.assetPath === 'string') {
          let build = await findBuildForAsset(data.assetPath);
          if (!build) {
            await installCurrentBuild();
            build = await findBuildForAsset(data.assetPath);
          }
          reply(build && (await buildComplete(build)) ? { ok: true, buildId: build.buildId } : { ok: false, reason: 'shell_unavailable' });
          return;
        }
        if (data.type === 'pin' && typeof data.buildId === 'string' && typeof data.attemptId === 'string') {
          const meta = await caches.open(META_CACHE);
          await writeJson(meta, PINS_KEY, { ...(await pins()), [data.attemptId]: data.buildId });
          reply({ ok: true });
          return;
        }
        if (data.type === 'unpin' && typeof data.attemptId === 'string') {
          const meta = await caches.open(META_CACHE);
          const next = await pins();
          delete next[data.attemptId];
          await writeJson(meta, PINS_KEY, next);
          await pruneBuilds();
          reply({ ok: true });
          return;
        }
        reply({ ok: false, reason: 'unknown_message' });
      } catch (error) {
        reply({ ok: false, reason: 'shell_unavailable' });
      }
    })(),
  );
});
