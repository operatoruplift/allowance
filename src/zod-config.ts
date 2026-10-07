import { z } from 'zod';

// Both deploy targets serve the client with script-src 'self', which forbids eval.
// Zod 4 probes for eval with a caught `new Function` the first time it builds an
// object schema, and the browser reports that probe as a CSP violation on every
// page even though Zod falls back. Jitless parsing skips the probe and behaves the
// same. This module must be imported before anything that defines a schema.
z.config({ jitless: true });
