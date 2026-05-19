# LINE Harness 修正マニュアル

だれでも修正できるようになるためのガイドです。

---

## 📦 最初の準備（1回だけ）

### ① コードを手元にダウンロードする

Mac の「ターミナル」アプリを開いて、下の1行だけコピー＆ペーストしてエンターキーを押します。

```bash
cd ~/Desktop && git clone https://github.com/yasuhidekoizumi-afk/line-crm.git
```

デスクトップに `line-crm` というフォルダができます。

### ② Claude Code でフォルダを開く

Claude Code を起動して「Open Folder」→ デスクトップの `line-crm` フォルダを選んでください。

✅ **2回目以降は①と②は不要です。**

---

## 🔁 毎日の流れ

### STEP 1：最新の状態にする

ターミナルで以下を実行（コピペでOK）：

```bash
cd ~/Desktop/line-crm && git pull
```

> 📌 これを忘れると、古いコードを触ってしまうことがあります。

---

### STEP 2：Claude Code に修正をお願いする

Claude Code のチャットに、ふつうの日本語で伝えるだけです。

**伝え方の例：**
- 「友だち一覧ページのタイトルを『LINE友だち管理』に変えて」
- 「送信ボタンの色を青にして」
- 「ポイントに有効期限の表示を追加して」

Claude Code が勝手にファイルを見つけて修正してくれます。

---

### STEP 3：修正した内容をアップロードする

ターミナルで以下を3行まとめてコピペしてエンター：

```bash
cd ~/Desktop/line-crm
git add .
git commit -m "やったことを短く書く（例：タイトル変更）"
git push
```

> 📌 これをやると、あなたの修正が GitHub という場所にアップロードされます。

---

### STEP 4：本番に自動反映される（あなたは何もしなくてOK）

STEP 3 をやったら、**あとは自動で本番環境に反映されます。**

何もする必要はありません。GitHub というサービスが自動でビルド＆デプロイしてくれます。

| 変更した場所 | 自動で反映されるURL |
|------------|-------------------|
| 管理画面の見た目を変えた | https://line.oryzae.shop に自動反映 |
| 中の動き（API）を変えた | API に自動反映 |

**反映されたか確認したいときは：**
1. ブラウザで https://github.com/yasuhidekoizumi-afk/line-crm/actions を開く
2. 一番上の行に ✅（緑のチェック）が付いていれば成功
3. ❌（赤いバツ）が付いていたら小泉さんに連絡

---

## 🆘 よくある質問

### Q. どのファイルを直せばいいかわからない
→ Claude Code に「どのファイルを直せばいい？」と聞いてください。

### Q. 直したら画面が変になった
→ Claude Code に「元に戻して」と伝えるか、以下を実行：
```bash
cd ~/Desktop/line-crm && git checkout .
```

### Q. アップロードしたのに反映されていない
→ 反映には1〜3分かかります。Actions のページで ✅ になるのを待ってください。

### Q. エラーが出た
→ エラーメッセージをそのまま Claude Code に貼り付けて「これなに？」と聞いてください。

---

## 🔗 よく使うページ

| ページ | URL |
|-------|-----|
| LINE Harness 管理画面 | https://line.oryzae.shop |
| コードの管理場所（GitHub） | https://github.com/yasuhidekoizumi-afk/line-crm |
| 自動デプロイの状況 | https://github.com/yasuhidekoizumi-afk/line-crm/actions |

---

## 📞 緊急連絡先

大きな問題が起きたら小泉さんに連絡してください。
