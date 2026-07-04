import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { PlaceSearchResult } from '../adapters/geocoding';
import type { Activity, ActivityLocation } from '../domain/types';
import { SearchCombobox } from './SearchCombobox';

type ActivityListProps = {
  title?: string;
  activities: Activity[];
  selectedActivityId: string | null;
  onSelectActivity: (activityId: string) => void;
  onCreateActivity: (input: { title: string; location?: ActivityLocation }) => Promise<unknown> | unknown;
  searchActivities: (query: string) => Promise<PlaceSearchResult[]>;
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

function formatCoordinatePair(result: Extract<PlaceSearchResult, { kind: 'coordinates' }>) {
  return `${result.coordinates.lat}, ${result.coordinates.lng}`;
}

function activityLocationFromSearchResult(
  result: Extract<PlaceSearchResult, { kind: 'place' }>,
): ActivityLocation {
  return {
    name: result.location.placeName,
    address: result.address ?? result.location.sourceLabel,
    coordinates: result.coordinates,
    sourceProvider: 'maptiler',
    sourceFeatureId: result.location.sourceFeatureId,
  };
}

function activityLocationFromCoordinateResult(
  result: Extract<PlaceSearchResult, { kind: 'coordinates' }>,
): ActivityLocation {
  const coordinates = formatCoordinatePair(result);

  return {
    name: 'Coordinates',
    address: coordinates,
    coordinates: result.coordinates,
    sourceProvider: 'manual',
  };
}

function formatActivitySearchContext(result: PlaceSearchResult) {
  if (result.kind === 'coordinates') {
    return formatCoordinatePair(result);
  }

  return result.address ?? result.location.sourceLabel;
}

function formatDistance(distanceKm: number | undefined) {
  if (distanceKm === undefined) return '';

  if (distanceKm >= 10) {
    return `${Math.round(distanceKm)} km`;
  }

  return `${distanceKm.toFixed(1)} km`;
}

function formatTypeBadge(result: PlaceSearchResult) {
  if (result.kind === 'coordinates') return 'Coordinates';

  return result.placeTypeNames?.[0] ?? result.placeTypes?.[0] ?? 'Place';
}

export function ActivityList({
  title = 'Activities',
  activities,
  selectedActivityId,
  onSelectActivity,
  onCreateActivity,
  searchActivities,
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

  async function createManualActivity(query: string) {
    const title = query.trim();
    if (!title) return;

    setMutationError('');
    await Promise.resolve(onCreateActivity({ title }));
    setNewActivityTitle('');
  }

  async function submitNewActivity() {
    try {
      await createManualActivity(newActivityTitle);
    } catch {
      setMutationError('Unable to update activities.');
    }
  }

  async function createActivityFromSearchResult(result: PlaceSearchResult) {
    setMutationError('');
    try {
      if (result.kind === 'coordinates') {
        await Promise.resolve(
          onCreateActivity({
            title: 'Coordinates',
            location: activityLocationFromCoordinateResult(result),
          }),
        );
      } else {
        await Promise.resolve(
          onCreateActivity({
            title: result.location.placeName,
            location: activityLocationFromSearchResult(result),
          }),
        );
      }
    } catch {
      setMutationError('Unable to update activities.');
      throw new Error('Unable to update activities.');
    }
  }

  return (
    <section className="activity-list-section" aria-label={title}>
      <div className="activity-list-header">
        <h2>{title}</h2>
      </div>

      <div className="activity-add-row">
        <SearchCombobox<PlaceSearchResult>
          label="Search for an activity"
          placeholder="Find a place, venue, or address"
          inputId="activity-search"
          resultsId="activity-search-results"
          className="activity-search-group"
          value={newActivityTitle}
          onValueChange={setNewActivityTitle}
          search={searchActivities}
          getResultId={(result) => result.id}
          getResultLabel={(result) => result.label}
          onSelectResult={createActivityFromSearchResult}
          onSubmitQuery={createManualActivity}
          renderResult={(result) => {
            const context = formatActivitySearchContext(result);
            const distance = formatDistance(result.distanceFromProximityKm);

            return (
              <span className="activity-search-result">
                <span className="activity-search-result__primary">
                  <span className="search-result-title">
                    {result.kind === 'coordinates' ? 'Use coordinates' : result.location.placeName}
                  </span>
                  <span className="search-result-badge">{formatTypeBadge(result)}</span>
                </span>
                <span className="activity-search-result__meta">
                  {context ? <span className="search-result-subtitle">{context}</span> : null}
                  {distance ? <span className="search-result-distance">{distance}</span> : null}
                </span>
              </span>
            );
          }}
        />
        <button type="button" aria-label="Add activity" onClick={submitNewActivity}>
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>

      {activities.length === 0 ? (
        <p className="activity-empty-state">No activities yet</p>
      ) : (
        <ol className="activity-list">
          {activities.map((activity, index) => {
            const isSelected = activity.id === selectedActivityId;
            const title = activity.title;

            return (
              <li key={activity.id} className="activity-row">
                <button
                  type="button"
                  className={isSelected ? 'activity-select is-selected' : 'activity-select'}
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
      {mutationError ? (
        <p className="activity-error" role="alert">
          {mutationError}
        </p>
      ) : null}
    </section>
  );
}
