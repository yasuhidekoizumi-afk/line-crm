# チャット画面 次期アップデート設計（/chats v2）

最終更新: 2026-11-15 / 対象: `apps/web/src/app/chats/page.tsx`, `apps/worker/src/routes/chats.ts`

## 0. 結論

次の4点をまとめて入れる。ただし**着手順は A→B→C→D ではなく B→D→（受信基盤）→A→C**。
理由は本番データの実測で、AIトリアージ（A）と画像・スタンプ対応（C）は
「LINE受信がトリアージにも履歴にも乗っていない」という土台の欠陥を先に直さないと絵に描いた餅になるため。

| 記号 | 内容 | 前提となる欠陥 | 着手順 |
|---|---|---|---|
| B | 未読の定義統一・一括既読・担当アサイン | なし（すぐ入る） | 1 |
| D | 一覧のサーバー側検索・ページング | なし（すぐ入る） | 1 |
| 基盤 | 受信メッセージ（text以外）の履歴化 + LINE受信のAIトリアージ起動 + 承認時のLINE送信 | — | 2 |
| A | 会話画面へのAIトリアージ・承認の統合 | 基盤 | 3 |
| C | 返信手段の拡充（スタンプ・カード・テンプレ画像・再送） | 基盤（受信履歴） | 3 |

## 1. 本番実測（2026-11-15、D1 `--remote` 直接集計）

| 指標 | 実測値 |
|---|---|
| `chats` 総数 | 236 |
| うち `status='unread'` | 233 |
| `status='in_progress'` | 2 |
| `status='resolved'` | 1 |
| メール系チャット（`channel LIKE 'email_%'`） | 3 |
| `ai_status` が設定されているチャット | 3 |
| `messages_log` 総行数 | 70,595（2026-03-30〜2026-11-13） |
| 実未読（スタッフ最終返信以降の受信）がある会話 | 229 / うち合計786メッセージ・最大36 |
| `ai_decision_log` | L1: 1件（2026-04-26） / L2: 5件（最終 2026-04-27） |
| `staff_members` | 13件（実名・APIキー有効） |

読み取れること:

1. **「未読」タブが機能していない**。236件中233件が `status='unread'` で、タブを押しても絞り込まれない。
   未読バッジ（メッセージ数ベース）とフィルタ（`chats.status` ベース）が別物のため。
2. **AIトリアージは4月から止まっている**。LINE受信では起動せず、メール受信時のみ
   （`apps/worker/src/routes/cs.ts:255`）。よってUIだけ先に統合しても表示するデータが無い。
3. **顧客の画像・スタンプ・ファイルは履歴に残らない**。webhookは `event.message.type === 'text'` のみ
   記録する（`apps/worker/src/routes/webhook.ts:268`）。これは未読数にも欠落が出る。
4. **承認キューからLINEで送信できない**。`sendReply` はLINEチャネルで警告を出して `return` する
   （`apps/worker/src/routes/cs.ts:428-432`）。メールのみ送信可。

## 2. Phase 1（本ブランチで実装）— B + D

### 2-1. DB（migration `072_chat_read_and_assignment.sql`）

```sql
ALTER TABLE chats ADD COLUMN last_read_at TEXT;        -- スタッフが最後に既読にした時刻
ALTER TABLE chats ADD COLUMN assigned_staff_id TEXT;   -- 対応者（staff_members.id）
ALTER TABLE chats ADD COLUMN assigned_at TEXT;
CREATE INDEX IF NOT EXISTS idx_chats_assigned ON chats(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_messages_log_friend_created ON messages_log(friend_id, created_at DESC);
```

- 既読は「会話単位の既読位置」。未読数 = `last_read_at` と「スタッフ最終返信時刻」の**大きい方**より後の受信数。
  これで「返信したら既読になる」従来挙動を壊さず、返信せずに既読だけ消す操作も可能になる。
- `operator_id`（既存）は0件の `operators` テーブル参照で実質未使用。実在する `staff_members` を担当者に使う。

### 2-2. API（`apps/worker/src/routes/chats.ts`）

`GET /api/chats` の拡張（既存パラメータは全て維持）:

| 追加パラメータ | 意味 |
|---|---|
| `q` | 名前・メール・タグ名の部分一致（サーバー側） |
| `limit` / `offset` | ページング（既定100・最大500） |
| `sort=unread` | 未読数の多い順（既定は `last_message_at DESC`） |

- `status=unread` は **メッセージベースの未読数 > 0** に変更（`chats.status` を見ない）。
- レスポンスに `meta: { total, limit, offset, hasMore }` を追加（`data` は配列のままなので後方互換）。

新規:

| エンドポイント | 動作 |
|---|---|
| `POST /api/chats/:id/read` | `last_read_at` を現在時刻に。`status` は変えない |
| `POST /api/chats/read-all` | `{ ids: [...] }`（最大500件）を一括既読 |
| `POST /api/chats/:id/claim` | ログイン中スタッフを `assigned_staff_id` に設定（取り合いの可視化） |
| `PUT /api/chats/:id` | `assignedStaffId`（`null` で解除）を受け付ける |

