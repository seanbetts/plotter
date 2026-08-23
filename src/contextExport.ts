import type {
  ContextExportBuilder,
  ContextJson,
  LocalWebContextV1,
} from '@local-web/ui';
import packageMetadata from '../package.json';
import type { PlotterApiClient } from './api/client';
import type { TripContextReadResponse } from './api/contracts';
import type {
  TripContextActivity,
  TripContextDestination,
  TripContextResearchLink,
  TripContextRouteIntent,
  TripContextRouteLeg,
  TripContextRouteWarning,
  TripContextWaypoint,
} from './storage/revision';

const ACTIVE_ROUTE = '/plotter';
const NO_RECORDED_RATIONALE = 'The choice is recorded but its rationale is not.';

const ASSUMPTIONS = [
  'This document is a point-in-time trip-planning snapshot and is not continuously synchronised after download.',
  'Trip timing remains provisional unless a date is explicitly recorded.',
  'Stored personal rationale and notes are treated as the reasoning for recorded choices; no additional motivation is inferred.',
] as const;

const CAVEATS = [
  'Route calculations depend on the recorded vehicle, profile and provider result.',
  'Failed, manual or review-required route legs may not represent a navigable route.',
  'Border, shipping, road and ferry notes remain user research rather than guarantees.',
  'Research links are not revalidated during export.',
  'Omitted images or geometry may contain additional visual context.',
] as const;

const OMISSIONS = [
  'all media and map images, including media records, image binaries, base64, thumbnails, preview and full image URLs, captions, credits and screenshots;',
  'full route geometry, map tiles, route keys, raw provider requests, provider diagnostics, API responses and transient route alternatives;',
  'provider credentials and .env contents;',
  'Supabase and migration data, Supabase Storage, migration archives, credentials and reconciliation reports;',
  'SQLite files, backups, imports and recovery archives;',
  'repository paths and absolute filesystem paths;',
  'service ports, hostnames and serving origins;',
  'browser preferences and IndexedDB;',
  'transient dialogs, search results, pending dropped pins, link previews and image previews;',
  'application source, executable code and whole-app archives.',
] as const;

export type PlotterContextExportDependencies = {
  client: PlotterApiClient;
  activeTripId: string;
  selectedDestinationId: string | null;
  selectedActivityId: string | null;
  itineraryCollapsed: boolean;
  now?: () => Date;
};

