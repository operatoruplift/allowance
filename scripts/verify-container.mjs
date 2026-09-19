import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Controlled production-image check. No outbound network, host secrets or payer keys.
const image = process.argv[2] || 'allowance:verify';
const name = `allowance-verify-${randomUUID()}`;
const volume = `${name}-data`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000 });
const inContainer = (code) =>
  JSON.parse(docker('exec', name, 'node', '--input-type=module', '-e', code));
const request = (route, cookie) =>
  inContainer(`
  const res = await fetch('http://127.0.0.1:4318' + ${JSON.stringify(route)}, {
    headers: { 'x-forwarded-proto': 'https', cookie: ${JSON.stringify(cookie || '')} }
  });
  console.log(JSON.stringify({status:res.status, body:await res.json(),
    cookie:res.headers.get('set-cookie'), cache:res.headers.get('cache-control')}));
`);
async function healthy() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if (request('/api/health').status === 200) return;
    } catch {
      /* The image may still be starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Production container did not become healthy.');
}
try {
  docker('volume', 'create', volume);
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--network',
    'none',
    '--mount',
    `type=volume,src=${volume},dst=/data`,
    '-e',
    'APP_ORIGIN=https://console.example',
    '-e',
    'PROXY_HOPS=1',
    '-e',
    `SESSION_SECRET=${randomUUID()}${randomUUID()}`,
    '-e',
    'LIVE_PAYMENTS_ENABLED=false',
    image
  );
  await healthy();
  const native = inContainer(`
    import Database from 'better-sqlite3';
    import argon2 from 'argon2';
    const db = new Database('/data/allowance.sqlite');
    db.exec('CREATE TABLE container_restart_probe (id INTEGER PRIMARY KEY, value TEXT) STRICT');
    db.prepare('INSERT INTO container_restart_probe VALUES (?,?)').run(1,'preserved');
    console.log(JSON.stringify({uid:process.getuid(), integrity:db.pragma('quick_check',{simple:true}),
      argon2:await argon2.verify(await argon2.hash('isolated-image-probe'), 'isolated-image-probe')}));
    db.close();
  `);
  assert.notEqual(native.uid, 0);
  assert.equal(native.integrity, 'ok');
  assert.equal(native.argon2, true);
  const session = request('/api/session');
  assert.equal(session.body.authenticated, false);
  assert.equal(session.body.configured, false);
  assert.equal(session.cache, 'no-store');
  assert.match(session.cookie, /^__Host-allowance=/);
  assert.match(session.cookie, /; Secure/);
  const cookie = session.cookie.split(';')[0];
  assert.equal(request('/api/runs', cookie).status, 401);
  docker('restart', '--time', '15', name);
  await healthy();
  const restored = request('/api/session', cookie);
  assert.equal(restored.body.csrfToken, session.body.csrfToken);
  const disk = inContainer(`
    import Database from 'better-sqlite3';
    const db = new Database('/data/allowance.sqlite');
    console.log(JSON.stringify(db.prepare('SELECT value FROM container_restart_probe WHERE id=1').get()));
    db.close();
  `);
  assert.equal(disk.value, 'preserved');
  const details = JSON.parse(docker('inspect', name))[0];
  assert.equal(details.HostConfig.NetworkMode, 'none');
  assert.equal(details.Mounts.filter((mount) => mount.Destination === '/data').length, 1);
  console.log(
    JSON.stringify(
      {
        kind: 'isolated production container; no signing, model calls or external network',
        verifiedAt: new Date().toISOString(),
        image,
        unprivileged: true,
        nativeSqlite: true,
        nativeArgon2: true,
        persistentVolume: true,
        restartSessionPreserved: true,
        secureProxyCookie: true,
        unconfiguredAuthClosed: true,
        network: 'none',
      },
      null,
      2
    )
  );
} finally {
  try {
    docker('rm', '-f', name);
  } catch {
    /* May not have been created. */
  }
  try {
    docker('volume', 'rm', volume);
  } catch {
    /* Only this disposable test volume. */
  }
}
