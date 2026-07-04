/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');

describe('image preview styles', () => {
  it('renders full-screen preview images full bleed instead of letterboxed', () => {
    expect(styles).toMatch(/\.image-preview-frame img\s*{[^}]*object-fit:\s*cover;/s);
  });

  it('mirrors populated image strip structure for empty image strips', () => {
    expect(styles).toMatch(
      /\.destination-image-strip\s*{[^}]*--destination-image-hero-height:\s*clamp\(156px,\s*22vh,\s*240px\);[^}]*--destination-image-carousel-height:\s*60px;/s,
    );
    expect(styles).toMatch(/\.destination-image-empty\s*{[^}]*min-height:\s*var\(--destination-image-hero-height\);/s);
    expect(styles).toMatch(/\.destination-image-hero\s*{[^}]*height:\s*var\(--destination-image-hero-height\);/s);
    expect(styles).toMatch(
      /\.destination-image-carousel\s*{[^}]*min-height:\s*var\(--destination-image-carousel-height\);/s,
    );
    expect(styles).toMatch(/\.destination-image-carousel\.is-empty\s*{[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.destination-image-empty-graphic\s*{[^}]*width:\s*42px;[^}]*height:\s*42px;/s);
    expect(styles).toMatch(/\.destination-image-loading-spinner\s*{[^}]*animation:\s*route-spin 900ms linear infinite;/s);
    expect(styles).toMatch(
      /\.destination-image-thumbnail-placeholder\s*{[^}]*background:\s*rgb\(var\(--color-text-rgb\) \/ 0\.045\);[^}]*cursor:\s*default;/s,
    );
    expect(styles).toMatch(/\.destination-image-empty\s*{[^}]*border-style:\s*solid;/s);
    expect(styles).not.toMatch(/\.destination-image-empty\s*{[^}]*border-style:\s*dashed;/s);
  });

  it('keeps only the top divider on stop image strips', () => {
    expect(styles).toMatch(/\.destination-image-strip\s*{[^}]*border-top:\s*1px solid var\(--border-subtle\);/s);
    expect(styles).not.toMatch(/\.destination-image-strip\s*{[^}]*border-block:/s);
    expect(styles).not.toMatch(/\.destination-image-strip\s*{[^}]*border-bottom:/s);
  });
});

describe('panel tag editor styles', () => {
  it('matches label-to-control spacing for tag legends', () => {
    expect(styles).toMatch(/\.tag-editor legend\s*{[^}]*margin-bottom:\s*6px;/s);
  });

  it('bottom-aligns the tag section with a section divider in profile panels', () => {
    expect(styles).toMatch(
      /\.destination-profile,\s*\.activity-panel\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s,
    );
    expect(styles).toMatch(
      /\.destination-profile > \.tag-editor,\s*\.activity-panel > \.tag-editor\s*{[^}]*margin-top:\s*auto;[^}]*padding-top:\s*10px;[^}]*border-top:\s*1px solid var\(--border-subtle\);/s,
    );
  });

  it('styles tag legends like activity section headings', () => {
    expect(styles).toMatch(
      /\.tag-editor legend\s*{[^}]*color:\s*var\(--text-secondary\);[^}]*font-size:\s*0\.82rem;[^}]*font-weight:\s*700;/s,
    );
  });

  it('leaves breathing room between tag titles and their divider line', () => {
    expect(styles).toMatch(/\.tag-editor legend\s*{[^}]*padding-right:\s*12px;/s);
  });
});

