// Speichert Favoriten/Spielpläne/Tabellen/Statistiken (via storage.js,
// IndexedDB) und bündelt die Lade-/Abgleichslogik gegen nuLiga. Identisch
// zur Chrome-Erweiterungs-Version - einzige Änderung: chrome.storage.local
// wurde durch storage.js (IndexedDB) ersetzt, siehe dort.

import { storage } from "./storage.js";
import { fetchDocument } from "../nuligaClient.js";
import {
  HVNB_HOST,
  parseTeamPortraitLink,
  buildTeamPortraitUrl,
  buildGroupPageUrl,
  buildPlayerStatsUrl,
  buildCourtInfoUrl,
  buildClubSearchUrl,
  buildClubTeamsUrl,
} from "../parsers/nuligaUrlParser.js";
import { parseTeamPortrait } from "../parsers/teamPortraitParser.js";
import { parseGroupTable } from "../parsers/groupTableParser.js";
import { parsePlayerStats } from "../parsers/playerStatsParser.js";
import { parseTeamStats } from "../parsers/teamStatsParser.js";
import { parseVenue } from "../parsers/venueParser.js";
import { parseClubSearch, parseClubTeams, findClubTeamRow } from "../parsers/clubParsers.js";
import { PLAYER_STAT_TYPES, TEAM_STATS_KEY, favoriteTeamId } from "./models.js";
import { diffMatches, matchesStartingBetween, EVENT_TYPES, REMINDER_LEAD_MINUTES } from "../shared/matchEvents.js";

const KEYS = {
  favorites: "favorites",
  matches: "matches",
  table: "table",
  playerStats: "playerStats",
  venues: "venues",
};

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

/** @returns {Promise<{group: object|null, teams: object[]}>} */
export async function getTeamStats(id) {
  const map = await getAll(KEYS.playerStats);
  return (map[id] && map[id][TEAM_STATS_KEY]) || { group: null, teams: [] };
}

export function teamIdFor(teamtable, championship, group) {
  return favoriteTeamId(HVNB_HOST, teamtable, championship, group);
}

// ---------------------------------------------------------------------------
// Mannschaftssuche: Verein suchen -> Mannschaften des Vereins -> Mannschaft
// in der Staffeltabelle finden (dort steht die teamtable-ID).
// ---------------------------------------------------------------------------

export async function searchClubs(query) {
  const url = buildClubSearchUrl(query);
  const { doc, url: pageUrl } = await fetchDocument(url);
  return parseClubSearch(doc, pageUrl);
}

export async function getClubTeams(clubId) {
  const { doc, url } = await fetchDocument(buildClubTeamsUrl(clubId));
  return parseClubTeams(doc, url);
}

/**
 * @returns {Promise<{row: object|null, rows: object[]}>} row = eindeutig gefundene
 *   Mannschaft; sonst null und rows = alle Mannschaften der Staffel zur Auswahl.
 */
export async function resolveClubTeam(clubName, clubTeam) {
  const { doc, url } = await fetchDocument(buildGroupPageUrl(HVNB_HOST, clubTeam.championship, clubTeam.group));
  const rows = parseGroupTable(doc, url).filter((r) => r.teamtable);
  return { row: findClubTeamRow(rows, clubName, clubTeam.teamLabel), rows };
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
  return addFavorite(parsed);
}

