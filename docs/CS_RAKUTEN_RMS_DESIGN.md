# 楽天 RMS WEB SERVICE 統合 設計書

**作成日**: 2026-04-27
**対象**: ORYZAE Inc.
**前提**: CS Phase 1 (LINE/メール統合受信箱 + AIトリアージ + Slack承認フロー) が稼働中
**目的**: 楽天市場店舗からの問い合わせ (R-Messe) を harness に統合し、AI下書き → 承認 → 自動返信を実現

---

## 0. 設計原則

1. **失効事故ゼロ運用**: licenseKey 90日更新を多層アラートで見逃さない
2. **既存パイプラインの再利用**: AIトリアージ・Slack通知・承認バナーは LINE/Email と同じものを使う
3. **段階的構築**: Phase 1〜6 の小さなPRに分けてマージ・本番反映を細かく繰り返す
4. **フェイルオープン**: 楽天連携が止まってもLINE/Emailは動き続ける

---

## 1. 認証方式

### ESA（楽天独自）
```
Authorization: ESA <Base64(serviceSecret:licenseKey)>
```

| 値 | 性質 | 取得元 |
|---|---|---|
| `serviceSecret` | 恒久 | RMS管理画面で発行（サービス単位） |
| `licenseKey` | **90日有効** | RMS管理画面で発行（店舗単位、3ヶ月毎更新） |

両方とも `wrangler secret put` で本番に登録。発行日付のみ DB に保存。

---

## 2. DB スキーマ（Migration 028）

### `rakuten_rms_credentials` （シングルトン: id='default'）
```sql
CREATE TABLE IF NOT EXISTS rakuten_rms_credentials (
  id                TEXT PRIMARY KEY DEFAULT 'default',
  issued_at         TEXT NOT NULL,
  expires_at        TEXT NOT NULL,             -- issued_at + 90日
  last_verified_at  TEXT,                       -- 最後に counts.get で疎通確認した日時
  status            TEXT NOT NULL CHECK (status IN ('active', 'expired', 'rotating')),
  notification_log  TEXT,                       -- JSON: {"30d":true,"14d":true,...}
  created_at        TEXT NOT NULL DEFAULT (...),
  updated_at        TEXT NOT NULL DEFAULT (...)
);
```

### `rakuten_inquiries` (R-Messe 問い合わせメタデータ)
```sql
CREATE TABLE IF NOT EXISTS rakuten_inquiries (
  id                TEXT PRIMARY KEY,                -- UUID
  rakuten_inquiry_id TEXT NOT NULL UNIQUE,           -- 楽天側の問い合わせ ID
  chat_id           TEXT NOT NULL REFERENCES chats(id),
  customer_email    TEXT,                            -- マスクメール
  customer_name     TEXT,
  order_number      TEXT,
  inquiry_type      TEXT,                            -- '商品問い合わせ' | '注文後' | '店舗問い合わせ'
  status            TEXT NOT NULL,                   -- 'unread' | 'replied' | 'completed'
  is_read           INTEGER NOT NULL DEFAULT 0,
  is_completed      INTEGER NOT NULL DEFAULT 0,
  raw_metadata      TEXT,                            -- JSON: API原文（デバッグ用）
  fetched_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (...)
);
CREATE INDEX idx_rakuten_inquiry_status ON rakuten_inquiries(status);
CREATE INDEX idx_rakuten_inquiry_chat ON rakuten_inquiries(chat_id);
```

### `rakuten_messages` (個別メッセージ; cs_messages を再利用しても良いが、楽天固有メタが多いため別テーブル)

実は **既存 `cs_messages` を再利用** する設計にする。`channel='rakuten'` を追加し、`raw_metadata` に楽天固有データ（mailNumber, attachments 等）を JSON で格納。

`chats` テーブルの `channel` enum に `'rakuten'` を追加。

---

## 3. licenseKey 多層アラート（Layer 1〜4）

### Layer 1: カレンダーアラート（cron 1日1回）
```typescript
async function checkLicenseExpiry(env) {
  const cred = await db.prepare(`SELECT * FROM rakuten_rms_credentials WHERE id='default'`).first();
  if (!cred) return;
  const daysLeft = Math.ceil((new Date(cred.expires_at).getTime() - Date.now()) / 86400000);
  const log = JSON.parse(cred.notification_log ?? '{}');
  const milestones = [30, 14, 7, 1, 0];
  for (const m of milestones) {
    if (daysLeft <= m && !log[`${m}d`]) {
      await sendSlackAlert(m, daysLeft, cred);
      log[`${m}d`] = true;
    }
  }
  await db.prepare(`UPDATE rakuten_rms_credentials SET notification_log=? WHERE id='default'`)
    .bind(JSON.stringify(log)).run();
}
```

### Layer 2: 401検知（API呼び出し失敗時）
```typescript
async function rmsApiCall(env, path, body) {
  const res = await fetch(...);
  if (res.status === 401) {
    await markCredentialExpired(env);
    await sendSlackUrgent('🚨 楽天licenseKey失効を検知。RMS管理画面で再発行を。');
    await pauseRakutenPolling(env);
    throw new Error('Rakuten licenseKey expired');
  }
  return res.json();
}
```

### Layer 3: UI（/cs/settings ページ）
- 残日数バー表示（緑/黄/赤）
- 「RMS管理画面を開く」リンク
- 「新しいlicenseKey登録」フォーム → 疎通確認 → DB更新

