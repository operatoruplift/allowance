import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { config, SPA_ROUTE } from '../scripts/rehearsal-config';
import { CLIENT_ROUTES, LEGAL_ROUTES, isClientRoute } from '../shared/routes';
import { LEGAL_LAST_UPDATED_ISO, PUBLIC_SITE } from '../src/legal';

// A store reviewer and a crawler meet the site the same way: robots.txt, the
// sitemap it names, and the legal pages the listing links to. All three must
// hold on the static rehearsal and on the Node server without anyone clicking.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicFile = (file: string) => readFile(path.join(root, 'public', file), 'utf8');

describe('robots.txt', () => {
  it('allows crawling and names the sitemap at the public origin', async () => {
    const lines = (await publicFile('robots.txt'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    expect(lines[0]).toBe('User-agent: *');
    expect(lines).toContain('Allow: /');
    expect(lines).toContain(`Sitemap: ${PUBLIC_SITE}/sitemap.xml`);
    // Only directives a robots parser understands, each with a value.
    for (const line of lines) expect(line).toMatch(/^(User-agent|Allow|Disallow|Sitemap): \S/);
  });
});

describe('sitemap.xml', () => {
  it('lists the home page and both legal pages, each at an address the router serves', async () => {
    const xml = await publicFile('sitemap.xml');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, value]) => value);
    expect(locations).toEqual([
      `${PUBLIC_SITE}/`,
      ...LEGAL_ROUTES.map((route) => `${PUBLIC_SITE}${route}`),
    ]);
    for (const location of locations) {
      const url = new URL(location);
      expect(url.origin).toBe(PUBLIC_SITE);
      expect(isClientRoute(url.pathname)).toBe(true);
    }
    const lastModified = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(([, value]) => value);
    expect(lastModified).toEqual([LEGAL_LAST_UPDATED_ISO, LEGAL_LAST_UPDATED_ISO]);
  });
});

describe('legal pages on both deploy targets', () => {
  const spa = new RegExp(`^${SPA_ROUTE}$`);
  it('are rewritten to the shell with status 200 on the static rehearsal, after the filesystem phase', () => {
    for (const route of LEGAL_ROUTES) {
      expect(spa.test(route)).toBe(true);
      expect(spa.test(`${route}/`)).toBe(true);
    }
    const rewrite = config.routes.find((route) => route.src === SPA_ROUTE);
    expect(rewrite).toMatchObject({ dest: '/index.html' });
    expect(rewrite?.status).toBeUndefined();
    const filesystem = config.routes.findIndex((route) => route.handle === 'filesystem');
    const error = config.routes.findIndex((route) => route.handle === 'error');
    expect(filesystem).toBeLessThan(config.routes.indexOf(rewrite!));
    expect(config.routes.indexOf(rewrite!)).toBeLessThan(error);
    // Nothing ahead of the filesystem phase answers a legal page with a status of its own.
    for (const route of LEGAL_ROUTES)
      for (const entry of config.routes.slice(0, filesystem))
        if (entry.src && !entry.methods && new RegExp(`^${entry.src}$`).test(route))
          expect(entry.status, `${entry.src} would answer ${route}`).toBeUndefined();
  });
  it('are pages for the Node server too, while robots.txt and sitemap.xml stay files', () => {
    for (const route of LEGAL_ROUTES) expect(isClientRoute(route)).toBe(true);
    for (const file of ['/robots.txt', '/sitemap.xml']) {
      expect(isClientRoute(file)).toBe(false);
      expect(spa.test(file)).toBe(false);
    }
    expect(CLIENT_ROUTES).toEqual(expect.arrayContaining([...LEGAL_ROUTES]));
  });
});
