/**
 * Phase H3 - vitest snapshot lock for primitives.
 *
 * Playwright snapshots (web/e2e/visual-regression.spec.ts) cover the
 * full assembled page in a real browser. This vitest companion locks
 * the rendered HTML of every primitive in jsdom so a pure-CSS or
 * structural change (renaming a className, dropping an aria attr,
 * removing a data-testid) is caught at the unit-test layer without
 * needing the e2e runner.
 *
 * Why both layers:
 *   - Playwright catches pixel-level visual diffs (color, spacing,
 *     font rendering) that unit tests cannot see.
 *   - vitest catches HTML structural diffs (DOM tree shape, attribute
 *     names, child order) much faster (no browser, runs on every push)
 *     and produces a readable text diff (`snapshot.toMatchSnapshot()`)
 *     instead of a binary png.
 *
 * Snapshot files live alongside the test in
 * `web/src/test/__snapshots__/visual-snapshots.test.tsx.snap`. Update
 * them with `vitest --update-snapshots` after intentional changes.
 *
 * @see docs/PHASE_H3_VISUAL_REGRESSION.md
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { LoadingSkeleton } from '../components/primitives/LoadingSkeleton';
import { EmptyState } from '../components/primitives/EmptyState';

function withFluent(ui: React.ReactElement): React.ReactElement {
  return <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>;
}

/**
 * Strip Fluent UI's auto-generated CSS-in-JS class hashes (`___xyz123`)
 * from snapshot output so changing the version of @fluentui/react-components
 * does not invalidate every primitive snapshot.
 *
 * The hash format is `___<8-12 alphanumeric chars>` and appears in
 * className lists. We replace it with `___HASH` so the rest of the
 * className list (mostly stable user-defined names) is still asserted
 * but the hash drift is immaterial.
 */
function normalizeFluentHashes(html: string): string {
  return html.replace(/___[a-z0-9]{6,16}/gi, '___HASH');
}

describe('Phase H3 - primitive HTML structural snapshots', () => {
  it('LoadingSkeleton (count=3, default shape)', () => {
    const { container } = render(withFluent(<LoadingSkeleton count={3} />));
    expect(normalizeFluentHashes(container.innerHTML)).toMatchSnapshot();
  });

  it('LoadingSkeleton (count=1, circle shape)', () => {
    const { container } = render(
      withFluent(<LoadingSkeleton count={1} shape="circle" width="48px" height="48px" />),
    );
    expect(normalizeFluentHashes(container.innerHTML)).toMatchSnapshot();
  });

  it('EmptyState (no CTA)', () => {
    const { container } = render(
      withFluent(<EmptyState title="No items yet" body="Create one to get started." />),
    );
    expect(normalizeFluentHashes(container.innerHTML)).toMatchSnapshot();
  });

  it('EmptyState (with CTA)', () => {
    const { container } = render(
      withFluent(
        <EmptyState
          title="No items yet"
          body="Create one to get started."
          actionLabel="Create item"
          onAction={() => {}}
        />,
      ),
    );
    expect(normalizeFluentHashes(container.innerHTML)).toMatchSnapshot();
  });
});
