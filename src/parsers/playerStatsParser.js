import { clean, directTds, directThs } from "./htmlTextUtils.js";

/**
 * Parst eine groupMeetingStatistics-Seite (Spieler-Rangliste).
 *
 * WICHTIG: Die Spaltenreihenfolge unterscheidet sich je nach Statistik-Typ
 * (live geprüft am 20.09.2026), z.B.:
 *   playerGoals:          Rang, Spieler, Verein, Tore,          Spiele, ∅ pro Spiel
 *   playerSuspensions:    Rang, Spieler, Verein, ∅ pro Spiel,   Zeitstrafen, 1., 2., 3., Spiele
 *   playerSevenMeterGoals hat GAR KEINE "Spiele"-Spalte.
 * Deshalb werden Spalten grundsätzlich über die Kopfzeilen-Texte gesucht,
 * nie über eine feste Position.
 *
 * @param {Document} doc
 * @param {string} valueLabel - Kopfzeilen-Text der Wertespalte, z.B. "Tore"
 * @returns {import('../data/models.js').PlayerStat[]}
 */
export function parsePlayerStats(doc, valueLabel) {
  const table = doc.querySelector("table.result-set") || findTableByHeaderText(doc, "Spieler");
  if (!table) return [];

  const headerRow = table.querySelector("tr");
  if (!headerRow) return [];
  const headers = directThs(headerRow).map((th) => clean(th.textContent));

  const idxRank = headers.indexOf("Rang");
  const idxPlayer = headers.indexOf("Spieler");
  const idxClub = headers.indexOf("Verein");
  const idxValue = headers.indexOf(valueLabel);
  const idxMatches = headers.indexOf("Spiele");
  const idxAverage = headers.findIndex((h) => h.startsWith("∅")); // "∅ ..."

  if (idxPlayer === -1 || idxClub === -1 || idxValue === -1) return [];

  const rows = Array.from(table.querySelectorAll("tr"));
  const result = [];

  for (const row of rows) {
    const cells = directTds(row);
    if (cells.length <= Math.max(idxPlayer, idxClub, idxValue)) continue;

    const playerName = clean(cells[idxPlayer]?.textContent);
    if (!playerName) continue;

    result.push({
      rank: idxRank >= 0 ? clean(cells[idxRank]?.textContent) : "",
      playerName,
      club: clean(cells[idxClub]?.textContent),
      value: clean(cells[idxValue]?.textContent),
      matchesPlayed: idxMatches >= 0 ? clean(cells[idxMatches]?.textContent) : null,
      average: idxAverage >= 0 ? clean(cells[idxAverage]?.textContent) : null,
    });
  }

  return result;
}

function findTableByHeaderText(doc, headerText) {
  for (const th of Array.from(doc.querySelectorAll("th"))) {
    if (clean(th.textContent) === headerText) return th.closest("table");
  }
  return null;
}
