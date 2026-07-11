import { Car, Caravan, Check, ChevronDown, Pencil, Plus, Trash2, Truck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { VehiclePreset } from '../domain/types';
import type { TripSummary } from '../storage/tripDirectoryRepository';

type TripSelectorProps = {
  trips: TripSummary[];
  activeTrip: TripSummary | null;
  actionError: string | null;
  onSelectTrip: (tripId: string) => void;
  onCreateTrip: (name: string) => Promise<boolean | void> | boolean | void;
  onUpdateTrip: (
    tripId: string,
    patch: { name: string; vehiclePreset: VehiclePreset },
  ) => Promise<TripSummary | false> | TripSummary | false;
  onDeleteTrip: (tripId: string) => Promise<boolean | void> | boolean | void;
};

type DialogMode = 'create' | 'edit' | 'delete' | null;

const vehicleOptions = [
  { preset: 'standard', label: 'Standard vehicle', Icon: Car },
  { preset: 'large-camper', label: 'Large camper', Icon: Caravan },
  { preset: 'expedition-truck', label: 'Expedition truck', Icon: Truck },
] satisfies Array<{ preset: VehiclePreset; label: string; Icon: typeof Car }>;

export function TripSelector({
  trips,
  activeTrip,
  actionError,
  onSelectTrip,
  onCreateTrip,
  onUpdateTrip,
  onDeleteTrip,
}: TripSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [tripName, setTripName] = useState('');
  const [vehiclePreset, setVehiclePreset] = useState<VehiclePreset>('standard');
  const [targetTrip, setTargetTrip] = useState<TripSummary | null>(null);
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const deleteDialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen && !dialogMode) return undefined;

    const closeOverlays = () => {
      setIsOpen(false);
      setDialogMode(null);
      setTargetTrip(null);
    };
    const handleWindowPointerDown = (event: PointerEvent) => {
      if (selectorRef.current?.contains(event.target as Node)) return;

      closeOverlays();
    };
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeOverlays();
      }
    };

    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [dialogMode, isOpen]);

  useEffect(() => {
    if (!dialogMode) return;

    if (dialogMode === 'delete') {
      deleteDialogRef.current?.focus();
      return;
    }

    nameInputRef.current?.focus();
  }, [dialogMode]);

  const closeDialog = () => {
    setDialogMode(null);
    setTargetTrip(null);
  };

  const openDialog = (mode: DialogMode, trip: TripSummary | null = null) => {
    setDialogMode(mode);
    setTargetTrip(trip);
    setTripName(mode === 'edit' ? trip?.name ?? '' : '');
    setVehiclePreset(mode === 'edit' ? trip?.routingVehicle.preset ?? 'standard' : 'standard');
    setIsOpen(false);
  };

  const submitName = async () => {
    const trimmedName = tripName.trim();
    if (!trimmedName) return;

    const succeeded = dialogMode === 'create'
      ? await onCreateTrip(trimmedName)
      : targetTrip
        ? await onUpdateTrip(targetTrip.id, { name: trimmedName, vehiclePreset })
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
                  aria-label={`Edit ${trip.name}`}
                  onClick={() => openDialog('edit', trip)}
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

      {dialogMode === 'create' || dialogMode === 'edit' ? (
        <section
          className="trip-selector__dialog"
          role="dialog"
          aria-modal="true"
          aria-label={dialogMode === 'create' ? 'New trip' : 'Edit trip'}
        >
          <form
            className="trip-selector__dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitName();
            }}
          >
            <label htmlFor="trip-selector-name">Trip name</label>
            {dialogMode === 'edit' ? (
              <div
                role="group"
                aria-label="Vehicle for this trip"
                className="trip-selector__vehicle-options"
              >
                {vehicleOptions.map(({ preset, label, Icon }) => (
                  <button
                    key={preset}
                    type="button"
                    className="trip-selector__vehicle-option"
                    aria-label={label}
                    aria-pressed={vehiclePreset === preset}
                    title={label}
                    onClick={() => setVehiclePreset(preset)}
                  >
                    <Icon size={17} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="trip-selector__dialog-entry">
              <input
                id="trip-selector-name"
                ref={nameInputRef}
                value={tripName}
                onChange={(event) => setTripName(event.target.value)}
              />
              <button
                type="button"
                className="trip-selector__dialog-icon-button"
                aria-label="Cancel"
                onClick={closeDialog}
              >
                <X size={16} aria-hidden="true" />
              </button>
              <button
                type="submit"
                className="trip-selector__dialog-icon-button"
                aria-label={dialogMode === 'create' ? 'Create trip' : 'Save trip'}
              >
                <Check size={16} aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {dialogMode === 'delete' && targetTrip ? (
        <section
          ref={deleteDialogRef}
          className="trip-selector__dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Delete trip"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.target !== event.currentTarget) return;

            event.preventDefault();
            void confirmDelete();
          }}
        >
          <form
            className="trip-selector__dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmDelete();
            }}
          >
            <div className="trip-selector__delete-confirmation">
              <p title={targetTrip.name}>
                Delete <strong>{targetTrip.name}</strong>?
              </p>
              <button
                type="button"
                className="trip-selector__dialog-icon-button"
                aria-label="Cancel"
                onClick={closeDialog}
              >
                <X size={16} aria-hidden="true" />
              </button>
              <button
                type="submit"
                className="trip-selector__dialog-icon-button trip-selector__dialog-icon-button--danger"
                aria-label={`Delete ${targetTrip.name}`}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {actionError ? <p className="trip-selector__error">{actionError}</p> : null}
    </div>
  );
}
