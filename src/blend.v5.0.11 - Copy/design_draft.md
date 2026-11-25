# Blend Player Profile Sync and Recovery

* **Author:** Kyle Rode
* **Status:** Draft
* **Date:** 2026-11-14

## Overview

Blend Player v5.0.11 is a local-first browser app. This feature gives one person a stable profile identity that can be used on multiple devices, while retaining local editing and playback. A profile is identified by a cryptographically random GUID. The GUID remains the permanent storage path key, but it is public and does not authorize access.

The app will use a backend to coordinate profile changes before writing the current Experience JSON to the public `BlendPlayer/BlendPlayer` GitHub repository at `experiences/{guid}/experience.json`. The file and its full Git history are public. The backend will use WebDAV locking, and enrolled browsers will receive separate `Secure` and `HttpOnly` device cookies through an API custom domain. Users will not need a username or password sign-in. GitHub credentials stay on the backend. Bitbucket is out of scope.

Changes remain saved in the browser while offline and sync when connectivity returns. The first valid update accepted by the backend wins. A stale update prompts the user to resubmit and replace the current GitHub version or cancel. Resubmission creates a later commit, preserving history. A single-use share URL expires after ten minutes. A replacement device can use one of ten one-use recovery keys; generating a new set invalidates the previous set and downloads a text file containing the new keys.

The feature also includes hidden-by-default identity controls and a server-authorized administrative interface for GitHub Experience repository operations. A dedicated Render backend is under consideration. The account currently has no Blend-specific Render service, and its existing services and datastores belong to other projects.

## The Problem

Blend already supports multiple Experiences, stable local persistence, and Experience JSON import and export. The existing format is `player.blend.experience.v2`, which includes settings, a media library snapshot, and playlist and slideshow snapshots. Browser state is stored in IndexedDB and LocalStorage. The app is delivered as static files and has no existing Experience API or WebDAV server. Its existing Git provider feature handles user-owned playlist publishing in the browser and does not provide this backend.

People using more than one browser need a way to keep the same profile and Experience current across devices. A public GUID path cannot serve as a secret, and GitHub's public files cannot hold confidential profile data. Device enrollment, recovery, concurrent edits, and public repository writes therefore need a backend that checks a separate device credential and serializes accepted updates. Offline edits must remain available until the user can sync or resolve a conflict.

The Render account has one workspace with existing Node services, PostgreSQL databases, and Key Value stores for AI-Powered and FilmBuff projects. None is a Blend service. Reusing those resources would mix this feature with unrelated projects. The app's current cPanel deployment remains the static frontend host unless a later design decision changes it.

## Goals

* Generate a new cryptographically random GUID when a browser has no profile identity. Validate imported GUIDs strictly and support local-file and HTTPS URL import, confirmation before replacing an identity, local export, copy, reveal, and delete-and-start-over controls.
* Keep the GUID and its controls hidden by default. Explain that the GUID is public, anyone who obtains a separate access credential can act on the profile, and public GitHub Experience files and history are readable by anyone.
* Enroll each browser with a separate server-issued `Secure` and `HttpOnly` device cookie. Use the selected API custom-domain approach with exact-origin CORS and server-side request protection. The public GUID alone must never authorize a write.
* Provide ten one-use recovery keys per profile. Require a local text-file download when generating them, consume a key when a replacement device is enrolled, and invalidate the previous set when a new set is generated.
* Let an enrolled device create a single-use share URL that expires after ten minutes. Redeeming it enrolls another device and synchronizes the profile.
* Keep local edits and playback working offline. Queue unsynced profile changes locally and report pending, successful, conflict, and error states without exposing credentials.
* Coordinate writes through WebDAV. Accept the first valid write for a profile revision; reject stale writes without silently replacing newer data. Ask the user before resubmitting a stale draft over the current GitHub version or cancelling the remote update.
* Store only the current Experience JSON artifact in the public GitHub repository at `experiences/{guid}/experience.json`. Create the path on first write. Update and delete the live file with new commits so the public history remains intact. Keep registries, secrets, logs, and administrative state outside that repository.
* Attempt GitHub synchronization after each accepted Experience modification and show its result separately from local save status. Preserve retryable state after network or provider failures.
* Provide an administrative interface whose access is validated by the backend, with a generated admin key, server-validated single-use confirmation for sensitive actions, rate limits, and redacted audit records. Keep existing provider credentials out of the frontend and never display them after saving.
* Preserve the existing Experience JSON format, import and export behavior, IndexedDB data, media resolution, playback, and PWA offline behavior.

## Non-Goals

* Bitbucket storage or synchronization.
* Hiding Experience content or Git history in the public GitHub repository, or treating the GUID as a password.
* Requiring a username, email address, phone number, or routine interactive sign-in to use a profile.
* Moving the existing static frontend from cPanel as part of this feature.
* Rewriting or erasing Git history when updating or deleting a live Experience file.
* Uploading provider credentials, recovery codes, device credentials, GUID registries, logs, or admin state to the public Experience repository.

## Open Questions

* Which Render service plan and persistent datastore should host the dedicated backend, and will `api.mytech.today` be configured to point to it? Existing Render resources belong to other projects.  use render controls to provision the necessary backend
* Does replacing the recovery-key set revoke existing device cookies, or do previously enrolled browsers remain authorized?  Revoke
* What lifetime and revocation controls should apply to a device cookie after enrollment?  remove
* What should cancel do to a stale local draft after the user declines to overwrite the current GitHub version? sync to current saved experience
* Which parts of the Experience should mirror to a replacement device when media files or browser-specific file and directory handles are local to the original device?  the entire experience
* Which administrative GitHub operations are required, and which can be supported with the intended minimum repository permissions?  you decide and make those available.
