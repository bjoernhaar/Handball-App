// Web Push: meldet dieses Gerät beim eigenen Worker an und hält die Liste
// der Favoriten dort aktuell. Der Worker gleicht die Spielpläne alle 15
// Minuten mit nuLiga ab und schickt bei Änderungen eine Mitteilung - auch
// wenn die App gar nicht geöffnet ist.
//
// Beim Worker landen nur: das Push-Abo (eine vom Browser erzeugte, anonyme
// Adresse) und die IDs der Favoriten-Mannschaften. Kein Name, keine E-Mail.

import { WORKER_URL } from "./config.js";

const SYNCED_KEY = "pushFavoritesSynced";
const RESYNC_MS = 24 * 60 * 60 * 1000;

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function base64UrlToBytes(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function teamsPayload(favorites) {
  return favorites.map((f) => ({ teamtable: f.teamtable, championship: f.championship, group: f.group }));
}

async function putSubscription(subscription, favorites) {
  const response = await fetch(`${WORKER_URL}/subscription`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), teams: teamsPayload(favorites) }),
  });
  if (!response.ok) throw new Error(`Anmeldung für Mitteilungen fehlgeschlagen (HTTP ${response.status}).`);
  try {
    localStorage.setItem(SYNCED_KEY, JSON.stringify({ at: Date.now(), sig: signature(favorites) }));
  } catch {
    // localStorage nicht verfügbar - dann eben beim nächsten Start erneut
  }
}

function signature(favorites) {
  return teamsPayload(favorites)
    .map((t) => `${t.teamtable}|${t.championship}|${t.group}`)
    .sort()
    .join(",");
}

/** @returns {Promise<"unsupported"|"denied"|"off"|"on">} */
export async function getPushState(registration) {
  if (!pushSupported() || !registration) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await registration.pushManager.getSubscription().catch(() => null);
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Fragt nach der Erlaubnis und meldet das Gerät beim Worker an. */
export async function enablePush(registration, favorites) {
  if (!pushSupported() || !registration) throw new Error("Dieser Browser unterstützt keine Push-Mitteilungen.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Mitteilungen wurden nicht erlaubt.");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const config = await fetch(`${WORKER_URL}/config`).then((r) => {
      if (!r.ok) throw new Error(`Server nicht erreichbar (HTTP ${r.status}).`);
      return r.json();
    });
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(config.vapidPublicKey),
    });
  }
  await putSubscription(subscription, favorites);
}

export async function disablePush(registration) {
  const subscription = registration && (await registration.pushManager.getSubscription());
  if (!subscription) return;
  await fetch(`${WORKER_URL}/subscription`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});
  await subscription.unsubscribe();
  try {
    localStorage.removeItem(SYNCED_KEY);
  } catch {
    // egal
  }
}

/**
 * Überträgt die aktuelle Favoritenliste an den Worker - sofort, wenn sie
 * sich geändert hat, sonst höchstens einmal am Tag (hält das Abo frisch).
 */
export async function syncPushFavorites(registration, favorites, { force = false } = {}) {
  if (!pushSupported() || !registration || Notification.permission !== "granted") return;
  const subscription = await registration.pushManager.getSubscription().catch(() => null);
  if (!subscription) return;
  let last = null;
  try {
    last = JSON.parse(localStorage.getItem(SYNCED_KEY) || "null");
  } catch {
    last = null;
  }
  if (!force && last && last.sig === signature(favorites) && Date.now() - last.at < RESYNC_MS) return;
  await putSubscription(subscription, favorites);
}
