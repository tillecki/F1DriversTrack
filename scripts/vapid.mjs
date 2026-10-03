/* Generates the VAPID keypair for web push. Run once:  npm run push:keys
   Then set the two values it prints. */
import { webcrypto as crypto } from "node:crypto";

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
);
const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
const pub = await crypto.subtle.exportKey("raw", pair.publicKey);
const b64url = (buf) => Buffer.from(buf).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

console.log("\n1. Put this in wrangler.toml under [vars] as VAPID_PUBLIC_KEY:\n");
console.log("   VAPID_PUBLIC_KEY = \"" + b64url(pub) + "\"\n");
console.log("2. Run  npx wrangler secret put VAPID_PRIVATE_JWK  and paste this one line:\n");
console.log("   " + JSON.stringify({ kty: priv.kty, crv: priv.crv, d: priv.d, x: priv.x, y: priv.y }) + "\n");
console.log("3. Run  npx wrangler secret put VAPID_SUBJECT  and give it  mailto:you@example.com\n");
