/**
 * LIFF Shopify連携ページ
 *
 * 遷移元: Shopify 顧客アカウントページの「LINE連携する」ボタン
 *   https://liff.line.me/<LIFF_ID>?page=link-shopify&shopifyCustomerId={{customer.id}}
 *
 * 処理:
 *   1. URLクエリから shopifyCustomerId を取得
 *   2. liff.getAccessToken() で LINE アクセストークンを取得
 *      （IDトークンはLIFFチャネルの openid スコープに依存するため避ける）
 *   3. POST /api/liff/link-shopify に送信 → サーバーで /v2/profile で検証 → 紐付け + 300ptボーナス + 過去注文backfill
 *   4. 結果を表示
 */

declare const liff: {
  getIDToken(): string | null;
  getAccessToken(): string | null;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  isInClient(): boolean;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  logout(): void;
  closeWindow(): void;
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function render(html: string): void {
  const container = document.getElementById('app');
  if (container) container.innerHTML = html;
}

function showLoading(message: string): void {
  render(`
    <div class="card">
      <div class="loading-spinner"></div>
      <p class="message">${escapeHtml(message)}</p>
    </div>
  `);
}

function showSuccess(data: { bonusAwarded: number; backfilledOrders: number; backfilledPoints: number }): void {
  const { bonusAwarded, backfilledOrders, backfilledPoints } = data;
  const totalPoints = bonusAwarded + backfilledPoints;
  const lines: string[] = [];
  if (bonusAwarded > 0) {
    lines.push(`🎁 LINE連携ボーナス <strong>+${bonusAwarded}pt</strong>`);
  } else {
    lines.push('連携が完了しました！');
  }
  if (backfilledOrders > 0) {
    lines.push(`🛍 過去のご購入 ${backfilledOrders}件 <strong>+${backfilledPoints}pt</strong>`);
  }
  const totalLine = totalPoints > 0
    ? `<p class="message" style="margin-top:16px;font-size:15px;color:#06C755;font-weight:700;">合計 +${totalPoints}pt を付与しました</p>`
    : '';

  render(`
    <div class="card">
      <div class="check-icon">✓</div>
      <h2>LINE連携完了！</h2>
      <p class="message">${lines.join('<br>')}</p>
      ${totalLine}
      <button id="closeBtn" class="close-btn" style="margin-top:24px;">閉じる</button>
    </div>
  `);

  const closeBtn = document.getElementById('closeBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (liff.isInClient()) {
        liff.closeWindow();
      } else {
        window.close();
      }
    });
  }
}

function collectDebugInfo(extra: Record<string, unknown> = {}): string {
  const params = new URLSearchParams(window.location.search);
  const info: Record<string, unknown> = {
    ua: navigator.userAgent,
    url: window.location.href,
    shopifyCustomerId: params.get('shopifyCustomerId'),
    page: params.get('page'),
    time: new Date().toISOString(),
  };
  try { info.isInClient = liff.isInClient(); } catch (e) { info.isInClient = `err:${(e as Error).message}`; }
  try { info.isLoggedIn = liff.isLoggedIn(); } catch (e) { info.isLoggedIn = `err:${(e as Error).message}`; }
  try {
    const tok = liff.getAccessToken();
    info.hasAccessToken = !!tok;
    info.accessTokenLen = tok ? tok.length : 0;
  } catch (e) {
    info.hasAccessToken = `err:${(e as Error).message}`;
  }
  try {
    const id = liff.getIDToken();
    info.hasIdToken = !!id;
  } catch (e) {
    info.hasIdToken = `err:${(e as Error).message}`;
  }
  Object.assign(info, extra);
  return JSON.stringify(info, null, 2);
}

function showError(message: string, debugExtra: Record<string, unknown> = {}): void {
  const debug = collectDebugInfo(debugExtra);
  render(`
    <div class="card">
      <h2>エラー</h2>
      <p class="error">${escapeHtml(message)}</p>
      <details style="margin-top:16px;text-align:left;">
        <summary style="cursor:pointer;font-size:12px;color:#666;">🔧 デバッグ情報（サポート用・タップして展開）</summary>
        <pre id="debug-info" style="margin-top:8px;padding:12px;background:#f5f5f5;border-radius:6px;font-size:11px;line-height:1.5;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${escapeHtml(debug)}</pre>
        <button id="copyDebugBtn" style="margin-top:8px;padding:8px 12px;background:#06C755;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">デバッグ情報をコピー</button>
      </details>
      <p class="sub-message" style="margin-top:16px;">お手数ですが、ORYZAEサポートまでご連絡ください。<br>上の「デバッグ情報をコピー」を押してスクショに添えていただけると助かります。</p>
    </div>
  `);
  const btn = document.getElementById('copyDebugBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(debug);
        btn.textContent = 'コピーしました ✓';
      } catch {
        const pre = document.getElementById('debug-info');
        if (pre) {
          const range = document.createRange();
          range.selectNode(pre);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
        }
        btn.textContent = '全選択済み → 手動コピーしてください';
      }
    });
  }
}

export async function initLinkShopify(): Promise<void> {
  try {
    const params = new URLSearchParams(window.location.search);
    const shopifyCustomerId = params.get('shopifyCustomerId');
    if (!shopifyCustomerId) {
      showError('Shopify顧客IDが指定されていません。Shopifyのマイページからアクセスしてください。', {
        stage: 'missingCustomerId',
      });
      return;
    }

    showLoading('LINE連携を処理しています...');

    // アクセストークンを取得（LIFFチャネルのopenidスコープ非依存）
    let accessToken = liff.getAccessToken();
    if (!accessToken) {
      // まだ一度もログインしていない状態 → login() で発行
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href });
        return;
      }
      showError('LINEアクセストークンが取得できません。LINEアプリから開きなおしてください。', {
        stage: 'missingAccessToken',
      });
      return;
    }

    let res: Response;
    let rawBody = '';
    try {
      res = await fetch('/api/liff/link-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, shopifyCustomerId }),
      });
      rawBody = await res.text();
    } catch (netErr) {
      showError('サーバーに接続できませんでした', {
        stage: 'fetch',
        netError: netErr instanceof Error ? netErr.message : String(netErr),
      });
      return;
    }

    let json: { success: boolean; data?: { bonusAwarded: number; backfilledOrders: number; backfilledPoints: number }; error?: string } | null = null;
    try {
      json = JSON.parse(rawBody);
    } catch {
      showError('サーバー応答が不正です', {
        stage: 'parseJson',
        httpStatus: res.status,
        rawBody: rawBody.slice(0, 500),
      });
      return;
    }

    if (!res.ok || !json?.success) {
      showError(json?.error || `連携に失敗しました（HTTP ${res.status}）`, {
        stage: 'serverError',
        httpStatus: res.status,
        serverError: json?.error,
      });
      return;
    }

    showSuccess(json.data ?? { bonusAwarded: 0, backfilledOrders: 0, backfilledPoints: 0 });
  } catch (err) {
    showError(err instanceof Error ? err.message : '連携処理中にエラーが発生しました。', {
      stage: 'unhandled',
      errorName: err instanceof Error ? err.name : typeof err,
      errorStack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join(' | ') : undefined,
    });
  }
}
