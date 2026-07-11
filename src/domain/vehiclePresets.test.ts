import { describe, expect, it } from 'vitest';
import { resolveVehiclePreset, standardRoutingVehicle } from './vehiclePresets';

describe('vehicle presets', () => {
  it('resolves the approved expedition truck snapshot', () => {
    expect(resolveVehiclePreset('expedition-truck')).toEqual({
      preset: 'expedition-truck',
      profile: 'driving-hgv',
      vehicleType: 'hgv',
      restrictions: { length: 9, width: 2.55, height: 3.8, weight: 15, axleLoad: 7.5 },
    });
  });

  it('exposes the standard routing vehicle', () => {
    expect(standardRoutingVehicle).toEqual({
      preset: 'standard',
      profile: 'driving-car',
      restrictions: {},
    });
  });

  it('returns an independent restriction snapshot', () => {
    const vehicle = resolveVehiclePreset('large-camper');
    vehicle.restrictions.height = 4;

    expect(resolveVehiclePreset('large-camper').restrictions.height).toBe(3.2);
  });
});
