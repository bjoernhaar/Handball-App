// Schlanker Spielplan-Parser für teamPortrait-Seiten im Worker.
//
// Im Worker gibt es keinen DOMParser, und das CPU-Budget pro Aufruf ist klein
// - deshalb bewusst Regex statt eines vollständigen HTML-Parsers. Liefert
// dieselben Felder wie src/parsers/teamPortraitParser.js der App (die
// Übereinstimmung wird in worker/test/schedule.test.mjs gegen echte
// nuLiga-Seiten geprüft).

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function cleanText(html) {
  return decodeEntities((html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function attr(html, name) {
  const m = html.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

function queryParamFromHref(href, name) {
  if (!href) return null;
  try {
    return new URL(href, "https://hvnb-handball.liga.nu/").searchParams.get(name);
  } catch {
    return null;
  }
}

/** Die dreizeilige <h1>: Staffel, Liga, Mannschaft. */
function parseHeading(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return { leagueName: "", displayName: "" };
  const lines = m[1].split(/<br\s*\/?>/i).map(cleanText).filter(Boolean);
  return { leagueName: lines[1] || "", displayName: lines[2] || "" };
}

/**
 * @param {string} html - komplette teamPortrait-Seite
 * @returns {{leagueName: string, displayName: string, matches: Array<{matchNumber: string, date: string|null, time: string|null, venueName: string|null, homeTeam: string, awayTeam: string, homeScore: number|null, awayScore: number|null}>}}
 */
export function parseTeamPortraitHtml(html) {
  const heading = parseHeading(html);
  const matches = [];

  const headIdx = html.search(/<th[^>]*>\s*Heimmannschaft\s*<\/th>/i);
  if (headIdx === -1) return { ...heading, matches };
  const tableStart = html.lastIndexOf("<table", headIdx);
  const tableEnd = html.indexOf("</table>", headIdx);
  const table = html.slice(tableStart, tableEnd === -1 ? undefined : tableEnd);

  for (const rowHtml of table.split(/<tr\b/i).slice(1)) {
    // Zellen nach Spaltenposition: colspan=n belegt n Positionen (Rest null),
    // z.B. "Termin offen" über Tag+Datum bei verlegten Spielen.
    const cells = [];
    for (const [, attrs, inner] of rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)) {
      cells.push({ attrs, html: inner });
      const span = parseInt((attrs.match(/colspan="(\d+)"/i) || [])[1] || "1", 10);
      for (let i = 1; i < span; i++) cells.push(null);
    }
    if (cells.length < 8 || !cells[3] || !cells[7]) continue;
    const html_ = (i) => (cells[i] ? cells[i].html : "");

    const dateMatch = cleanText(html_(1)).match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const timeMatch = cleanText(html_(2)).match(/(\d{1,2}):(\d{2})/);
    const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;
    const merged = cells[0] && !cells[1];
    const note =
      [merged ? cleanText(cells[0].html) : "", cells[2] ? cleanText(attr(cells[2].attrs, "title") || "") : ""]
        .filter(Boolean)
        .join(" – ") || null;

    const venueTitle = html_(3).match(/<span[^>]*\btitle="([^"]*)"/i);
    const matchNumber = cleanText(html_(4));
    const homeTeam = cleanText(html_(5));
    const awayTeam = cleanText(html_(6));
    if (!matchNumber && !homeTeam && !awayTeam) continue;

    // Ein Ergebnis zählt nur mit Spielbericht-Link - verlegte Spiele zeigen
    // ohne Link ein "0:0".
    let homeScore = null;
    let awayScore = null;
    const scoreMatch = cleanText(html_(7)).match(/^(\d+):(\d+)$/);
    if (scoreMatch && /<a\b/i.test(html_(7))) {
      homeScore = parseInt(scoreMatch[1], 10);
      awayScore = parseInt(scoreMatch[2], 10);
    }

    matches.push({
      matchNumber,
      date,
      time: timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : null,
      venueName: venueTitle ? cleanText(decodeEntities(venueTitle[1])) || null : null,
      venueLocationId: queryParamFromHref(attr(html_(3), "href"), "location"),
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      note,
    });
  }

  return { ...heading, matches };
}
