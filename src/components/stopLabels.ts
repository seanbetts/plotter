function isEndStop(stopNumber: number, totalStops?: number) {
  return totalStops !== undefined && totalStops > 1 && stopNumber === totalStops;
}

export function formatStopMarker(stopNumber: number, totalStops?: number) {
  if (stopNumber === 1) return 'ST';
  if (isEndStop(stopNumber, totalStops)) return 'ED';

  return String(stopNumber).padStart(2, '0');
}

export function formatStopAccessibleLabel(stopNumber: number, totalStops?: number) {
  if (stopNumber === 1) return 'Start';
  if (isEndStop(stopNumber, totalStops)) return 'End';

  return `Stop ${stopNumber}`;
}

export function formatStopHeaderLabel(stopNumber: number, totalStops?: number) {
  if (stopNumber === 1) return 'Start';
  if (isEndStop(stopNumber, totalStops)) return 'End';

  return `Stop ${formatStopMarker(stopNumber)}`;
}
