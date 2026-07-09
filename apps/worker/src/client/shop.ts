/**
 * LIFF Shop — LINE内でポイント確認〜購入まで完結
 *
 * Called from: LIFF_URL?page=shop
 * Flow:
 *   1. LIFF認証 → LINE userId 取得
 *   2. GET /api/shop/balance → ポイント残高表示
 *   3. 商品を選んで「ポイントで買う」→ POST /api/shop/checkout
 *   4. ShopifyカートURLを受け取り、リダイレクト
 */

declare const liff: {
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getFriendship(): Promise<{ friendFlag: boolean }>;
  isInClient(): boolean;
  closeWindow(): void;
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

interface Product {
  variantId: string;
  title: string;
  price: number;
  imageUrl?: string;
}

interface ShopBalance {
  balance: number;
  limitedBalance: number;
  limitedExpiresAt: string | null;
  totalSpent: number;
}

let balance: ShopBalance | null = null;

// ── API ──────────────────────────────────────────

async function fetchBalance(lineUserId: string): Promise<ShopBalance> {
  const res = await fetch('/api/shop/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineUserId }),
  });
  const data = await res.json() as { success: boolean; data?: ShopBalance; error?: string };
  if (!data.success || !data.data) throw new Error(data.error || '残高の取得に失敗しました');
  return data.data;
}

async function checkout(lineUserId: string, variantId: string, points: number): Promise<string> {
  const res = await fetch('/api/shop/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineUserId, variantId, points }),
  });
  const data = await res.json() as { success: boolean; data?: { cartUrl: string }; error?: string };
  if (!data.success || !data.data) throw new Error(data.error || 'チェックアウトに失敗しました');
  return data.data.cartUrl;
}

// ── UI ───────────────────────────────────────────

function render(html: string): void {
  const container = document.getElementById('app');
  if (container) container.innerHTML = html;
}

function formatExpiry(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}まで`;
  } catch {
    return '';
  }
}

function formatPrice(price: number): string {
  return `¥${price.toLocaleString()}`;
}

function renderLoading(): void {
  render(`
    <div class="card">
      <div class="loading-spinner"></div>
      <p>読み込み中...</p>
    </div>
  `);
}

function renderError(message: string): void {
  render(`
    <div class="card">
      <h2>エラー</h2>
      <p class="error">${escapeHtml(message)}</p>
    </div>
  `);
}

function renderShop(products: Product[]): void {
  if (!balance) return;

  const totalBalance = balance.balance + balance.limitedBalance;
  const expiry = formatExpiry(balance.limitedExpiresAt);

  const productCards = products.map((p) => {
    const discount = Math.min(totalBalance, p.price);
    const effectivePrice = p.price - discount;
    const maxUsable = Math.min(totalBalance, Math.floor(p.price / 100) * 100);

    return `
      <div class="product-card">
        <div class="product-info">
          <div class="product-title">${escapeHtml(p.title)}</div>
          <div class="product-price">
            <span class="original-price">${formatPrice(p.price)}</span>
            ${totalBalance > 0 ? `
              <span class="arrow">→</span>
              <span class="effective-price">実質 ${formatPrice(effectivePrice)}</span>
            ` : ''}
          </div>
          ${totalBalance > 0 ? `<div class="points-note">💮 ${maxUsable}pt利用可能</div>` : ''}
        </div>
        <button
          class="buy-btn"
          data-variant="${p.variantId}"
          ${totalBalance === 0 ? 'disabled' : ''}
        >
          ${totalBalance > 0 ? 'ポイントで買う' : 'ポイントがありません'}
        </button>
      </div>
    `;
  }).join('');

  render(`
    <div class="shop-container">
      <div class="balance-card">
        <div class="balance-icon">💮</div>
        <div class="balance-amount">${totalBalance.toLocaleString()}pt</div>
        ${expiry ? `<div class="balance-expiry">${expiry}</div>` : ''}
        <div class="balance-detail">
          通常 ${balance.balance.toLocaleString()}pt
          ${balance.limitedBalance > 0 ? ` + 期間限定 ${balance.limitedBalance.toLocaleString()}pt` : ''}
        </div>
      </div>

      <div class="products-section">
        <h3>ポイントで買える商品</h3>
        <div class="product-list">
          ${productCards}
        </div>
        <p class="shop-note">※ タップ後、Shopifyのチェックアウト画面で配送先とお支払いを入力してください</p>
      </div>
    </div>
  `);

  // 購入ボタンのイベント
  document.querySelectorAll('.buy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const variantId = (e.currentTarget as HTMLElement).dataset.variant;
      if (!variantId) return;

      const button = e.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = '処理中...';

      try {
        const profile = await liff.getProfile();
        const usePoints = Math.min(totalBalance, Math.floor(products.find(p => p.variantId === variantId)?.price ?? 0 / 100) * 100);
        const url = await checkout(profile.userId, variantId, usePoints);
        window.location.href = url;
      } catch (err) {
        button.disabled = false;
        button.textContent = 'ポイントで買う';
        alert(err instanceof Error ? err.message : 'エラーが発生しました');
      }
    });
  });
}

// ── Entry Point ──────────────────────────────────

export async function initShop(): Promise<void> {
  renderLoading();

  try {
    const profile = await liff.getProfile();

    // 友だちチェック
    let friendFlag = false;
    try {
      friendFlag = (await liff.getFriendship()).friendFlag;
    } catch { /* ignore */ }

    if (!friendFlag) {
      render(`
        <div class="card">
          <h2>友だち追加が必要です</h2>
          <p>ポイントを利用するには、ORYZAE公式LINEの友だち追加が必要です。</p>
          <a href="https://line.me/R/ti/p/@oryzae_foodcosme" class="add-friend-btn">友だち追加する</a>
        </div>
      `);
      return;
    }

    // 残高取得
    balance = await fetchBalance(profile.userId);

    // 商品データ（variant ID は後で設定）
    const products: Product[] = [
      { variantId: '49489292198047', title: 'PLAIN プレーン 550g', price: 4536 },
      { variantId: '49489293017247', title: 'BANANA COCONUTS 550g', price: 4536 },
      { variantId: '49489290576031', title: 'DRIED FRUIT 550g', price: 4536 },
      { variantId: 'SET3_PLACEHOLDER',   title: '人気3種お試しセット', price: 2980 },
    ];

    renderShop(products);
  } catch (err) {
    renderError(err instanceof Error ? err.message : '読み込みに失敗しました');
  }
}
