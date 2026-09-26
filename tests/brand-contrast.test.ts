import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The count beside each brand-kit filter is 10px text, so it needs 4.5:1 like any
// other small text. A 0.75 fade over the cream page put it at 3.3:1 while the
// label beside it passed, which is exactly the kind of difference a screenshot
// does not show. The numerals inherit the button's colour in every state now, so
// what this checks is that each of those colours clears the ratio on its own
// ground, and that no rule fades them again.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(path.join(root, 'src/brand-kit.css'), 'utf8');

/** The value of a `--bk-*` custom property declared in the stylesheet. */
function token(name: string): string {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(css)?.[1];
  expect(value, `--${name} should be declared in brand-kit.css`).toBeDefined();
  return value!;
}

/** The body of one rule, by exact selector. */
function rule(selector: string): string {
  const body = css.split(`${selector} {`)[1]?.split('}')[0];
  expect(body, `${selector} should exist in brand-kit.css`).toBeDefined();
  return body!;
}

function channel(value: number): number {
  const ratio = value / 255;
  return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16)
  );
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** WCAG 2 contrast ratio between two opaque colours. */
function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe('brand kit filter counts', () => {
  it('are never faded away from the colour they inherit', () => {
    expect(rule('.bk-filters button span')).not.toContain('opacity');
  });

  it('clear 4.5:1 in the resting, pressed and hovered states', () => {
    expect(contrast(token('bk-muted'), token('bk-paper'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', token('bk-ink'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('bk-red'), token('bk-soft'))).toBeGreaterThanOrEqual(4.5);
  });

  it('measures the ratio the way the guideline defines it', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // The fade this replaced, for the record: cream at 25% over the muted ink.
    expect(contrast('#918787', token('bk-paper'))).toBeLessThan(4.5);
  });
});