未読数・未読フィルタ・ソートは**同一のSQL式**を使う（`UNREAD_EXPR`）。ここが今回の核心で、
画面のバッジとタブの件数が構造的に一致するようになる。

### 2-3. UI（`apps/web/src/app/chats/page.tsx`）

- 検索はサーバー側（300msデバウンス）。読み込み済み分だけの検索をやめる。
- 一覧は100件ずつ。「もっと見る」で `offset` を進める（500件上限の見えない欠落を解消）。
- 「未読」タブ＝メッセージ未読、「未対応」バッジ＝`status` の意味に整理（ラベルを分ける）。
- 一覧下部に「表示中をすべて既読」ボタン。会話を開いたら自動で既読。
- 会話ヘッダに担当者名と「自分が担当」ボタン。他者が担当なら名前を出す（同時対応の事故防止）。

### 2-4. 検証

1. `pnpm --filter worker typecheck` / `pnpm --filter web build`
2. ローカルD1にmigrationを適用し、`GET /api/chats?status=unread` と `meta.total` が一致すること
3. 本番migrationは `--file` ではなく `--command` で1文ずつ（スキル `references/d1-direct-query.md` の既知の罠）
4. デプロイはGitHub push→Actions（ローカル `wrangler deploy` 禁止＝`VITE_LIFF_ID` 欠落）

## 3. Phase 2（基盤）— 受信の取りこぼしとAI起動

**実装済み（2026-11-15）**

- `webhook.ts`: `message` イベントの `text` 以外（`image` / `sticker` / `file` / `video` / `audio` / `location`）も
  `messages_log` に記録し、チャットを未読に上げる。画像は LINE のコンテンツAPIから取得して R2
  （`incoming-<messageId>.<ext>`）へ保存し、`/images/:key` の URL を `content` に持たせる。
  メッセージIDは数日で失効するため、参照だけ持たせると後から見られない。
- `chats/page.tsx`: スタンプは LINE の CDN 画像、ファイル/位置情報/動画/音声は人が読める表示にした。
- `cs.ts`: `runLineTriage()` を追加し、webhook から LINE 受信で起動（`CS_LINE_TRIAGE_ENABLED=true` が条件）。
  **LINEは下書き生成のみ**（`allowAutoSend=false`）。理由は webhook 側の `LINE_AI_AUTOREPLY_ENABLED`
  による即返信と二重返信になるため。L1でも下書き＋Slack通知に回す。
- `cs.ts`: `sendReply` の LINE 分岐を実装。承認時は `pushMessage`（replyTokenは1分で失効するため不可）で
  送信し、`messages_log` にも記録する。`sendReply` は `{ ok, error }` を返し、**送信成功後に承認を確定**する
  （逆順だと送信失敗でも下書きが承認済みで消える）。L1自動送信に失敗した場合は下書きへ落とす。

**未着手**

- L1自動送信の段階解放（現状はLINEでは常に人間承認）
- 受信画像の保持期間・R2ライフサイクル（現状は無期限）
- スタンプ送信（Phase 3のC）

## 4. Phase 3（A + C）

**実装済み（2026-11-15）**

- **A（AIトリアージの可視化・承認）**: 一覧行と会話ヘッダに `ai_status`（AI自動返信/AI下書き/AI要対応/有人対応）・
  `ai_category`・金銭フラグのバッジ。会話画面の下部に承認待ち下書きのパネルを出し、
  「この内容で送信」「編集して送信」「却下（理由必須）」をその場で実行できる。
  30秒ポーリングで新しい下書きも拾う。却下理由は `ai_drafts.rejection_reason` と
  `ai_decision_log.outcome` に残り、精度改善の材料になる。
- 承認者の既定値はログイン中のスタッフ（`c.get('staff')`）。画面からスタッフIDを渡さない。
- **C（返信拡充）**: テンプレート（Flexカード／定型文）ピッカーを追加。カードは即送信、定型文は入力欄へ。
  送信失敗時は本文を保持したまま「再送」ボタンを出す。スタンプ送信API（`messageType: 'sticker'`）も実装。

**未着手**

- スタンプ送信のUI。スタッフが実際に使う `packageId`/`stickerId` の一覧が決まっていないため、
  推測したIDを並べるのは避けた（APIは受け口だけ用意済み）。
- テンプレ画像の選択送信（現状はファイルアップロードのみ）。
- 送信失敗の永続ログ（現状は画面上の再送のみ。タブを閉じると失われる）。

## 5. リスク

- 未読定義の変更で、既存の「未読」タブの見え方が変わる（233件→実未読229件）。運用中の交代時に混乱しないよう、
  リリース時に河原あいさんへ1行アナウンスを出す。
- migration 072 適用前にWorkerを先にデプロイすると `assigned_staff_id` 参照で500になる。
  **必ず migration → Worker → Web の順**。
