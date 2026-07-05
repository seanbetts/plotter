import { X } from 'lucide-react';
import type { RouteOption } from '../domain/routeOptions';

type RouteAlternativesPanelStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'saving';

type RouteAlternativesPanelProps = {
  originName: string;
  targetName: string;
  status: RouteAlternativesPanelStatus;
  options: RouteOption[];
  selectedOptionId: string | null;
  error?: string | null;
  onSelectOption: (optionId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
};

const kmToMiles = 0.621371;

function formatDistanceMiles(distanceKm: number) {
  return `${Math.round(distanceKm * kmToMiles).toLocaleString()} mi`;
}

function formatDurationHours(travelTimeHours: number) {
  return `${travelTimeHours.toFixed(1)} hr`;
}

export function RouteAlternativesPanel({
  originName,
  targetName,
  status,
  options,
  selectedOptionId,
  error,
  onSelectOption,
  onConfirm,
  onClose,
}: RouteAlternativesPanelProps) {
  const dialogTitle = `Edit route from ${originName} to ${targetName}`;
  const canConfirm = Boolean(selectedOptionId) && options.length > 0 && status === 'ready';

  return (
    <section className="route-alternatives-panel" role="dialog" aria-modal="true" aria-label={dialogTitle}>
      <header className="route-alternatives-header">
        <div>
          <h2>{dialogTitle}</h2>
          <p>Choose which calculated route should be used for this leg.</p>
        </div>
        <button
          type="button"
          className="route-alternatives-close"
          aria-label="Close route options"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {status === 'loading' ? (
        <p className="route-alternatives-status" role="status" aria-label="Calculating route options">
          Calculating route options
        </p>
      ) : null}
      {status === 'error' && error ? (
        <p className="route-alternatives-error" role="alert">
          {error}
        </p>
      ) : null}
      {status === 'empty' ? (
        <p className="route-alternatives-empty">No alternate routes found for this leg.</p>
      ) : null}

      {options.length > 0 ? (
        <fieldset className="route-alternatives-options">
          <legend>Route options</legend>
          {options.map((option) => {
            const distance = formatDistanceMiles(option.distanceKm);
            const duration = formatDurationHours(option.travelTimeHours);

            return (
              <label key={option.id} className="route-alternative-option">
                <input
                  type="radio"
                  name="route-alternative"
                  aria-label={`${option.label} ${distance} ${duration}`}
                  checked={selectedOptionId === option.id}
                  onChange={() => onSelectOption(option.id)}
                />
                <span className="route-alternative-option-copy">
                  <strong>{option.label}</strong>
                  <small className="route-alternative-option-meta">
                    <span>{distance}</span>
                    <span>{duration}</span>
                  </small>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      <footer className="route-alternatives-actions">
        <button type="button" className="route-alternatives-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="route-alternatives-primary"
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          {status === 'saving' ? 'Saving route' : 'Use selected route'}
        </button>
      </footer>
    </section>
  );
}
