import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActivity, reorderActivities, updateActivity } from './activities';

describe('activities', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an activity with defaults for a destination', () => {
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));

    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Louvre',
      order: 2,
    });

    expect(activity).toMatchObject({
      destinationId: 'destination-1',
      order: 2,
      title: 'Louvre',
      description: '',
      category: 'other',
      status: 'idea',
      priority: 'medium',
      links: [],
      notes: '',
      tags: [],
      createdAt: '2026-07-03T12:00:00.000Z',
      updatedAt: '2026-07-03T12:00:00.000Z',
    });
    expect(activity.id).toEqual(expect.any(String));
  });

  it('updates an activity timestamp strictly after patching fields when the current clock is behind', () => {
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
    const activity = {
      ...createActivity({
        destinationId: 'destination-1',
        title: 'Bakery crawl',
        order: 0,
      }),
      updatedAt: '2026-07-03T12:00:01.000Z',
    };

    vi.setSystemTime(new Date('2026-07-03T12:00:00.500Z'));

    const updated = updateActivity(activity, {
      title: 'Morning bakery crawl',
      tags: ['food'],
    });

    expect(updated).toMatchObject({
      id: activity.id,
      destinationId: 'destination-1',
      title: 'Morning bakery crawl',
      tags: ['food'],
    });
    expect(updated.createdAt).toBe(activity.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(activity.updatedAt));
  });

  it('updates an activity timestamp after patching fields', () => {
    const activity = createActivity({
      destinationId: 'destination-1',
      title: 'Bakery crawl',
      order: 0,
    });

    const updated = updateActivity(activity, {
      title: 'Morning bakery crawl',
      tags: ['food'],
    });

    expect(updated).toMatchObject({
      id: activity.id,
      destinationId: 'destination-1',
      title: 'Morning bakery crawl',
      tags: ['food'],
    });
    expect(updated.createdAt).toBe(activity.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(activity.updatedAt));
  });

  it('reorders activities by requested ids and preserves omitted activities after requested ids', () => {
    const first = createActivity({ destinationId: 'destination-1', title: 'First', order: 0 });
    const second = createActivity({ destinationId: 'destination-1', title: 'Second', order: 1 });
    const third = createActivity({ destinationId: 'destination-1', title: 'Third', order: 2 });

    const reordered = reorderActivities([first, second, third], [
      third.id,
      'unknown-activity',
      first.id,
    ]);

    expect(reordered.map((activity) => activity.title)).toEqual(['Third', 'First', 'Second']);
    expect(reordered.map((activity) => activity.order)).toEqual([0, 1, 2]);
  });
});
