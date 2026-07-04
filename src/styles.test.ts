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
