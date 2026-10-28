import { CACHE_KEY_VERSIONS } from '@app/shared/const';

let cacheUserId = 'guest';

export function setCacheUserId(userId: number): void {
  cacheUserId = String(userId);
}

export function clearCacheUserId(): void {
  cacheUserId = 'guest';
}

export function hasCacheUser(): boolean {
  return cacheUserId !== 'guest';
}

function getCacheUserId(): string {
  return cacheUserId;
}

function resolveCacheKeyVersion(baseKey: string): number {
  const version = CACHE_KEY_VERSIONS[baseKey];
  if (version !== undefined) return version;

  // No safe fallback version exists here: any vN we pick still gets swept by the next purge
  // pass (it treats an unregistered baseKey as stale regardless of version), so writing under
  // it would silently vanish every session instead of failing loudly.
  throw new Error(`Cache key "${baseKey}" is not registered in CACHE_KEY_VERSIONS`);
}

export function buildCacheKey(baseKey: string): string {
  return `${baseKey}:${getCacheUserId()}:v${resolveCacheKeyVersion(baseKey)}`;
}

// For keys that intentionally stay tied to the browser, not the logged-in user (e.g. navbar
// collapsed state) — same registry/versioning, just no userId segment.
export function buildDeviceCacheKey(baseKey: string): string {
  return `${baseKey}:v${resolveCacheKeyVersion(baseKey)}`;
}

const USER_SCOPED_KEY_PATTERN = /^([a-z_]+):[^:]*:v(\d+)$/; // matches "baseKey:userId:vN"
const DEVICE_SCOPED_KEY_PATTERN = /^([a-z_]+):v(\d+)$/; // matches "baseKey:vN" (no userId)

interface ParsedCacheKey {
  baseKey: string;
  version: number;
  isUserScoped: boolean;
}

function parseCacheKey(key: string): ParsedCacheKey | null {
  const userScopedMatch = key.match(USER_SCOPED_KEY_PATTERN);
  if (userScopedMatch) {
    return { baseKey: userScopedMatch[1], version: Number(userScopedMatch[2]), isUserScoped: true };
  }

  const deviceScopedMatch = key.match(DEVICE_SCOPED_KEY_PATTERN);
  if (deviceScopedMatch) {
    return { baseKey: deviceScopedMatch[1], version: Number(deviceScopedMatch[2]), isUserScoped: false };
  }

  return null;
}

// A key is stale if it's not a currently-registered baseKey at its currently-registered version
// — covers both "version bumped" and "baseKey retired entirely" in one check.
export function isStaleCacheKey(key: string): boolean {
  const parsed = parseCacheKey(key);
  if (!parsed) return false;
  return CACHE_KEY_VERSIONS[parsed.baseKey] !== parsed.version;
}

export function isUserScopedCacheKey(key: string): boolean {
  const parsed = parseCacheKey(key);
  return parsed !== null && parsed.isUserScoped && parsed.baseKey in CACHE_KEY_VERSIONS;
}

export function clearAllUserScopedCaches(): void {
  Object.keys(localStorage)
    .filter(isUserScopedCacheKey)
    .forEach((key) => localStorage.removeItem(key));
}

export function purgeStaleCacheVersions(): void {
  Object.keys(localStorage)
    .filter(isStaleCacheKey)
    .forEach((key) => localStorage.removeItem(key));
}
