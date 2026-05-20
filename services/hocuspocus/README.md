# Hocuspocus Service

`services/hocuspocus` owns the standalone canvas collaboration transport runtime.

## Runtime

Start the service with:

```bash
bun run --cwd services/hocuspocus start
```

Required runtime configuration:

- `HOCUSPOCUS_PORT`: positive integer port for the service listener.
- `HOCUSPOCUS_ADDRESS`: optional bind address.
- `HOCUSPOCUS_DEBOUNCE_MS`: optional positive integer debounce override.
- `HOCUSPOCUS_MAX_DEBOUNCE_MS`: optional positive integer maximum debounce override.

## Readiness

The runtime emits a minimal readiness contract through `onReadinessChange`.
The status includes only service identity, readiness state, port, and address.
It intentionally excludes auth tokens, document identifiers, connection context,
and persistence payloads so smoke checks can verify the service without canvas
document access.
