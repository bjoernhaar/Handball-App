// Ende-zu-Ende-Test des Workers mit simuliertem KV-Speicher, simuliertem
// nuLiga und simuliertem Push-Dienst: Abo anlegen -> erster Cron-Lauf legt
// Snapshot an -> nuLiga verlegt ein Spiel -> zweiter Lauf schickt eine
// verschlüsselte Push-Mitteilung, die sich wieder entschlüsseln lässt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import ece from "http_ece";
import { fixture } from "./helpers.mjs";
import worker, { runScheduled, vapidFromEnv } from "../src/index.js";
import { parseTeamPortraitHtml } from "../src/schedule.js";

const html = fixture("teamPortrait.html");
const ORIGIN = "https://example.github.io";

class MemoryKV {
  constructor() {
    this.map = new Map();
  }
  async get(key, type) {
    const e = this.map.get(key);
    if (!e) return null;
    return type === "json" ? JSON.parse(e.value) : e.value;
  }
  async put(key, value, opts = {}) {
    this.map.set(key, { value, metadata: opts.metadata ?? null });
  }
  async delete(key) {
    this.map.delete(key);
  }
  async list({ prefix = "" } = {}) {
    const keys = [...this.map.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([name, e]) => ({ name, metadata: e.metadata }));
    return { keys, list_complete: true };
  }
}

async function makeEnv() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  return {
    KV: new MemoryKV(),
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8080`,
    VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url"),
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    VAPID_SUBJECT: `${ORIGIN}/handball-favoriten/`,
  };
}

test("Proxy lässt nur die eigene App und nur nuLiga-HVNB durch", async () => {
  const env = await makeEnv();
  const call = (url, origin) =>
    worker.fetch(new Request(`https://w.example/proxy?url=${encodeURIComponent(url)}`, { headers: origin ? { Origin: origin } : {} }), env);

  assert.equal((await call("https://hvnb-handball.liga.nu/cgi-bin/WebObjects/nuLigaHBDE.woa/wa/groupPage?x=1")).status, 403);
  assert.equal((await call("https://example.com/", ORIGIN)).status, 400);
  assert.equal((await call("https://hvnb-handball.liga.nu/cgi-bin/WebObjects/nuLigaHBDE.woa/wa/login", ORIGIN)).status, 400);
});

test("Cron erkennt eine Spielverlegung und schickt eine Push-Mitteilung", { skip: !html && "Fixtures fehlen" }, async (t) => {
  const env = await makeEnv();
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
    keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
  };

  let nuligaHtml = html;
  const pushes = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://hvnb-handball.liga.nu/")) return new Response(nuligaHtml, { status: 200 });
    if (url.startsWith("https://fcm.googleapis.com/")) {
      pushes.push({ url, headers: init.headers, body: init.body });
      return new Response(null, { status: 201 });
    }
    throw new Error("unerwarteter fetch: " + url);
  });

  const put = await worker.fetch(
    new Request("https://w.example/subscription", {
      method: "PUT",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ subscription, teams: [{ teamtable: "2227521", championship: "HRBN 26/27", group: "489041" }] }),
    }),
    env
  );
  assert.equal(put.status, 200);

  // Zeitpunkt weit weg von allen Anpfiffzeiten, damit keine Erinnerung dazwischenfunkt.
  const now = Date.UTC(2026, 9, 1, 3, 0);
  const first = await runScheduled(env, now);
  assert.equal(first.fetched, 1);
  assert.equal(pushes.length, 0, "beim ersten Laden keine Mitteilung");
  assert.ok(await env.KV.get("team:2227521|HRBN 26/27|489041"));

  // nuLiga verlegt das Spiel 15010 (falls vorhanden) bzw. das erste offene Spiel auf 16:30 Uhr.
  const snapshot = await env.KV.get("team:2227521|HRBN 26/27|489041", "json");
  const open = snapshot.matches.find((m) => m.homeScore == null && m.time);
  assert.ok(open, "kein offenes Spiel im Fixture");
  const rowStart = nuligaHtml.indexOf(`> ${open.matchNumber} <`) !== -1 ? nuligaHtml.indexOf(`> ${open.matchNumber} <`) : nuligaHtml.search(new RegExp(`>\\s*${open.matchNumber}\\s*<`));
  const before = nuligaHtml.slice(0, rowStart);
  const timeIdx = before.lastIndexOf(open.time);
  nuligaHtml = nuligaHtml.slice(0, timeIdx) + "16:30" + nuligaHtml.slice(timeIdx + open.time.length);

  const second = await runScheduled(env, now + 15 * 60e3);
  assert.equal(second.pushes, 1);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].headers["Content-Encoding"], "aes128gcm");
  assert.match(pushes[0].headers.Authorization, /^vapid t=/);

  const payload = JSON.parse(
    ece.decrypt(Buffer.from(pushes[0].body), { version: "aes128gcm", privateKey: ua, authSecret: subscription.keys.auth }).toString()
  );
  assert.match(payload.title, /^Spielplanänderung: HG Jever\/Schortens/);
  assert.match(payload.body, new RegExp(`Uhrzeit: ${open.time} Uhr → 16:30 Uhr`));
  assert.equal(payload.teamId, "hvnb-handball.liga.nu:2227521:HRBN 26/27:489041");

  // Dritter Lauf ohne Änderung -> keine weitere Mitteilung.
  await runScheduled(env, now + 30 * 60e3);
  assert.equal(pushes.length, 1);
});

