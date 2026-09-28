// Die Versionsnummer wird nur in src/version.js gepflegt - Service Worker,
// Changelog und package.json müssen dazu passen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_VERSION } from "../../src/version.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Service-Worker-Cache trägt die App-Version", () => {
  const match = read("../../service-worker.js").match(/const CACHE_VERSION = "([^"]+)"/);
  assert.equal(match && match[1], APP_VERSION, "CACHE_VERSION in service-worker.js anpassen");
});

test("CHANGELOG.md beginnt mit der aktuellen Version", () => {
  const match = read("../../CHANGELOG.md").match(/^## Version (\S+)/m);
  assert.equal(match && match[1], APP_VERSION, "Eintrag in CHANGELOG.md ergänzen");
});

test("worker/package.json hat dieselbe Version", () => {
  const pkg = JSON.parse(read("../package.json"));
  assert.equal(pkg.version.replace(/\.0$/, ""), APP_VERSION);
});
