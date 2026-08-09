import manifest from '../../local-web.json';
import { plotterAppIdentity } from './appIdentity';

describe('Plotter local-web identity', () => {
  it('matches the generated local-web manifest', () => {
    expect(plotterAppIdentity).toEqual({
      id: manifest.id,
      name: manifest.title,
      icon: manifest.home.icon,
      accent: manifest.home.accent,
    });
    expect(plotterAppIdentity.accent).toBe('#D9467A');
  });
});
