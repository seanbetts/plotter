import { createActivity, updateActivity } from '../domain/activities';
import { createDestination, updateDestination } from '../domain/destinations';
import { createFallbackResearchLink } from '../domain/researchLinks';
import { createManualRouteLeg, createRouteLeg } from '../domain/routeLegs';
import type { Activity, ActivityLocation, Destination, ResearchLink, RouteLeg, RouteWaypoint } from '../domain/types';
import { resolveVehiclePreset } from '../domain/vehiclePresets';
import { calculateAutomaticRouteLegs } from './routeOrchestration';
import type {
  ChangedSummary,
  LinkEnricher,
  PlaceInput,
  PlaceResolver,
  RouteCalculator,
  RouteLegDirectiveDraftV2,
  TripManifestDraft,
} from './types';
import { TripCommandValidationError } from './validation';

export type TripManifestMaterializationDependencies = {
  calculateRoute?: RouteCalculator;
  resolvePlace?: PlaceResolver;
  enrichLink?: LinkEnricher;
};

export type MaterializedTripManifest = {
  destinations: Destination[];
  activities: Activity[];
  routeLegs: RouteLeg[];
  routingVehicle: import('../domain/types').TripRoutingVehicle;
  changed: ChangedSummary;
};

function createChangedSummary(): ChangedSummary {
  return {
    tripsCreated: [],
    tripsDeleted: [],
    stopsAdded: [],
    stopsUpdated: [],
    stopsDeleted: [],
    activitiesAdded: [],
    activitiesUpdated: [],
    activitiesDeleted: [],
    linksAdded: [],
    linksDeleted: [],
    routesRecalculated: 0,
  };
}

async function enrichLinks(
  urls: string[],
  enrichLink: LinkEnricher | undefined,
): Promise<ResearchLink[]> {
  return Promise.all(urls.map((url, sortOrder) => (
    enrichLink
      ? enrichLink(url, sortOrder)
      : Promise.resolve(createFallbackResearchLink(url, { sortOrder }))
  )));
}

async function resolveStop(
  place: PlaceInput,
  name: string,
  resolvePlace: PlaceResolver | undefined,
  path: string,
) {
  if (resolvePlace) {
    return resolvePlace({ place, profile: 'stop', fallbackName: name });
  }
  if (!place.coordinates) {
    throw new TripCommandValidationError(
      'PLACE_RESOLVER_REQUIRED',
      'A place resolver is required when coordinates are omitted.',
      path,
    );
  }
  return { coordinates: place.coordinates };
}

function fallbackActivityLocation(title: string, coordinates: NonNullable<PlaceInput['coordinates']>): ActivityLocation {
  return {
    name: title,
    address: 'TBC',
    coordinates,
    sourceProvider: 'manual',
  };
}

async function resolveActivity(
  place: PlaceInput | undefined,
  title: string,
  resolvePlace: PlaceResolver | undefined,
  path: string,
) {
  if (!place) return undefined;
  if (resolvePlace) {
    const resolved = await resolvePlace({ place, profile: 'activity', fallbackName: title });
    return resolved.activityLocation
      ?? (resolved.coordinates ? fallbackActivityLocation(title, resolved.coordinates) : undefined);
  }
  if (!place.coordinates) {
    throw new TripCommandValidationError(
      'PLACE_RESOLVER_REQUIRED',
      'A place resolver is required when coordinates are omitted.',
      path,
    );
  }
  return fallbackActivityLocation(title, place.coordinates);
}

