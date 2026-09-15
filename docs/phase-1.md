# Phase 0 / Phase 1 stabilization

## Automatic images update

Images now travel automatically in the owned vehicle snapshot, with no review
checkbox. Old empty transfers can recover images only from the exact original
capture ID and source URL, never from a newer car. The file assignment uses the
first 17 images to respect the limit displayed by mobile.bg; the snapshot keeps
all extracted URLs. Reload the extension and destination page to apply this fix.
This supersedes the per-capture image-review requirement below.

## Subsequent user-requested defaults

The user explicitly requested restoring automatic equipment presets, VAT included,
and a random production month when no month was supplied. These supersede the
original Phase 1 default-value restrictions described below. The original equipment
preset is applied to every listing; 4x4 is set or cleared from the extracted drive.
Explicit months remain unchanged. City options are read from the live mobile.bg
select for the selected region, cached separately by region, and suggested in the
popup settings. Prefixed names such as `гр. София` match `София`; ambiguous names
are not guessed. The cache fills when the corresponding form/region is loaded.
Transfer ownership and cancellation remain unchanged.


## Scope and baseline

Baseline: `7adf687` (Initial working version). The first three regression tests
were run successfully before changing production code: Copart extraction, IAAI
extraction, and existing make/model selection plus description templates.

The existing popup, service worker, separate scrapers, form field selectors,
two-phase region reload, and DataTransfer image mechanism remain. No production
authentication changes, framework migration, dependency installation, or general
Phase 2 recovery system was introduced.

Tests use Node's built-in test runner with deterministic Chrome/DOM fixtures.
They execute the production scripts, including the worker message handler and
popup click handlers. They are not recordings of current live auction pages and
do not prove that current site HTML or upload handlers match the fixtures.

## Commands

Requires Node 22+ (validated with Node 24). No npm install is necessary.

```text
npm test
npm run check
git diff --check
```

`check` parses every JavaScript file and verifies manifest resource paths.
There is no existing ESLint or TypeScript configuration; neither was added for
this iteration.

## Ownership and cleanup rules

- `importState.sources[sourceTabId]` stores the latest successful capture for
  that auction tab. Each capture has a unique ID and exact source URL.
- Beginning another scrape invalidates the previous capture for that tab.
  Only the latest request ID can save. A navigation or clear invalidates it.
- `carData` remains a compatibility mirror of the last saved capture. It is
  never trusted independently of `importState.sources`.
- The popup reads the active auction tab's capture. A popup on a non-auction
  page displays the last still-owned capture. Fill verifies the displayed
  capture ID again rather than silently substituting new data.
- The worker copies data/settings into `importState.transfers[destinationTabId]`.
  Later captures cannot mutate that snapshot.
- Starting from an auction opens a new inactive form tab. The worker saves
  ownership and starts dispatch before focusing the tab can close the popup.
- Starting from the active blank mobile.bg publication form can use that tab.
  An already-owned tab rejects another capture. A populated unowned form is
  rejected before vehicle fields are overwritten.
- Repeated starts for the same capture reuse the existing destination. Claims
  prevent concurrent filling. Reinjection does not rerun startup hooks.
- Region reload progress is stored on the owned transfer, never in a global
  pending-car key. Resumption checks preserved make/model/year/VIN values.
- Changing vehicle identity after filling invalidates automatic images and
  preserves the user's edits.
- Clear removes all captures, pending requests and transfers, including legacy
  pending keys; it also cancels content-script work. Settings/auth remain.
  Already-filled website fields and files are not erased by Clear.
- Closing a source tab removes its capture but does not alter an already-started
  destination snapshot. Closing a destination removes its transfer.
- Navigating away from `/pcgi/mobile.cgi` removes destination ownership.
  Transfers expire after two hours and browser startup clears tab-bound state.
- Legacy pending values are discarded because their destination cannot be
  established. Existing users must reload auction/mobile tabs and scrape again
  after updating the unpacked extension. Settings and license state are retained.

The serialized worker writes and transfer IDs are the limited prerequisite for
Phase 1 ownership. This is not a general retry/resume engine. Interrupted or
failed imports should be cleared and re-extracted into a new form.

