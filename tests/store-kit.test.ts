import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isClientRoute } from '../shared/routes';

// The listing kit is uploaded by hand, months after it was made. The Portal
// rejects an asset at the wrong size only at submission, so the sizes and limits
// are checked here, on the files actually committed.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = path.join(root, 'docs/dapp-store');
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
const PUBLIC_SITE = 'https://allowanceonsolana.vercel.app';

/** Width and height from a PNG's IHDR chunk, which always follows the signature. */
function pngSize(file: string): { width: number; height: number } {
  const header = readFileSync(file).subarray(0, 24);
  expect(header.subarray(1, 4).toString('latin1'), `${file} is not a PNG`).toBe('PNG');
  expect(header.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

const listing = (): string => readFileSync(path.join(kit, 'listing.md'), 'utf8');

/** The copy-ready block under a `### <heading>` line: the first text fence after it. */
function field(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n### ${heading}\n`);
  expect(start, `listing.md has no "${heading}" field`).toBeGreaterThan(-1);
  const block = /```text\n([\s\S]*?)\n```/.exec(markdown.slice(start));
  expect(block, `"${heading}" has no text block`).not.toBeNull();
  return block![1];
}

describe('the dApp Store banner', () => {
  it('is exactly 1200 × 600', () => {
    expect(pngSize(path.join(kit, 'banner-1200x600.png'))).toEqual({ width: 1200, height: 600 });
  });
});

describe('the dApp Store screenshots', () => {
  const directory = path.join(kit, 'screenshots');
  const files = existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => name.endsWith('.png'))
        .sort()
    : [];

  it('number five or six, which the store’s four to eight allows', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.length).toBeLessThanOrEqual(6);
  });

  it('are portrait 1080 × 1920, one size, each under 3 MB', () => {
    for (const name of files) {
      const file = path.join(directory, name);
      expect(pngSize(file), name).toEqual({ width: 1080, height: 1920 });
      expect(statSync(file).size, name).toBeLessThan(MAX_SCREENSHOT_BYTES);
    }
  });
});

describe('the listing text', () => {
  it('keeps the name, subtitle and description within the Portal limits', () => {
    const markdown = listing();
    expect(field(markdown, 'App name').length).toBeLessThanOrEqual(25);
    expect(field(markdown, 'Subtitle').length).toBeLessThanOrEqual(30);
    const description = field(markdown, 'Description');
    expect(description.length).toBeLessThanOrEqual(10000);
    expect(description.length).toBeGreaterThan(600);
    // Accurate to what installs: a no-spend rehearsal, plus a console you host.
    expect(description).toContain('rehearsal');
    expect(description).toContain('self-hosted operator console');
    expect(field(markdown, 'What’s new')).toBe('First release');
  });

  it('carries the links, contact, language and policy answers the Portal asks for', () => {
    const markdown = listing();
    for (const value of [
      `${PUBLIC_SITE}/privacy`,
      `${PUBLIC_SITE}/terms`,
      'Set in the Portal',
      'English',
      '© 2026 Operator Uplift',
      'sanctioned',
    ])
      expect(markdown, value).toContain(value);
    expect(markdown).toMatch(/Token distribution\s*\|\s*No\b/);
    expect(field(markdown, 'Reviewer notes').length).toBeGreaterThan(200);
    expect(markdown).toContain('## Listing decision');
  });
});

describe('links to the public site in the store documents', () => {
  it('point at a page the site serves or a file it publishes', () => {
    for (const document of ['docs/dapp-store/listing.md', 'docs/seeker-and-pwa.md']) {
      const source = readFileSync(path.join(root, document), 'utf8');
      const links = [
        ...source.matchAll(/https:\/\/allowanceonsolana\.vercel\.app(\/[^\s)`'"|>]*)?/g),
      ];
      expect(links.length, document).toBeGreaterThan(0);
      for (const [, rawPath = '/'] of links) {
        const pathname = new URL(rawPath.replace(/[.,;:]+$/, ''), PUBLIC_SITE).pathname;
        const served = isClientRoute(pathname) || existsSync(path.join(root, 'public', pathname));
        expect(served, `${document} links ${pathname}, which the site does not serve`).toBe(true);
      }
    }
  });
});
