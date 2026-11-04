#!/usr/bin/env node
// Moderators: turn APPROVED anonymous road reports into the static, public file data/closures.json.
// No network access, no keys: you export the reports yourself (Supabase dashboard → SQL, see README.md) and pass the file.
//
//   node scripts/closures/export-approved.mjs --reports reports.json --approve approve.json [--out data/closures.json] [--hours 48]
//   node scripts/closures/export-approved.mjs --prune            # only drop expired entries
//
// reports.json: array of kh_events rows ({ id, props }) where props.k === 'closure'.
// approve.json: { "<row id>": { "hours": 48, "note": "neutral moderator text (optional)" }, … } – only these are published.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { rowsToEntries, mergeFile } from '../../js/closures-core.js';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) { const a = args[i]; if (a.startsWith('--')) opt[a.slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true; }
const out = opt.out || new URL('../../data/closures.json', import.meta.url).pathname;
const now = opt.now ? Date.parse(opt.now) : Date.now();
const read = f => JSON.parse(readFileSync(f, 'utf8'));
const doc = existsSync(out) ? read(out) : { schema: 1, closures: [] };
let add = [];
if (!opt.prune) {
  if (!opt.reports || !opt.approve) { console.error('need --reports <file> and --approve <file> (or --prune)'); process.exit(2); }
  const rows = read(opt.reports), approve = read(opt.approve);
  add = rowsToEntries(Array.isArray(rows) ? rows : rows.rows || [], approve, now, +opt.hours || 48);
  const missing = Object.keys(approve).filter(id => !add.some(e => e.id === 'r' + id));
  if (missing.length) console.warn('skipped (not found / not a road report / invalid):', missing.join(', '));
}
const res = mergeFile(doc, add, now);
writeFileSync(out, JSON.stringify(res, null, 2) + '\n');
console.log(`${out}: ${res.closures.length} active entr${res.closures.length === 1 ? 'y' : 'ies'} (+${add.length} new)`);
