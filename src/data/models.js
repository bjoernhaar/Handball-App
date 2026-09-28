// Gemeinsame Datentypen (als JSDoc dokumentiert, JS braucht keine echten
// Typdeklarationen) und die Definition der 5 Spielerstatistik-Typen.
//
// Die urlParam-Werte und label-Texte wurden am 20.09.2026 gegen die echte
// HVNB-nuLiga-Seite geprüft (siehe README "Architektur").

/**
 * @typedef {Object} FavoriteTeam
 * @property {string} id                 - `${host}:${teamtable}:${championship}:${group}`
 * @property {string} host
 * @property {string} teamtable
 * @property {string} championship
 * @property {string} group
 * @property {string} displayName        - z.B. "HG Jever/Schortens 1. männliche Jugend B"
 * @property {string} leagueName         - z.B. "Landesliga männliche Jugend B"
 * @property {string} clubName           - für den "eigenes Team"-Abgleich in Tabelle/Statistik
 * @property {string|null} icsDownloadUrl - https-Link auf die Saison-ICS-Datei
 * @property {string|null} icsWebcalUrl   - derselbe Link mit webcal://-Schema
 * @property {number} sortOrder
 * @property {number} addedAt            - Epoch-Millis
 * @property {number|null} lastSyncedAt  - Epoch-Millis
 */

/**
 * @typedef {Object} Match
 * @property {string} matchNumber
 * @property {string|null} dayOfWeek     - "Sa", "So", ...
 * @property {string|null} date          - ISO yyyy-MM-dd
 * @property {string|null} time          - HH:mm
 * @property {string|null} venueName
 * @property {string|null} venueLocationId
 * @property {string} homeTeam
 * @property {string} awayTeam
 * @property {number|null} homeScore
 * @property {number|null} awayScore
 * @property {string|null} halftimeInfo  - z.B. "9:10 zur Halbzeit"
 * @property {string|null} meetingId
 * @property {boolean} reminderSent
 * @property {{at: number, changes: Array<{field: string, label: string, from: any, to: any}>}|null} lastChange
 *           - letzte erkannte Spielplanänderung (für den "geändert"-Hinweis)
 */

/**
 * @typedef {Object} TableRow
 * @property {number} rank
 * @property {string} teamName
 * @property {string|null} teamtable
 * @property {number} played
 * @property {number} wins
 * @property {number} draws
 * @property {number} losses
 * @property {number} goalsFor
 * @property {number} goalsAgainst
 * @property {number} pointsFor
 * @property {number} pointsAgainst
 */

/**
 * @typedef {Object} PlayerStat
 * @property {string} rank
 * @property {string} playerName
 * @property {string} club
 * @property {string} value
 * @property {string|null} matchesPlayed
 * @property {string|null} average
 */

/**
 * @typedef {Object} Venue
 * @property {string} name
 * @property {string|null} street
 * @property {string|null} zipCity
 * @property {string|null} phone
 * @property {string|null} mapsUrl - direkt von nuLiga übernommener Google-Maps-Routenlink
 */

export const PLAYER_STAT_TYPES = [
  { key: "goals", urlParam: "playerGoals", label: "Tore", valueLabel: "Tore" },
  { key: "sevenMeterGoals", urlParam: "playerSevenMeterGoals", label: "7m-Tore", valueLabel: "7m-Tore" },
  { key: "suspensions", urlParam: "playerSuspensions", label: "Zeitstrafen", valueLabel: "Zeitstrafen" },
  { key: "yellowCards", urlParam: "playerYellowCards", label: "Gelbe Karten", valueLabel: "Gelbe Karten" },
  { key: "redCards", urlParam: "playerRedCards", label: "Rote Karten", valueLabel: "Rote Karten" },
];

/** Schlüssel, unter dem die Mannschaftsstatistik (groupAndTeams) neben den Spielerstatistiken liegt. */
export const TEAM_STATS_KEY = "teams";

export function favoriteTeamId(host, teamtable, championship, group) {
  return `${host}:${teamtable}:${championship}:${group}`;
}
