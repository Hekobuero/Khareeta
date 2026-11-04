// same key function as js/offline.js / sw.js (offline.js imports DOM modules, so it is not loaded in Node)
export const tileKey = u => u.replace(/^(https:\/\/tiles\.openfreemap\.org\/planet)\/[^/]+\//, '$1/_/');
