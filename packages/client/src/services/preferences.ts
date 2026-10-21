// Per-device UI preferences (e.g. OBS chapter options). Storage may be unavailable in some
// OBS/CEF profiles, so reads fall back to the default and writes are best-effort.

export function getBoolPreference(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(`streamcollab_pref:${key}`);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

export function setBoolPreference(key: string, value: boolean) {
  try {
    localStorage.setItem(`streamcollab_pref:${key}`, String(value));
  } catch {
    // ignore: preference only lasts for this page load
  }
}
