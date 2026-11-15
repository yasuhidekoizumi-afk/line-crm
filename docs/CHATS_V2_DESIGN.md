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

## 6. 未読の運用設計（2026-11-15 追加）

本番の未読229件を実データで分解した結果:

| 区分 | 件数 |
|---|---|
| 未読の会話 | 229 |
| 最終受信がお礼・締め表現 | 125 |
| うち要対応語（退会・解約・返金・未着等）を含む | 9 |
| 要返信候補（キーワード抽出・全未読） | 65 |

最終受信月は 2026-04〜11 に分散し、最古は4月。**未読数はCSの負荷を表していない**（対応済みだが
クローズされていない会話が積み上がっている）。

### やらないと決めたこと: お礼・締め文の自動クローズ

文面の語だけで判定すると、締め表現が**依頼文の結び**にも使われるため誤爆する。
実データで「締め表現かつ要対応語なしかつ受信1件のみ」に絞った11件のうち、
「【一時停止の依頼】」「メールアドレス変更のお願い」「注文81704の住所変更」「注文金額修正のお願い」が
混ざっていた（＝返信が必要な依頼）。**自動クローズは実装しない。**
将来やるなら文面ルールではなく、AIに「返信不要／要返信」を判定させ、下書きと同じ承認フローに乗せる。

### 代わりに入れたもの（データを書き換えない）

- **放置日数**: 未読がある会話の「最後の顧客メッセージからの経過日数」。3日以上＝橙、7日以上＝赤で表示。
  `sort=stale` で放置順（未読を先に、古い順）。
- **要返信候補フィルタ**: `attention=1`。最終受信が要対応語（退会・解約・返金・返品・交換・未着・不良・
  破損・賞味期限・在庫・間違・キャンセル・変更・修正・依頼・相談・苦情・クレーム）を含む会話だけ表示。
  これは**判断ではなく閲覧順のヒント**であり、ステータスは変えない。
- 一覧の件数表示（全n件・未読n件）と一括既読は既存のまま。

## 7. 記録の断絶とAI意図判定（2026-11-15 追加・§6の一部を差し替え）

### 判明した事実: 返信はハーネスに記録されていない

現場は **LINE公式アカウント管理画面（PCブラウザ）** から返信している。Messaging API は
「自分が送ったメッセージ」を後から取得できないため、ハーネス側には返信が残らない。

| 項目 | 実測 |
|---|---|
| 会話数 | 236 |
| ハーネスからの返信（配信除く）が1件も無い会話 | **226** |
| ハーネスからの返信が記録されている会話 | 10（自動返信・テスト等） |

したがって `未読` の実体は「**未返信**」ではなく「**ハーネス上に返信記録がない**」。
「212日放置」に見えた会話も、実際は管理画面で返信済みである可能性が高い。
**未読数・経過日数を返信状況の指標として使ってはいけない。**

### 採用した設計（併用運用）

返信は管理画面のまま。ハーネスは「**顧客がまだ何かを求めているか**」だけを判定し、
要確認候補を出す監視装置として使う。

- `chats.ai_intent`（`needs_reply` / `closing` / `unclear`）＋ `ai_intent_reason` / `ai_intent_at`
- 判定: `packages/ai-sdk/src/chat-intent.ts`（Gemini `gemini-3.6-flash`・temperature 0・JSON出力）
  - 文末が「よろしくお願いします」でも本文が依頼なら `needs_reply`
  - 「ありがとうございます」の後に新しい依頼が続く場合も `needs_reply`
  - 失敗時は `unclear`（誤って `closing` にしない）
- 起動: LINE受信時に `apps/worker/src/services/chat-intent.ts` が判定して保存。
  過去分は `POST /api/chats/intent-classify`（1回最大20件・`remaining` を返す）を画面の「AI判定」で繰り返す。
- UI: 一覧・ヘッダに `要返信(AI)` / `要確認(AI)` / `応答不要(AI)` バッジ。フィルタは `intent=needs_reply` / `unchecked`。
  **放置日数のバッジは撤去**（返信済みを「放置」と誤表示するため）。並び替えの「放置順」は「古い順」に改名。

### 残る限界

- 返信後にお客様が何も返さない場合、最終メッセージは依頼のままなので候補に残り続ける。
  → 「確認したら対応済みにする」運用が必要（ステータス=対応済みが確認済みマークを兼ねる）。
- 管理画面の返信内容はハーネスに残らないため、対応履歴・初回応答時間の計測はできない。
  必要になったら「返信はハーネスに一本化」が前提になる。
