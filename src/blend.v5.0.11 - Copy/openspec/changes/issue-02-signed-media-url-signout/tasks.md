# Tasks

## 1. Signed URL cleanup helper

- [x] 1.1 Add the side-effect-free cleanup helper and unit tests for signed URL clearing, portable-reference preservation, missing/expired expiry metadata, public/local boundaries, and cleanup failures; verify with the focused Node test.
- [x] 1.2 Advance `ASSET_VERSION` and `CACHE_VERSION` together, add the helper to the versioned app-shell precache, and verify the PWA asset invariant tests pass.

## 2. Sign-out integration and recovery

- [x] 2.1 Wire cleanup into the signed-out event, preserve current position and experience, and expose the accessible sign-out/retry copy; verify both media layers clear signed sources while public/local playback stays available in the focused auth E2E spec.
- [x] 2.2 Add E2E coverage for cancellation/late playback advance, retry after sign-in, multi-tab local reset, and a copied URL that remains independently usable; verify the focused auth E2E spec.

## 3. Integration verification

- [x] 3.1 Run the package syntax check, regression suite, auth E2E spec, and private-media-export E2E spec; report any runner startup failures separately from assertion results.
- [x] 3.2 Validate the OpenSpec change and Beads link/status with supported CLI commands; verify this issue is separate from the existing local-media-root issue.

## Workflow follow-up

- Review and archive this OpenSpec change after implementation review if the user asks to archive it.
