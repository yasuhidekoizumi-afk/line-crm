# LINE Harness 修正マニュアル

はじめてでも修正・デプロイができるようになるためのガイドです。

---

## 最初の1回だけやること（初期セットアップ）

### 1. リポジトリをパソコンに取得する

ターミナル（Mac の場合は「ターミナル」アプリ）を開いて、以下を1行ずつ実行します。

```bash
# デスクトップに移動
cd ~/Desktop

# リポジトリをクローン（コードを取得）
git clone https://github.com/yasuhidekoizumi-afk/line-crm.git
```

完了すると、デスクトップに `line-crm` フォルダが作られます。

---

### 2. Claude Code でフォルダを開く

Claude Code を起動して、「Open Folder」から先ほどの `line-crm` フォルダを選択します。

これで準備完了です。**次回からはこの手順は不要です。**

---

## 日常の作業フロー（毎回やること）

### STEP 1：最新のコードを取得する

作業を始める前に、必ずターミナルで以下を実行してください。

```bash
cd ~/Desktop/line-crm
git pull
```

> これをやらないと、自分の変更が古いコードに上書きされることがあります。

---

### STEP 2：Claude Code に修正を依頼する

Claude Code のチャット欄に、やりたいことを日本語で入力するだけです。

**例：**
- 「友だち一覧ページのタイトルを『LINE友だち管理』に変えてください」
- 「ブロードキャストの送信ボタンの色を青に変えてください」
- 「ロイヤルティポイントのAPIに、ポイント有効期限を返す項目を追加してください」

Claude Code が該当するファイルを見つけて修正してくれます。

---

### STEP 3：変更をGitHubに保存する（push）

修正が終わったら、ターミナルで以下を実行します。

```bash
cd ~/Desktop/line-crm

# 変更を記録
git add .
git commit -m "修正内容を一言で書く（例：友だち一覧のタイトルを変更）"

# GitHubに送る
git push
```

---

### STEP 4：自動デプロイ（pushするだけでOK）

`git push` したら、**あとは自動で本番反映されます。** ローカルで何かコマンドを実行する必要はありません。

GitHub Actions が自動で以下のデプロイを実行します：

| 変更内容 | 自動で実行されるデプロイ |
|---------|------------------------|
| 管理画面（見た目）を変えた → `apps/web/` を変更 | GitHub Pages に自動デプロイ → https://line.oryzae.shop |
| APIの動作を変えた → `apps/worker/` を変更 | Cloudflare Workers に自動デプロイ → https://oryzae-line-crm.oryzae.workers.dev |

**デプロイが完了したか確認したいときは：**
1. GitHub のリポジトリページ（https://github.com/yasuhidekoizumi-afk/line-crm）を開く
2. 上のタブから「Actions」をクリック
3. 最新のワークフロー実行に ✓（緑色のチェック）が付いていれば成功
4. ✕（赤色のバツ）が付いていたら、その行をクリックしてエラーメッセージを確認

> ⚠️ ローカルで `pnpm deploy:web` や `pnpm deploy` を実行しないでください。
> これらのコマンドは認証情報（Cloudflare API Tokenなど）が必要で、あなたの環境では動きません。
> ローカルでやるべきことは `git push` だけで完了です。

---

## よくある質問

### Q. どのファイルを触ればいいかわからない
→ Claude Code に「〇〇を修正したいのですが、どのファイルですか？」と聞けばOKです。

### Q. 修正してみたら画面が壊れた
→ Claude Code に「元に戻してください」と伝えるか、以下を実行します：
```bash
git checkout .
```

### Q. pushしたのに反映されていない
→ GitHub Actions のデプロイが完了するまで数分かかることがあります。Actions タブで進行状況を確認してください。
  - 管理画面: GitHub Pages への反映にはビルド＋デプロイで約2〜3分
  - API: Cloudflare Workers への反映には約1〜2分

### Q. Actions の実行が赤い✕になった
→ その実行をクリックして、赤い✕が付いたステップを開くとエラーメッセージが表示されます。
   エラーメッセージを小泉さんに共有してください。

### Q. エラーが出てわからない
→ エラーメッセージをそのまま Claude Code に貼り付けて「これどういう意味ですか？」と聞いてください。

---

## 管理画面・ダッシュボード

| 何 | URL |
|---|---|
| LINE Harness 管理画面 | https://line.oryzae.shop |
| GitHub（コード管理） | https://github.com/yasuhidekoizumi-afk/line-crm |
| GitHub Actions（デプロイ状況） | https://github.com/yasuhidekoizumi-afk/line-crm/actions |

---

## 緊急時の連絡先

何か大きな問題が起きた場合は小泉さんに連絡してください。
