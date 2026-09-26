import path from 'node:path';
import express, { type Express } from 'express';
import { isClientRoute } from '../shared/routes.js';

/**
 * Serves the built client. Every document request receives the app shell, and the
 * status says which page it is: a route the router serves answers 200, and any
 * other address answers 404 with the shell, so the site's own 404 page is what a
 * visitor reads and a crawler or link checker is told the same thing.
 */
export function serveClient(app: Express, directory: string): void {
  const root = path.resolve(directory);
  app.use(express.static(root, { index: false }));
  app.get('/{*path}', (request, response) =>
    response.status(isClientRoute(request.path) ? 200 : 404).sendFile(path.join(root, 'index.html'))
  );
}
