import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The Android shell is generated, then edited by hand. Regenerating it rewrites
// the build script, and nothing at runtime would show that the locale filter or
// the documented signing inputs had quietly gone.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8');

describe('the Android shell', () => {
  it('packages English resources only', () => {
    // Every other locale comes from AndroidX libraries the app never translates,
    // and a listing that declares 86 languages it does not speak can be refused.
    expect(read('android/app/build.gradle.kts')).toMatch(
      /androidResources\s*\{\s*localeFilters\s*\+=\s*listOf\("en"\)\s*\}/
    );
    // Without a resource of its own in English, the filtered APK reports no
    // language at all, only the default configuration.
    expect(read('android/app/src/main/res/values-en/strings.xml')).toContain(
      '<string name="app_name">Allowance</string>'
    );
  });

  it('documents only the build properties Gradle actually reads', () => {
    const build = read('android/app/build.gradle.kts') + read('android/gradle.properties');
    const named = new Set(read('docs/seeker-and-pwa.md').match(/\bWEB_SHELL_[A-Z_]+\b/g));
    expect(named.size).toBeGreaterThan(0);
    for (const name of named) expect(build, `${name} is never read by the build`).toContain(name);
  });
});
