import manifest from '../../local-web.json';

describe('Plotter local-web identity', () => {
  it('uses the canonical Plotter accent', () => {
    expect(manifest.home.accent).toBe('#D9467A');
  });
});
