import { describe, expect, it } from 'vitest';
import {
  addUniqueTags,
  buildTagSuggestions,
  filterTagSuggestions,
  splitTagInput,
} from './tagEditorModel';

describe('tag editor model', () => {
  it('splits comma-separated input into trimmed tags', () => {
    expect(splitTagInput(' food, garden , ,family ')).toEqual(['food', 'garden', 'family']);
  });

  it('adds tags case-insensitively without changing existing tags', () => {
    expect(addUniqueTags(['Food'], ['food', 'Garden'])).toEqual(['Food', 'Garden']);
  });

  it('builds shared suggestions from stop and activity tags by frequency then name', () => {
    expect(
      buildTagSuggestions([
        ['garden', 'family'],
        ['food'],
        ['Family', 'food'],
        ['architecture'],
      ]),
    ).toEqual([
      { tag: 'family', count: 2 },
      { tag: 'food', count: 2 },
      { tag: 'architecture', count: 1 },
      { tag: 'garden', count: 1 },
    ]);
  });

  it('filters suggestions by excluding current tags and ranking prefix matches before contains matches', () => {
    const suggestions = [
      { tag: 'street-food', count: 4 },
      { tag: 'food', count: 2 },
      { tag: 'seafood', count: 8 },
      { tag: 'family', count: 5 },
    ];

    expect(filterTagSuggestions(suggestions, ['food'], 'fo')).toEqual([
      { tag: 'street-food', count: 4 },
      { tag: 'seafood', count: 8 },
    ]);
  });

  it('returns top useful suggestions before typing', () => {
    const suggestions = [
      { tag: 'family', count: 5 },
      { tag: 'garden', count: 3 },
      { tag: 'food', count: 4 },
      { tag: 'museum', count: 2 },
      { tag: 'architecture', count: 1 },
      { tag: 'walk', count: 1 },
      { tag: 'market', count: 1 },
    ];

    expect(filterTagSuggestions(suggestions, ['garden'], '')).toEqual([
      { tag: 'family', count: 5 },
      { tag: 'food', count: 4 },
      { tag: 'museum', count: 2 },
      { tag: 'architecture', count: 1 },
      { tag: 'market', count: 1 },
      { tag: 'walk', count: 1 },
    ]);
  });
});
