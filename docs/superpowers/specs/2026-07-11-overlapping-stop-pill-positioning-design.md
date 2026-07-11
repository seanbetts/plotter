# Overlapping Stop Pill Positioning Design

## Goal

Keep both stop pills readable when a trip visits the same place more than once or when nearby stop pills overlap at the current map zoom.

## Behaviour

- A stop pill that does not overlap another stop pill remains below its map pin.
- When two stop pills overlap in screen space, the earlier stop in route order appears above its pin and the later stop remains below its pin.
- The same rule applies whether the stops have identical coordinates or merely project close enough for their pills to overlap.
- Positions are recalculated whenever existing map label positions are updated, including after map movement and zoom changes.
- Stop selection and click behaviour remain unchanged.

## Implementation Shape

`MapCanvas` will calculate destination label bounds using the same above/below placement vocabulary already used by activity labels. It will first identify destination pills whose default below-pin bounds collide. Within each collision group, route order determines placement: the first stop uses the above position and the second uses the below position. Non-colliding stops retain the existing below position.

The projected destination label model will carry its resolved position. Rendering will apply the existing `map-label-position-above` class to destination pills placed above, so no new visual treatment is needed.

Activity label placement will reserve each destination pill's resolved bounds rather than assuming every destination pill is below its pin. This preserves the existing activity collision behaviour around the newly positioned stop pills.

## Scope

This change targets pairs of overlapping stop pills, including return-loop duplicates. It does not add multi-row stacking for three or more stops at one point, change stop marker geometry, alter route ordering, or change persisted trip data.

## Testing

Component tests will demonstrate that:

- two stops with identical coordinates render with the first pill above and the second below;
- two nearby stops whose projected pill bounds overlap use the same placement;
- non-overlapping stop pills remain below;
- activity labels reserve the resolved destination pill bounds.

The focused component tests will be run through a red-green cycle. The completed behavior will also be checked in the rendered map at planning zoom.