/** Fügt ein Team hinzu (aus der Suche oder aus einem Link). */
export async function addFavorite({ host = HVNB_HOST, teamtable, championship, group }) {
  const id = favoriteTeamId(host, teamtable, championship, group);
  const favorites = await getAll(KEYS.favorites);
  if (favorites[id]) {
    throw new Error("Dieses Team ist bereits als Favorit gespeichert.");
  }

  const [{ doc, url }, extras] = await Promise.all([
    fetchDocument(buildTeamPortraitUrl(host, teamtable, championship, group)),
    // Tabelle & Statistiken best-effort - ein Fehler hier soll das
    // Hinzufügen des Favoriten nicht scheitern lassen.
    loadTableAndStats({ host, championship, group }).catch((err) => {
      console.warn("Tabelle/Statistik konnten beim Hinzufügen nicht geladen werden:", err);
      return null;
    }),
  ]);
  const portrait = parseTeamPortrait(doc, url);
  if (!portrait.displayName && portrait.matches.length === 0) {
    throw new Error("Diese Mannschaft wurde bei nuLiga nicht gefunden.");
  }

  return serialized(async () => {
    const favorites = await getAll(KEYS.favorites);
    const now = Date.now();
    const team = {
      id,
      host,
      teamtable,
      championship,
      group,
      displayName: portrait.displayName || teamtable,
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
    matchesMap[id] = portrait.matches.map((m) => ({ ...m, lastChange: null }));
    await setAll(KEYS.matches, matchesMap);

    if (extras) await saveTableAndStats(id, extras);
    return team;
  });
}

export function removeFavorite(id) {
  return serialized(async () => {
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
  });
}

// Alle Favoriten liegen jeweils in EINEM Speicher-Eintrag (favorites,
// matches, ...). Damit sich parallele Aktualisierungen nicht gegenseitig
// überschreiben, laufen alle Lese-Ändere-Schreibe-Abschnitte nacheinander -
// die Netzwerkabrufe davor dürfen weiterhin parallel laufen.
let writeQueue = Promise.resolve();
function serialized(fn) {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.catch(() => {});
  return result;
}

/** Nur Netzwerk: Tabelle, 5 Spielerstatistiken und Mannschaftsstatistik der Staffel. */
async function loadTableAndStats({ host, championship, group }) {
  const loadStats = async (displayType, parse, fallback) => {
    try {
      const { doc } = await fetchDocument(buildPlayerStatsUrl(host, championship, group, displayType));
      return parse(doc);
    } catch (err) {
      console.warn(`Statistik "${displayType}" konnte nicht geladen werden:`, err);
      return fallback;
    }
  };
  const statsByType = {};
  const [tableRows] = await Promise.all([
    fetchDocument(buildGroupPageUrl(host, championship, group)).then(({ doc, url }) => parseGroupTable(doc, url)),
    ...PLAYER_STAT_TYPES.map(async (statType) => {
      statsByType[statType.key] = await loadStats(statType.urlParam, (doc) => parsePlayerStats(doc, statType.valueLabel), []);
    }),
    (async () => {
      statsByType[TEAM_STATS_KEY] = await loadStats("groupAndTeams", parseTeamStats, { group: null, teams: [] });
    })(),
  ]);
  return { tableRows, statsByType };
}

/** Nur innerhalb von serialized() aufrufen. */
async function saveTableAndStats(id, { tableRows, statsByType }) {
  const tableMap = await getAll(KEYS.table);
  tableMap[id] = tableRows;
  await setAll(KEYS.table, tableMap);
  const statsMap = await getAll(KEYS.playerStats);
  statsMap[id] = statsByType;
  await setAll(KEYS.playerStats, statsMap);
}

/**
 * Lädt Spielplan, Tabelle und Statistiken eines Favoriten neu und ermittelt
 * per src/shared/matchEvents.js (identisch zum Worker), was sich geändert hat:
 * Spielplanänderungen, neue/entfallene Spiele, neue Ergebnisse und Spiele,
 * die bald beginnen.
 *
 * @returns {Promise<{team: import('./models.js').FavoriteTeam, events: Array}>}
 */
export async function refreshTeam(id) {
  const known = await getFavorite(id);
  if (!known) throw new Error(`Favorit ${id} existiert nicht (mehr).`);

  const url = buildTeamPortraitUrl(known.host, known.teamtable, known.championship, known.group);
  const [{ doc, url: resolvedUrl }, extras] = await Promise.all([
    fetchDocument(url),
    loadTableAndStats(known).catch((err) => {
      console.warn("Tabelle/Statistik konnten beim Sync nicht aktualisiert werden:", err);
      return null;
    }),
  ]);
  const portrait = parseTeamPortrait(doc, resolvedUrl);

  return serialized(() => mergeRefresh(id, portrait, extras));
}

async function mergeRefresh(id, portrait, extras) {
  const favorites = await getAll(KEYS.favorites);
  const team = favorites[id];
  if (!team) throw new Error(`Favorit ${id} wurde inzwischen entfernt.`);

  const matchesMap = await getAll(KEYS.matches);
  const previousMatches = matchesMap[id] || [];
  const previousByNumber = new Map(previousMatches.map((m) => [m.matchNumber, m]));
  const now = Date.now();

  const events = diffMatches(previousMatches, portrait.matches);
  const changesByNumber = new Map(
    events.filter((e) => e.type === EVENT_TYPES.changed).map((e) => [e.match.matchNumber, e.changes])
  );

  const mergedMatches = portrait.matches.map((incoming) => {
    const previous = previousByNumber.get(incoming.matchNumber);
    const changes = changesByNumber.get(incoming.matchNumber);
    return {
      ...incoming,
      reminderSent: previous ? !!previous.reminderSent : false,
      lastChange: changes ? { at: now, changes } : (previous && previous.lastChange) || null,
    };
  });

  const soon = matchesStartingBetween(
    mergedMatches.filter((m) => !m.reminderSent),
    now,
    0,
    REMINDER_LEAD_MINUTES
  );
  for (const match of soon) {
    match.reminderSent = true;
    events.push({ type: EVENT_TYPES.reminder, match });
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

  if (extras) await saveTableAndStats(id, extras);
  return { team, events };
}

/** Aktualisiert alle Favoriten (Abrufe parallel, Speichern nacheinander). */
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

export function reorderFavorites(orderedIds) {
  return serialized(async () => {
    const favorites = await getAll(KEYS.favorites);
    orderedIds.forEach((id, index) => {
      if (favorites[id]) favorites[id].sortOrder = index;
    });
    await setAll(KEYS.favorites, favorites);
  });
}
