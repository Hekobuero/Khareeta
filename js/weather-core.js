// Open-Meteo weather helpers (no DOM). Separated from place.js so the startup
// path can paint the weather chip without downloading the place/route graph.
import { fetchJSON } from './util.js';
import { getLang } from './i18n.js';

const WMO = {
  0: ['☀️', 'Clear', 'صافٍ', 'Klar'],
  1: ['🌤️', 'Mainly clear', 'صافٍ غالبًا', 'Überwiegend klar'],
  2: ['⛅', 'Partly cloudy', 'غائم جزئيًا', 'Teilweise bewölkt'],
  3: ['☁️', 'Overcast', 'غائم', 'Bedeckt'],
  45: ['🌫️', 'Fog', 'ضباب', 'Nebel'],
  48: ['🌫️', 'Fog', 'ضباب', 'Nebel'],
  51: ['🌦️', 'Drizzle', 'رذاذ', 'Nieselregen'],
  53: ['🌦️', 'Drizzle', 'رذاذ', 'Nieselregen'],
  55: ['🌦️', 'Drizzle', 'رذاذ', 'Nieselregen'],
  61: ['🌧️', 'Rain', 'مطر', 'Regen'],
  63: ['🌧️', 'Rain', 'مطر', 'Regen'],
  65: ['🌧️', 'Heavy rain', 'مطر غزير', 'Starkregen'],
  71: ['🌨️', 'Snow', 'ثلج', 'Schnee'],
  73: ['🌨️', 'Snow', 'ثلج', 'Schnee'],
  75: ['❄️', 'Heavy snow', 'ثلج كثيف', 'Starker Schneefall'],
  80: ['🌦️', 'Showers', 'زخات', 'Schauer'],
  81: ['🌧️', 'Showers', 'زخات', 'Schauer'],
  82: ['⛈️', 'Heavy showers', 'زخات غزيرة', 'Starke Schauer'],
  95: ['⛈️', 'Thunderstorm', 'عاصفة رعدية', 'Gewitter'],
  96: ['⛈️', 'Thunderstorm', 'عاصفة رعدية', 'Gewitter'],
  99: ['⛈️', 'Thunderstorm', 'عاصفة رعدية', 'Gewitter'],
};

export function wmo(code, isDay = 1) {
  const w = WMO[code] || WMO[Math.floor(code / 10) * 10] || ['🌡️', '', '', ''];
  const i = getLang() === 'ar' ? 2 : getLang() === 'de' ? 3 : 1;
  let e = w[0];
  if (!isDay && code <= 1) e = '🌙';
  return [e, w[i]];
}

const wxCache = new Map();
export async function weatherRaw(lat, lon) {
  const k = lat.toFixed(2) + ',' + lon.toFixed(2);
  const c = wxCache.get(k);
  if (c && Date.now() - c.t < 15 * 60000) return c.j;
  const j = await fetchJSON(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`,
    {},
    8000,
  );
  wxCache.set(k, { t: Date.now(), j });
  return j;
}
