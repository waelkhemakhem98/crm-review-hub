// localStorage can throw (SecurityError: opaque origin) when this file is
// opened directly via file:// in some browsers/security configurations.
// Every access goes through here so the app degrades to in-memory-only
// (still fully usable, just without autosave-across-reload) instead of
// crashing on an uncaught exception during render.
let available = true;

export function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw;
  } catch {
    available = false;
    return fallback;
  }
}

export function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    available = false;
  }
}

export function storageAvailable() {
  return available;
}
