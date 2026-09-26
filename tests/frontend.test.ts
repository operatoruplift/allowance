import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { serveClient } from '../server/frontend.js';
import { CLIENT_ROUTES } from '../shared/routes.js';

// The router renders a 404 page for an address it does not serve. Serving that
// page under a 200 says the opposite to everything that reads the status rather
// than the words, so the server has to know which addresses are pages.

const shell = '<!doctype html><title>Allowance</title><div id="root"></div>';
let app: express.Express;

beforeAll(async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'allowance-client-'));
  await writeFile(path.join(directory, 'index.html'), shell);
  await writeFile(
    path.join(directory, 'allowance-a.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>'
  );
  app = express();
  serveClient(app, directory);
});

describe('the built client', () => {
  it('answers every client route with the shell and a 200', async () => {
    for (const route of CLIENT_ROUTES) {
      const url = route.replace(/:[^/]+/g, 'example-id');
      const response = await request(app).get(url);
      expect(response.status, `${url} should be a page`).toBe(200);
      expect(response.text).toContain('<div id="root">');
    }
  });

  it('answers an address the router does not serve with the shell and a 404', async () => {
    for (const url of ['/definitely-not-a-route-xyz', '/lab/extra', '/runs/one/two']) {
      const response = await request(app).get(url);
      expect(response.status, `${url} is not a page`).toBe(404);
      // The shell still comes back, so the site's own 404 page renders in place.
      expect(response.text).toContain('<div id="root">');
    }
  });

  it('still serves a real file from the build', async () => {
    const response = await request(app).get('/allowance-a.svg');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/svg+xml');
    expect(Buffer.from(response.body).toString()).toContain('<svg');
  });

  it('does not serve the shell in place of a missing asset with a 200', async () => {
    expect((await request(app).get('/assets/missing.js')).status).toBe(404);
  });
});
