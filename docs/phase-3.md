# Phase 3 — extraction and mapping contract

## Scope

The existing scrapers, filler, ownership store, retry flow and user defaults remain.
`shared/vehicle.js` is loaded before source scripts and popup/worker code. It
centralizes route recognition and the source normalization contract. No framework
or backend changes, and no kar.bg adapter, were introduced.

## Model

New captures use `schemaVersion: 1`, retaining the compatible flat vehicle fields.
`raw` contains original field strings, odometer unit and source field collections;
`units` documents normalized units. `fieldStatus` is known, unknown or manual-review.
`review` feeds the popup and transfer result. Empty strings / null mileage remain
unknown; they never mean zero. Legacy captures and immutable retry snapshots remain
readable without destructive migration.

Mileage requires explicit mi/km (or explicit structured unit). Grouped thousands
and decimal readings are handled; conflicting units, malformed grouping and not-
actual readings are rejected. Miles use 1.609344, rounded to whole km. Litres/cc are
normalized to cm3. Explicit kW converts to metric horsepower (PS) with 1.359621617.
Named hp/bhp/PS values retain the source number; differing horsepower conventions
remain a manual verification concern. No power is inferred from displacement.

Fuel uses explicit aliases: petrol, diesel, electric, hybrid, plug-in hybrid,
LPG and CNG are distinct. Flex fuel, hydrogen and unrecognized combinations remain
manual review. Transmission, drive, body, color and cylinder counts use supported
values; masked/invalid VIN stays raw and is not inserted as a full VIN.

## Source ownership

Copart structured candidates must match the URL lot. Conflicting current-lot
candidates and visible lot/title disagreement stop extraction. IAAI requested item
ID must match the URL; stock number and item ID are not treated as interchangeable.
The dynamic stock hidden input is selected by the current item suffix. Hidden and
visible title disagreement stops extraction. A new capture without corroborating
identity cannot be saved for transfer.

DOM fallback scans a copy of main/body excluding known recommended/related/similar
regions. Conflicting repeated text values are not guessed. This exclusion is
conservative and must be validated against live layouts; unknown recommendation
markup is not proven covered by these fixtures.

The only image changes are prerequisites for lot isolation: Copart no longer scans
all unrelated inline scripts/Next.js objects for URLs; IAAI image keys must name the
current item before index deduplication. Downloads, resizing, upload acknowledgement
and retry algorithms were not expanded into Phase 4.

## Destination checks

Select matching is exact and unique; model trim matching remains supported but
ambiguous options are rejected. Setters verify the value after website events.
Fields written during the phase are checked again before the checkpoint/completion.
Optional failures persist as warnings; make/model failures stop the transfer.
Existing region reload identity verification remains. No DOM check establishes
server acceptance. The requested VAT/extras/missing-month defaults remain explicit
user preferences, not extracted facts.

## Routes

Copart .com numeric /lot/; IAAI numeric /VehicleDetail/, /vehicles/, /vehicle/, /buy/
share one recognizer between popup and worker. IAAI Search is not an extraction
route. mobile.bg/www.mobile.bg CGI remains the destination workflow. kar.bg has no
adapter or permission in the baseline. Copart .co.uk has a legacy host permission
but no supported scraper route. Neither is newly claimed as supported.

## Chrome acceptance (drafts only)

1. Reload extension and all tabs. Copart: open a current lot with recommendations,
   extract, compare lot/title/VIN/make/model/year against the page. Verify no
   recommended vehicle contributes data. Change the URL to another lot in the same
   tab, then extract again; old values must not carry over.
2. Copart: compare an explicitly mi reading and a km reading. Inspect raw review
   values for unknown/not-actual/absent mileage. Verify 10,000 mi -> 16,093 km;
   10,000 km stays 10,000. Check litres, cc and explicitly marked kW/hp where present.
3. IAAI: use a VehicleDetail listing with visible stock number; confirm its hidden
   requested item is not confused with stock number. Repeat supported numeric
   /vehicles/ or /buy/ routes if the current site offers them. Inspect a two-word
   make, masked VIN and an engine such as 3.0L with no trailing text.
4. For both sources, inspect petrol/diesel/hybrid/PHEV/electric/CNG/LPG/flex-fuel
   examples available to you. Unsupported values must show manual review rather
   than petrol defaults. Compare the destination engine selection exactly.
5. mobile.bg: transfer both sources into separate empty forms. Check make/model,
   year, mileage, engine, power, transmission, body, fuel and VIN. Confirm review
   warnings and original presets, corrections, city and automatic photos remain.
6. Use an unsupported model or a city absent from its region. It must not select
   the first vaguely matching option. Review saved warnings. Change identity while
   loading; the transfer must stop before declaring successful completion.
7. Repeat region reload, login, duplicate start, cancel and retry from Phase 2.
   Retry must still use its original snapshot even after extracting another car.
8. kar.bg: verify there is no automatic extraction/fill/injection into that site.
   The popup may show the last valid source, but transfer opens mobile.bg. Positive
   kar.bg mapping tests do not exist because no baseline adapter was present.

## Completion boundary

Automated end-to-end fixtures execute extraction -> normalization -> owned capture
-> transfer -> actual filler. These are controlled fixtures, not saved live DOM
recordings. Live Chrome acceptance and actual selector/identity availability remain
unverified. Therefore implementation/testing is delivered, but full production
acceptance under the user's completion criterion is not yet established. Stop
before Phase 4; do not equate green unit tests with real-site confirmation.
