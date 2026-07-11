import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LineString } from 'geojson';
import { describe, expect, it, vi } from 'vitest';
import type { RouteOption } from '../domain/routeOptions';
import type { RoutingAnchor } from '../domain/types';
import { RouteAlternativesPanel } from './RouteAlternativesPanel';

describe('RouteAlternativesPanel', () => {
  const baseGeometry: LineString = {
    type: 'LineString',
    coordinates: [
      [-2.935, 43.263],
      [-8.6291, 41.1579],
    ],
  };

  const options: RouteOption[] = [
    {
      id: 'recommended',
      label: 'Recommended',
      source: 'recommended',
      distanceKm: 457,
      travelTimeHours: 5.8,
      geometry: baseGeometry,
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 457 }],
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'recommended-key',
      warnings: [],
      endpointAnchors: {},
    },
    {
      id: 'avoid-highways',
      label: 'Avoid highways',
      source: 'avoid-feature',
      distanceKm: 520,
      travelTimeHours: 7.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-2.935, 43.263],
          [-5.1, 42.2],
          [-8.6291, 41.1579],
        ],
      },
      sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 520 }],
      provider: 'openrouteservice',
      profile: 'driving-car',
      routeKey: 'avoid-highways-key',
      warnings: [],
      endpointAnchors: {},
    },
  ];
  const altaAnchor: RoutingAnchor = {
    profile: 'driving-hgv',
    coordinates: { lat: 69.98334, lng: 23.27165 },
    originalCoordinates: { lat: 69.96887, lng: 23.27165 },
    snapDistanceKm: 1.609,
    provider: 'openrouteservice',
    resolvedAt: '2026-07-11T00:00:00.000Z',
  };

  it('shows loading state for one route leg', () => {
    render(
      <RouteAlternativesPanel
        originName="Bilbao"
        targetName="Porto"
        status="loading"
        options={[]}
        selectedOptionId={null}
        onSelectOption={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Edit route from Bilbao to Porto' })).toBeInTheDocument();
    const loadingStatus = screen.getByRole('status', { name: 'Calculating route options' });
    expect(loadingStatus).toBeInTheDocument();
    expect(loadingStatus.querySelector('.route-alternatives-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use selected route' })).toBeDisabled();
  });

  it('shows route options and confirms the selected option', async () => {
    const user = userEvent.setup();
    const onSelectOption = vi.fn();
    const onConfirm = vi.fn();

    render(
      <RouteAlternativesPanel
        originName="Bilbao"
        targetName="Porto"
        status="ready"
        options={options}
        selectedOptionId="recommended"
        onSelectOption={onSelectOption}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('Avoid highways')).toBeInTheDocument();
    expect(screen.getByText('284 mi')).toBeInTheDocument();
    expect(screen.getByText('5.8 hr')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Avoid highways 323 mi 7.1 hr' }));
    expect(onSelectOption).toHaveBeenCalledWith('avoid-highways');

    await user.click(screen.getByRole('button', { name: 'Use selected route' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows recovery provenance copy for adjusted endpoint and profile fallback options', () => {
    render(
      <RouteAlternativesPanel
        originName="Olderdalen"
        targetName="Alta"
        status="ready"
        options={[
          {
            id: 'adjusted-endpoint',
            label: 'Adjusted endpoint',
            source: 'adjusted-endpoint',
            distanceKm: 361,
            travelTimeHours: 5.4,
            geometry: baseGeometry,
            sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 1, distanceKm: 361 }],
            provider: 'openrouteservice',
            profile: 'driving-hgv',
            routeKey: 'adjusted-key',
            warnings: [{
              code: 'ROUTING_ANCHOR_ADJUSTED',
              message: 'Route target uses a routing point 1.6 km from the stop.',
            }],
            endpointAnchors: { target: altaAnchor },
          },
          {
            id: 'profile-fallback',
            label: 'Car-profile fallback',
            source: 'profile-fallback',
            distanceKm: 377,
            travelTimeHours: 5.9,
            geometry: {
              type: 'LineString',
              coordinates: [
                [-2.935, 43.263],
                [-3.4, 44],
                [-8.6291, 41.1579],
              ],
            },
            sections: [{ kind: 'road', startGeometryIndex: 0, endGeometryIndex: 2, distanceKm: 377 }],
            provider: 'openrouteservice',
            profile: 'driving-car',
            routeKey: 'fallback-key',
            warnings: [{
              code: 'VEHICLE_PROFILE_FALLBACK',
              message: 'Truck dimensions were not validated.',
            }],
            endpointAnchors: {},
          },
        ]}
        selectedOptionId="adjusted-endpoint"
        onSelectOption={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Adjusted endpoint')).toBeVisible();
    expect(screen.getByText('Uses a nearby routable road point for Alta.')).toBeVisible();
    expect(screen.getByText('Car-profile fallback')).toBeVisible();
    expect(screen.getByText('Truck dimensions were not validated.')).toBeVisible();
  });

  it('shows an empty state when no route options are available', () => {
    render(
      <RouteAlternativesPanel
        originName="Bilbao"
        targetName="Porto"
        status="empty"
        options={[]}
        selectedOptionId={null}
        onSelectOption={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('No alternate routes found for this leg.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use selected route' })).toBeDisabled();
  });

  it('shows errors and saving state without allowing confirmation', () => {
    const { rerender } = render(
      <RouteAlternativesPanel
        originName="Bilbao"
        targetName="Porto"
        status="error"
        options={[]}
        selectedOptionId={null}
        error="Route options could not be calculated."
        onSelectOption={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Route options could not be calculated.');
    expect(screen.getByRole('button', { name: 'Use selected route' })).toBeDisabled();

    rerender(
      <RouteAlternativesPanel
        originName="Bilbao"
        targetName="Porto"
        status="saving"
        options={options}
        selectedOptionId="recommended"
        onSelectOption={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Saving route' })).toBeDisabled();
  });

  it('closes the route options panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <RouteAlternativesPanel
        originName="Bilbao"
        targetName="Porto"
        status="ready"
        options={options}
        selectedOptionId="recommended"
        onSelectOption={vi.fn()}
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Close route options' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
