export function formatStopMarker(stopNumber: number) {
  return stopNumber === 1 ? 'ST' : String(stopNumber).padStart(2, '0');
}

export function formatStopAccessibleLabel(stopNumber: number) {
  return stopNumber === 1 ? 'Start' : `Stop ${stopNumber}`;
}

export function formatStopHeaderLabel(stopNumber: number) {
  return stopNumber === 1 ? 'Start' : `Stop ${formatStopMarker(stopNumber)}`;
}
