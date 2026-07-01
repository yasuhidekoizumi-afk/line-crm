#!/usr/bin/env node
/**
 * socialplus.line メタフィールド → line-crm バックフィル ドライバ
 *
 * 使い方:
 *   node scripts/backfill-socialplus-line.mjs \
 *     --input /path/to/customers.jsonl \
 *     --worker https://oryzae-line-crm.oryzae.workers.dev \
 *     --api-key $WORKER_API_KEY \
 *     --chunk 100
 *
 * 想定入力:
 *   Shopify bulkOperationRunQuery で吐いた customers.jsonl（1行1顧客）。
 *   各行の期待キー: id, email, firstName, lastName, tags, metafield.value
 *   metafield.value に本物のLINE userId（U + 32文字）が入っている行のみ処理対象。
 *
 * 進捗ファイル:
 *   scripts/.backfill-progress.json に処理済みの Shopify Customer ID を保存。
 *   途中で止めても、次回実行時は続きから。--reset で最初から。
 *
 * 出力:
 *   scripts/.backfill-results.jsonl に endpoint の per-item 結果を追記。
 */

import { readFile, writeFile, appendFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_PATH = join(__dirname, '.backfill-progress.json');
const RESULTS_PATH = join(__dirname, '.backfill-results.jsonl');
// LINE API の一時エラー（429/5xx/network）や db_error などで未処理になった item を保存。
// 進捗ファイルには入れないため、次回実行時に再挑戦される。
const FAILURES_PATH = join(__dirname, '.backfill-failures.jsonl');

/** コマンドライン引数を key/value に */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function isValidLineUserId(uid) {
  return typeof uid === 'string' && uid.startsWith('U') && uid.length === 33;
}

/** 数値部分だけを取り出す（gid://shopify/Customer/123 → "123"） */
function extractShopifyId(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{5,})/);
  return m ? m[1] : null;
}

async function fileExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadProgress(reset) {
  if (reset) return new Set();
  if (!(await fileExists(PROGRESS_PATH))) return new Set();
  try {
    const raw = await readFile(PROGRESS_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    return new Set(Array.isArray(obj.done) ? obj.done : []);
  } catch {
    return new Set();
  }
}

async function saveProgress(done) {
  await writeFile(PROGRESS_PATH, JSON.stringify({ done: [...done] }, null, 2), 'utf-8');
}

async function readJsonl(path) {
  const raw = await readFile(path, 'utf-8');
  const items = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      items.push(JSON.parse(t));
    } catch {
      // 壊れた行は無視
    }
  }
  return items;
}

