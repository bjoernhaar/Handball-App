// Cloudflare Worker für Handball Favoriten - drei Aufgaben:
//
//  1. GET  /proxy?url=...   werbefreier, eigener Proxy zu hvnb-handball.liga.nu
//                           (nuLiga sendet keine CORS-Header, der Browser darf
//                           die Seiten sonst nicht lesen)
//  2. PUT/DELETE /subscription   Push-Abo eines Geräts + dessen Favoriten speichern
//  3. Cron (alle 15 Min.)   Spielpläne aller abonnierten Mannschaften abgleichen
//                           und bei Änderungen Push-Mitteilungen verschicken
//
// Ausgelegt auf den kostenlosen Cloudflare-Tarif: max. 50 ausgehende
// Anfragen pro Aufruf (daher Stapel à BATCH_SIZE Teams) und wenige
// KV-Schreibvorgänge (Snapshots werden nur bei echten Änderungen gespeichert,
// Erinnerungen kommen ganz ohne gespeicherten Zustand aus).

import { validateNuligaUrl, fetchNuliga, teamPortraitUrl, NULIGA_HOST } from "./nuliga.js";
import { parseTeamPortraitHtml } from "./schedule.js";
import { sendPush, isValidSubscription } from "./webpush.js";
import {
  diffMatches,
  matchesStartingBetween,
  describeEvent,
  EVENT_TYPES,
  REMINDER_LEAD_MINUTES,
} from "../../src/shared/matchEvents.js";
import { APP_VERSION } from "../../src/version.js";

const CRON_MINUTES = 15; // muss zu [triggers] crons in wrangler.toml passen
const BATCH_SIZE = 12;
const MAX_SUBREQUESTS = 48;
const MAX_TEAMS_PER_DEVICE = 30;
const METADATA_LIMIT = 1000; // KV erlaubt 1024 Byte Metadaten pro Eintrag

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin) {
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Expose-Headers": "X-Final-Url, X-Upstream-Status",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

async function handleProxy(request, origin) {
  const target = validateNuligaUrl(new URL(request.url).searchParams.get("url") || "");
  if (!target) return json({ error: "Nur Seiten von hvnb-handball.liga.nu sind erlaubt." }, 400, origin);
  try {
    const { status, html, finalUrl } = await fetchNuliga(target);
    return new Response(html, {
      status: status >= 400 ? 502 : 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Final-Url": finalUrl,
        "X-Upstream-Status": String(status),
        ...corsHeaders(origin),
      },
    });
  } catch (err) {
    return json({ error: `nuLiga nicht erreichbar: ${err.message}` }, 502, origin);
  }
}

async function subscriptionKey(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return "sub:" + [...new Uint8Array(digest)].slice(0, 20).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function teamKeyOf(t) {
  return `${t.teamtable}|${t.championship}|${t.group}`;
}

function isValidTeam(t) {
  return (
    t &&
    /^\d{1,12}$/.test(String(t.teamtable)) &&
    /^\d{1,12}$/.test(String(t.group)) &&
    typeof t.championship === "string" &&
    t.championship.length > 0 &&
    t.championship.length <= 60
  );
}

async function handlePutSubscription(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Ungültiges JSON." }, 400, origin);
  }
  if (!isValidSubscription(body.subscription)) return json({ error: "Ungültiges Push-Abo." }, 400, origin);

  const teamKeys = [];
  for (const t of (Array.isArray(body.teams) ? body.teams : []).filter(isValidTeam)) {
    const key = teamKeyOf(t);
    if (teamKeys.includes(key)) continue;
    if (teamKeys.length >= MAX_TEAMS_PER_DEVICE) break;
    if (JSON.stringify({ t: [...teamKeys, key] }).length > METADATA_LIMIT) break;
    teamKeys.push(key);
  }

  const { endpoint, keys } = body.subscription;
  await env.KV.put(await subscriptionKey(endpoint), JSON.stringify({ subscription: { endpoint, keys }, updatedAt: Date.now() }), {
    metadata: { t: teamKeys },
  });
  return json({ ok: true, teams: teamKeys.length }, 200, origin);
}

