import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Destination, RouteLeg } from '../domain/types';
import { MapCanvas } from './MapCanvas';

vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn(function () {
      return {
        on: vi.fn(),
        off: vi.fn(),
        remove: vi.fn(),
        addControl: vi.fn(),
        getSource: vi.fn(),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getLayer: vi.fn(),
        setData: vi.fn(),
        fitBounds: vi.fn(),
        project: vi.fn(() => ({ x: 120, y: 80 })),
      };
    }),
    NavigationControl: vi.fn(function () {
      return {};
    }),
  },
}));

describe('MapCanvas', () => {
  const destination: Destination = {
    id: 'dest-1',
    name: 'Cappadocia',
    countryRegion: 'Turkey',
    coordinates: { lat: 38.6431, lng: 34.8289 },
    status: 'idea',
    priority: 'medium',
    timing: { idealMonths: [], expectedStayDays: 3, provisionalStartDate: '', provisionalEndDate: '' },
    why: { summary: '', highlights: '', personalRationale: '' },
    media: [],
    research: { notes: '', links: [], bookReferences: [] },
    activities: { items: [] },
    routeContext: { previousNextNotes: '', drivingNotes: '', borderShippingNotes: '', notes: '' },
    tags: [],
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
  };

  it('renders destination pins as accessible buttons', () => {
    render(
      <MapCanvas
        destinations={[destination]}
        routeLegs={[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDropPin={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select Cappadocia' })).toBeInTheDocument();
  });

  it('renders the empty planning map label with no destinations', () => {
    render(
      <MapCanvas
        destinations={[]}
        routeLegs={[] as RouteLeg[]}
        selectedDestinationId={null}
        onSelectDestination={vi.fn()}
        onDropPin={vi.fn()}
      />,
    );

    expect(screen.getByText('Blank planning map')).toBeInTheDocument();
  });
});
