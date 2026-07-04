/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');

describe('image preview styles', () => {
  it('renders full-screen preview images full bleed instead of letterboxed', () => {
    expect(styles).toMatch(/\.image-preview-frame img\s*{[^}]*object-fit:\s*cover;/s);
  });
});

describe('panel tag editor styles', () => {
  it('matches label-to-control spacing for tag legends', () => {
    expect(styles).toMatch(/\.tag-editor legend\s*{[^}]*margin-bottom:\s*6px;/s);
  });
});

describe('panel coordinate editor styles', () => {
  it('keeps coordinate edit inputs visually integrated with their metric pills', () => {
    expect(styles).toMatch(
      /\.destination-profile \.profile-coordinate-input-pill,\s*\.activity-panel \.profile-coordinate-input-pill\s*{[^}]*gap:\s*3px;[^}]*font-size:\s*inherit;/s,
    );
    expect(styles).toMatch(
      /\.destination-profile \.profile-coordinate-input-pill input,\s*\.activity-panel \.profile-coordinate-input-pill input\s*{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*padding:\s*0;[^}]*background:\s*transparent;/s,
    );
  });
});

describe('activity list styles', () => {
  it('removes nested search shell chrome in the activity search', () => {
    expect(styles).toMatch(
      /\.activity-search-group \.search-input-shell,\s*\.activity-search-group \.search-input-shell:focus-within\s*{[^}]*outline:\s*0;/s,
    );
    expect(styles).toMatch(/\.activity-search-group input\s*{[^}]*border:\s*0;/s);
    expect(styles).toMatch(/\.activity-search-group input\s*{[^}]*background:\s*transparent;/s);
    expect(styles).toMatch(/\.activity-search-group input\s*{[^}]*outline:\s*0;/s);
    expect(styles).toMatch(
      /\.destination-profile \.activity-search-group input\s*{[^}]*border:\s*0;/s,
    );
  });

  it('keeps activity rows tightly spaced', () => {
    expect(styles).toMatch(/\.activity-list\s*{[^}]*gap:\s*2px;/s);
  });
});