async function handleDeleteSubscription(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Ungültiges JSON." }, 400, origin);
  }
  if (typeof body.endpoint !== "string") return json({ error: "endpoint fehlt." }, 400, origin);
  await env.KV.delete(await subscriptionKey(body.endpoint));
  return json({ ok: true }, 200, origin);
}

async function handleFetch(request, env) {
  const url = new URL(request.url);
  const origin = allowedOrigin(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
  }
  if (url.pathname === "/") {
    return new Response(`Handball Favoriten - Worker läuft (Version ${APP_VERSION}).`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  // Alles Weitere nur für die eigene App - kein offener Proxy für Dritte.
  if (!origin) return json({ error: "Origin nicht erlaubt." }, 403, null);

  if (url.pathname === "/proxy" && request.method === "GET") return handleProxy(request, origin);
  if (url.pathname === "/config" && request.method === "GET") {
    return json(
      { version: APP_VERSION, vapidPublicKey: env.VAPID_PUBLIC_KEY, reminderLeadMinutes: REMINDER_LEAD_MINUTES },
      200,
      origin
    );
  }
  if (url.pathname === "/subscription" && request.method === "PUT") return handlePutSubscription(request, env, origin);
  if (url.pathname === "/subscription" && request.method === "DELETE") return handleDeleteSubscription(request, env, origin);
  return json({ error: "Nicht gefunden." }, 404, origin);
}

// ---------------------------------------------------------------------------
// Cron-Abgleich
// ---------------------------------------------------------------------------

async function listSubscriptions(env) {
  const subs = [];
  let cursor;
  do {
    const page = await env.KV.list({ prefix: "sub:", cursor });
    for (const k of page.keys) subs.push({ key: k.name, teams: (k.metadata && k.metadata.t) || [] });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return subs;
}

function pickBatch(teamKeys, snapshots, runIndex) {
  const missing = teamKeys.filter((k) => !snapshots.get(k));
  const known = teamKeys.filter((k) => snapshots.get(k));
  const batch = missing.slice(0, BATCH_SIZE);
  if (known.length) {
    const start = (runIndex * BATCH_SIZE) % known.length;
    for (let i = 0; i < known.length && batch.length < BATCH_SIZE; i++) {
      batch.push(known[(start + i) % known.length]);
    }
  }
  return batch;
}

export function vapidFromEnv(env) {
  let privateJwk;
  try {
    // Unsichtbares BOM/Leerraum tolerieren (entsteht z.B. beim Einfügen per PowerShell-Pipe).
    privateJwk = JSON.parse(String(env.VAPID_PRIVATE_JWK || "").replace(/^﻿/, "").trim());
  } catch (err) {
    throw new Error(`Secret VAPID_PRIVATE_JWK ist kein gültiges JSON (${err.message}) - neu setzen, siehe README.`);
  }
  return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk, subject: env.VAPID_SUBJECT };
}

export async function runScheduled(env, scheduledTime) {
  const runIndex = Math.floor(scheduledTime / (CRON_MINUTES * 60000));
  const subs = await listSubscriptions(env);
  const subscribersByTeam = new Map();
  for (const sub of subs) {
    for (const t of sub.teams) {
      if (!subscribersByTeam.has(t)) subscribersByTeam.set(t, []);
      subscribersByTeam.get(t).push(sub.key);
    }
  }
  const teamKeys = [...subscribersByTeam.keys()].sort();
  if (teamKeys.length === 0) return { teams: 0, fetched: 0, pushes: 0 };

  const snapshots = new Map(
    await Promise.all(teamKeys.map(async (k) => [k, await env.KV.get(`team:${k}`, "json")]))
  );

  let subrequests = 0;
  let pushes = 0;
  const vapid = vapidFromEnv(env);
  const subCache = new Map();

  async function pushToSubscribers(teamKey, messages) {
    const subscriberKeys = subscribersByTeam.get(teamKey) || [];
    if (subrequests + subscriberKeys.length * messages.length > MAX_SUBREQUESTS) return false;
    for (const subKey of subscriberKeys) {
      if (!subCache.has(subKey)) subCache.set(subKey, await env.KV.get(subKey, "json"));
      const record = subCache.get(subKey);
      if (!record) continue;
      for (const message of messages) {
        subrequests++;
        try {
          const result = await sendPush(record.subscription, message, vapid);
          pushes++;
          if (result.gone) {
            await env.KV.delete(subKey);
            subCache.set(subKey, null);
            break;
          }
        } catch (err) {
          console.warn("Push fehlgeschlagen:", err.message);
        }
      }
    }
    return true;
  }

  const teamIdOf = (teamKey) => {
    const [teamtable, championship, group] = teamKey.split("|");
    return { teamtable, championship, group, id: `${NULIGA_HOST}:${teamtable}:${championship}:${group}` };
  };

  // 1. Stapel an Teams frisch von nuLiga laden und mit dem Snapshot vergleichen.
  const batch = pickBatch(teamKeys, snapshots, runIndex);
  const pending = [];
  await Promise.all(
    batch.map(async (teamKey) => {
      const team = teamIdOf(teamKey);
      subrequests++;
      try {
        const { status, html } = await fetchNuliga(teamPortraitUrl(team));
        if (status >= 400) return;
        const parsed = parseTeamPortraitHtml(html);
        if (!parsed.displayName && parsed.matches.length === 0) return; // Fehlerseite o.Ä.
        pending.push({ teamKey, team, parsed });
      } catch (err) {
        console.warn(`Abruf ${teamKey} fehlgeschlagen:`, err.message);
      }
    })
  );

  for (const { teamKey, team, parsed } of pending) {
    const previous = snapshots.get(teamKey);
    const next = { displayName: parsed.displayName, leagueName: parsed.leagueName, matches: parsed.matches };
    const events = previous ? diffMatches(previous.matches, next.matches) : [];
    const teamName = next.displayName || (previous && previous.displayName) || "Favorit";
    const messages = events.map((e) => ({ ...describeEvent(e, team.id, teamName), teamId: team.id }));

    const delivered = messages.length === 0 || (await pushToSubscribers(teamKey, messages));
    // Nicht zugestellte Änderungen (Budget erschöpft) werden beim nächsten
    // Lauf erneut erkannt, weil der alte Snapshot dann stehen bleibt.
    if (!delivered) continue;
    const changed =
      !previous ||
      previous.displayName !== next.displayName ||
      JSON.stringify(previous.matches) !== JSON.stringify(next.matches);
    if (changed) await env.KV.put(`team:${teamKey}`, JSON.stringify({ ...next, updatedAt: Date.now() }));
    snapshots.set(teamKey, next);
  }

  // 2. Erinnerungen: jedes Spiel fällt in genau ein 15-Minuten-Fenster vor
  //    Anpfiff - so ist kein "schon erinnert"-Zustand nötig.
  for (const teamKey of teamKeys) {
    const snapshot = snapshots.get(teamKey);
    if (!snapshot) continue;
    const soon = matchesStartingBetween(
      snapshot.matches,
      scheduledTime,
      REMINDER_LEAD_MINUTES - CRON_MINUTES,
      REMINDER_LEAD_MINUTES
    );
    if (!soon.length) continue;
    const team = teamIdOf(teamKey);
    const messages = soon.map((match) => ({
      ...describeEvent({ type: EVENT_TYPES.reminder, match }, team.id, snapshot.displayName || "Favorit"),
      teamId: team.id,
    }));
    await pushToSubscribers(teamKey, messages);
  }

  // 3. Einmal täglich: Snapshots von Teams aufräumen, die niemand mehr verfolgt.
  if (runIndex % Math.round((24 * 60) / CRON_MINUTES) === 0) {
    const active = new Set(teamKeys.map((k) => `team:${k}`));
    const stored = await env.KV.list({ prefix: "team:" });
    for (const k of stored.keys) if (!active.has(k.name)) await env.KV.delete(k.name);
  }

  return { teams: teamKeys.length, fetched: pending.length, pushes };
}

export default {
  fetch: handleFetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runScheduled(env, controller.scheduledTime).then((stats) => console.log("Abgleich:", JSON.stringify(stats)))
    );
  },
};
