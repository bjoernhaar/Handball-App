import { clean, linesByBr } from "./htmlTextUtils.js";

/**
 * Parst eine courtInfo-Seite (Hallenadresse).
 *
 * Struktur (live geprüft 20.09.2026):
 *   <h1>Ort, Hallenname  (ID)<br>Hallenspielplan</h1>
 *   <p>Straße<br>PLZ Ort<br>Tel.: ...<br><br><a href="google.com/maps/dir/...">[Routenplaner...]</a></p>
 *
 * @param {Document} doc
 * @returns {import('../data/models.js').Venue|null}
 */
export function parseVenue(doc) {
  const h1 = doc.querySelector("h1");
  if (!h1) return null;
  const firstLine = linesByBr(h1)[0] || "";
  // Trailing "(12345)"-Hallen-ID vom Namen abtrennen, z.B. "Jever, SZ  (805106)" -> "Jever, SZ"
  const name = clean(firstLine.replace(/\(\d+\)\s*$/, ""));

  const mapsLink = Array.from(doc.querySelectorAll("a")).find((a) =>
    (a.getAttribute("href") || "").includes("google.com/maps")
  );
  const mapsUrl = mapsLink ? mapsLink.getAttribute("href") : null;
  const addressParagraph = mapsLink ? mapsLink.closest("p") : null;

  let street = null;
  let zipCity = null;
  let phone = null;

  if (addressParagraph) {
    const lines = linesByBr(addressParagraph).filter((l) => !/Routenplaner/i.test(l));
    if (lines[0]) street = lines[0];
    if (lines[1]) zipCity = lines[1];
    const phoneLine = lines.find((l) => /^Tel\.?:?/i.test(l));
    if (phoneLine) phone = clean(phoneLine.replace(/^Tel\.?:?/i, ""));
  }

  return { name, street, zipCity, phone, mapsUrl };
}
