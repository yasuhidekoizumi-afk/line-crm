#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '../src/client/main.ts');
const source = readFileSync(sourcePath, 'utf8');

function extractFunctionBody(code, functionName) {
  const marker = `async function ${functionName}(`;
  const start = code.indexOf(marker);
  if (start === -1) throw new Error(`${functionName} not found`);
  const open = code.indexOf('{', start);
  if (open === -1) throw new Error(`${functionName} opening brace not found`);

  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return code.slice(open + 1, i);
  }
  throw new Error(`${functionName} closing brace not found`);
}

const rawBody = extractFunctionBody(source, 'linkAndAddFlow');
// コメントを解析対象から除外する（コメント内の "getFriendship" 等を誤検出しないため）
const body = rawBody
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
const trackingRedirectIndex = Math.min(
  ...[
    body.indexOf("redirectUrl.includes('/t/')"),
    body.indexOf("redirectUrl?.includes('/t/')"),
    body.indexOf('isTrackingRedirectUrl(redirectUrl)'),
  ].filter((i) => i >= 0),
);
const friendshipIndex = body.indexOf('getFriendship');

if (!Number.isFinite(trackingRedirectIndex) || trackingRedirectIndex < 0) {
  throw new Error('linkAndAddFlow must have an explicit tracking-link redirect branch for /t/ URLs');
}

if (friendshipIndex >= 0 && friendshipIndex < trackingRedirectIndex) {
  throw new Error(
    'tracking-link redirects must append lu before calling liff.getFriendship(); ' +
      'otherwise getFriendship failures send users back with _skip_liff=1 and link_clicks.friend_id stays NULL',
  );
}

console.log('OK: /t/ tracking redirects are handled before getFriendship');
