#!/usr/bin/env bash
# FERMENT: friends → customers バックフィル実行スクリプト
#
# 使い方:
#   WORKER_URL=https://your-worker.workers.dev \
#   API_TOKEN=your-bearer-token \
#   ./scripts/ferment/backfill-customers.sh
#
# 50件ずつバッチ処理し、done=true まで繰り返し呼び出す。
# 13,000名を想定：Shopify API レート制限込みで約 2 時間で完了見込み。

set -eu

: "${WORKER_URL:?WORKER_URL is required (e.g. https://your-worker.workers.dev)}"
: "${API_TOKEN:?API_TOKEN is required (ログイン時のBearer token)}"
REGION="${REGION:-JP}"
BATCH_SIZE="${BATCH_SIZE:-50}"
OFFSET="${OFFSET:-0}"

echo "▶ FERMENT バックフィル開始"
echo "  URL: $WORKER_URL"
echo "  Region: $REGION"
echo "  Batch size: $BATCH_SIZE"
echo ""

# 進捗状況の初期確認
status_json=$(curl -sS -H "Authorization: Bearer $API_TOKEN" "$WORKER_URL/api/ferment/backfill/customers/status")
echo "▶ 開始時ステータス:"
echo "$status_json" | python3 -c "import sys, json; d=json.load(sys.stdin).get('data',{}); print(f'  friends: {d.get(\"total_friends\")} / customers: {d.get(\"total_customers\")} / with_email: {d.get(\"with_email\")}')"
echo ""

total_processed=0
total_synced=0
batch_num=0

while :; do
  batch_num=$((batch_num + 1))
  response=$(curl -sS -X POST \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"offset\":$OFFSET,\"limit\":$BATCH_SIZE,\"region\":\"$REGION\"}" \
    "$WORKER_URL/api/ferment/backfill/customers")

  processed=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('processed',0))")
  synced=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('synced',0))")
  next_offset=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('next_offset',0))")
  done_flag=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('done',False))")

  total_processed=$((total_processed + processed))
  total_synced=$((total_synced + synced))

  printf "  [batch %3d] offset=%-6d processed=%-3d synced=%-3d (total synced: %d)\n" \
    "$batch_num" "$OFFSET" "$processed" "$synced" "$total_synced"

  OFFSET=$next_offset

  if [ "$done_flag" = "True" ] || [ "$processed" = "0" ]; then
    echo ""
    echo "▶ バックフィル完了"
    echo "  合計処理件数: $total_processed"
    echo "  合計同期件数: $total_synced"
    break
  fi
done

# 最終ステータス
echo ""
echo "▶ 最終ステータス:"
curl -sS -H "Authorization: Bearer $API_TOKEN" "$WORKER_URL/api/ferment/backfill/customers/status" \
  | python3 -m json.tool
