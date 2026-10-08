import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import { CLIENT_ROUTES, LEGAL_ROUTES } from '../shared/routes';
import { ISSUES_URL, LEGAL_LAST_UPDATED, OPERATOR_NAME, supportContact } from '../src/legal';

// The store reviewer reads these pages, and so does anyone deciding whether to fund a
// payer. Each required statement is asserted on the rendered page rather than kept
// as a checklist beside it, so a later edit cannot quietly drop one.

const page = (path: string): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );

/** The words a reader sees, so a sentence split by inline markup still reads as one. */
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const headings = (html: string): string[] =>
  [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/gs)].map(([, inner]) => text(inner).trim());

describe('the legal routes', () => {
  it('are client routes on both deploy targets', () => {
    expect([...LEGAL_ROUTES]).toEqual(['/privacy', '/terms']);
    for (const route of LEGAL_ROUTES) expect(CLIENT_ROUTES).toContain(route);
  });
});

describe('the privacy policy', () => {
  const html = page('/privacy');
  const body = text(html);

  it('is a real page, not the 404, a sign-in wall or a placeholder', () => {
    expect(html).toMatch(/<h1[^>]*>Privacy policy<\/h1>/);
    expect(body).not.toContain('This page isn’t here.');
    expect(body).not.toContain('Operator password');
    expect(body.length).toBeGreaterThan(4000);
  });

  it('is dated and names the operator', () => {
    expect(LEGAL_LAST_UPDATED).toBe('7 October 2026');
    expect(body).toContain('Last updated: 7 October 2026');
    expect(OPERATOR_NAME).toBe('Operator Uplift');
    expect(body).toContain('Operator Uplift');
  });

  it('says the public site makes no network calls and keeps only device storage', () => {
    expect(body).toContain("connect-src 'none'");
    expect(body).toContain('no network requests');
    // src/motion.tsx is the only browser storage the site uses.
    expect(body).toContain('allowance-reduced-motion');
    expect(body).toMatch(/no cookies/i);
    expect(body).toMatch(/no analytics/i);
  });

  it('lists what a live operator deployment stores', () => {
    for (const fact of [
      'Argon2id',
      'express-session',
      'SQLite journal',
      'policies',
      'receipts',
      'mandates',
      'wallet addresses',
      'transaction signatures',
      'IP address',
    ])
      expect(body, fact).toContain(fact);
  });

  it('names who else receives data from a live deployment', () => {
    for (const processor of ['RPC provider', 'x402 facilitator', 'PayAI', 'OpenAI'])
      expect(body, processor).toContain(processor);
    // Render and Docker are ways to deploy the code, not a claim that a server runs.
    expect(body).toContain('Render');
    expect(body).toContain('Docker');
    expect(body).toContain('does not mean a live deployment is running');
  });

  it('covers retention, backups, security, age, changes and contact', () => {
    expect(headings(html)).toEqual(
      expect.arrayContaining([
        'Retention',
        'Backups and restore',
        'Security',
        'Children',
        'Changes to this policy',
        'Contact',
      ])
    );
    expect(body).toContain('18');
    expect(body).toContain('runtime-recovery.md');
  });
});

describe('the terms of use', () => {
  const html = page('/terms');
  const body = text(html);

  it('is a real page, dated, between the user and the operator', () => {
    expect(html).toMatch(/<h1[^>]*>Terms of use<\/h1>/);
    expect(body).not.toContain('This page isn’t here.');
    expect(body).toContain('Last updated: 7 October 2026');
    expect(body).toContain('Operator Uplift');
    expect(body.length).toBeGreaterThan(4000);
  });

  it('describes a developer tool for an operator’s own dedicated payer', () => {
    expect(body).toContain('developer tool');
    expect(body).toContain('dedicated payer');
    expect(body).toContain('no-spend rehearsal');
  });

  it('says the limits are enforced by the app, not by escrow, so fund small amounts', () => {
    // The threat model's own words, so the two documents cannot drift apart.
    expect(body).toContain(
      'A host administrator or stolen payer key can bypass application controls: there is no onchain budget escrow.'
    );
    expect(body).toContain('application-enforced');
    expect(body).toMatch(/small amounts/);
  });

  it('disclaims custody and advice, keeps third-party fees separate and limits liability', () => {
    expect(body).toContain('custody of third-party funds');
    expect(body).toContain('facilitator');
    expect(body).toContain('model provider');
    expect(body).toContain('not financial');
    expect(body).toContain('“as is”');
    expect(headings(html)).toEqual(
      expect.arrayContaining(['No warranty', 'Limitation of liability'])
    );
  });

  it('carries the Solana dApp Store clause', () => {
    expect(body).toContain(
      'If you obtained Allowance through the Solana dApp Store, these terms are between you and Operator Uplift only.'
    );
    expect(body).toContain('Solana Mobile Parties');
    expect(body).toContain('are not a party to these terms');
    expect(body).toContain(
      'no responsibility or liability to you in connection with the app, its content, support or maintenance'
    );
  });

  it('covers changes, governing law and contact', () => {
    expect(headings(html)).toEqual(
      expect.arrayContaining(['Changes to these terms', 'Governing law', 'Contact'])
    );
  });
});

describe('the legal contact', () => {
  it('links the issue tracker when no support email was configured at build time', () => {
    for (const value of [undefined, '', '   ', 'not an email', 'help@', 'a@b.c?bcc=x@y.z'])
      expect(supportContact(value), String(value)).toEqual({
        kind: 'issues',
        href: ISSUES_URL,
        label: 'github.com/operatoruplift/allowance/issues',
      });
    expect(ISSUES_URL).toBe('https://github.com/operatoruplift/allowance/issues');
  });

  it('uses the configured support email', () => {
    expect(supportContact(' help@example.org ')).toEqual({
      kind: 'email',
      href: 'mailto:help@example.org',
      label: 'help@example.org',
    });
  });

  it('appears on both pages', () => {
    for (const path of LEGAL_ROUTES) expect(page(path)).toContain(`href="${ISSUES_URL}"`);
  });
});

describe('the site footer', () => {
  const routes = [
    ...CLIENT_ROUTES.map((route) => route.replace(/:[^/]+/g, 'example-id')),
    '/definitely-not-a-route-xyz',
  ];

  it.each(routes)('links the privacy policy and the terms from %s', (route) => {
    const footer = /<footer class="site-footer".*?<\/footer>/s.exec(page(route))?.[0] ?? '';
    expect(footer, `${route} has no site footer`).not.toHaveLength(0);
    expect(footer).toContain('href="/privacy"');
    expect(footer).toContain('href="/terms"');
    expect(footer).toContain('© 2026 Operator Uplift');
  });

  it('renders once per page', () => {
    for (const route of routes) expect(page(route).match(/<footer /g), route).toHaveLength(1);
  });
});
