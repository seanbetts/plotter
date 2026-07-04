import type { Activity } from './types';

type CreateActivityInput = {
  destinationId: string;
  title: string;
  order?: number;
};

type ActivityPatch = Partial<Omit<Activity, 'id' | 'destinationId' | 'createdAt' | 'updatedAt'>>;

const nowIso = () => new Date().toISOString();
const createId = () => crypto.randomUUID();
const nextIsoAfter = (timestamp: string) => {
  const now = nowIso();
  const previousTime = Date.parse(timestamp);

  if (Date.parse(now) > previousTime) {
    return now;
  }

  return new Date(previousTime + 1).toISOString();
};

export function createActivity(input: CreateActivityInput): Activity {
  const timestamp = nowIso();

  return {
    id: createId(),
    destinationId: input.destinationId,
    order: input.order ?? 0,
    title: input.title,
    description: '',
    category: 'other',
    status: 'idea',
    priority: 'medium',
    links: [],
    notes: '',
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateActivity(activity: Activity, patch: ActivityPatch): Activity {
  return {
    ...activity,
    ...patch,
    updatedAt: nextIsoAfter(activity.updatedAt),
  };
}

export function reorderActivities(activities: Activity[], orderedActivityIds: string[]): Activity[] {
  const requestedIds = new Set(orderedActivityIds);
  const activitiesById = new Map(activities.map((activity) => [activity.id, activity]));
  const orderedActivities = [
    ...orderedActivityIds
      .map((activityId) => activitiesById.get(activityId))
      .filter((activity): activity is Activity => activity !== undefined),
    ...activities.filter((activity) => !requestedIds.has(activity.id)),
  ];

  return orderedActivities.map((activity, order) =>
    activity.order === order ? activity : updateActivity(activity, { order }),
  );
}