async function postChunk(workerUrl, apiKey, items, lineAccountId) {
  const url = `${workerUrl.replace(/\/$/, '')}/api/admin/backfill/socialplus-line`;
  const body = { items };
  if (lineAccountId) body.lineAccountId = lineAccountId;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // authMiddleware は `Authorization: Bearer <API_KEY>` 形式しか通さない。
      // x-api-key ヘッダにすると 401 になるので注意。
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { success: false, error: `non-json response: ${text.slice(0, 200)}` };
  }
  if (!res.ok || !json.success) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json.data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const inputPath = args.input;
  if (!inputPath) {
    console.error('❌ --input <customers.jsonl のパス> は必須です');
    process.exit(1);
  }
  const workerUrl = args.worker || process.env.WORKER_URL || 'https://oryzae-line-crm.oryzae.workers.dev';
  const apiKey = args['api-key'] || process.env.WORKER_API_KEY;
  if (!apiKey) {
    console.error('❌ --api-key もしくは WORKER_API_KEY 環境変数が必要です');
    process.exit(1);
  }
  const chunkSize = Number(args.chunk || 100);
  const limit = args.limit ? Number(args.limit) : Infinity;
  const dryRun = Boolean(args['dry-run']);
  const reset = Boolean(args.reset);
  const lineAccountId = args['line-account-id'] || null;

  // ── LINEアカウントID 未指定チェック ──
  // 本番はLINEアカウントが2つ以上ある想定。socialplus.line メタフィールドには
  // どのチャネル(=どのアカウント)で友だち登録した userId かの情報がない。
  // 間違った accessToken で getProfile を叩くと本来フォロー中の人も 404 扱いになり
  // is_following=0 で誤取り込みされる。dry-run 以外では明示指定を必須にする。
  if (!lineAccountId && !dryRun) {
    console.error(
      '❌ --line-account-id が未指定です。\n' +
        '   本番はLINEアカウントが複数あり、誤ったチャネルで getProfile すると\n' +
        '   本来フォロー中の人も 404 扱いになり is_following=0 で誤取り込みされます。\n' +
        '   アカウントIDは以下で確認してください:\n' +
        '     cd apps/worker && npx wrangler d1 execute oryzae-line-crm --remote \\\n' +
        '       --command "SELECT id, name FROM line_accounts WHERE is_active=1"',
    );
    process.exit(1);
  }

  console.log(`📥 入力: ${inputPath}`);
  console.log(`🎯 送信先: ${workerUrl}`);
  console.log(`📦 チャンク: ${chunkSize}件/リクエスト`);
  console.log(`📞 LINEアカウント: ${lineAccountId ?? '(dry-run のため未指定OK)'}`);
  if (limit !== Infinity) console.log(`🔢 上限: ${limit}件`);
  if (dryRun) console.log(`🧪 dry-run: 実際のPOSTはしません`);

  const all = await readJsonl(inputPath);
  console.log(`  → ${all.length}件のレコードを読み込み`);

  // フィルタ: metafield.value が本物のLINE userId のもののみ
  const targets = [];
  for (const rec of all) {
    const mfVal = rec?.metafield?.value?.trim?.();
    const sid = extractShopifyId(rec?.id);
    if (!isValidLineUserId(mfVal) || !sid) continue;
    targets.push({
      shopifyCustomerId: sid,
      lineUserId: mfVal,
      email: rec.email || null,
      firstName: rec.firstName || null,
      lastName: rec.lastName || null,
    });
  }
  console.log(`  → うち socialplus.line 有効: ${targets.length}件`);

  const done = await loadProgress(reset);
  console.log(`  → 進捗ファイル既済: ${done.size}件`);

  const pending = targets
    .filter((t) => !done.has(t.shopifyCustomerId))
    .slice(0, limit === Infinity ? undefined : limit);
  console.log(`🚀 今回処理する残り: ${pending.length}件`);

  if (dryRun) {
    console.log('\n[dry-run] 最初の3件のプレビュー:');
    for (const p of pending.slice(0, 3)) console.log('  ', p);
    return;
  }

  const totalStats = {
    received: 0,
    profilesOk: 0,
    profilesNotFriend: 0,
    profileErrors: 0,
    friendsInserted: 0,
    friendsUpdated: 0,
    customersLinked: 0,
    customersCreated: 0,
    conflicts: 0,
    skipped: 0,
  };
  const startTime = Date.now();

  let chunkIdx = 0;
  const totalChunks = Math.ceil(pending.length / chunkSize);

  for (let i = 0; i < pending.length; i += chunkSize) {
    const slice = pending.slice(i, i + chunkSize);
    chunkIdx++;
    const chunkStart = Date.now();
    let attempt = 0;
    let data;
    while (true) {
      attempt++;
      try {
        data = await postChunk(workerUrl, apiKey, slice, lineAccountId);
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        const wait = 2000 * attempt;
        console.warn(`  ⚠ chunk ${chunkIdx} 失敗 (attempt ${attempt}): ${err.message}. ${wait}ms 待って再試行`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    // 集計
    for (const k of Object.keys(totalStats)) {
      totalStats[k] += data[k] ?? 0;
    }

    // per-item 結果を分類:
    //   - 一時失敗（getProfile 429/5xx/network, db_error）→ done に入れず failures.jsonl に退避
    //     → 次回実行で自動リトライされる
    //   - 成功 or 恒久的スキップ（invalid_input, conflict, 404=not_friend）→ done に入れる
    const results = data.results ?? [];
    const resultByShopifyId = new Map(
      results.map((r) => [String(r.shopifyCustomerId), r]),
    );
    let chunkRetries = 0;
    for (const item of slice) {
      const r = resultByShopifyId.get(String(item.shopifyCustomerId));
      const isTransient =
        r &&
        (r.friendAction === 'skipped' || r.customerAction === 'skipped') &&
        typeof r.error === 'string' &&
        (r.error.startsWith('getProfile_failed:') || r.error.startsWith('db_error:'));
      if (isTransient) {
        chunkRetries++;
        // 元の item + endpoint の結果を退避（次回リトライ時に元の入力形式で読み戻せるように）
        await appendFile(
          FAILURES_PATH,
          JSON.stringify({ item, result: r, at: new Date().toISOString() }) + '\n',
          'utf-8',
        );
        // done には入れない → 次回実行で再送される
      } else {
        done.add(item.shopifyCustomerId);
      }
    }
    await saveProgress(done);

    // per-item 結果を追記
    const resultLines = results.map((r) => JSON.stringify(r)).join('\n');
    if (resultLines) await appendFile(RESULTS_PATH, resultLines + '\n', 'utf-8');

    const chunkMs = Date.now() - chunkStart;
    console.log(
      `  ✓ chunk ${chunkIdx}/${totalChunks} (${slice.length}件, ${chunkMs}ms): ok=${data.profilesOk} notFriend=${data.profilesNotFriend} linked=${data.customersLinked} created=${data.customersCreated} conflicts=${data.conflicts} retry=${chunkRetries}`,
    );

    // レート抑制
    await new Promise((r) => setTimeout(r, 500));
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n📊 完了サマリー:');
  console.log(`  経過時間: ${elapsedSec}秒`);
  for (const [k, v] of Object.entries(totalStats)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`\n💾 結果詳細: ${RESULTS_PATH}`);
  console.log(`💾 進捗: ${PROGRESS_PATH}`);
}

main().catch((err) => {
  console.error('❌ 実行失敗:', err);
  process.exit(1);
});
