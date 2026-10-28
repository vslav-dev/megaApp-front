// Chrome/Edge: dynamic import() rejects with this when the chunk file 404s
const CHUNK_FETCH_FAILED_RE = /failed to fetch dynamically imported module/i;
// Firefox: dynamic import() rejects with this when the chunk file 404s
const CHUNK_LOAD_FAILED_RE = /error loading dynamically imported module/i;
// Safari: module script import failure, message carries no URL
const CHUNK_IMPORT_FAILED_RE = /importing a module script failed/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    CHUNK_FETCH_FAILED_RE.test(message) || CHUNK_LOAD_FAILED_RE.test(message) || CHUNK_IMPORT_FAILED_RE.test(message)
  );
}
