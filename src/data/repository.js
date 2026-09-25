// Speichert Favoriten/Spielpläne/Tabellen/Statistiken (via storage.js,
// IndexedDB) und bündelt die Lade-/Abgleichslogik gegen nuLiga. Identisch
// zur Chrome-Erweiterungs-Version - einzige Änderung: chrome.storage.local
// wurde durch storage.js (IndexedDB) ersetzt, siehe dort.

import { storage } from "./storage.js";
import { fetchDocument } from "../nuligaClient.js";
import {
  parseTeamPortraitLink,
  buildTeamPortraitUrl,
  buildGroupPageUrl,
  buildPlayerStatsUrl,
  buildCourtInfoUrl,
} from "../parsers/nuligaUrlParser.js";
import { parseTeamPortrait } from "../parsers/teamPortraitParser.js";
import { parseGroupTable } from "../parsers/groupTableParser.js";
import { parsePlayerStats } from "../parsers/playerStatsParser.js";
import { parseVenue } from "../parsers/venueParser.js";
import { PLAYER_STAT_TYPES, favoriteTeamId } from "./models.js";

const KEYS = {
  favorites: "favorites",
  matches: "matches",
  table: "table",
  playerStats: "playerStats",
  venues: "venues",
};

/** Ein Spiel gilt als "bald beginnend", wenn es innerhalb dieses Fensters liegt. */
const UPCOMING_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 Stunden, wie in der Android-Version

async function getAll(key) {
  const result = await storage.get(key);
  return result[key] || {};
}

async function setAll(key, value) {
  await storage.set({ [key]: value });
}

