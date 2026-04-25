# LINE Harness CS機能 Phase 1 技術設計書

**作成日**: 2026-04-25
**対象**: 株式会社オリゼ（ORYZAE Inc.）
**ベンチマーク**: Gorgias Automate / Yuma AI / Intercom Fin
**フェーズ**: Phase 1（MVP・2-4週）

---

## 0. ゴール（再掲）

**「CS窓口」ではなく「AI一次対応エージェント + 人間スーパーバイザー1名」**

LINE と Gmail からの問い合わせを統合受信箱に集約し、Gemini 3 Flash Preview による AI が下書き・自動応答を生成。CS担当1名が承認・例外対応のみ実施する構造。

### 確定事項
- **CS担当**: 既存CS担当者をAIで武装（新規採用なし）
- **金銭絡む対応**: 必ず人間承認（自動送信禁止）
- **言語**: 日本語のみ（USは後回し）
- **AIモデル**: Gemini 3 Flash Preview
- **MVPチャネル**: LINE + Gmail（`support@oryzae.site`、`customer-support@oryzae.shop`）

---

## 1. アーキテクチャ全体図

```
┌──────────────┐  ┌──────────────┐
│ LINE Webhook │  │ Gmail Pub/Sub│  ← 受信チャネル
└──────┬───────┘  └──────┬───────┘
       │                  │
       ▼                  ▼
┌──────────────────────────────┐
│   統合受信箱（chats テーブル拡張）   │
│   - channel: line | email      │
│   - thread_id（メールスレッド対応） │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│   AI トリアージエンジン            │
│   1. 金銭キーワード検出（Guard）   │
│   2. Gemini 3 Flash で分類       │
│   3. FAQマッチ → L1 / L2 / L3   │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│   顧客カルテ統合（Context Builder） │
│   - LINE friend / Shopify顧客    │
│   - 過去対応履歴 / 購入履歴       │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│   AI 応答生成（Gemini 3 Flash）   │
│   - L1: 即返信テキスト生成        │
│   - L2: 下書き生成 → 承認キュー   │
│   - L3: 人間にエスカレ + Slack通知│
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│   送信（既存 line-sdk / email-sdk）│
└──────────────────────────────┘
```

---

## 2. 既存資産の再利用

| 既存パッケージ | 役割 | Phase 1での扱い |
|---|---|---|
| `apps/worker/src/routes/chats.ts` | チャット一覧・送受信API | 拡張（channel・AI関連カラム追加） |
| `packages/db/src/chats.ts` | DB schema | スキーマ追加 |
| `packages/ai-sdk/gemini-client.ts` | Geminiクライアント | Gemini 3 Flash Previewに対応 |
| `packages/email-sdk/resend-client.ts` | メール送信（Resend） | 送信側はそのまま流用 |
| `packages/line-sdk` | LINE送受信 | そのまま流用 |
| `apps/worker/src/routes/shopify-webhooks.ts` | Shopify連携 | 顧客カルテ取得APIを追加 |

---

## 3. データベース設計

### 3-1. `chats` テーブル拡張
既存のchatsテーブルに以下カラム追加：

```sql
ALTER TABLE chats ADD COLUMN channel TEXT NOT NULL DEFAULT 'line';
  -- 'line' | 'email_support' | 'email_customer_support'
ALTER TABLE chats ADD COLUMN external_thread_id TEXT;
  -- Gmailスレッド識別子（メールの場合）
ALTER TABLE chats ADD COLUMN customer_email TEXT;
  -- メール起点の場合の送信元アドレス
ALTER TABLE chats ADD COLUMN ai_status TEXT;
  -- 'pending' | 'l1_auto_replied' | 'l2_draft_pending' | 'l2_approved' | 'l3_escalated' | 'human_handled'
ALTER TABLE chats ADD COLUMN ai_category TEXT;
  -- 'faq' | 'order_status' | 'refund' | 'complaint' | 'product_question' | 'other'
ALTER TABLE chats ADD COLUMN ai_confidence REAL;
  -- 0.0 〜 1.0
ALTER TABLE chats ADD COLUMN ai_money_flag BOOLEAN DEFAULT FALSE;
  -- 金銭関連検出フラグ（自動送信禁止トリガー）
```

