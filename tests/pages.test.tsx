import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import App, { RunDetails } from '../src/App';
import { createDemo, demoProbe, fixtureStep } from '../src/demo';

// The pages are rendered to markup here rather than described in a comment:
// react-dom/server needs no browser, so the header pill, the live region, the
// state of each trigger and the 404 page can be asserted on the real output.

const page = (path: string): string =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );

/** The rehearsal after its two purchases and the budget boundary. */
const finishedRun = () => {
  let run = createDemo();
  for (let step = 0; step < 6; step++) run = fixtureStep(run, step, 'standard');
  return run;
};

const details = (run: ReturnType<typeof createDemo>): string =>
  renderToStaticMarkup(
    <MemoryRouter>
      <RunDetails run={run} probe={() => {}} exportReceipt={() => {}} probePending={false} />
    </MemoryRouter>
  );

describe('the rehearsal page header', () => {
  it('describes the rehearsal it is showing, not a live execution', () => {
    const html = page('/demo');
    expect(html).toContain('Offline plan');
    expect(html).toContain('Payments: no funds moved');
    expect(html).toContain('Data: not requested');
    expect(html).not.toContain('Live execution');
    // Nothing on this page probes a network, so no label may claim to be waiting.
    expect(html).not.toContain('checking');
  });

  it('keeps the rehearsal notice it sits beside', () => {
    expect(page('/demo')).toContain('You’re in rehearsal.');
  });
});

describe('the rehearsal triggers', () => {
  it('states unavailability with aria, so pressing run cannot drop focus', () => {
    const html = page('/demo');
    const trigger = /<button[^>]*>(?:(?!<\/button>).)*Run the rehearsal/s.exec(html)?.[0] ?? '';
    expect(trigger, 'the run trigger should be in the markup').not.toHaveLength(0);
    expect(trigger).toContain('aria-disabled="false"');
    expect(trigger).toContain('aria-busy="false"');
    expect(trigger).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it('mounts a status region before any run, so the outcome can be announced', () => {
    expect(page('/demo')).toContain('<p class="visually-hidden" role="status">');
  });

  it('keeps the boundary trigger mounted once the probe has answered', () => {
    const before = details(finishedRun());
    expect(before).toContain('Test the boundary');
    expect(before).not.toContain('Denied before signing');

    const after = details(demoProbe(finishedRun()));
    // The button that was pressed is still there to hold focus, marked
    // unavailable rather than removed, with the outcome beside it.
    expect(after).toContain('Test the boundary');
    expect(after).toContain('aria-disabled="true"');
    expect(after).toContain('Denied before signing');
    expect(after).not.toMatch(/<button[^>]*\sdisabled/);
  });
});

describe('the landing budget summary', () => {
  it('names the allowance figure the same way the policy lab does', () => {
    const html = page('/');
    // Two figures on this page are allowance headroom: the hero receipt and the
    // scrolling story's policy outcome. "Capacity" belongs to the daily limit, so
    // neither may borrow the word for the allowance.
    expect(html.match(/Allowance left/g)).toHaveLength(2);
    expect(html).not.toMatch(/capacity left/i);
    expect(html).not.toContain('Available capacity');
  });

  it('explains the comparison without renaming the allowance', () => {
    expect(page('/')).toContain('Compare proposed costs with the allowance left.');
  });
});

describe('unmatched routes', () => {
  it('render the site 404 page, with the header, a home link and the footer', () => {
    const html = page('/definitely-not-a-route-xyz');
    expect(html).toContain('404 / Outside this allowance');
    expect(html).toContain('This page isn’t here.');
    expect(html).toContain('Go to the home page');
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain('aria-label="Footer navigation"');
    expect(html).toContain('href="/"');
  });
});
