import type { TripRoutingVehicle, VehiclePreset } from './types';

const presets: Record<VehiclePreset, TripRoutingVehicle> = {
  standard: { preset: 'standard', profile: 'driving-car', restrictions: {} },
  'large-camper': {
    preset: 'large-camper', profile: 'driving-hgv', vehicleType: 'hgv',
    restrictions: { length: 7.5, width: 2.5, height: 3.2, weight: 5, axleLoad: 3 },
  },
  'expedition-truck': {
    preset: 'expedition-truck', profile: 'driving-hgv', vehicleType: 'hgv',
    restrictions: { length: 9, width: 2.55, height: 3.8, weight: 15, axleLoad: 7.5 },
  },
};

export function resolveVehiclePreset(preset: VehiclePreset): TripRoutingVehicle {
  return structuredClone(presets[preset]);
}

export const standardRoutingVehicle = resolveVehiclePreset('standard');
