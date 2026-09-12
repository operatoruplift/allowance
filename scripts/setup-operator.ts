import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import argon2 from 'argon2';
async function hidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error(
      'Use an interactive terminal; passwords are never read from command arguments.'
    );
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const c of chunk.toString()) {
        if (c === '\u0003') {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (c === '\r' || c === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (c === '\u007f') {
          value = value.slice(0, -1);
        } else if (c >= ' ' && value.length < 256) value += c;
      }
    };
    process.stdin.on('data', onData);
  });
}
try {
  const password = await hidden('New operator password (minimum 12 characters): ');
  if (password.length < 12) throw new Error('Use at least 12 characters.');
  if (password !== (await hidden('Repeat password: '))) throw new Error('Passwords do not match.');
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  let current = '';
  try {
    current = await fs.readFile('.env', 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  current = current
    .split('\n')
    .filter((line) => !/^\s*(OPERATOR_PASSWORD_HASH|SESSION_SECRET)=/.test(line))
    .join('\n');
  await fs.writeFile(
    '.env',
    `${current.trimEnd()}\nOPERATOR_PASSWORD_HASH='${hash}'\nSESSION_SECRET=${randomBytes(48).toString('hex')}\n`,
    { mode: 0o600 }
  );
  await fs.chmod('.env', 0o600);
  process.stdout.write(
    'Operator hash and new session secret saved to ignored .env. Restart the service. Existing sessions will be invalidated.\n'
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Setup failed.'}\n`);
  process.exitCode = 1;
}
