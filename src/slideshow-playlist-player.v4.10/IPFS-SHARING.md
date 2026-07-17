# IPFS Sharing

Blend can package the active experience as an IPFS-addressed manifest plus one CID per referenced media item.

## Provider Modes

- `Auto`: publish through an available provider without requiring a manual mode change. Auto uses a worker Helia module or custom Kubo endpoint when present. If no publisher is configured, the Share action performs a short reachability check against the default local Kubo endpoint (`http://127.0.0.1:5001`) and uses it only when it responds. Gateway retrieval remains available for playback.
- `Kubo`: add/fetch through a local or configured Kubo HTTP RPC API, defaulting to `http://127.0.0.1:5001`.
- `Helia`: use a browser Helia provider loaded inside `ipfs-worker.js` from the configured worker Helia module URL.
- `Gateway playback`: retrieve shared experiences through configured gateways. Gateways cannot publish new shares.

This app does not include private API keys, paid pinning services, or centralized upload storage. For long-term availability, keep the content pinned in a persistent Kubo/Helia node or use a pinning provider you control.

With default settings, Blend will not silently upload to a remote write service. Sharing works when local Kubo is running and its HTTP API allows the app origin. If Kubo is not reachable and no browser provider is configured, the share button opens a setup prompt and the configuration panel shows the current provider status.

## Worker Architecture

The UI thread owns playback, state orchestration, dialogs, and progress display only. IPFS preflight checks, Kubo HTTP RPC uploads/fetches, Helia startup, Helia uploads/fetches, cancellation, and shutdown run in `ipfs-worker.js`.

The boundary is defined in `ipfs-worker-protocol.js`; `ipfs-worker-client.js` lazy-starts one module worker, sends typed request messages, validates worker responses, forwards progress/warnings, and sends cancellation messages when the app aborts an operation. The worker imports `ipfs-service.js` with worker delegation disabled so the direct provider implementations are reused without spawning nested workers.

## Browser Helia Provider Contract

Blend keeps Helia pluggable so local playback stays dependency-light. A deployment that wants native browser IPFS should provide a worker-safe module URL. The bundled `ipfs-helia-provider.js` is the default module and lazy-loads Helia from pinned ESM CDN URLs inside the worker. Deployments that require stricter CSP or offline startup can replace it with a same-origin bundled module that exports the same contract.

The provider should implement:

- `addFile(blob, options)` or `addBytes(bytes, options)`, returning a CID string or an object with `cid`.
- `fetchCid(cid, options)` or `cat(cid, options)`, returning a `Blob`, `Response`, `Uint8Array`, `ArrayBuffer`, or async iterable of byte chunks.
- Optional `stop()`, `close()`, or `destroy()` for worker shutdown cleanup.

Blend passes abort signals, MIME hints, filenames, and progress callbacks where available.

The worker response includes the CID, byte size when known, MIME/content type when known, item kind, timestamp, provider id, and the configured gateway URL when available. Manifest share URLs are still built by the main app because they depend on the current page URL.

## Kubo Notes

The browser must be allowed to call the Kubo HTTP API. Before uploading, Blend checks `POST /api/v0/version`; if that request fails, sharing stops before media is packaged and explains that Kubo may be stopped, the endpoint may be wrong, or CORS may be blocking the app origin. In local development, configure Kubo CORS for the app origin you use, for example `http://localhost:8080` or the file/app origin you trust. Do not expose the Kubo RPC API broadly on a public network.

## Share Warning Reset

Before the first public IPFS upload, Blend shows a warning that media added to IPFS may be retrievable by anyone with the CID/link and can be difficult to retract.

You can re-enable the warning in either place:

- In the configuration panel, turn on `Show public upload warning`.
- Open the app with `?resetShareWarning=true`.

The dialog checkbox only suppresses future warnings after the user confirms sharing.

## Share Links

Shared links use:

```text
?ipfsExperience=<manifest-cid>&ipfsGateway=<gateway-url>
```

On open, Blend fetches and validates the manifest, downloads referenced item CIDs using the configured provider/gateway strategy, caches the blobs in IndexedDB, creates a local experience, and plays it with the existing playback engine.

## Safety Limits

Fetched manifests are treated as untrusted JSON. Blend validates CIDs, schema version, media categories, MIME types, list references, type/CID consistency, and item sizes before playback. Manifests intentionally omit file handles, absolute paths, source URLs, secrets, and machine-local metadata.
