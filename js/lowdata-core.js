// Data-saver / Datensparmodus helpers (pure: no DOM, no network).
// Default follows navigator.connection.saveData when the user has never toggled lowData.

/** True when the browser reports Save-Data / Data Saver. */
export function saveDataOn(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  try { return !!(nav && nav.connection && nav.connection.saveData); } catch { return false; }
}

/**
 * Resolve the initial lowData flag from a stored settings object.
 * If the user has explicitly saved `lowData` (true or false), keep that choice.
 * Otherwise default to the browser's Save-Data preference.
 */
export function resolveLowData(stored, nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  if (stored && Object.prototype.hasOwnProperty.call(stored, 'lowData')) return !!stored.lowData;
  return saveDataOn(nav);
}

/** Map extras (3D buildings, hillshade, DEM terrain) are skipped in low-data mode. */
export function allowMapExtras(settings) {
  return !(settings && settings.lowData);
}

/** Non-essential place extras (weather, photos, wiki, Panoramax) are skipped in low-data mode. */
export function allowPlaceExtras(settings) {
  return !(settings && settings.lowData);
}

/** Prefetch of the alternate map theme is skipped in low-data mode. */
export function allowStylePrefetch(settings) {
  return !(settings && settings.lowData);
}
