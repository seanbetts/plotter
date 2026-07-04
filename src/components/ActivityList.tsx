import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Activity } from '../domain/types';

type ActivityListProps = {
  activities: Activity[];
  selectedActivityId: string | null;
  onSelectActivity: (activityId: string) => void;
  onCreateActivity: (title: string) => Promise<unknown> | unknown;
  onDeleteActivity: (activityId: string) => Promise<unknown> | unknown;
  onReorderActivities: (orderedActivityIds: string[]) => Promise<unknown> | unknown;
};

function moveActivityId(activityIds: string[], activityId: string, direction: -1 | 1) {
  const currentIndex = activityIds.indexOf(activityId);
  const nextIndex = currentIndex + direction;

  if (currentIndex === -1 || nextIndex < 0 || nextIndex >= activityIds.length) {
    return activityIds;
  }

  const nextActivityIds = [...activityIds];
  const [movedActivityId] = nextActivityIds.splice(currentIndex, 1);
  nextActivityIds.splice(nextIndex, 0, movedActivityId);
  return nextActivityIds;
}

export function ActivityList({
  activities,
  selectedActivityId,
  onSelectActivity,
  onCreateActivity,
  onDeleteActivity,
  onReorderActivities,
}: ActivityListProps) {
  const [newActivityTitle, setNewActivityTitle] = useState('');
  const [mutationError, setMutationError] = useState('');
  const orderedActivityIds = activities.map((activity) => activity.id);

  function runMutation(mutation: () => Promise<unknown> | unknown) {
    setMutationError('');
    let result: Promise<unknown> | unknown;

    try {
      result = mutation();
    } catch {
      setMutationError('Unable to update activities.');
      return;
    }

    void Promise.resolve(result).catch(() => {
      setMutationError('Unable to update activities.');
    });
  }

  async function submitNewActivity() {
    const title = newActivityTitle.trim();
    if (!title) return;

    setMutationError('');
    try {
      await Promise.resolve(onCreateActivity(title));
      setNewActivityTitle('');
    } catch {
      setMutationError('Unable to update activities.');
    }
  }

  return (
    <section className="activity-list-section" aria-label="Activities">
      <div className="activity-list-header">
        <h2>Activities</h2>
      </div>

      {activities.length === 0 ? (
        <p className="activity-empty-state">No activities yet</p>
      ) : (
        <ol className="activity-list">
          {activities.map((activity, index) => {
            const isSelected = activity.id === selectedActivityId;
            const title = activity.title;

            return (
              <li
                key={activity.id}
                className={isSelected ? 'activity-row is-selected' : 'activity-row'}
              >
                <button
                  type="button"
                  className="activity-select"
                  aria-label={`Select activity ${title}`}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onSelectActivity(activity.id)}
                >
                  <span className="activity-row-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="activity-row-title">{title}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Move ${title} up`}
                  disabled={index === 0}
                  onClick={() =>
                    runMutation(() =>
                      onReorderActivities(moveActivityId(orderedActivityIds, activity.id, -1)),
                    )
                  }
                >
                  <ArrowUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${title} down`}
                  disabled={index === activities.length - 1}
                  onClick={() =>
                    runMutation(() =>
                      onReorderActivities(moveActivityId(orderedActivityIds, activity.id, 1)),
                    )
                  }
                >
                  <ArrowDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${title}`}
                  onClick={() => runMutation(() => onDeleteActivity(activity.id))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="activity-add-row">
        <input
          aria-label="New activity title"
          placeholder="Add activity"
          value={newActivityTitle}
          onChange={(event) => setNewActivityTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitNewActivity();
            }
          }}
        />
        <button type="button" aria-label="Add activity" onClick={submitNewActivity}>
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
      {mutationError ? (
        <p className="activity-error" role="alert">
          {mutationError}
        </p>
      ) : null}
    </section>
  );
}
