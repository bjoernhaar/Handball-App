// Web Push ohne Fremdbibliothek, nur mit WebCrypto:
//  - VAPID (RFC 8292): der Worker weist sich gegenüber dem Push-Dienst
//    (bei Chrome/Android: Firebase Cloud Messaging) per signiertem JWT aus.
//  - Verschlüsselung der Nachricht (RFC 8291, "aes128gcm"), damit nur das
//    Handy, das das Abo angelegt hat, den Inhalt lesen kann.

const encoder = new TextEncoder();

export function b64urlEncode(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, lengthBytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, lengthBytes * 8);
  return new Uint8Array(bits);
}

/**
 * Verschlüsselt payload für ein PushSubscription-Objekt (RFC 8291).
 * @param {{keys: {p256dh: string, auth: string}}} subscription
 * @param {Uint8Array} payload
 * @returns {Promise<Uint8Array>} kompletter Request-Body
 */
export async function encryptPayload(subscription, payload) {
  const uaPublic = b64urlDecode(subscription.keys.p256dh);
  const authSecret = b64urlDecode(subscription.keys.auth);

  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256));

  const keyInfo = concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  // Ein einziger Record: Nutzdaten + Trennbyte 0x02 ("letzter Record").
  const plaintext = concat(payload, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  const header = concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ciphertext);
}

/**
 * @param {string} endpoint - Push-Dienst-URL aus der Subscription
 * @param {{publicKey: string, privateJwk: object, subject: string}} vapid
 */
export async function vapidAuthorization(endpoint, vapid) {
  const audience = new URL(endpoint).origin;
  const header = b64urlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject }))
  );
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

/**
 * Schickt eine Push-Nachricht.
 * @returns {Promise<{ok: boolean, gone: boolean, status: number}>} gone = Abo existiert nicht mehr (löschen)
 */
export async function sendPush(subscription, data, vapid) {
  const body = await encryptPayload(subscription, encoder.encode(JSON.stringify(data)));
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(24 * 3600),
      Urgency: "normal",
    },
    body,
  });
  return { ok: response.ok, gone: response.status === 404 || response.status === 410, status: response.status };
}

/** Nur echte Push-Dienste der Browser-Hersteller, damit der Worker nicht als beliebiger "POST-Versender" missbraucht werden kann. */
const PUSH_SERVICE_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];

export function isValidSubscription(sub) {
  if (!sub || typeof sub.endpoint !== "string" || !sub.keys) return false;
  if (typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string") return false;
  try {
    const url = new URL(sub.endpoint);
    return url.protocol === "https:" && PUSH_SERVICE_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}
