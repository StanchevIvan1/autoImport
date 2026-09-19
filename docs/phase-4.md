# Phase 4 — image pipeline implementation and acceptance gap

## Completion status

Implementation and deterministic fixture validation are provided. **Phase 4 is not
fully accepted under the requested completion criterion.** Browser discovery found
only an empty Codex browser, no connected user Chrome/upload form. The current
mobile.bg uploader's actual server-response contract could not be inspected.
kar.bg has no baseline adapter/host permission. Do not infer real-site success
from the fixture tests or the presence of thumbnails.

## Implemented

- Copart: current-lot image branches only; exclude related/recommendation/ad keys;
  fallback limited to the scoped gallery. URL query strings and paths are untouched.
- IAAI: current item key before image-index deduplication; select the largest
  already-existing variant instead of rewriting dimensions/signatures.
- Exact URL deduplication; HTTPS auction-host allowlist; reject credentials,
  unexpected ports, malformed and overlong URLs. Maximum 100 source URLs.
- Individual persisted IDs, original index, attempt-specific filename, attempts,
  state, timestamp, error code/message and receipt. No binary storage.
- States: pending, fetching, fetched, uploading, uploaded, failed, unconfirmed,
  cancelled and excluded (destination limit).
- Two worker fetches globally, 32 queued; sequential processing inside a transfer.
  Three attempts, 500/1000 ms backoff, 15-second request timeout. Retry only transient
  HTTP 408/425/429/500/502/503/504 or network/timeouts. Redirects fail explicitly
  rather than following an unvalidated target; refreshing source URLs may help.
- MIME, signature and streamed size validation: max 10 MiB per file; decode check
  via createImageBitmap when available, max 40 MP; bitmap.close() in finally.
- Cancel/clear/retire abort in-flight requests and prevent queued network work.
- Persist uploading before DataTransfer assignment. Reload cannot blindly repeat
  that uncertain side effect. Reconcile matching receipts before further work.
- Retry only failed images in the SAME destination image panel. Uploaded and
  unconfirmed images are not fetched/assigned again. Existing file selections
  are never overwritten. Retry filenames have a new generation so an old error
  thumbnail cannot be mistaken for the new attempt.
- Phase 2's full retry in a NEW blank form remains separate: it necessarily uses
  the original image set because the new listing has no uploads from the old one.
- Counts include all discovered images, including those beyond mobile.bg's existing
  17-file limit. 17 confirmed out of 20 is partial with 3 excluded, never complete.
- Popup shows confirmed, failed, unconfirmed, excluded and per-image errors.

## Acceptance adapter

The only currently implemented confirmation adapter is standard Dropzone DOM:
exact generated filename, one matching .dz-preview, .dz-success or .dz-error.
Local thumbnails, input.files, dispatched change/input events and .dz-complete
alone are NOT success. Poll at most 30 seconds for this adapter. Unknown uploaders
remain unconfirmed without automatic resubmission. This adapter is not a claim
that mobile.bg currently uses Dropzone, or that a server accepted an image after
custom website handlers alter framework semantics.

Primary reference for the standard markers:
https://github.com/dropzone/dropzone/blob/main/src/options.js
(success/error handlers and filename rendering).

Required remaining work: inspect the real mobile.bg uploader DOM/network response
and add/validate its acceptance adapter if it is not standard Dropzone. A server
receipt mapped to this exact filename/image is needed; do not use image-count-only
heuristics. kar.bg requires a separately scoped adapter, absent from the baseline.

## Resource boundaries

Binaries are transient: one downloaded response/base64 at a time per transfer,
plus selected Files. At most 17 x 10 MiB can be held for the destination file list.
The website owns that list once assigned. Extension cancellation cannot undo an
already-issued website HTTP upload; it stops extension work and retains conservative
outcomes. No backend proxy, object-URL allocation or permanent base64 storage.
Expired/signed URLs may require a fresh extraction and a new transfer. Per-transfer
retry deliberately does not substitute a new vehicle's URLs into the old snapshot.

## Manual Chrome verification — drafts, never publish

1. Reload extension and both source/destination tabs. Copart -> mobile.bg: use a
   lot with known gallery order and related vehicles. Extract; verify only its
   photos/URLs appear. Fill; continue to photos. Compare accepted photos one by one
   with the source and popup counts. If the uploader is unknown, expect unconfirmed.
2. IAAI -> mobile.bg: repeat with resizer URLs including query tokens. Verify image
   item keys belong to the current item, order is maintained within the batch and
   no URL dimensions/tokens were rewritten.
3. Copart -> kar.bg and IAAI -> kar.bg: negative support tests only. No automated
   injection or upload should run on kar.bg. Positive E2E verification is blocked
   because the repository contains no kar.bg adapter.
4. Partial fetch: DevTools Network request blocking for one gallery URL. Other
   images should be handed off; blocked image records an error. Unblock. After the
   website clears its file input (or after manually reviewing/removing the selection),
   use the image panel retry. Only the failed image should be requested again.
5. Destination rejection: use a controlled uploader fixture returning an explicit
   rejection for one filename. Check partial counts; accepted filenames must not
   be repeated on retry. Verify a new retry filename doesn't reuse the old error row.
6. Reload during fetching; unfinished fetches may restart within the persisted
   attempt bound. Reload immediately after assignment: do not reassign uncertain
   files. Existing matching confirmation rows may reconcile; otherwise unconfirmed.
7. Double-click image retry and reopen popup: no duplicate request/assignment for
   confirmed images. Full Phase 2 retry is a NEW listing, not a selective photo retry.
8. Cancel/clear during network throttling: no further image requests or assignments;
   another transfer in another tab continues. Existing website uploads may finish.
9. Test >17 images: remaining images are excluded, result remains partial. Confirm
   manual ordering after retry: the website may append retried images at the end.
10. Test 403/404, transient 503, HTML instead of image, >10 MiB, redirect and expired
    token. Inspect specific errors. No complete result may appear with failures,
    exclusions or uncertain assignments.

## Tests

Node tests cover signed URLs, identity, exact duplicates, malformed URL/content,
transient/permanent failures, bounded retries, global concurrency, cancellation,
stream size cap, temporary bitmap cleanup, uploader success/rejection, selective
retry, reload uncertainty and 29/30 aggregate semantics. Both scraper -> capture
-> actual fetch state -> filler -> uploader-fixture paths cover full and partial
outcomes. Existing Phase 0–3 tests remain included. Fixtures are not live website
recordings. No Phase 5 authentication changes.