### 3-2. 新規テーブル

#### `ai_drafts`（AI下書き）
```sql
CREATE TABLE ai_drafts (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  message_id TEXT NOT NULL REFERENCES messages(id),  -- 元メッセージ
  draft_text TEXT NOT NULL,
  draft_metadata JSON,  -- カテゴリ・参照FAQ等
  status TEXT NOT NULL DEFAULT 'pending',
    -- 'pending' | 'approved' | 'edited' | 'rejected' | 'sent'
  approved_by TEXT,  -- staff_id
  approved_at TIMESTAMP,
  final_text TEXT,  -- 編集後の実送信テキスト
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `customer_links`（顧客名寄せ）
```sql
CREATE TABLE customer_links (
  id TEXT PRIMARY KEY,
  line_friend_id TEXT,
  email TEXT,
  shopify_customer_id TEXT,
  freee_partner_id TEXT,
  display_name TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(line_friend_id),
  UNIQUE(email),
  UNIQUE(shopify_customer_id)
);
```

#### `faq_entries`（FAQ知識ベース）
Phase 1ではGoogleスプレッドシートで管理し、起動時 or 5分間隔でharness DBに同期。

```sql
CREATE TABLE faq_entries (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT[],  -- マッチング用キーワード
  l1_eligible BOOLEAN DEFAULT FALSE,  -- L1自動返信可能フラグ
  active BOOLEAN DEFAULT TRUE,
  source_row INTEGER,  -- スプレッドシート行番号
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `ai_decision_log`（精度モニタリング）
```sql
CREATE TABLE ai_decision_log (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  level TEXT NOT NULL,  -- 'L1' | 'L2' | 'L3'
  category TEXT,
  confidence REAL,
  matched_faq_id TEXT,
  money_flag BOOLEAN,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_jpy REAL,
  outcome TEXT,  -- 'auto_sent' | 'approved' | 'edited' | 'rejected' | 'escalated'
  outcome_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 4. Gmail受信統合（新規実装）

### 4-1. アーキテクチャ
**Gmail API + Cloud Pub/Sub** を採用（議論判断1: A推奨）

```
Gmail (support@oryzae.site, customer-support@oryzae.shop)
  ↓ watch() API
Google Cloud Pub/Sub Topic
  ↓ push subscription
Cloudflare Worker endpoint: POST /webhooks/gmail
  ↓
parse → upsert chat → trigger AI triage
```

### 4-2. 実装ステップ
1. **GCP設定**
   - Pub/Sub Topic: `projects/oryzae/topics/cs-gmail-inbound` 作成
   - サービスアカウント `cs-harness@oryzae.iam.gserviceaccount.com` 発行
   - Gmail APIスコープ: `gmail.readonly`, `gmail.modify`

2. **Gmail watch登録**（24時間ごと再登録のcron必要）
   ```typescript
   await gmail.users.watch({
     userId: 'support@oryzae.site',
     requestBody: {
       topicName: 'projects/oryzae/topics/cs-gmail-inbound',
       labelIds: ['INBOX'],
     }
   });
   ```

3. **Worker受信エンドポイント**: `apps/worker/src/routes/gmail-webhook.ts`（新規）
   - Pub/Sub通知 → historyIdから差分取得 → メール本文parse → chats upsert
   - スレッドID（`threadId`）で既存chatに連結 or 新規作成

### 4-3. 注意点
- Gmail watch有効期限が7日。daily cronで再登録
- Pub/Sub通知はメール本文を含まない → Gmail API再取得必要
- HTML/プレーンテキスト両対応、添付ファイルは初期はスキップ（Phase 2で）

---

## 5. AIトリアージエンジン

### 5-1. 処理フロー
```typescript
async function triageMessage(message: IncomingMessage) {
  // Step 1: 金銭キーワード検出（決定論的）
  const moneyFlag = detectMoneyKeywords(message.text);
  // → 「返金」「キャンセル」「交換」「返品」「請求」「料金」「価格」「破損」「異物」

  // Step 2: 顧客カルテ取得
  const customer = await buildCustomerContext(message);

  // Step 3: Gemini 3 Flashで分類
  const classification = await gemini.classify({
    text: message.text,
    customer,
    faqs: await loadActiveFaqs(),
  });
  // → { category, confidence, matched_faq_id, suggested_level }

  // Step 4: レベル決定（金銭フラグでL1禁止）
  let level = classification.suggested_level;
  if (moneyFlag && level === 'L1') level = 'L2';
  if (classification.category === 'complaint') level = 'L3';

  // Step 5: 実行
  if (level === 'L1') {
    const reply = generateL1Reply(classification.matched_faq_id, customer);
    await sendReply(message, reply);
    await logDecision({...});
  } else if (level === 'L2') {
    const draft = await gemini.generateDraft({ message, customer, faqs });
    await createDraft({ chat_id, message_id, draft_text: draft });
    await notifySlackApprovalQueue(chat_id);
  } else {
    await escalateToHuman(message, classification);
    await notifySlackEscalation(chat_id);
  }
}
```

### 5-2. 金銭キーワード辞書（初期版）
```typescript
const MONEY_KEYWORDS = [
  '返金', '返品', '交換', 'キャンセル', '解約', '取り消し',
  '請求', '料金', '価格', '値段', '支払', '決済', '引き落とし',
  '破損', '不良', '異物', '腐', 'カビ', 'おかしい',
  '弁護士', '消費者センター', '訴', '法的',
];
```

### 5-3. L1自動送信のフェイルセーフ（議論判断3: 段階解放）
- **初期2週間**: 全件L2扱い（L1は実質無効化）
- 承認データを `ai_decision_log` に蓄積
- カテゴリ別に「承認率 90%超」「件数20件超」「金銭フラグ無し」を満たしたものから L1解放
- ダッシュボードで「L1解放候補カテゴリ」を可視化

---

## 6. 顧客カルテ統合（Context Builder）

### 6-1. 顧客名寄せロジック
```typescript
async function buildCustomerContext(message: IncomingMessage) {
  let link = await findCustomerLink({
    line_friend_id: message.line_friend_id,
    email: message.email,
  });

  if (!link) {
    // Shopify検索（メール or 電話番号で）
    const shopifyCustomer = await shopify.findCustomerByEmail(message.email);
    if (shopifyCustomer) {
      link = await createCustomerLink({
        email: message.email,
        shopify_customer_id: shopifyCustomer.id,
        display_name: shopifyCustomer.first_name + shopifyCustomer.last_name,
      });
    }
  }

  return {
    name: link?.display_name,
    purchase_history: link?.shopify_customer_id
      ? await shopify.getOrderHistory(link.shopify_customer_id, { limit: 5 })
      : null,
    past_chats: await getRecentChats(link?.id, { limit: 3 }),
    ltv: link?.shopify_customer_id
      ? await shopify.getCustomerLTV(link.shopify_customer_id)
      : null,
  };
}
```

### 6-2. AIプロンプトへの注入例
```
あなたは株式会社オリゼのCS担当AIです。以下の顧客文脈を踏まえて応答してください。

【顧客情報】
- お名前: 山田太郎 様
- 過去購入: KOJIPOP 6本セット（2026-04-10）、麹甘味料 200g（2026-03-22）
- LTV: ¥18,400
- 過去問合せ: 2件（配送遅延・賞味期限質問、すべて解決済み）

【オリゼ商品情報】
[商品マスタ・賞味期限・配送ポリシー・返品規約を注入]

【今回の問合せ】
「先日購入したKOJIPOP、まだ届いていません」
```

---

## 7. 承認キューUI（既存`apps/web`拡張）

### 7-1. 画面構成
- `/inbox` … 統合受信箱（既存）
  - フィルタ追加: `[全て] [AI承認待ち] [エスカレ] [人間対応中] [完了]`
- `/inbox/:chat_id` … 会話詳細（既存）
  - **新規**: 上部に「AI下書き」バナー
    - 下書きテキスト（編集可能テキストエリア）
    - `[承認して送信]` `[編集して送信]` `[却下して自分で書く]` ボタン
    - 「AIが参照したFAQ」「分類カテゴリ」「信頼度」を表示
- `/dashboard/cs` … 新規ダッシュボード
  - 今日の対応件数（L1/L2/L3比率）
  - 平均初動時間 / 平均解決時間
  - AI承認率（編集率・却下率）
  - L1解放候補カテゴリ

### 7-2. Slack通知設計
```typescript
// L3エスカレーション
{
  channel: 'C02ET1YNMRQ',
  text: '🚨 CSエスカレーション',
  blocks: [
    { type: 'section', text: '*顧客*: 山田太郎 様（LINE）\n*分類*: クレーム（信頼度: 0.92）\n*内容*: 「異物が入っていた...」' },
    { type: 'actions', elements: [
      { type: 'button', text: 'harness で開く', url: '...' }
    ]}
  ]
}

// 承認待ち滞留（30分未対応）
{
  channel: 'C02ET1YNMRQ',
  text: '⏰ AI下書き承認待ち（30分超過: 3件）',
}
```

---

## 8. FAQ知識ベース（議論判断2: スプレッドシート開始）

### 8-1. スプレッドシート構造
**シート名**: `ORYZAE CS FAQ Master`（小泉さんのGoogle Sheetsに新規作成）

| 列 | 内容 |
|---|---|
| A | カテゴリ（faq / order_status / product / shipping / return） |
| B | 質問パターン（複数行可） |
| C | 回答テンプレート |
| D | キーワード（カンマ区切り） |
| E | L1自動返信可（TRUE/FALSE） |
| F | 有効（TRUE/FALSE） |
| G | 最終更新日 |

### 8-2. 同期
- 起動時 + 5分間隔でシート→DB同期（既存`google-sheets` MCP連携）
- 編集即反映でCS担当者が運用しやすい

### 8-3. 初期FAQ（小泉さんに依頼するセット）
- 賞味期限・保存方法
- 送料・配送日数
- 返品・交換ポリシー
- 商品の使い方（KOJIPOP・麹甘味料・甘酒）
- 定期便の解約方法
- ギフト対応
- 領収書発行

---

## 9. APIエンドポイント追加

```
POST   /webhooks/gmail              新規 Gmail Pub/Sub受信
GET    /api/chats?ai_status=...     既存拡張（フィルタ追加）
POST   /api/chats/:id/triage        新規 手動再トリアージ
GET    /api/chats/:id/draft         新規 AI下書き取得
POST   /api/chats/:id/draft/approve 新規 承認送信
POST   /api/chats/:id/draft/reject  新規 却下
GET    /api/customers/:id/context   新規 顧客カルテAPI
GET    /api/faqs                    新規 FAQ一覧
POST   /api/faqs/sync               新規 スプレッドシート再同期
GET    /api/dashboard/cs            新規 CSダッシュボード集計
```

---

## 10. コスト試算

### 月間想定（保守的）
- 問い合わせ件数: 500件/月（LINE 200 + メール 300）
- L1: 100件 / L2: 350件 / L3: 50件

### Gemini 3 Flash Preview
- 入力: 平均 2,000 tokens（顧客カルテ込み）
- 出力: 平均 300 tokens
- 単価（推定）: 入力 $0.075/1M tok, 出力 $0.30/1M tok

```
500件 × (2000 × 0.000000075 + 300 × 0.0000003)
= 500 × (0.00015 + 0.00009)
= $0.12 / 月 ≒ ¥18 / 月
```

→ **AIコストは無視できるレベル**。月$50（¥7,500）の予算上限を設定すれば十分。

---

## 11. Phase 1 実装ロードマップ

| 週 | 作業 | 担当想定 |
|---|---|---|
| **W1** | DB schema追加・migration実行 / Gmail Pub/Sub設定 / 金銭キーワード検出 | エンジニア |
| **W1** | FAQスプレッドシート作成・初期コンテンツ20件 | 小泉さん + CS担当 |
| **W2** | Gmail受信→chats統合 / FAQ同期処理 / 顧客カルテAPI | エンジニア |
| **W2** | AIトリアージ実装（Gemini 3 Flash連携） | エンジニア |
| **W3** | 承認キューUI / Slack通知 / CSダッシュボード | エンジニア |
| **W3** | CS担当者ヒアリング・UI受入レビュー | 小泉さん |
| **W4** | 全件L2運用開始 / ログ収集 / 微調整 | CS担当 + エンジニア |

---

## 12. 残タスク

### 小泉さんアクション（2026-04-25 確定）
- [x] **CS担当者の特定** → **小泉さんが暫定スーパーバイザー**。MVP稼働後にCS担当へ引き継ぎ（理論より実物優先）
- [ ] **gcloud auth login**（ブラウザ認証、小泉さんのGoogleアカウントで）
- [ ] **Gmail APIスコープ承認**（小泉さん本人がWorkspace管理者）
- [ ] **既存FAQ整理スプシの場所確認**（社内に既存ありとのこと、要確認）
- [ ] **Slack通知チャネル決定**（`#cs-alerts` を新規作成 or 既存流用）
- [ ] **Workspaceテナント確認**：`oryzae.site`と`oryzae.shop`が同じGoogle Workspaceテナントか

### Claude（私）が代行
- [x] **gcloud CLIインストール**（Homebrew、`/opt/homebrew/bin/gcloud`）
- [x] **GCPプロジェクト**: 既存`oryzae` (504543875916) を使用
- [x] **Gmail API・Pub/Sub API・IAM API有効化**
- [x] **Pub/Sub Topic `projects/oryzae/topics/cs-gmail-inbound` 作成**
- [x] **サービスアカウント `cs-harness@oryzae.iam.gserviceaccount.com` 発行**（Unique ID: `115607137523532357870`）
- [x] **鍵JSON生成**: `~/Downloads/oryzae-secrets/cs-harness-key.json`
- [x] **Gmail Push Publisher権限付与**: `gmail-api-push@system.gserviceaccount.com`
- [ ] **Workspace委任承認待ち**（小泉さんの管理者作業）
- [ ] **Pub/Sub Subscription作成**（Worker URL確定後）
- [ ] **Gmail watch登録スクリプト作成**
- [ ] **過去6ヶ月メールから頻出FAQ TOP20抽出**（委任承認後）
- [ ] **FAQマスターシート雛形作成**

### Slack設定
- [x] CS通知チャネル: `C02ET1YNMRQ`

### Workspace構成判明事項（2026-04-25）
- `oryzae.site`: Google Workspace ✅ サービスアカウント方式可
- `oryzae.shop`: Workspace外 ⚠️ → **転送設定推奨**（`customer-support@oryzae.shop` → `support@oryzae.site`）

---

## 13. Phase 2 以降（参考）

- Phase 2: Shopifyお問い合わせフォーム統合 / タグ管理 / SLA監視
- Phase 3: Instagram DM / L3精度向上 / AI自動学習ループ
- Phase 4: Amazon Q&A / 楽天問合せ / 多言語（英語US対応）

---

**設計書ステータス**: ドラフト（小泉さん承認待ち）
**次アクション**: 上記「残タスク」着手 → エンジニア実装開始判断
