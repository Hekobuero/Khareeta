// Simplified Syria border for tile-POI vs. own-data decisions.
// Source: Natural Earth 10m Admin 0 Countries (public domain), inward-buffered ~0.5 km so Syrian border
// towns stay on our GeoJSON, then Douglas–Peucker simplified. Used by tools/poi/style-poi.mjs (MapLibre
// `within` filter) and by js/tile-poi.js (point-in-polygon). SY_BBOX in world-core.js stays for other uses.
export const SY_RING = [
  [35.744,35.585],
  [35.8433,35.7468],
  [35.8058,35.8463],
  [35.9793,35.9237],
  [36.0025,35.8666],
  [36.1589,35.8198],
  [36.1987,35.9491],
  [36.3606,35.9925],
  [36.3728,36.2236],
  [36.6667,36.2273],
  [36.5343,36.4788],
  [36.6433,36.8253],
  [36.9631,36.7512],
  [37.0529,36.6169],
  [37.447,36.6313],
  [38.2242,36.9054],
  [38.479,36.8529],
  [38.7244,36.691],
  [39.2397,36.6583],
  [39.7661,36.7393],
  [40.7096,37.0975],
  [41.4801,37.0726],
  [42.0103,37.1728],
  [42.2108,37.3211],
  [42.35,37.2268],
  [42.3741,37.0639],
  [41.842,36.6203],
  [41.3841,36.5191],
  [41.2743,36.3562],
  [41.2337,36.06],
  [41.3516,35.8249],
  [41.3605,35.6555],
  [41.2583,35.4953],
  [41.1984,35.2435],
  [41.2013,34.7938],
  [40.9634,34.4042],
  [40.6891,34.3342],
  [38.7732,33.3744],
  [36.8062,32.3161],
  [36.3889,32.3821],
  [36.1786,32.53],
  [36.0691,32.5198],
  [36.0055,32.6574],
  [35.7663,32.7505],
  [35.8911,32.945],
  [35.7708,33.3339],
  [35.9349,33.5252],
  [36.0382,33.5673],
  [35.9249,33.6419],
  [35.9512,33.7079],
  [36.1383,33.8473],
  [36.3593,33.8214],
  [36.2911,33.9448],
  [36.6071,34.1992],
  [36.5273,34.425],
  [36.3238,34.5136],
  [36.4419,34.6318],
  [36.3092,34.6905],
  [36.261,34.6302],
  [35.9723,34.6529],
  [35.8708,34.9227],
  [35.8909,35.1084],
  [35.9654,35.1977],
  [35.9219,35.4183],
  [35.7738,35.5061],
  [35.744,35.585]
];
export const SY_POLY = { type: 'Polygon', coordinates: [SY_RING] };

/** Ray-casting point-in-polygon. Ring is closed (first == last). Boundary counts as inside. */
export function inSyria(lon, lat) {
  let inside = false;
  for (let i = 0, j = SY_RING.length - 1; i < SY_RING.length; j = i++) {
    const xi = SY_RING[i][0], yi = SY_RING[i][1], xj = SY_RING[j][0], yj = SY_RING[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
