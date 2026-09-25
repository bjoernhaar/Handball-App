// Einfacher Key-Value-Speicher auf Basis von IndexedDB (statt localStorage),
// weil IndexedDB - anders als localStorage - auch im Service Worker zur
// Verfügung steht. Das ist nötig, damit der periodische Hintergrund-Sync
// (siehe service-worker.js) auf dieselben Daten zugreifen kann wie die App
// im Vordergrund. Die get/set-Signatur ist bewusst an chrome.storage.local
// angelehnt (Pendant zur Room-Datenbank der Android-Version bzw. zu
// chrome.storage.local der Erweiterungs-Version), damit repository.js
// praktisch unverändert bleibt.

const DB_NAME = "handball-favoriten";
const STORE_NAME = "kv";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const storage = {
  /** @returns {Promise<Object>} z.B. { favorites: {...} } - Pendant zu chrome.storage.local.get(key) */
  async get(key) {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, "readonly");
      const value = await reqToPromise(tx.objectStore(STORE_NAME).get(key));
      return { [key]: value };
    } catch (err) {
      console.warn("Storage-Lesefehler:", err);
      return {};
    }
  },

  /** @param {Object} obj z.B. { favorites: {...} } - Pendant zu chrome.storage.local.set(obj) */
  async set(obj) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const [key, value] of Object.entries(obj)) {
        store.put(value, key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
