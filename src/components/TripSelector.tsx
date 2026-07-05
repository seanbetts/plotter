import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TripSummary } from '../storage/tripDirectoryRepository';

type TripSelectorProps = {
  trips: TripSummary[];
  activeTrip: TripSummary | null;
  actionError: string | null;
  onSelectTrip: (tripId: string) => void;
  onCreateTrip: (name: string) => Promise<boolean | void> | boolean | void;
  onRenameTrip: (tripId: string, name: string) => Promise<boolean | void> | boolean | void;
  onDeleteTrip: (tripId: string) => Promise<boolean | void> | boolean | void;
};

type DialogMode = 'create' | 'rename' | 'delete' | null;

export function TripSelector({
  trips,
  activeTrip,
  actionError,
  onSelectTrip,
  onCreateTrip,
  onRenameTrip,
  onDeleteTrip,
}: TripSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [tripName, setTripName] = useState('');
  const [targetTrip, setTargetTrip] = useState<TripSummary | null>(null);
  const selectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleWindowPointerDown = (event: PointerEvent) => {
      if (selectorRef.current?.contains(event.target as Node)) return;

      setIsOpen(false);
    };
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setDialogMode(null);
      }
    };

    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [isOpen]);

  const openDialog = (mode: DialogMode, trip: TripSummary | null = null) => {
    setDialogMode(mode);
    setTargetTrip(trip);
    setTripName(mode === 'rename' ? trip?.name ?? '' : '');
    setIsOpen(false);
  };

  const submitName = async () => {
    const trimmedName = tripName.trim();
    if (!trimmedName) return;

    const succeeded = dialogMode === 'create'
      ? await onCreateTrip(trimmedName)
      : targetTrip
        ? await onRenameTrip(targetTrip.id, trimmedName)
        : false;

    if (succeeded === false) return;

    setDialogMode(null);
    setTargetTrip(null);
    setIsOpen(false);
  };

  const confirmDelete = async () => {
    if (!targetTrip) return;

    const succeeded = await onDeleteTrip(targetTrip.id);
    if (succeeded === false) return;

    setDialogMode(null);
    setTargetTrip(null);
    setIsOpen(false);
  };

  return (
    <div className="trip-selector" ref={selectorRef}>
      <div className="trip-selector__controls">
        <button
          type="button"
          className="trip-selector__trigger"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label={`Current trip: ${activeTrip?.name ?? 'Loading trips'}`}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span>{activeTrip?.name ?? 'Loading trips'}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="trip-selector__create-button"
          aria-label="New trip"
          onClick={() => openDialog('create')}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>

      {isOpen ? (
        <div className="trip-selector__menu" role="menu" aria-label="Trips">
          <div className="trip-selector__list">
            {trips.map((trip) => (
              <div className="trip-selector__row" key={trip.id}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={trip.id === activeTrip?.id}
                  className={trip.id === activeTrip?.id ? 'is-active' : undefined}
                  onClick={() => {
                    onSelectTrip(trip.id);
                    setIsOpen(false);
                  }}
                >
                  <span>{trip.name}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="trip-selector__row-action"
                  aria-label={`Rename ${trip.name}`}
                  onClick={() => openDialog('rename', trip)}
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="trip-selector__row-action"
                  aria-label={`Delete ${trip.name}`}
                  onClick={() => openDialog('delete', trip)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {dialogMode === 'create' || dialogMode === 'rename' ? (
        <section
          className="trip-selector__dialog"
          role="dialog"
          aria-modal="true"
          aria-label={dialogMode === 'create' ? 'New trip' : 'Rename trip'}
        >
          <label htmlFor="trip-selector-name">Trip name</label>
          <input
            id="trip-selector-name"
            value={tripName}
            onChange={(event) => setTripName(event.target.value)}
          />
          <div className="trip-selector__dialog-actions">
            <button type="button" onClick={() => {
              setDialogMode(null);
              setTargetTrip(null);
            }}>
              Cancel
            </button>
            <button type="button" onClick={() => void submitName()}>
              {dialogMode === 'create' ? 'Create trip' : 'Save name'}
            </button>
          </div>
        </section>
      ) : null}

      {dialogMode === 'delete' && targetTrip ? (
        <section className="trip-selector__dialog" role="dialog" aria-modal="true" aria-label="Delete trip">
          <p>Delete {targetTrip.name}?</p>
          <div className="trip-selector__dialog-actions">
            <button type="button" onClick={() => {
              setDialogMode(null);
              setTargetTrip(null);
            }}>
              Cancel
            </button>
            <button type="button" onClick={() => void confirmDelete()}>
              Delete {targetTrip.name}
            </button>
          </div>
        </section>
      ) : null}

      {actionError ? <p className="trip-selector__error">{actionError}</p> : null}
    </div>
  );
}
