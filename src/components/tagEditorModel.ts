export type TagSuggestion = {
  tag: string;
  count: number;
};

const maxSuggestions = 6;

export const tagKey = (tag: string) => tag.toLocaleLowerCase();

export const splitTagInput = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function addUniqueTags(currentTags: string[], newTags: string[]) {
  const existingTags = new Set(currentTags.map(tagKey));
  const additions = newTags.filter((tag) => {
    const key = tagKey(tag);
    if (existingTags.has(key)) return false;

    existingTags.add(key);
    return true;
  });

  return [...currentTags, ...additions];
}

export function listsMatch(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function buildTagSuggestions(tagGroups: string[][]): TagSuggestion[] {
  const counts = new Map<string, TagSuggestion>();

  for (const tags of tagGroups) {
    for (const tag of tags) {
      const normalized = tag.trim();
      if (!normalized) continue;

      const key = tagKey(normalized);
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { tag: normalized, count: 1 });
      }
    }
  }

  return [...counts.values()].sort(compareByFrequencyThenName);
}

export function filterTagSuggestions(
  suggestions: TagSuggestion[],
  currentTags: string[],
  query: string,
) {
  const currentKeys = new Set(currentTags.map(tagKey));
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return suggestions
    .filter((suggestion) => !currentKeys.has(tagKey(suggestion.tag)))
    .filter((suggestion) => {
      if (!normalizedQuery) return true;

      return tagKey(suggestion.tag).includes(normalizedQuery);
    })
    .sort((left, right) => compareByQuery(normalizedQuery, left, right))
    .slice(0, maxSuggestions);
}

function compareByQuery(query: string, left: TagSuggestion, right: TagSuggestion) {
  if (!query) return compareByFrequencyThenName(left, right);

  const leftKey = tagKey(left.tag);
  const rightKey = tagKey(right.tag);
  const leftIsPrefix = tagMatchesPrefix(leftKey, query);
  const rightIsPrefix = tagMatchesPrefix(rightKey, query);

  if (leftIsPrefix !== rightIsPrefix) return leftIsPrefix ? -1 : 1;

  return compareByFrequencyThenName(left, right);
}

function tagMatchesPrefix(tag: string, query: string) {
  return tag.split(/[\s-]+/).some((part) => part.startsWith(query));
}

function compareByFrequencyThenName(left: TagSuggestion, right: TagSuggestion) {
  if (left.count !== right.count) return right.count - left.count;

  return tagKey(left.tag).localeCompare(tagKey(right.tag));
}