/** @returns {Promise<import('./models.js').FavoriteTeam[]>} sortiert nach sortOrder */
export async function getFavorites() {
  const map = await getAll(KEYS.favorites);
  return Object.values(map).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getFavorite(id) {
  const map = await getAll(KEYS.favorites);
  return map[id] || null;
}

export async function getMatches(id) {
  const map = await getAll(KEYS.matches);
  return map[id] || [];
}

export async function getTable(id) {
  const map = await getAll(KEYS.table);
  return map[id] || [];
}

export async function getPlayerStats(id, statKey) {
  const map = await getAll(KEYS.playerStats);
  return (map[id] && map[id][statKey]) || [];
}

/**
 * Fügt ein Team anhand eines eingefügten/geteilten teamPortrait-Links hinzu.
 * Wirft einen Error mit einer für die UI verständlichen deutschen Meldung,
 * wenn der Link ungültig ist oder das Team schon Favorit ist.
 */
export async function addFavoriteFromUrl(rawInput) {
  const parsed = parseTeamPortraitLink(rawInput);
  if (!parsed) {
    throw new Error(
      "Das sieht nicht nach einem nuLiga-Mannschaftsportrait-Link aus. Bitte den Link der teamPortrait-Seite einfügen."
    );
  }

  const id = favoriteTeamId(parsed.host, parsed.teamtable, parsed.championship, parsed.group);
  const favorites = await getAll(KEYS.favorites);
  if (favorites[id]) {
    throw new Error("Dieses Team ist bereits als Favorit gespeichert.");
  }

  const { doc, url } = await fetchDocument(parsed.normalizedUrl);
  const portrait = parseTeamPortrait(doc, url);

  const now = Date.now();
  const team = {
    id,
    host: parsed.host,
    teamtable: parsed.teamtable,
    championship: parsed.championship,
    group: parsed.group,
    displayName: portrait.displayName || parsed.teamtable,
    leagueName: portrait.leagueName,
    clubName: portrait.clubName,
    icsDownloadUrl: portrait.icsDownloadUrl,
    icsWebcalUrl: portrait.icsWebcalUrl,
    sortOrder: Object.keys(favorites).length,
    addedAt: now,
    lastSyncedAt: now,
  };

  favorites[id] = team;
  await setAll(KEYS.favorites, favorites);

  const matchesMap = await getAll(KEYS.matches);
  matchesMap[id] = portrait.matches;
  await setAll(KEYS.matches, matchesMap);

  // Tabelle & Statistiken best-effort nachladen - ein Fehler hier soll das
  // Hinzufügen des Favoriten nicht scheitern lassen.
  try {
    await refreshTableAndStats(team);
  } catch (err) {
    console.warn("Tabelle/Statistik konnten beim Hinzufügen nicht geladen werden:", err);
  }

  return team;
}

export async function removeFavorite(id) {
  const [favorites, matches, table, playerStats] = await Promise.all([
    getAll(KEYS.favorites),
    getAll(KEYS.matches),
    getAll(KEYS.table),
    getAll(KEYS.playerStats),
  ]);
  delete favorites[id];
  delete matches[id];
  delete table[id];
  delete playerStats[id];
  await Promise.all([
    setAll(KEYS.favorites, favorites),
    setAll(KEYS.matches, matches),
    setAll(KEYS.table, table),
    setAll(KEYS.playerStats, playerStats),
  ]);
}

async function refreshTableAndStats(team) {
  const groupUrl = buildGroupPageUrl(team.host, team.championship, team.group);
  const { doc: groupDoc, url: groupPageUrl } = await fetchDocument(groupUrl);
  const tableRows = parseGroupTable(groupDoc, groupPageUrl);
  const tableMap = await getAll(KEYS.table);
  tableMap[team.id] = tableRows;
  await setAll(KEYS.table, tableMap);

  const statsByType = {};
  for (const statType of PLAYER_STAT_TYPES) {
    const statsUrl = buildPlayerStatsUrl(team.host, team.championship, team.group, statType.urlParam);
    try {
      const { doc: statsDoc } = await fetchDocument(statsUrl);
      statsByType[statType.key] = parsePlayerStats(statsDoc, statType.valueLabel);
    } catch (err) {
      console.warn(`Statistik "${statType.label}" konnte nicht geladen werden:`, err);
      statsByType[statType.key] = [];
    }
  }
  const statsMap = await getAll(KEYS.playerStats);
  statsMap[team.id] = statsByType;
  await setAll(KEYS.playerStats, statsMap);
}

/**
 * Lädt Spielplan, Tabelle und Statistiken eines Favoriten neu und ermittelt,
 * welche Spiele neu ein Ergebnis bekommen haben bzw. bald beginnen (für
 * Benachrichtigungen). Bereits gesetzte resultNotified/reminderSent-Flags
 * bleiben über den Abgleich per matchNumber erhalten.
 *
 * @returns {Promise<{team: import('./models.js').FavoriteTeam, newlyFinishedMatches: import('./models.js').Match[], soonStartingMatches: import('./models.js').Match[]}>}
 */
export async function refreshTeam(id) {
  const favorites = await getAll(KEYS.favorites);
  const team = favorites[id];
  if (!team) throw new Error(`Favorit ${id} existiert nicht (mehr).`);

  const url = buildTeamPortraitUrl(team.host, team.teamtable, team.championship, team.group);
  const { doc, url: resolvedUrl } = await fetchDocument(url);
  const portrait = parseTeamPortrait(doc, resolvedUrl);

  const matchesMap = await getAll(KEYS.matches);
  const previousMatches = matchesMap[id] || [];
  const previousByNumber = new Map(previousMatches.map((m) => [m.matchNumber, m]));

  const mergedMatches = portrait.matches.map((incoming) => {
    const previous = previousByNumber.get(incoming.matchNumber);
    return {
      ...incoming,
      resultNotified: previous ? previous.resultNotified : false,
      reminderSent: previous ? previous.reminderSent : false,
    };
  });

  const newlyFinishedMatches = [];
  const soonStartingMatches = [];
  const now = Date.now();

  for (const match of mergedMatches) {
    const previous = previousByNumber.get(match.matchNumber);
    const hasResult = match.homeScore != null && match.awayScore != null;
    const hadResultBefore = previous && previous.homeScore != null && previous.awayScore != null;

    if (hasResult && !hadResultBefore && !match.resultNotified) {
      newlyFinishedMatches.push(match);
      match.resultNotified = true;
    }

    if (!hasResult && !match.reminderSent && startsWithinWindow(match, now)) {
      soonStartingMatches.push(match);
      match.reminderSent = true;
    }
  }

  matchesMap[id] = mergedMatches;
  await setAll(KEYS.matches, matchesMap);

  team.displayName = portrait.displayName || team.displayName;
  team.leagueName = portrait.leagueName || team.leagueName;
  team.clubName = portrait.clubName || team.clubName;
  team.icsDownloadUrl = portrait.icsDownloadUrl || team.icsDownloadUrl;
  team.icsWebcalUrl = portrait.icsWebcalUrl || team.icsWebcalUrl;
  team.lastSyncedAt = now;
  favorites[id] = team;
  await setAll(KEYS.favorites, favorites);

  try {
    await refreshTableAndStats(team);
  } catch (err) {
    console.warn("Tabelle/Statistik konnten beim Sync nicht aktualisiert werden:", err);
  }

  return { team, newlyFinishedMatches, soonStartingMatches };
}

function startsWithinWindow(match, nowMs) {
  if (!match.date || !match.time) return false;
  const start = new Date(`${match.date}T${match.time}:00`);
  if (Number.isNaN(start.getTime())) return false;
  const diff = start.getTime() - nowMs;
  return diff > 0 && diff <= UPCOMING_WINDOW_MS;
}

/** Aktualisiert alle Favoriten parallel (für den Hintergrund-Sync). */
export async function refreshAllFavorites() {
  const favorites = await getFavorites();
  const outcomes = await Promise.all(
    favorites.map((team) =>
      refreshTeam(team.id).catch((err) => {
        console.warn(`Sync für ${team.displayName} fehlgeschlagen:`, err);
        return null;
      })
    )
  );
  return outcomes.filter(Boolean);
}

/**
 * Lädt die Hallenadresse (gecacht). Federation ist bewusst fest auf HVNB
 * gesetzt (siehe README, "Nur HVNB"-Scope).
 */
export async function getVenue(host, locationId) {
  const venues = await getAll(KEYS.venues);
  if (venues[locationId]) return venues[locationId];

  const url = buildCourtInfoUrl(host, locationId);
  const { doc } = await fetchDocument(url);
  const venue = parseVenue(doc);
  if (venue) {
    venues[locationId] = venue;
    await setAll(KEYS.venues, venues);
  }
  return venue;
}

export async function reorderFavorites(orderedIds) {
  const favorites = await getAll(KEYS.favorites);
  orderedIds.forEach((id, index) => {
    if (favorites[id]) favorites[id].sortOrder = index;
  });
  await setAll(KEYS.favorites, favorites);
}