test("jedes Gerät arbeitet autark: eigene Favoriten, eigene Mitteilungen, Ausfall betrifft nur sich selbst", { skip: !html && "Fixtures fehlen" }, async (t) => {
  const env = await makeEnv();
  const TEAM_1 = { teamtable: "2227521", championship: "HRBN 26/27", group: "489041" };
  const TEAM_2 = { teamtable: "9999999", championship: "HRBN 26/27", group: "489041" };
  const key = (x) => `team:${x.teamtable}|${x.championship}|${x.group}`;

  // Gespeicherter Stand: bei beiden Teams war ein offenes Spiel früher um 09:00.
  const current = parseTeamPortraitHtml(html);
  const open = current.matches.find((m) => m.homeScore == null && m.time);
  const old = { ...current, matches: current.matches.map((m) => (m.matchNumber === open.matchNumber ? { ...m, time: "09:00" } : m)) };
  await env.KV.put(key(TEAM_1), JSON.stringify(old));
  await env.KV.put(key(TEAM_2), JSON.stringify(old));

  const devices = {};
  for (const [name, teams] of [["A", [TEAM_1]], ["B", [TEAM_1, TEAM_2]], ["C", [TEAM_2]], ["D", []]]) {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const subscription = {
      endpoint: `https://fcm.googleapis.com/fcm/send/device-${name}`,
      keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    };
    devices[name] = { ua, auth, subscription, received: [] };
    const res = await worker.fetch(
      new Request("https://w.example/subscription", {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ subscription, teams }),
      }),
      env
    );
    assert.equal(res.status, 200);
  }

  // Gerät A wurde deinstalliert -> sein Push-Dienst antwortet 410.
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://hvnb-handball.liga.nu/")) return new Response(html, { status: 200 });
    const name = url.split("device-")[1];
    const dev = devices[name];
    if (name === "A") return new Response(null, { status: 410 });
    const payload = JSON.parse(
      ece.decrypt(Buffer.from(init.body), { version: "aes128gcm", privateKey: dev.ua, authSecret: dev.subscription.keys.auth }).toString()
    );
    dev.received.push(payload.teamId);
    return new Response(null, { status: 201 });
  });

  await runScheduled(env, Date.UTC(2026, 9, 1, 3, 0));

  const id1 = "hvnb-handball.liga.nu:2227521:HRBN 26/27:489041";
  const id2 = "hvnb-handball.liga.nu:9999999:HRBN 26/27:489041";
  assert.deepEqual(devices.B.received.sort(), [id1, id2].sort(), "B folgt beiden Teams");
  assert.deepEqual(devices.C.received, [id2], "C bekommt nur sein Team");
  assert.deepEqual(devices.D.received, [], "D ohne Favoriten bekommt nichts");

  const subs = (await env.KV.list({ prefix: "sub:" })).keys;
  assert.equal(subs.length, 3, "nur das ausgefallene Gerät A wurde entfernt");

  // C schaltet Mitteilungen aus -> B bleibt unberührt.
  await worker.fetch(
    new Request("https://w.example/subscription", {
      method: "DELETE",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: devices.C.subscription.endpoint }),
    }),
    env
  );
  const left = (await env.KV.list({ prefix: "sub:" })).keys.map((k) => k.metadata.t.length).sort();
  assert.deepEqual(left, [0, 2], "B (2 Teams) und D (0 Teams) sind noch da");
});

test("VAPID-Secret mit BOM/Zeilenumbruch wird trotzdem gelesen", async () => {
  const env = await makeEnv();
  const withBom = { ...env, VAPID_PRIVATE_JWK: "﻿" + env.VAPID_PRIVATE_JWK + "\r\n" };
  assert.equal(vapidFromEnv(withBom).privateJwk.kty, "EC");
  assert.throws(() => vapidFromEnv({ ...env, VAPID_PRIVATE_JWK: "kaputt" }), /kein gültiges JSON/);
});

test("abgelaufenes Push-Abo wird gelöscht", { skip: !html && "Fixtures fehlen" }, async (t) => {
  const env = await makeEnv();
  const start = Date.UTC(2026, 9, 1, 3, 0);
  // Snapshot so anlegen, dass ein Spiel in 110 Minuten beginnt -> Erinnerung fällig.
  const kickoff = new Date(start + 110 * 60e3);
  const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }).format(kickoff);
  const [date, time] = berlin.split(" ");
  await env.KV.put(
    "team:1|HRBN 26/27|2",
    JSON.stringify({ displayName: "Test", matches: [{ matchNumber: "1", date, time, homeTeam: "A", awayTeam: "B", homeScore: null, awayScore: null }] })
  );
  await env.KV.put("sub:dead", JSON.stringify({ subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/dead", keys: { p256dh: createECDH("prime256v1").generateKeys("base64url"), auth: randomBytes(16).toString("base64url") } } }), {
    metadata: { t: ["1|HRBN 26/27|2"] },
  });
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://fcm.googleapis.com/")) return new Response(null, { status: 410 });
    return new Response("<html></html>", { status: 200 });
  });
  const stats = await runScheduled(env, start);
  assert.equal(stats.pushes, 1);
  assert.equal(await env.KV.get("sub:dead"), null);
});
