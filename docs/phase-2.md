# Phase 2: recoverable transfers

This document supersedes the Phase 1 instructions to clear and re-extract after
an interruption. Existing uncommitted Phase 1 changes were preserved.

## Ownership and recovery

The existing `importState` is the only pending-transfer store. Jobs retain UUIDs,
immutable vehicle/settings snapshots, explicit phases and results. No login
credentials or new permissions were added. Legacy unowned pending keys remain
unsupported and are removed.

Phases: created, filling, phase2, resuming, images, imagesAssigned, completed,
failed, cancelled, detached, expired. `completed` means form data transferred
without source images; `imagesAssigned` means file input assignment, NOT server
upload or publication. Results retain image counts and form warnings.

Same-tab mobile.bg redirects retain the job. Dispatch resumes on page load;
a CGI login page without the vehicle form does not claim the transfer. A region
reload resumes only with matching form identity. A new document interrupting
filling/resuming marks the job failed; late old-document updates are rejected.

The popup lists transfers and provides cancellation and retry in a NEW blank
form. Retry uses the original snapshot even if the source tab changed/closed.
It persists the replacement and cancellation before acknowledgement. Concurrent
retries reuse the replacement. Completed/partially filled website fields are
never rolled back or overwritten. Cancellation stops extension operations only.

Browser restart and departure from mobile.bg retire tab authority while keeping
snapshots for explicit retry. Two-hour expiry disables execution, retains retry.
Clear removes all transfer history. Service-worker suspension alone does not
clear state. Retired tab IDs cannot resume automatically in unrelated pages.

## Automated checks

Run `npm test`, `npm run check`, `git diff --check`. Recovery fixtures cover login,
interrupted documents, old responses, restart, cancellation, concurrent retry,
immutable snapshots and image result semantics. Phase 1 tests remain in the suite.

## Manual Chrome acceptance

Use drafts only; do not publish:
1. Reload the unpacked extension and all existing auction/mobile tabs.
2. Extract A, fill, verify fields/preset/city/corrections; advance to photos and
   verify the first 17 photos. Popup must say assigned, not uploaded/published.
3. Repeat logged out of mobile.bg. Log in in the SAME destination tab; return to
   the new form there. Only A should populate, with one transfer ID.
4. Reload while filling. If interrupted, use Retry in the popup. Check a new
   blank tab receives A; the old partial form is left untouched.
5. Trigger region reload. Check matching form continues once. Change identity
   before continuation; it must stop rather than attaching the wrong images.
6. Start A and B from different auction tabs. Cancel A while photos download.
   B must continue; A must not assign late photos. Clear during download too.
7. Close A's source, then retry A twice quickly. Exactly one new destination
   should use A's original values/photos, even if the source now displays B.
8. Restart Chrome. Old jobs must not run by reused tab IDs. Explicit Retry should
   restore the snapshot in a new form. Test Cancel after restart as well.
9. Block an image URL, verify partial counts; retry in a fresh form. Existing
   file selections must never be overwritten. Verify uploads in mobile.bg itself.
10. Enter a city absent from its region; the stored result must retain a warning.

## Limits / Phase 3 boundary

Live Chrome/site login paths, dynamic selectors and server upload acceptance are
not verified by DOM fixtures. Redirects to another host retire ownership and
require explicit retry. A partially filled form is recovered into a fresh tab,
not replayed in place. Image processing/server receipt verification remains later
work. An interrupted image assignment may require user inspection because DOM
assignment and extension storage cannot be committed atomically. No Phase 3 work.
