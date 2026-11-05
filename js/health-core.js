// Gesundheit / Notfall (Health / Emergency) – pure data + helpers, no DOM.
// Numbers are for SYRIA only. Short codes work on Syrian phone networks; they are NOT local
// emergency numbers when the user is abroad (e.g. Germany also uses 110 for police).
//
// Sources researched 2026-11-05 (Berlin). Wikipedia was not used as a cited source.
// Omitted (unconfirmed as a nationwide public hotline from a reliable institutional page):
//   - dedicated poison-control number (SPIC exists in literature; no public dial code found)
//   - Syrian Arab Red Crescent nationwide emergency short code (sarc.sy lists HQ office phones only)
//   - "111 health emergency" (only on Brazilian Embassy Damascus page; not on AU/CA advisories)
//   - Red Crescent "331 0476" (Brazilian Embassy; looks like a Damascus landline fragment)

/** @typedef {{ id: string, dial: string, icon: string, labelKey: string, sources: { url: string, name: string, states: string }[] }} EmNumber */

/** @type {EmNumber[]} */
export const EMERGENCY_NUMBERS = [
  {
    id: 'ambulance',
    dial: '110',
    icon: 'hospital',
    labelKey: 'emAmbulance',
    sources: [
      {
        url: 'https://travel.gc.ca/destinations/syria',
        name: 'Government of Canada – Travel advice (Syria)',
        states: 'medical assistance: 110',
      },
      {
        url: 'https://www.smartraveller.gov.au/destinations/middle-east/syria',
        name: 'Australian Government – Smartraveller (Syria)',
        states: 'Medical emergencies: Call 110',
      },
    ],
  },
  {
    id: 'police',
    dial: '112',
    icon: 'police',
    labelKey: 'emPolice',
    sources: [
      {
        url: 'https://travel.gc.ca/destinations/syria',
        name: 'Government of Canada – Travel advice (Syria)',
        states: 'police: 112',
      },
      {
        url: 'https://www.smartraveller.gov.au/destinations/middle-east/syria',
        name: 'Australian Government – Smartraveller (Syria)',
        states: 'Police: Call 112',
      },
    ],
  },
  {
    id: 'fire',
    dial: '113',
    icon: 'warning',
    labelKey: 'emFire',
    sources: [
      {
        url: 'https://travel.gc.ca/destinations/syria',
        name: 'Government of Canada – Travel advice (Syria)',
        states: 'firefighters: 113',
      },
      {
        url: 'https://www.smartraveller.gov.au/destinations/middle-east/syria',
        name: 'Australian Government – Smartraveller (Syria)',
        states: 'Fire services: Call 113',
      },
    ],
  },
];

/** Nearby place shortcuts → existing category chip keys (js/search.js CATS). Clinic uses the hospital chip (Overpass already includes amenity=clinic|doctors). */
export const NEARBY_ACTIONS = [
  { id: 'hospital', cat: 'hospital', icon: 'hospital', labelKey: 'emNearbyHospital' },
  { id: 'clinic', cat: 'hospital', icon: 'hospital', labelKey: 'emNearbyClinic' },
  { id: 'pharmacy', cat: 'pharmacy', icon: 'pharmacy', labelKey: 'emNearbyPharmacy' },
];

/** One-tap dial for Syrian short codes. Digits only in the href. */
export function telHref(dial) {
  const d = String(dial || '').replace(/\D/g, '');
  return d ? 'tel:' + d : null;
}

export function findNumber(id) {
  return EMERGENCY_NUMBERS.find(n => n.id === id) || null;
}

export const HEALTH_I18N = {
  en: {
    emChip: 'Emergency',
    emTitle: 'Health & emergency',
    emSyriaLabel: 'Syrian emergency numbers',
    emSyriaHint: 'These short codes are for Syria. They only work on Syrian phone networks — not local numbers where you are now.',
    emAmbulance: 'Ambulance / medical',
    emPolice: 'Police',
    emFire: 'Fire brigade',
    emCall: 'Call {n}',
    emNearbyTitle: 'Nearby (this map view)',
    emNearbyHospital: 'Hospitals',
    emNearbyClinic: 'Clinics & doctors',
    emNearbyPharmacy: 'Pharmacies',
    emNearbyHint: 'Searches the area you are looking at — does not jump the map to Syria.',
    emSources: 'Sources',
    emDrawer: 'Health & emergency',
  },
  ar: {
    emChip: 'طوارئ',
    emTitle: 'الصحة والطوارئ',
    emSyriaLabel: 'أرقام الطوارئ في سوريا',
    emSyriaHint: 'هذه الأرقام القصيرة لسوريا فقط. تعمل على شبكات الهاتف السورية — وليست أرقامًا محلية حيث أنت الآن.',
    emAmbulance: 'إسعاف / طبي',
    emPolice: 'الشرطة',
    emFire: 'الإطفاء',
    emCall: 'اتصال {n}',
    emNearbyTitle: 'بالقرب (منظور الخريطة)',
    emNearbyHospital: 'مستشفيات',
    emNearbyClinic: 'عيادات وأطباء',
    emNearbyPharmacy: 'صيدليات',
    emNearbyHint: 'يبحث في المنطقة التي تنظر إليها — دون نقل الخريطة إلى سوريا.',
    emSources: 'المصادر',
    emDrawer: 'الصحة والطوارئ',
  },
  de: {
    emChip: 'Notfall',
    emTitle: 'Gesundheit & Notfall',
    emSyriaLabel: 'Syrische Notrufnummern',
    emSyriaHint: 'Diese Kurzwahlen gelten für Syrien. Sie funktionieren nur in syrischen Telefonnetzen — nicht als Ortsnummern dort, wo du gerade bist.',
    emAmbulance: 'Rettung / Medizin',
    emPolice: 'Polizei',
    emFire: 'Feuerwehr',
    emCall: '{n} anrufen',
    emNearbyTitle: 'In der Nähe (dieser Kartenausschnitt)',
    emNearbyHospital: 'Krankenhäuser',
    emNearbyClinic: 'Kliniken & Ärzte',
    emNearbyPharmacy: 'Apotheken',
    emNearbyHint: 'Sucht im aktuellen Ausschnitt — die Karte springt nicht nach Syrien.',
    emSources: 'Quellen',
    emDrawer: 'Gesundheit & Notfall',
  },
};