describe('profile header styles', () => {
  it('keeps long location text inside the fixed-width profile panels', () => {
    expect(styles).toMatch(
      /\.profile-header\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/s,
    );
    expect(styles).toMatch(/\.profile-header-main\s*{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(
      /\.profile-location-address\s*{[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
  });

  it('places the stay-days stepper in the right header column', () => {
    expect(styles).toMatch(
      /\.profile-header\s*{[^}]*align-items:\s*stretch;/s,
    );
    expect(styles).toMatch(
      /\.profile-header-actions\s*{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto 1fr;[^}]*justify-items:\s*end;/s,
    );
    expect(styles).toMatch(
      /\.profile-stay-days\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto auto;[^}]*align-self:\s*end;[^}]*justify-content:\s*end;[^}]*gap:\s*8px;/s,
    );
    expect(styles).toMatch(
      /\.profile-stay-days-readout\s*{[^}]*justify-items:\s*center;/s,
    );
    expect(styles).toMatch(
      /\.profile-stay-days-number\s*{[^}]*font-size:\s*2\.05rem;/s,
    );
    expect(styles).toMatch(
      /\.profile-stay-days-label\s*{[^}]*font-size:\s*0\.66rem;[^}]*text-transform:\s*uppercase;/s,
    );
  });

  it('sizes save status feedback to match the close button', () => {
    expect(styles).toMatch(/\.profile-close-button\s*{[^}]*width:\s*34px;[^}]*height:\s*34px;/s);
    expect(styles).toMatch(/\.profile-save-status\s*{[^}]*width:\s*34px;[^}]*height:\s*34px;/s);
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

  it('lets the stop activity section shrink before the bottom tag editor', () => {
    expect(styles).toMatch(
      /\.destination-profile \.activity-list-section\s*{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s,
    );
  });

  it('keeps activity section controls packed together when the section grows', () => {
    expect(styles).toMatch(/\.activity-list-section\s*{[^}]*align-content:\s*start;/s);
  });

  it('styles the activity title divider like tag legends', () => {
    expect(styles).toMatch(
      /\.activity-list-header\s*{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*12px;/s,
    );
    expect(styles).toMatch(
      /\.activity-list-header::after\s*{[^}]*flex:\s*1 1 auto;[^}]*border-top:\s*1px solid var\(--border-subtle\);/s,
    );
    expect(styles).toMatch(/\.activity-list-section\s*{[^}]*padding-top:\s*0;[^}]*border-top:\s*0;/s);
  });

  it('uses the shared itinerary row hover treatment for stops and activities', () => {
    expect(styles).toMatch(/\.stop-item,\s*\.activity-row\s*{[^}]*background:\s*var\(--surface-row\);/s);
    expect(styles).toMatch(
      /\.stop-item:hover,\s*\.stop-item:focus-within,\s*\.activity-row:hover,\s*\.activity-row:focus-within\s*{[^}]*border-color:\s*var\(--border-hover\);[^}]*background:\s*var\(--surface-control-hover\);/s,
    );
    expect(styles).not.toMatch(/\.activity-select:hover,\s*\.activity-select:focus-visible/s);
  });

  it('keeps stop list rows compact without changing the row structure', () => {
    expect(styles).toMatch(
      /\.stop-item\s*{[^}]*grid-template-columns:\s*28px 28px minmax\(0,\s*1fr\) auto 32px;[^}]*gap:\s*4px;/s,
    );
    expect(styles).toMatch(
      /\.stop-select\s*{[^}]*align-content:\s*center;[^}]*gap:\s*0;[^}]*padding:\s*10px 8px;/s,
    );
    expect(styles).not.toMatch(/\.stop-delete\s*{[^}]*border-left:/s);
  });

  it('keeps itinerary stop addresses on one truncated line', () => {
    expect(styles).toMatch(
      /\.stop-select small\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
  });
});

describe('itinerary panel styles', () => {
  it('keeps the stops panel width stable when collapsed', () => {
    expect(styles).toMatch(/\.itinerary-panel\s*{[^}]*width:\s*min\(520px,\s*calc\(100vw - 32px\)\);/s);
    expect(styles).toMatch(/\.itinerary-panel\.is-collapsed\s*{[^}]*gap:\s*0;[^}]*overflow:\s*visible;/s);
    expect(styles).toMatch(
      /\.itinerary-panel-header\s*{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s,
    );
    expect(styles).toMatch(
      /\.itinerary-panel-actions\s*{[^}]*display:\s*flex;[^}]*justify-content:\s*end;[^}]*gap:\s*8px;/s,
    );
    expect(styles).toMatch(
      /\.itinerary-panel-stats\s*{[^}]*display:\s*flex;[^}]*flex:\s*0 0 auto;[^}]*gap:\s*7px;[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(/\.itinerary-panel-stat \+ \.itinerary-panel-stat::before\s*{[^}]*content:\s*"·";/s);
    expect(styles).toMatch(/\.itinerary-panel-toggle\s*{[^}]*width:\s*28px;[^}]*height:\s*28px;/s);
  });
});

describe('inline route connector styles', () => {
  it('keeps route rows compact and visually secondary between stops', () => {
    expect(styles).toMatch(
      /\.inline-route-leg\s*{[^}]*grid-template-columns:\s*30px 1px minmax\(0,\s*1fr\);[^}]*gap:\s*10px;[^}]*min-height:\s*calc\(42px \+ var\(--stop-list-gap,\s*8px\)\);[^}]*margin-bottom:\s*calc\(0px - var\(--stop-list-gap,\s*8px\)\);[^}]*padding:\s*4px 36px 4px 36px;/s,
    );
    expect(styles).toMatch(/\.inline-route-rail\s*{[^}]*height:\s*30px;/s);
    expect(styles).toMatch(/\.inline-route-type\s*{[^}]*width:\s*28px;[^}]*height:\s*28px;/s);
    expect(styles).toMatch(
      /\.inline-route-metrics\s*{[^}]*display:\s*flex;[^}]*gap:\s*6px;[^}]*min-width:\s*0;/s,
    );
    expect(styles).toMatch(/\.inline-route-metric \+ \.inline-route-metric::before\s*{[^}]*content:\s*"·";/s);
    expect(styles).toMatch(/\.inline-route-border-crossing\s*{[^}]*margin-left:\s*auto;/s);
    expect(styles).toMatch(/\.inline-route-retry \+ \.inline-route-border-crossing\s*{[^}]*margin-left:\s*0;/s);
  });
});
