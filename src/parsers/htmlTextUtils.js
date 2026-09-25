// Kleine Helfer zum Säubern von Text, der aus nuLiga-HTML extrahiert wurde.
// nuLiga formatiert seine Tabellen sehr großzügig mit Tabs/Zeilenumbrüchen und
// nutzt &nbsp; als Lückenfüller - das muss vor dem Anzeigen normalisiert werden.

const NBSP = " ";

/** Trimmt und kollabiert Whitespace (inkl. &nbsp;) zu einzelnen Leerzeichen. */
export function clean(text) {
  if (text == null) return "";
  return text
    .replace(new RegExp(NBSP, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Zerlegt den Inhalt eines Elements an <br>-Tags in gesäuberte Textzeilen,
 * z.B. für die dreizeilige <h1> von teamPortrait oder den Adress-Absatz von
 * courtInfo. Andere Kind-Elemente (z.B. ein <a>) werden per textContent
 * (NICHT innerHTML!) eingefügt, damit kein rohes HTML in den Zeilen landet.
 */
export function linesByBr(element) {
  const lines = [];
  let current = "";
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 1 && node.tagName === "BR") {
      lines.push(clean(current));
      current = "";
    } else if (node.nodeType === 3) {
      current += node.textContent;
    } else if (node.nodeType === 1) {
      current += node.textContent;
    }
  }
  lines.push(clean(current));
  return lines.filter((l) => l.length > 0);
}

/**
 * Liest einen Query-Parameter aus einem (ggf. relativen) href robust aus.
 * Nutzt URLSearchParams, das '+' im Gegensatz zu Androids Uri-Klasse korrekt
 * als Leerzeichen dekodiert (application/x-www-form-urlencoded), daher ist
 * hier - anders als in der Android-Version - kein manueller Fix nötig.
 */
export function queryParam(href, name, baseUrl = "https://hvnb-handball.liga.nu/") {
  if (!href) return null;
  try {
    const url = new URL(href, baseUrl);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

/** Direkte Kind-<td>-Elemente einer Zeile (robuster als Selektoren wie "> td"). */
export function directTds(row) {
  return Array.from(row.children).filter((c) => c.tagName === "TD");
}

/** Direkte Kind-<th>-Elemente einer Zeile. */
export function directThs(row) {
  return Array.from(row.children).filter((c) => c.tagName === "TH");
}
