// Drawer item «Gespeicherte Orte» (data-a="saved") must open the saved-places sheet.
// A bare `export { showSaved } from './saved.js'` re-exports the function for app.js (#hAll)
// but does not create a local binding, so the click handler threw
// ReferenceError: showSaved is not defined. No network, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

class ClassList {
  constructor(el) { this.el = el; }
  #set() { return new Set((this.el.className || '').split(/\s+/).filter(Boolean)); }
  #write(s) { this.el.className = [...s].join(' '); }
  add(...xs) { const s = this.#set(); for (const x of xs) if (x) s.add(x); this.#write(s); }
  remove(...xs) { const s = this.#set(); for (const x of xs) s.delete(x); this.#write(s); }
  toggle(name, force) { const on = force === undefined ? !this.contains(name) : !!force; if (on) this.add(name); else this.remove(name); return on; }
  contains(name) { return this.#set().has(name); }
}

class El {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = '';
    this.className = '';
    this.classList = new ClassList(this);
    this.dataset = {};
    this.attrs = new Map();
    this.style = { setProperty(k, v) { this[k] = v; } };
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.onclick = null;
    this.textContent = '';
    this.offsetHeight = 800;
    this.scrollTop = 0;
    this._html = '';
  }
  get children() { return this.childNodes; }
  appendChild(n) { n.parentNode = this; this.childNodes.push(n); return n; }
  setAttribute(k, v) {
    const val = String(v);
    this.attrs.set(k, val);
    if (k === 'id') this.id = val;
    if (k === 'class') this.className = val;
    if (k.startsWith('data-')) {
      const key = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = val;
    }
  }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(ev) {
    const event = { type: ev.type, target: ev.target || this };
    let node = event.target;
    while (node) {
      event.currentTarget = node;
      for (const fn of node.listeners?.[event.type] || []) fn.call(node, event);
      const on = node['on' + event.type];
      if (typeof on === 'function') on.call(node, event);
      node = node.parentNode;
    }
    return true;
  }
  closest(sel) {
    let n = this;
    while (n && n.nodeType === 1) { if (matches(n, sel)) return n; n = n.parentNode; }
    return null;
  }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  set innerHTML(html) {
    this._html = String(html);
    this.childNodes = [];
    this.textContent = '';
    parseInto(this, this._html);
  }
  get innerHTML() { return this._html; }
}

function matches(el, sel) {
  const parts = sel.trim().split(/\s+/);
  if (!matchSimple(el, parts[parts.length - 1])) return false;
  if (parts.length === 1) return true;
  const rest = parts.slice(0, -1).join(' ');
  let n = el.parentNode;
  while (n && n.nodeType === 1) { if (matches(n, rest)) return true; n = n.parentNode; }
  return false;
}
function matchSimple(el, sel) {
  const parts = [...sel.matchAll(/(#[\w-]+|\.[\w-]+|\[[^\]]+\]|[a-zA-Z][\w-]*)/g)].map(m => m[0]);
  if (!parts.length) return false;
  for (const p of parts) {
    if (p[0] === '#') { if (el.id !== p.slice(1)) return false; }
    else if (p[0] === '.') { if (!el.classList.contains(p.slice(1))) return false; }
    else if (p[0] === '[') {
      const m = p.slice(1, -1).match(/^([\w:-]+)(?:([~|^$*]?=)\s*"?([^"\]]*)"?)?$/);
      if (!m || !el.attrs.has(m[1])) return false;
      if (m[2] === '=' && el.attrs.get(m[1]) !== m[3]) return false;
      else if (m[2] && m[2] !== '=') return false;
    } else if (el.tagName !== p.toUpperCase()) return false;
  }
  return true;
}
function queryAll(root, sel) {
  const out = [];
  const walk = n => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } };
  walk(root);
  return out;
}
function applyAttrs(el, raw) {
  const re = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m; while ((m = re.exec(raw))) el.setAttribute(m[1], m[2] ?? m[3] ?? m[4] ?? '');
}
function parseInto(parent, html) {
  const re = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  const stack = [parent];
  let last = 0, m;
  while ((m = re.exec(html))) {
    const cur = stack[stack.length - 1];
    const text = html.slice(last, m.index);
    if (text) cur.textContent += text;
    last = re.lastIndex;
    const tag = m[1].toLowerCase();
    if (html[m.index + 1] === '/') {
      while (stack.length > 1 && stack[stack.length - 1].tagName !== tag.toUpperCase()) stack.pop();
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new El(tag);
    const attrs = m[2] || '';
    const self = /\/\s*$/.test(attrs) || VOID.has(tag);
    applyAttrs(el, attrs.replace(/\/\s*$/, ''));
    cur.appendChild(el);
    if (!self) stack.push(el);
  }
}

function installDom() {
  const store = new Map([['kh.lang', 'de']]);
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  globalThis.innerWidth = 1100;
  globalThis.innerHeight = 800;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '0' });
  const root = new El('html');
  root.lang = 'de'; root.dir = 'ltr';
  const body = new El('body');
  root.appendChild(body);
  const sheet = new El('section'); sheet.setAttribute('id', 'sheet'); sheet.dataset.state = 'hidden';
  const sheetBody = new El('div'); sheetBody.setAttribute('id', 'sheetBody');
  sheet.appendChild(sheetBody);
  body.appendChild(sheet);
  for (const id of ['scrim', 'drawer', 'layersPop', 'toast']) {
    const n = new El('div'); n.setAttribute('id', id); body.appendChild(n);
  }
  globalThis.document = {
    documentElement: root,
    body,
    createElement: tag => new El(tag),
    querySelector: sel => root.querySelector(sel),
    querySelectorAll: sel => root.querySelectorAll(sel),
  };
}

test('drawer action saved opens the saved-places list and ui.js still exports showSaved', async () => {
  installDom();
  const ui = await import('../../js/ui.js');
  const saved = await import('../../js/saved.js');
  const { App } = await import('../../js/core.js');
  const { setLang } = await import('../../js/i18n.js');
  setLang('de');

  // #hAll «Alle anzeigen» imports showSaved from ui.js — same function saved.js exports.
  assert.equal(typeof ui.showSaved, 'function');
  assert.equal(ui.showSaved, saved.showSaved);
  ui.showSaved();
  assert.equal(App.sheetKind, 'saved');
  assert.match(document.querySelector('h2.ptitle').textContent, /Gespeicherte Orte/);
  assert.match(document.querySelector('#svList .psub').textContent, /Noch keine Orte gespeichert/);

  App.sheetKind = 'home';
  document.querySelector('#sheetBody').innerHTML = '<p id="gone">home</p>';
  const drawer = document.querySelector('#drawer');
  drawer.classList.add('open');
  drawer.innerHTML = '<button class="ditem" data-a="saved"><span>Gespeicherte Orte</span></button>';
  ui.initDrawer();
  const hit = drawer.querySelector('[data-a="saved"] span');
  assert.equal(hit.closest('[data-a]').dataset.a, 'saved');
  hit.dispatchEvent({ type: 'click' });

  assert.equal(drawer.classList.contains('open'), false);
  assert.equal(App.sheetKind, 'saved');
  assert.equal(document.querySelector('#gone'), null);
  assert.match(document.querySelector('h2.ptitle').textContent, /Gespeicherte Orte/);
  assert.ok(document.querySelector('#svList'));
  assert.ok(document.querySelector('#svClose'));
});
