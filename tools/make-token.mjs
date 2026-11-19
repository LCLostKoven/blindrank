#!/usr/bin/env node
// Makes an Apple MusicKit developer token (a signed JWT). Needs Node 16+, no packages.
//
//   node tools/make-token.mjs --team ABCDE12345 --key KEYID12345 --p8 ./AuthKey_KEYID12345.p8 \
//        --origin https://yourname.github.io
//
// --team    your Apple Developer Team ID (developer.apple.com, Membership details)
// --key     the Key ID of a key with "Media Services (MusicKit)" enabled
// --p8      path to the .p8 private key file you downloaded when you created that key
// --origin  (recommended) the site the app will be hosted on; the token then only works there
// --days    how long the token lasts (default 150, Apple's maximum is about 180)
//
// Paste the printed token into config.js. Keep the .p8 file private and never upload it.

import { readFileSync } from 'node:fs';
import { sign, createPrivateKey } from 'node:crypto';

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

const a = args();
if (!a.team || !a.key || !a.p8) {
  console.error('Usage: node tools/make-token.mjs --team TEAMID --key KEYID --p8 path/to/AuthKey.p8 [--origin https://site] [--days 150]');
  process.exit(1);
}

const days = Math.min(Number(a.days || 150), 180);
const now = Math.floor(Date.now() / 1000);
const header = { alg: 'ES256', kid: a.key };
const payload = { iss: a.team, iat: now, exp: now + Math.floor(days * 86400) };
if (a.origin) payload.origin = [String(a.origin).replace(/\/$/, '')];

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const unsigned = `${b64(header)}.${b64(payload)}`;
const key = createPrivateKey(readFileSync(a.p8, 'utf8'));
const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');

console.log(`${unsigned}.${signature}`);
console.error(`\nToken valid for ${days} days (until ${new Date((now + days * 86400) * 1000).toDateString()}).`);