## Intentional behavior changes

- Missing month, emissions category, condition, VAT-related choice, and equipment
  are no longer guessed. Explicitly extracted 4x4 remains supported.
- Damage is preserved in the default description and `{щета}` placeholder.
  A custom template can still choose which fields to include.
- Ambiguous model/region selection no longer picks the first candidate. Unknown
  city no longer falls back to an arbitrary city or implicit Sofia.
- Unknown distance/unit remains unknown; explicit miles are converted and km are
  retained. Zero is preserved. Unknown fuel does not default to petrol; hybrid
  detection precedes petrol/electric classification.
- Manual horsepower/modification and image review reset on every new capture.
  Horsepower override is also used in the description.
- Images remain source-page candidates. The popup shows every candidate as a
  link to the full image. The user must review and check the image box for that
  capture before image transfer. Without it, the transfer has no images.
- Image assignment never replaces an existing file selection. Partial failures
  keep the owned URLs for manual retry; status says files were handed to the
  form, not that the server accepted them.

## Chrome acceptance checklist (still required)

Use draft forms only; do not publish as part of these checks.

1. Reload the unpacked extension and reload already-open auction/mobile tabs.
   Sign in to mobile.bg manually and use the existing license setup.
2. Clear saved listings. Open a Copart vehicle A, extract, inspect all fields,
   review its image links, check the image box, and click Fill without closing
   and reopening the popup. Verify A is filled in a fresh form.
3. Repeat for an IAAI vehicle B. Keep A's form open. Verify B gets another tab,
   neither form changes the other, and each image step has its own pictures.
4. Keep two auction tabs open. Reopen each popup and verify its preview belongs
   to that tab. Scrape B after editing A's horsepower/modification; verify A's
   overrides and image approval are not present on B.
5. Quickly click Fill repeatedly and reopen the popup to click again. Verify
   only one destination exists for that capture and no duplicate fill occurs.
6. On an empty mobile.bg form, start Fill from the popup and verify direct filling.
   Try a form containing another vehicle and verify it is rejected unchanged.
7. With a blank region and a configured region/city, check that the region reload
   preserves phase-one fields and that phone/description resume only in that tab.
   Repeat with a preselected matching region and with another configured region.
8. Change make/model/year/VIN after filling. Verify automatic pictures stop and
   the manual edit remains. Start a fresh transfer for a different vehicle.
9. Clear during scraping and during image downloading. Verify late results do
   not restore previews, pending work, or assign files. Existing website data
   remains for the user to discard manually.
10. Test an image-free or unapproved-image capture after an image-rich one.
    No pictures from the previous capture should appear.
11. Test blocked image requests and an existing file selection. Verify partial
    status, preserved retry URLs, and no replacement of existing selected files.
12. Inspect a vehicle with unknown month/fuel/mileage and a masked VIN. Verify
    no random month, presumed emissions, equipment, or full VIN is inserted.
    Check site-default selections manually, especially condition and emissions.
13. Close a destination, navigate away, and restart Chrome. Verify old transfers
    cannot resume in unrelated tabs. Clear/re-extract when restarting an import.

## Remaining limitations / later phases

- Live selectors, dependent-select rendering, region reload behavior, image-step
  URL, CDN authorization and mobile.bg upload acceptance require Chrome testing.
- The image extraction heuristics can still collect irrelevant images. The
  explicit per-capture image review is the Phase 1 safeguard; gallery provenance
  and robust image upload confirmation remain later work.
- Same-tab navigation is scoped conservatively to the existing CGI workflow.
  A different live image-step path will stop automatic images and needs a
  verified adapter update, not broad host-wide automatic uploading.
- Site-created default values are not evidence about the vehicle. Review them.
- No automated recovery of interrupted filling or worker dispatch. Failed jobs
  remain blocked until Clear/re-extraction; manual edits are never rolled back.
- Authentication server/deployment, demo keys, cached licensing, and general
  security hardening remain as identified in the audit.
- The test fixtures do not establish current real-site compatibility. Phase 1
  implementation and automated validation are separate from browser acceptance.