function nullableText(value: string | undefined): string | null {
  return value && value.trim() ? value : null;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function nullableNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableDate(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function latestTimestamp(values: readonly string[]): string | null {
  return values.reduce<string | null>((latest, value) => (
    !latest || value > latest ? value : latest
  ), null);
}

function sumKnown(values: readonly (number | undefined)[]): number | null {
  const known = values.filter((value): value is number => (
    typeof value === 'number' && Number.isFinite(value)
  ));
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
}

function provisionalDateRange(destinations: readonly TripContextDestination[]): ContextJson {
  const starts = destinations
    .map(({ timing }) => nullableDate(timing.provisionalStartDate))
    .filter((value): value is string => value !== null);
  const ends = destinations
    .map(({ timing }) => nullableDate(timing.provisionalEndDate))
    .filter((value): value is string => value !== null);
  if (starts.length === 0 && ends.length === 0) return null;
  return {
    start: starts.length > 0 ? starts.reduce((earliest, value) => value < earliest ? value : earliest) : null,
    end: ends.length > 0 ? ends.reduce((latest, value) => value > latest ? value : latest) : null,
  };
}

function researchLinkData(link: TripContextResearchLink): ContextJson {
  return {
    id: link.id,
    title: link.title,
    domain: link.domain,
    url: link.url,
    order: link.sortOrder,
    previewFetchedAt: nullableText(link.previewFetchedAt),
  };
}

function locationData(location: TripContextDestination['location']): ContextJson {
  return {
    placeName: location.placeName,
    regionName: location.regionName,
    countryName: location.countryName,
    countryCode: nullableText(location.countryCode),
    sourceLabel: location.sourceLabel,
    sourceProvider: location.sourceProvider,
    sourceFeatureId: nullableText(location.sourceFeatureId),
  };
}

function destinationData(destination: TripContextDestination): ContextJson {
  return {
    id: destination.id,
    name: destination.name,
    countryRegion: destination.countryRegion,
    coordinates: destination.coordinates,
    location: locationData(destination.location),
    order: destination.order,
    status: destination.status,
    priority: destination.priority,
    timing: {
      idealMonths: destination.timing.idealMonths,
      expectedStayDays: destination.timing.expectedStayDays,
      provisionalStartDate: nullableDate(destination.timing.provisionalStartDate),
      provisionalEndDate: nullableDate(destination.timing.provisionalEndDate),
    },
    rationale: {
      summary: nullableText(destination.why.summary),
      highlights: nullableText(destination.why.highlights),
      personal: nullableText(destination.why.personalRationale),
    },
    tags: destination.tags,
    research: {
      notes: nullableText(destination.research.notes),
      links: destination.research.links.map(researchLinkData),
      bookReferences: destination.research.bookReferences.map((reference) => ({
        id: reference.id,
        source: reference.source,
        reference: reference.reference,
        note: nullableText(reference.note),
      })),
    },
    routeContext: {
      previousNextNotes: nullableText(destination.routeContext.previousNextNotes),
      drivingNotes: nullableText(destination.routeContext.drivingNotes),
      borderShippingNotes: nullableText(destination.routeContext.borderShippingNotes),
      notes: nullableText(destination.routeContext.notes),
    },
    createdAt: destination.createdAt,
    updatedAt: destination.updatedAt,
  };
}

function activityData(
  activity: TripContextActivity,
  destinationsById: ReadonlyMap<string, TripContextDestination>,
): ContextJson {
  const location = activity.location;
  return {
    id: activity.id,
    destinationId: activity.destinationId,
    destinationName: destinationsById.get(activity.destinationId)?.name ?? null,
    order: activity.order,
    title: activity.title,
    description: nullableText(activity.description),
    category: activity.category,
    status: activity.status,
    priority: activity.priority,
    location: location ? {
      name: nullableText(location.name),
      address: nullableText(location.address),
      coordinates: location.coordinates ?? null,
      sourceProvider: nullableText(location.sourceProvider),
      sourceFeatureId: nullableText(location.sourceFeatureId),
    } : null,
    notes: nullableText(activity.notes),
    tags: activity.tags,
    links: activity.links.map(researchLinkData),
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  };
}

function waypointData(waypoint: TripContextWaypoint): ContextJson {
  return {
    id: waypoint.id,
    order: waypoint.order,
    name: waypoint.name,
    coordinates: waypoint.coordinates,
    location: locationData(waypoint.location),
    notes: nullableText(waypoint.notes),
    links: waypoint.links.map(researchLinkData),
  };
}

function routeIntentData(intent: TripContextRouteIntent): ContextJson {
  return {
    movement: intent.movement,
    calculation: intent.calculation,
    ferryPolicy: intent.ferryPolicy,
    waypoints: intent.waypoints.map(waypointData),
    notes: nullableText(intent.notes),
  };
}

function routeWarningData(warning: TripContextRouteWarning): ContextJson {
  return {
    code: warning.code,
    message: warning.message,
    context: warning.context ? {
      sourceRouteLegId: warning.context.sourceRouteLegId,
      unresolvedIntent: routeIntentData(warning.context.unresolvedIntent),
    } : null,
  };
}

function routeLegData(
  routeLeg: TripContextRouteLeg,
  destinationsById: ReadonlyMap<string, TripContextDestination>,
): ContextJson {
  return {
    id: routeLeg.id,
    origin: {
      id: routeLeg.originDestinationId,
      name: destinationsById.get(routeLeg.originDestinationId)?.name ?? null,
    },
    destination: {
      id: routeLeg.targetDestinationId,
      name: destinationsById.get(routeLeg.targetDestinationId)?.name ?? null,
    },
    movement: routeLeg.movement,
    calculation: routeLeg.calculation,
    ferryPolicy: routeLeg.ferryPolicy ?? null,
    status: routeLeg.status,
    distanceKm: nullableNumber(routeLeg.distanceKm),
    travelTimeHours: nullableNumber(routeLeg.travelTimeHours),
    provider: nullableText(routeLeg.provider),
    profile: nullableText(routeLeg.profile),
    calculatedAt: nullableText(routeLeg.calculatedAt),
    waypoints: routeLeg.waypoints.map(waypointData),
    sections: routeLeg.sections?.map((section) => ({
      kind: section.kind,
      distanceKm: section.distanceKm,
    })) ?? [],
    warnings: routeLeg.warnings.map(routeWarningData),
    notes: nullableText(routeLeg.notes),
    createdAt: routeLeg.createdAt,
    updatedAt: routeLeg.updatedAt,
  };
}

function tripDecisions(
  snapshot: TripContextReadResponse,
  activities: readonly TripContextActivity[],
): LocalWebContextV1['decisions'] {
  const vehicle = snapshot.trip.routingVehicle;
  return [
    {
      statement: `The routing vehicle is ${vehicle.preset} using ${vehicle.profile}.`,
      reasoning: NO_RECORDED_RATIONALE,
    },
    ...snapshot.destinations.map((destination, index) => ({
      statement: `Destination ${index + 1} is ${destination.name}; status ${destination.status}; priority ${destination.priority}; provisional timing ${nullableDate(destination.timing.provisionalStartDate) ?? 'not recorded'} to ${nullableDate(destination.timing.provisionalEndDate) ?? 'not recorded'}.`,
      reasoning: nullableText(destination.why.personalRationale) ?? NO_RECORDED_RATIONALE,
    })),
    ...activities.map((activity) => ({
      statement: `Activity ${activity.title} at destination ${activity.destinationId} is ${activity.status} with ${activity.priority} priority.`,
      reasoning: nullableText(activity.notes) ?? NO_RECORDED_RATIONALE,
    })),
    ...snapshot.routeLegs.map((routeLeg) => ({
      statement: `Route leg ${routeLeg.id} records ${routeLeg.movement}, ${routeLeg.calculation} calculation, ferry policy ${routeLeg.ferryPolicy ?? 'not recorded'}, status ${routeLeg.status}, and ${routeLeg.waypoints.length} ordered waypoint${routeLeg.waypoints.length === 1 ? '' : 's'}.`,
      reasoning: nullableText(routeLeg.notes) ?? NO_RECORDED_RATIONALE,
    })),
  ];
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function snapshotData(snapshot: TripContextReadResponse) {
  const destinationsById = new Map(snapshot.destinations.map((destination) => [destination.id, destination]));
  const destinationOrder = new Map(snapshot.destinations.map((destination, index) => [destination.id, index]));
  const activities = [...snapshot.activities].sort((left, right) => (
    (destinationOrder.get(left.destinationId) ?? Number.MAX_SAFE_INTEGER)
      - (destinationOrder.get(right.destinationId) ?? Number.MAX_SAFE_INTEGER)
    || left.order - right.order
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ));
  const countriesRegions = [...new Set(
    snapshot.destinations.map(({ countryRegion }) => countryRegion).filter(Boolean),
  )];
  const totalKnownDistanceKm = sumKnown(snapshot.routeLegs.map(({ distanceKm }) => distanceKm));
  const totalKnownTravelTimeHours = sumKnown(
    snapshot.routeLegs.map(({ travelTimeHours }) => travelTimeHours),
  );
  return {
    destinationsById,
    activities,
    trip: {
      id: snapshot.trip.id,
      name: snapshot.trip.name,
      description: nullableText(snapshot.trip.description),
      createdAt: snapshot.trip.createdAt,
      updatedAt: snapshot.trip.updatedAt,
      routingVehicle: {
        preset: snapshot.trip.routingVehicle.preset,
        profile: snapshot.trip.routingVehicle.profile,
        vehicleType: snapshot.trip.routingVehicle.vehicleType ?? null,
        restrictions: snapshot.trip.routingVehicle.restrictions,
      },
      destinationCount: snapshot.destinations.length,
      activityCount: snapshot.activities.length,
      routeLegCount: snapshot.routeLegs.length,
      totalKnownDistanceKm,
      totalKnownTravelTimeHours,
      countriesRegions,
      provisionalDateRange: provisionalDateRange(snapshot.destinations),
    } satisfies ContextJson,
    destinations: snapshot.destinations.map(destinationData),
    activityData: activities.map((activity) => activityData(activity, destinationsById)),
    routeLegs: snapshot.routeLegs.map((routeLeg) => routeLegData(routeLeg, destinationsById)),
    totalKnownDistanceKm,
    totalKnownTravelTimeHours,
    countriesRegions,
  };
}

export function createPlotterContextExportBuilder(
  {
    client,
    activeTripId,
    selectedDestinationId,
    selectedActivityId,
    itineraryCollapsed,
    now = () => new Date(),
  }: PlotterContextExportDependencies,
): ContextExportBuilder {
  return async ({ signal }) => {
    signal.throwIfAborted();
    let snapshot: TripContextReadResponse;
    try {
      snapshot = await client.request<TripContextReadResponse>(
        `/api/v1/trips/${encodeURIComponent(activeTripId)}/context`,
        { signal },
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      signal.throwIfAborted();
      throw new Error('Plotter context could not load the active trip snapshot.', {
        cause: error,
      });
    }
    signal.throwIfAborted();
    const observedAt = now().toISOString();
    const dataRevision = `trip:${snapshot.tripRevision};directory:${snapshot.directoryRevision}`;
    const mapped = snapshotData(snapshot);
    const selectedDestination = snapshot.destinations.find(({ id }) => id === selectedDestinationId) ?? null;
    const selectedActivity = snapshot.activities.find(({ id }) => id === selectedActivityId) ?? null;
    const visibleDetailContext = selectedActivity
      ? 'activity'
      : selectedDestination
        ? 'destination'
        : 'trip';
    const routeWarnings = snapshot.routeLegs.flatMap((routeLeg) => routeLeg.warnings.map((warning) => (
      `${routeLeg.id}: ${warning.message}`
    )));
    const latestDestinationUpdate = latestTimestamp(snapshot.destinations.map(({ updatedAt }) => updatedAt));
    const latestActivityUpdate = latestTimestamp(snapshot.activities.map(({ updatedAt }) => updatedAt));
    const latestRouteUpdate = latestTimestamp(snapshot.routeLegs.map(({ updatedAt }) => updatedAt));
    const knownMetrics = [
      mapped.totalKnownDistanceKm === null ? null : `${mapped.totalKnownDistanceKm} km known distance`,
      mapped.totalKnownTravelTimeHours === null
        ? null
        : `${mapped.totalKnownTravelTimeHours} hours known travel time`,
    ].filter((value): value is string => value !== null);
    const summary = `The active trip “${snapshot.trip.name}” contains ${plural(snapshot.destinations.length, 'destination')}, ${plural(snapshot.activities.length, 'activity')} and ${plural(snapshot.routeLegs.length, 'route leg')}${knownMetrics.length > 0 ? `, with ${knownMetrics.join(' and ')}` : ''}.`;

    return {
      schema: 'local-web-context/v1',
      app: {
        id: 'plotter',
        name: 'Plotter',
        version: packageMetadata.version,
        sourceRevision: 'unknown',
      },
      context: {
        title: `Trip: ${snapshot.trip.name}`,
        scope: 'The active Plotter trip, its ordered destinations, activities, route intent, recorded reasoning and current selection.',
        activeRoute: ACTIVE_ROUTE,
        generatedAt: observedAt,
        observedAt,
        dataRevision,
      },
      sensitivity: {
        classification: 'sensitive',
        notice: 'This document contains personal travel plans. Share it deliberately.',
      },
      summary,
      capabilities: [
        'active-trip',
        'ordered-destinations',
        'activities',
        'route-intent',
        'recorded-reasoning',
        'active-selection',
      ],
      sections: [
        {
          id: 'active-context',
          title: 'Active context',
          blocks: [{
            type: 'key-values',
            items: [
              { label: 'Trip', value: snapshot.trip.name },
              { label: 'Selected destination', value: selectedDestination?.name ?? null },
              { label: 'Selected activity', value: selectedActivity?.title ?? null },
              { label: 'Visible detail', value: visibleDetailContext },
              { label: 'Itinerary collapsed', value: itineraryCollapsed },
            ],
          }],
        },
        {
          id: 'trip-summary',
          title: 'Trip summary',
          blocks: [{ type: 'paragraph', text: summary }, {
            type: 'key-values',
            items: [
              { label: 'Routing vehicle preset', value: snapshot.trip.routingVehicle.preset },
              { label: 'Routing profile', value: snapshot.trip.routingVehicle.profile },
              { label: 'Known distance (km)', value: mapped.totalKnownDistanceKm },
              { label: 'Known travel time (hours)', value: mapped.totalKnownTravelTimeHours },
              { label: 'Countries/regions', value: mapped.countriesRegions.join(', ') || null },
            ],
          }],
        },
        {
          id: 'destinations',
          title: 'Ordered destinations',
          blocks: [{
            type: 'table',
            columns: [
              { key: 'order', label: 'Order' },
              { key: 'name', label: 'Destination' },
              { key: 'status', label: 'Status' },
              { key: 'priority', label: 'Priority' },
              { key: 'start', label: 'Provisional start' },
              { key: 'end', label: 'Provisional end' },
            ],
            rows: snapshot.destinations.map((destination, index) => ({
              order: index + 1,
              name: destination.name,
              status: destination.status,
              priority: destination.priority,
              start: nullableDate(destination.timing.provisionalStartDate),
              end: nullableDate(destination.timing.provisionalEndDate),
            })),
          }],
        },
        {
          id: 'activities',
          title: 'Activities',
          blocks: [{
            type: 'table',
            columns: [
              { key: 'destination', label: 'Destination' },
              { key: 'title', label: 'Activity' },
              { key: 'status', label: 'Status' },
              { key: 'priority', label: 'Priority' },
            ],
            rows: mapped.activities.map((activity) => ({
              destination: mapped.destinationsById.get(activity.destinationId)?.name ?? null,
              title: activity.title,
              status: activity.status,
              priority: activity.priority,
            })),
          }],
        },
        {
          id: 'route-legs',
          title: 'Route intent and summaries',
          blocks: [{
            type: 'table',
            columns: [
              { key: 'origin', label: 'Origin' },
              { key: 'destination', label: 'Destination' },
              { key: 'movement', label: 'Movement' },
              { key: 'calculation', label: 'Calculation' },
              { key: 'status', label: 'Status' },
            ],
            rows: snapshot.routeLegs.map((routeLeg) => ({
              origin: mapped.destinationsById.get(routeLeg.originDestinationId)?.name ?? null,
              destination: mapped.destinationsById.get(routeLeg.targetDestinationId)?.name ?? null,
              movement: routeLeg.movement,
              calculation: routeLeg.calculation,
              status: routeLeg.status,
            })),
          }, ...(routeWarnings.length > 0 ? [{
            type: 'list' as const,
            ordered: false,
            items: routeWarnings,
          }] : [])],
        },
      ],
      data: {
        activeContext: {
          route: ACTIVE_ROUTE,
          trip: { id: snapshot.trip.id, name: snapshot.trip.name },
          selectedDestination: selectedDestination
            ? { id: selectedDestination.id, name: selectedDestination.name }
            : null,
          selectedActivity: selectedActivity
            ? {
                id: selectedActivity.id,
                title: selectedActivity.title,
                destinationId: selectedActivity.destinationId,
              }
            : null,
          itineraryCollapsed,
          visibleDetailContext,
        },
        trip: mapped.trip,
        destinations: mapped.destinations,
        activities: mapped.activityData,
        routeLegs: mapped.routeLegs,
      },
      provenance: {
        freshness: 'The canonical Plotter service snapshot was observed once at export time; research links were not fetched or revalidated.',
        sources: [
          {
            label: 'Canonical Plotter service snapshot',
            observedAt,
            revision: dataRevision,
          },
          {
            label: 'Trip directory',
            observedAt,
            revision: String(snapshot.directoryRevision),
          },
          {
            label: 'Active trip',
            observedAt: snapshot.trip.updatedAt,
            revision: String(snapshot.tripRevision),
          },
          {
            label: 'Latest destination update',
            observedAt: latestDestinationUpdate,
            revision: null,
          },
          {
            label: 'Latest activity update',
            observedAt: latestActivityUpdate,
            revision: null,
          },
          {
            label: 'Latest route update',
            observedAt: latestRouteUpdate,
            revision: null,
          },
        ],
      },
      assumptions: ASSUMPTIONS,
      decisions: tripDecisions(snapshot, mapped.activities),
      caveats: CAVEATS,
      omissions: OMISSIONS,
    };
  };
}
