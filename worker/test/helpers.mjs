import { readFileSync, existsSync } from "node:fs";
import { JSDOM } from "jsdom";

const FIXTURES = new URL("./fixtures/", import.meta.url);

/** Echte nuLiga-Seiten (per scripts/fetch-fixtures.mjs geladen, nicht im Git). */
export function fixture(name) {
  const url = new URL(name, FIXTURES);
  return existsSync(url) ? readFileSync(url, "utf8") : null;
}

/** Macht DOMParser (wie im Browser) für die Parser der App verfügbar. */
export function installDomParser() {
  const { window } = new JSDOM("");
  globalThis.DOMParser = window.DOMParser;
}

export function parseHtml(html) {
  return new JSDOM(html).window.document;
}
