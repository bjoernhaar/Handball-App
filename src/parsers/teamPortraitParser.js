import { clean, linesByBr, directTds, queryParam } from "./htmlTextUtils.js";

/**
 * Parst eine teamPortrait-Seite: Vereins-/Liganamen aus der <h1>, den
 * Saison-Kalenderlink und den kompletten Spielplan.
 *
 * Die <h1> hat immer 3 Zeilen (per <br> getrennt):
 *   1. Staffelname (z.B. "HR Bremen-Nordsee 2026/27")
 *   2. Liganame    (z.B. "Landesliga männliche Jugend B")
 *   3. Mannschaftsname (z.B. "HG Jever/Schortens 1. männliche Jugend B")
 *
 * @param {Document} doc
 * @param {string} pageUrl - absolute URL der geladenen Seite (zum Auflösen relativer Links)
 */
export function parseTeamPortrait(doc, pageUrl) {
  const h1 = doc.querySelector("h1");
  const lines = h1 ? linesByBr(h1) : [];
  const championship = lines[0] || "";
  const leagueName = lines[1] || "";
  const displayName = lines[2] || "";

  // Der Vereinsname (für den "eigenes Team"-Abgleich) steht in der ersten
  // result-set-Tabelle in der Zeile "Verein" als Linktext zu clubInfoDisplay.
  let clubName = displayName;
  const clubLink = Array.from(doc.querySelectorAll("a")).find((a) =>
    /clubInfoDisplay/i.test(a.getAttribute("href") || "")
  );
  if (clubLink) clubName = clean(clubLink.textContent);

  // Kalenderlinks: nuLiga bietet denselben Endpunkt einmal als https (Download)
  // und einmal als webcal:// (Live-Abo) an.
  let icsDownloadUrl = null;
  let icsWebcalUrl = null;
  for (const a of Array.from(doc.querySelectorAll("a"))) {
    const href = a.getAttribute("href");
    if (!href) continue;
    if (a.className.includes("picto-ical-add") || href.startsWith("https://") && /getTeamMeetingsWebcal/i.test(href)) {
      icsDownloadUrl = new URL(href, pageUrl).toString();
    } else if (a.className.includes("picto-ical-download") || href.startsWith("webcal://")) {
      icsWebcalUrl = href;
    }
  }

  const matches = parseSchedule(doc, pageUrl);

  return { championship, leagueName, displayName, clubName, icsDownloadUrl, icsWebcalUrl, matches };
}

function parseSchedule(doc, pageUrl) {
  // Die Spielplan-Tabelle wird über die Kopfzeile "Heimmannschaft" gefunden,
  // nicht über eine feste Position - die Seite hat mehrere result-set-Tabellen.
  let table = null;
  for (const th of Array.from(doc.querySelectorAll("th"))) {
    if (clean(th.textContent) === "Heimmannschaft") {
      table = th.closest("table");
      break;
    }
  }
  if (!table) return [];

  // Achtung: nuLiga setzt die Kopfzeile OHNE eigenes <thead> direkt als
  // erste <tr> in den <tbody> - diese taucht hier also mit auf und hat 0
  // <td>-Zellen (nur <th>), wird also durch die Mindestlängen-Prüfung unten
  // automatisch übersprungen.
  const rows = Array.from(table.querySelectorAll("tr"));
  const matches = [];

  for (const row of rows) {
    const cells = directTds(row);
    if (cells.length < 8) continue; // Kopf-/Trennzeile ohne echte Spieldaten

    const dayOfWeek = clean(cells[0].textContent) || null;
    const dateRaw = clean(cells[1].textContent);
    const timeRaw = clean(cells[2].textContent);

    const venueSpan = cells[3].querySelector("span[title]");
    const venueName = venueSpan ? clean(venueSpan.getAttribute("title")) : null;
    const venueLink = cells[3].querySelector("a");
    const venueLocationId = venueLink ? queryParam(venueLink.getAttribute("href"), "location", pageUrl) : null;

    const matchNumber = clean(cells[4].textContent);
    const homeTeam = clean(cells[5].textContent);
    const awayTeam = clean(cells[6].textContent);

    let homeScore = null;
    let awayScore = null;
    let halftimeInfo = null;
    let meetingId = null;
    const resultLink = cells[7].querySelector("a");
    if (resultLink) {
      meetingId = queryParam(resultLink.getAttribute("href"), "meeting", pageUrl);
      const scoreSpan = resultLink.querySelector("span[title]");
      const scoreText = clean(scoreSpan ? scoreSpan.textContent : resultLink.textContent);
      const scoreMatch = scoreText.match(/^(\d+):(\d+)$/);
      if (scoreMatch) {
        homeScore = parseInt(scoreMatch[1], 10);
        awayScore = parseInt(scoreMatch[2], 10);
      }
      if (scoreSpan) halftimeInfo = clean(scoreSpan.getAttribute("title"));
    }

    const dateMatch = dateRaw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;
    const timeMatch = timeRaw.match(/(\d{1,2}):(\d{2})/);
    const time = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : null;

    if (!matchNumber && !homeTeam && !awayTeam) continue;

    matches.push({
      matchNumber,
      dayOfWeek,
      date,
      time,
      venueName,
      venueLocationId,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      halftimeInfo,
      meetingId,
      resultNotified: false,
      reminderSent: false,
    });
  }

  return matches;
}
