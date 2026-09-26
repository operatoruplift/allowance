import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PolicyLab, { AmountField } from '../src/PolicyLab';

// A validation message that renders in another section of the page is, at phone
// width, a screen away from the field it is about, and the field itself shows no
// sign of the problem. These assert the opposite: the message is inside the
// field's own block, and the input says it is invalid.

const field = (error?: string): string =>
  renderToStaticMarkup(
    <AmountField
      field="allowance"
      label="Total allowance"
      help="The most this task can use."
      value={error ? 'abc' : '0.040000'}
      error={error}
      onChange={() => {}}
    />
  );

describe('an invalid amount', () => {
  it('reports itself on the field, in the same block as the input', () => {
    const html = field('Use a positive decimal with at most six decimal places.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="plan-allowance-help plan-allowance-error"');
    expect(html).toContain('id="plan-allowance-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Use a positive decimal with at most six decimal places.');
    // One block: the message is a child of the field, after its own input.
    expect(html.indexOf('id="plan-allowance-error"')).toBeGreaterThan(
      html.indexOf('id="plan-allowance"')
    );
    expect(html.startsWith('<div class="lab-field">')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
  });

  it('leaves a valid field unmarked and described only by its hint', () => {
    const html = field();
    expect(html).not.toContain('aria-invalid');
    expect(html).toContain('aria-describedby="plan-allowance-help"');
    expect(html).not.toContain('role="alert"');
  });
});

describe('the policy lab totals', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <PolicyLab />
    </MemoryRouter>
  );

  it('names the allowance headroom and the daily headroom separately', () => {
    // "Capacity" belongs to the daily limit, which is what the third field and
    // the blocking reason both call it. The allowance figure is the allowance.
    expect(html).toContain('>Allowance left<');
    expect(html).toContain('>Daily capacity left<');
    expect(html).not.toMatch(/>\s*Capacity left/);
    expect(html).toContain('data-testid="plan-remaining"');
    expect(html).toContain('data-testid="plan-daily-remaining"');
  });

  it('still labels the field the daily figure comes from', () => {
    expect(html).toContain('Daily capacity');
    expect(html).toContain('The amount still available across your tasks.');
  });
});
