import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const origin = 'https://allowance.test';
const bundle = '/assets/index-12345678.js';
const style = '/assets/index-87654321.css';
const font = '/fonts/test.woff2';
const html = `<html><script type="module" src="${bundle}"></script><link rel="stylesheet" href="${style}"></html>`;
type Input = string | Request;
type EventHandler = (event: {
  request?: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith: (promise: Promise<Response>) => void;
}) => void;

function response(body: string, contentType = 'text/plain', headers: Record<string, string> = {}) {
  const result = new Response(body, {
    headers: { 'content-type': contentType, 'content-length': String(body.length), ...headers },
  });
  return asBasic(result);
}

function asBasic(result: Response): Response {
  Object.defineProperty(result, 'type', { value: 'basic' });
  const originalClone = result.clone.bind(result);
  result.clone = () => asBasic(originalClone());
  return result;
}

async function worker() {
  const key = (input: Input) => new URL(typeof input === 'string' ? input : input.url, origin).href;
  const stores = new Map<string, Map<string, Response>>();
  const handlers = new Map<string, EventHandler>();
  const requests: string[] = [];
  let offline = false;
  const network = new Map<string, () => Response>([
    ['/', () => response(html, 'text/html')],
    [bundle, () => response('console.log("ready")', 'application/javascript')],
    [style, () => response(`@font-face{src:url("${font}")}`, 'text/css')],
    [font, () => response('font', 'font/woff2')],
  ]);
  function open(name: string) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (input: Input) => store.get(key(input))?.clone(),
      put: async (input: Input, value: Response) => {
        store.set(key(input), value.clone());
      },
    };
  }
  const caches = {
    open: async (name: string) => open(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (input: Input, { cacheName }: { cacheName: string }) =>
      open(cacheName).match(input),
  };
  vm.runInNewContext(await readFile('public/sw.js', 'utf8'), {
    URL,
    Response,
    Set,
    Promise,
    Error,
    caches,
    self: {
      location: { origin },
      addEventListener: (name: string, handler: EventHandler) => handlers.set(name, handler),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    fetch: async (input: Input) => {
      const url = new URL(key(input));
      requests.push(url.pathname);
      if (offline) throw new Error('offline');
      return network.get(url.pathname)?.() ?? response('asset');
    },
  });
  async function event(name: string, request?: Request) {
    const pending: Promise<unknown>[] = [];
    let result: Promise<Response> | undefined;
    handlers.get(name)!({
      request,
      waitUntil: (value) => pending.push(value),
      respondWith: (value) => {
        result = value;
      },
    });
    const answer = result ? await result : undefined;
    await Promise.all(pending);
    return answer;
  }
  const request = (path: string, init: RequestInit = {}, navigate = false) => {
    const value = new Request(new URL(path, origin), init);
    if (navigate) Object.defineProperty(value, 'mode', { value: 'navigate' });
    return event('fetch', value);
  };
  return {
    caches,
    stores,
    network,
    requests,
    event,
    request,
    offline: () => {
      offline = true;
    },
  };
}

describe('public service worker', () => {
  it('completes its first install with JS, CSS and fonts for an offline lab launch', async () => {
    const app = await worker();
    await app.event('install');
    app.offline();
    expect(await (await app.request('/lab', {}, true))!.text()).toBe(html);
    for (const path of [bundle, style, font]) expect(await app.request(path)).toBeDefined();
  });

  it('retires a previous install and never reuses its stale artwork', async () => {
    const app = await worker();
    const old = await app.caches.open('allowance-shell-v1');
    await old.put('/brand/art/sky.jpg', response('old art', 'image/jpeg'));
    app.network.set('/brand/art/sky.jpg', () => response('new art', 'image/jpeg'));
    await app.event('install');
    await app.event('activate');
    expect(await app.caches.keys()).toEqual(['allowance-shell-v2']);
    expect(await (await app.request('/brand/art/sky.jpg'))!.text()).toBe('new art');
    app.network.set('/brand/art/sky.jpg', () => response('next release', 'image/jpeg'));
    expect(await (await app.request('/brand/art/sky.jpg'))!.text()).toBe('next release');
    app.offline();
    expect(await (await app.request('/brand/art/sky.jpg'))!.text()).toBe('next release');
  });

  it('keeps hashed assets immutable while refreshing the document for a new release', async () => {
    const app = await worker();
    await app.event('install');
    const before = app.requests.length;
    await app.request(bundle);
    expect(app.requests.length).toBe(before);
    const newBundle = '/assets/index-new12345.js';
    const newHtml = html.replace(bundle, newBundle);
    app.network.set('/lab', () => response(newHtml, 'text/html'));
    app.network.set(newBundle, () => response('new bundle', 'application/javascript'));
    await app.request('/lab', {}, true);
    app.offline();
    expect(await (await app.request('/lab', {}, true))!.text()).toBe(newHtml);
    expect(await (await app.request(newBundle))!.text()).toBe('new bundle');
  });

  it('keeps the previous offline shell if a release dependency cannot be cached', async () => {
    const app = await worker();
    await app.event('install');
    const newBundle = '/assets/index-broken12.js';
    app.network.set('/lab', () => response(html.replace(bundle, newBundle), 'text/html'));
    app.network.set(newBundle, () =>
      response('private bundle', 'application/javascript', { 'cache-control': 'no-store' })
    );
    await app.request('/lab', {}, true);
    app.offline();
    expect(await (await app.request('/lab', {}, true))!.text()).toBe(html);
  });

  it('does not replace the offline shell when opening a brand image as a document', async () => {
    const app = await worker();
    await app.event('install');
    app.network.set('/brand/profile.png', () => response('PNG', 'image/png'));
    await app.request('/brand/profile.png', {}, true);
    app.offline();
    expect(await (await app.request('/lab', {}, true))!.text()).toBe(html);
  });

  it('bypasses private paths, mutations, external origins, video, ranges and large downloads', async () => {
    const app = await worker();
    for (const path of [
      '/api/receipts/1',
      '/api',
      '/merchant/wallet',
      '/tools/snapshot',
      'https://external.test/asset.js',
      '/media/film.mp4',
      '/brand/kit.zip',
    ]) {
      expect(await app.request(path)).toBeUndefined();
    }
    expect(await app.request('/lab', { method: 'POST' })).toBeUndefined();
    expect(
      await app.request('/brand/art/sky.jpg', { headers: { range: 'bytes=0-100' } })
    ).toBeUndefined();
    expect(app.requests).toEqual([]);
    expect(await app.caches.keys()).toEqual([]);
  });

  it('never buffers oversized or no-store mutable artwork into Cache Storage', async () => {
    const app = await worker();
    app.network.set('/brand/big.png', () =>
      response('large', 'image/png', { 'content-length': '40000000' })
    );
    app.network.set('/brand/private.png', () =>
      response('private', 'image/png', { 'cache-control': 'no-store' })
    );
    await app.request('/brand/big.png');
    await app.request('/brand/private.png');
    const stored = app.stores.get('allowance-shell-v2')!;
    expect(stored.size).toBe(0);
  });
});