export async function materializeTripManifest(
  manifest: TripManifestDraft,
  dependencies: TripManifestMaterializationDependencies,
): Promise<MaterializedTripManifest> {
  const stopInputs = await Promise.all(manifest.stops.map(async (stop, order) => {
    const [resolved, links] = await Promise.all([
      resolveStop(stop.place, stop.name, dependencies.resolvePlace, `stops[${order}].place`),
      enrichLinks(stop.links, dependencies.enrichLink),
    ]);
    return { stop, order, resolved, links };
  }));

  const destinations = stopInputs.map(({ stop, order, resolved, links }) => {
    const destination = createDestination({
      name: stop.name,
      coordinates: resolved.coordinates,
      location: resolved.location,
      order,
    });
    return updateDestination(destination, {
      timing: { ...destination.timing, expectedStayDays: stop.expectedStayDays },
      research: { ...destination.research, notes: stop.notes ?? '', links },
      tags: stop.tags,
    });
  });

  const activityInputs = manifest.stops.flatMap((stop, stopIndex) => (
    stop.activities.map((activity, order) => ({ activity, order, stopIndex }))
  ));
  const activities = await Promise.all(activityInputs.map(async ({ activity, order, stopIndex }) => {
    const [location, links] = await Promise.all([
      resolveActivity(
        activity.place,
        activity.title,
        dependencies.resolvePlace,
        `stops[${stopIndex}].activities[${order}].place`,
      ),
      enrichLinks(activity.links, dependencies.enrichLink),
    ]);
    const created = createActivity({
      destinationId: destinations[stopIndex].id,
      title: activity.title,
      order,
      location,
    });
    return updateActivity(created, {
      description: activity.description ?? '',
      notes: activity.notes ?? '',
      tags: activity.tags,
      links,
    });
  }));

  const destinationByKey = new Map(manifest.stops.map((stop, index) => [stop.key, destinations[index]]));
  const directiveByPair = new Map(manifest.routeLegs.map((directive) => [
    `${directive.fromStopKey}\u0000${directive.toStopKey}`,
    directive,
  ]));
  const resolvedWaypoints = manifest.manifestVersion === 2
    ? new Map(await Promise.all(manifest.routeLegs.map(async (directive, directiveIndex) => {
        const waypoints = await Promise.all((directive.waypoints ?? []).map(async (waypoint, order): Promise<RouteWaypoint> => {
          const [resolved, links] = await Promise.all([
            resolveStop(
              waypoint.place,
              waypoint.name,
              dependencies.resolvePlace,
              `routeLegs[${directiveIndex}].waypoints[${order}].place`,
            ),
            enrichLinks(waypoint.links, dependencies.enrichLink),
          ]);
          return {
            id: crypto.randomUUID(),
            order,
            name: waypoint.name,
            coordinates: resolved.coordinates,
            location: resolved.location ?? {
              placeName: waypoint.name,
              regionName: '',
              countryName: '',
              sourceLabel: waypoint.name,
              sourceProvider: 'legacy',
            },
            notes: waypoint.notes ?? '',
            links,
          };
        }));
        return [`${directive.fromStopKey}\u0000${directive.toStopKey}`, waypoints] as const;
      })))
    : new Map<string, RouteWaypoint[]>();
  const pendingRouteLegs = destinations.slice(0, -1).map((origin, index) => {
    const target = destinations[index + 1];
    const fromKey = manifest.stops[index].key;
    const toKey = manifest.stops[index + 1].key;
    const directive = directiveByPair.get(`${fromKey}\u0000${toKey}`);
    if (manifest.manifestVersion === 1 && directive) {
      const directiveOrigin = destinationByKey.get(directive.fromStopKey)!;
      const directiveTarget = destinationByKey.get(directive.toStopKey)!;
      return createManualRouteLeg({
        origin: directiveOrigin.coordinates,
        target: directiveTarget.coordinates,
        originDestinationId: directiveOrigin.id,
        targetDestinationId: directiveTarget.id,
        notes: directive.notes,
      });
    }
    const v2Directive = manifest.manifestVersion === 2
      ? directive as RouteLegDirectiveDraftV2 | undefined
      : undefined;
    return createRouteLeg({
      originDestinationId: origin.id,
      targetDestinationId: target.id,
      type: v2Directive?.movement === 'vehicle-shipping' ? 'shipping-manual' : 'driving-auto',
      movement: v2Directive?.movement,
      calculation: v2Directive?.calculation,
      ferryPolicy: v2Directive?.ferryPolicy,
      waypoints: v2Directive ? resolvedWaypoints.get(`${fromKey}\u0000${toKey}`) : undefined,
      notes: v2Directive?.notes,
    });
  });
  const routingVehicle = resolveVehiclePreset(manifest.manifestVersion === 2 ? manifest.vehiclePreset : 'standard');
  const routeLegs = await calculateAutomaticRouteLegs({
    destinations,
    routeLegs: pendingRouteLegs,
    routingVehicle,
    calculateRoute: dependencies.calculateRoute,
  });

  const changed = createChangedSummary();
  changed.tripsCreated.push(manifest.name);
  changed.stopsAdded.push(...destinations.map((destination) => destination.name));
  changed.activitiesAdded.push(...activities.map((activity) => activity.title));
  changed.linksAdded.push(
    ...destinations.flatMap((destination) => destination.research.links.map((link) => link.url)),
    ...activities.flatMap((activity) => activity.links.map((link) => link.url)),
    ...routeLegs.flatMap((routeLeg) => (
      routeLeg.waypoints ?? []
    ).flatMap((waypoint) => waypoint.links.map((link) => link.url))),
  );
  changed.routesRecalculated = routeLegs.filter((leg) => leg.type === 'driving-auto').length;

  return { destinations, activities, routeLegs, routingVehicle, changed };
}
