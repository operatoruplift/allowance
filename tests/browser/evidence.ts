import { mkdirSync } from 'node:fs';
import path from 'node:path';

/** Each validation run writes fresh captures instead of replacing dated release evidence. */
export function evidencePath(filename: string): string {
  const destination = path.resolve(
    process.env.ALLOWANCE_EVIDENCE_DIR ?? 'test-results/evidence',
    filename
  );
  mkdirSync(path.dirname(destination), { recursive: true });
  return destination;
}
