// Erzeugt einmalig das VAPID-Schlüsselpaar für Web Push.
//   Öffentlicher Schlüssel -> VAPID_PUBLIC_KEY in wrangler.toml
//   Privater Schlüssel     -> Secret: npx wrangler secret put VAPID_PRIVATE_JWK
// Den privaten Schlüssel nie ins Git-Repository einchecken!

import { webcrypto as crypto } from "node:crypto";
import { writeFileSync } from "node:fs";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const publicKey = Buffer.from(raw).toString("base64url");

const out = process.argv[2] || "vapid-private.json";
writeFileSync(out, JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
console.log("VAPID_PUBLIC_KEY =", publicKey);
console.log(`Privater Schlüssel (JWK) gespeichert in ${out} - NICHT committen.`);
