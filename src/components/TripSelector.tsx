import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TripSummary } from '../storage/tripDirectoryRepository';

type TripSelectorProps = {
  trips: TripSummary[];
  activeTrip: TripSummary | null;
  actionError: string | null;
  onSelectTrip: (tripId: string) => void;
  onCreateTrip: (name: string) => Promise<boolean | void> | boolean | void;
  onRenameActiveTrip: (name: string) => Promise<boolean | void> | boolean | void;
  onDeleteTrip: (tripId: string) => Promise<boolean | void> | boolean | void;
};

type DialogMode = 'create' | 'rename' | 'delete' | null;

export function TripSelector({
  trips,
  activeTrip,
  actionError,
  onSelectTrip,
  onCreateTrip,
  onRenameActiveTrip,
  onDeleteTrip,
}: TripSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [tripName, setTripName] = useState('');
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

  const openDialog = (mode: DialogMode) => {
    setDialogMode(mode);
    setTripName(mode === 'rename' ? activeTrip?.name ?? '' : '');
  };

  const submitName = async () => {
    const trimmedName = tripName.trim();
    if (!trimmedName) return;

    const succeeded = dialogMode === 'create'
      ? await onCreateTrip(trimmedName)
      : await onRenameActiveTrip(trimmedName);

    if (succeeded === false) return;

    setDialogMode(null);
    setIsOpen(false);
  };

  const confirmDelete = async () => {
    if (!activeTrip) return;

    const succeeded = await onDeleteTrip(activeTrip.id);
    if (succeeded === false) return;

    setDialogMode(null);
    setIsOpen(false);
  };

  return (
    <div className="trip-selector" ref={selectorRef}>
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

      {isOpen ? (
        <div className="trip-selector__menu" role="menu" aria-label="Trips">
          <div className="trip-selector__list">
            {trips.map((trip) => (
              <button
                key={trip.id}
                type="button"
                role="menuitemradio"
                aria-checked={trip.id === activeTrip?.id}
                className={trip.id === activeTrip?.id ? 'is-active' : undefined}
                onClick={() => {
                  onSelectTrip(trip.id);
                  setIsOpen(false);
                }}
              >
                {trip.name}
              </button>
            ))}
          </div>
          <div className="trip-selector__actions">
            <button type="button" role="menuitem" onClick={() => openDialog('create')}>
              <Plus size={16} aria-hidden="true" />
              <span>New trip</span>
            </button>
            <button type="button" role="menuitem" disabled={!activeTrip} onClick={() => openDialog('rename')}>
              <Pencil size={16} aria-hidden="true" />
              <span>Rename trip</span>
            </button>
            <button type="button" role="menuitem" disabled={!activeTrip} onClick={() => openDialog('delete')}>
              <Trash2 size={16} aria-hidden="true" />
              <span>Delete trip</span>
            </button>
          </div>
          {actionError ? <p className="trip-selector__error">{actionError}</p> : null}
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
            <button type="button" onClick={() => setDialogMode(null)}>
              Cancel
            </button>
            <button type="button" onClick={() => void submitName()}>
              {dialogMode === 'create' ? 'Create trip' : 'Save name'}
            </button>
          </div>
        </section>
      ) : null}

      {dialogMode === 'delete' && activeTrip ? (
        <section className="trip-selector__dialog" role="dialog" aria-modal="true" aria-label="Delete trip">
          <p>Delete {activeTrip.name}?</p>
          <div className="trip-selector__dialog-actions">
            <button type="button" onClick={() => setDialogMode(null)}>
              Cancel
            </button>
            <button type="button" onClick={() => void confirmDelete()}>
              Delete {activeTrip.name}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