### Layer 4: 疎通確認による登録
新キー登録時に `counts.get` を実行 → 200ならDB更新、それ以外はロールバック。

---

## 4. ESA認証ヘルパー (`packages/rakuten-sdk` 新設)

```typescript
// packages/rakuten-sdk/src/rms-client.ts
export class RmsClient {
  constructor(
    private serviceSecret: string,
    private licenseKey: string,
    private baseUrl = 'https://api.rms.rakuten.co.jp/es/1.0/'
  ) {}

  private authHeader(): string {
    const raw = `${this.serviceSecret}:${this.licenseKey}`;
    const b64 = btoa(raw);
    return `ESA ${b64}`;
  }

  async getInquiryCounts(): Promise<{ count: number }> {
    return this.apiPost('inquirymng-api/inquirymngapi/counts/20231001/get', {});
  }

  async listInquiries(opts: { fromDate: string; toDate: string; page?: number }): Promise<...> {
    return this.apiPost('inquirymng-api/inquirymngapi/inquiries/20231001/get', opts);
  }

  async getInquiry(id: string): Promise<...> { ... }
  async replyToInquiry(id: string, body: string, attachments?: ...): Promise<...> { ... }
  async markAsRead(id: string): Promise<...> { ... }
  async markAsComplete(id: string): Promise<...> { ... }

  private async apiPost<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new RmsLicenseExpiredError();
    if (!res.ok) throw new Error(`RMS API error: ${res.status}`);
    return res.json();
  }
}
```

---

## 5. 受信統合フロー (Phase 3)

```
楽天 R-Messe（顧客問い合わせ）
    ↓ (5分間隔のcron)
RmsClient.listInquiries({ fromDate: lastFetchedAt })
    ↓
新規問い合わせを rakuten_inquiries / cs_messages に upsert
    ↓
chats テーブルに channel='rakuten' でレコード作成 or 紐付け
    ↓
runTriageForMessage() を既存パイプラインで呼び出し
    ↓
AI下書き生成 → ai_drafts INSERT → Slack通知 → harness UI
```

---

## 6. 送信統合フロー (Phase 4)

```
harness UI で AI下書き承認
    ↓
POST /api/cs/drafts/:id/approve
    ↓
chat.channel === 'rakuten' なら sendReplyRakuten() を呼ぶ
    ↓
RmsClient.replyToInquiry(rakuten_inquiry_id, finalText)
    ↓
楽天側 R-Messe に返信が記録される
    ↓
cs_messages に outgoing として保存
    ↓
markAsRead + markAsComplete 自動実行
```

---

## 7. ポーリング戦略

### Cron スケジュール
- **5分毎**: 新規問い合わせチェック (`fromDate=今-10分`)
- **1日1回**: licenseKey 失効チェック
- **1日1回**: 過去未取得問い合わせバックフィル（最大30日前まで）

### レート制限管理
- 1リクエスト/秒、1日5,000件
- inquiry系 + 既存FERMENT/Shopify連携の合計で管理
- グローバルキューで遅延制御（必要なら）

---

## 8. エラー処理

### 401 Unauthorized → licenseKey失効
- 全 polling 即停止（無駄リクエスト防止）
- Slack 緊急通知（@channel）
- 管理UIに「⚠️ 楽天連携停止中」バナー
- 新キー登録 + 疎通確認 → 自動再開

### 429 Rate Limit → リトライ
- exponential backoff（1秒 → 2秒 → 4秒、最大3回）
- それでも失敗ならログ + 次回cronで再試行

### 500 系 → 一時的サーバ障害
- 同上（リトライ）
- 連続10回失敗で Slack 通知

---

## 9. テスト戦略

楽天には **サンドボックス環境が無い**ため：
- **PoC段階**: 自分で楽天店舗に問い合わせを送って動作確認
- **本実装**: D1のテーブルに対して unit test、API モック
- **本番**: ステージング無し、cron間隔を最初は10分に伸ばして慎重に

---

## 10. Phase 別マイルストーン

| Phase | デリバラブル | クレデンシャル | 工数 |
|---|---|---|---|
| 1 | DB schema + ESA Lib + 失効アラート + Settings UI | ❌ | 2日 |
| 2 | PoC疎通テスト (counts.get) | ✅ | 0.5日 |
| 3 | inquiries.get cron + harness取り込み + AI下書き | ✅ | 4日 |
| 4 | reply.post + 承認連携 | ✅ | 3日 |
| 5 | 添付ファイル R2連携 | ✅ | 2日 |
| 6 | バックフィル + エラー処理 + 本番運用開始 | ✅ | 2日 |

合計: **13.5日（約3週間）**

---

## 11. 残タスク（小泉さんアクション）

- [ ] RMS管理画面 → 「6. WEB API サービス」 → 「3-2 お問い合わせ」 を有効化
- [ ] `serviceSecret` 発行
- [ ] `licenseKey` 発行
- [ ] `inquirymng-api` 公式ドキュメント PDF/HTML 取得 → 共有
- [ ] PoC実行許可（counts.get で件数取得のみ）
- [ ] `wrangler secret put RAKUTEN_SERVICE_SECRET` / `RAKUTEN_LICENSE_KEY`

---

## 12. リスク・将来課金

**R-Messe 将来課金予告**: 月額3,000-5,000円 + 従量(10円/件×100件超)
→ 100件/月超えるとSaaS（Re:lation 12,000円）と価格逆転の可能性。**運用1ヶ月後に件数チェック**して再評価。
