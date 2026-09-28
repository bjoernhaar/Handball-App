// Prüft die Web-Push-Verschlüsselung gegen die unabhängige Referenz-
// Implementierung http_ece (Mozilla) und die VAPID-Signatur mit node:crypto.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes, createPublicKey, verify } from "node:crypto";
import ece from "http_ece";
import { encryptPayload, vapidAuthorization, isValidSubscription, b64urlDecode } from "../src/webpush.js";

function fakeBrowserSubscription() {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  return {
    ua,
    auth,
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    },
  };
}

test("aes128gcm-Nachricht lässt sich mit http_ece entschlüsseln", async () => {
  const { ua, auth, subscription } = fakeBrowserSubscription();
  const message = JSON.stringify({ title: "Spielplanänderung: HG Jever/Schortens", body: "Uhrzeit: 12:00 Uhr → 14:00 Uhr" });
  const body = await encryptPayload(subscription, new TextEncoder().encode(message));
  const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: auth.toString("base64url") });
  assert.equal(plain.toString("utf8"), message);
});

test("VAPID-JWT ist gültig signiert und richtig adressiert", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);

  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", {
    publicKey,
    privateJwk,
    subject: "https://example.github.io/handball-favoriten/",
  });
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, publicKey);
  const [h, c, s] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.ok(claims.exp > Date.now() / 1000);

  const pub = createPublicKey({ key: { ...privateJwk, d: undefined }, format: "jwk" });
  const ok = verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, b64urlDecode(s));
  assert.ok(ok, "Signatur ungültig");
});

test("nur echte Push-Dienste werden akzeptiert", () => {
  const keys = { p256dh: "x", auth: "y" };
  assert.ok(isValidSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/1", keys }));
  assert.ok(!isValidSubscription({ endpoint: "https://evil.example.com/hook", keys }));
  assert.ok(!isValidSubscription({ endpoint: "http://fcm.googleapis.com/x", keys }));
  assert.ok(!isValidSubscription({ endpoint: "https://fcm.googleapis.com/x" }));
});
