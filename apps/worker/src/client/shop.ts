/**
 * LIFF Shop — LINE内でポイント確認〜購入まで完結
 *
 * Called from: LIFF_URL?page=shop
 * Flow:
 *   1. LIFF認証 → LINE userId 取得
 *   2. POST /api/shop/balance → ポイント残高表示
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

async function fetchProducts(lineUserId: string): Promise<Product[]> {
  const res = await fetch('/api/shop/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineUserId }),
  });
  const data = await res.json() as { success: boolean; data?: Product[]; error?: string };
  if (!data.success || !data.data) throw new Error(data.error || '商品情報の取得に失敗しました');
  return data.data;
}

async function fetchBalance(lineUserId: string): Promise<ShopBalance> {
  const res = await fetch('/api/shop/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineUserId }),
  });
  const data = await res.json() as { success: boolean; data?: ShopBalance; error?: string };
  if (res.status === 404) {
    const err = new Error(data.error || 'LINE連携が見つかりません');
    (err as Error & { code?: string }).code = 'NOT_LINKED';
    throw err;
  }
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
    const maxUsable = Math.min(totalBalance, Math.floor(p.price / 100) * 100);
    const effectivePrice = p.price - maxUsable;

    return `
      <div class="product-card">
        <div class="product-image">
          ${p.imageUrl
            ? `<img src="${p.imageUrl}" alt="${escapeHtml(p.title)}" loading="lazy" />`
            : `<div class="product-image-placeholder">${escapeHtml(p.title.charAt(0))}</div>`
          }
        </div>
        <div class="product-body">
          <div class="product-title">${escapeHtml(p.title)}</div>
          <div class="product-price-row">
            ${totalBalance > 0 && maxUsable > 0 ? `
              <span class="product-price-original">${formatPrice(p.price)}</span>
              <span class="product-price-badge">-${maxUsable.toLocaleString()}pt</span>
            ` : ''}
            <div class="product-price-final">${totalBalance > 0 && maxUsable > 0 ? formatPrice(effectivePrice) : formatPrice(p.price)}</div>
          </div>
          <button
            class="buy-btn"
            data-variant="${p.variantId}"
            ${totalBalance === 0 || maxUsable === 0 ? 'disabled' : ''}
          >
            ${totalBalance > 0 && maxUsable > 0 ? 'ポイントで買う' : 'ポイントがありません'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  render(`
    <div class="shop-page">
      <!-- ヘッダー -->
      <div class="shop-header">
        <div class="shop-logo">ORYZAE</div>
        <div class="shop-subtitle">ポイントで買う</div>
      </div>

      <!-- 残高カード -->
      <div class="balance-card">
        <div class="balance-label">保有ポイント</div>
        <div class="balance-row">
          <span class="balance-value">${totalBalance.toLocaleString()}</span>
          <span class="balance-unit">pt</span>
        </div>
        ${expiry ? `<div class="balance-expiry">⚠ ${expiry}</div>` : ''}
        <div class="balance-breakdown">
          通常 ${balance.balance.toLocaleString()}pt
          ${balance.limitedBalance > 0 ? `<span class="balance-limited">+ 期間限定 ${balance.limitedBalance.toLocaleString()}pt</span>` : ''}
        </div>
      </div>

      <!-- 商品一覧 -->
      <div class="products-section">
        <div class="products-title">商品を選ぶ</div>
        <div class="product-list">
          ${productCards}
        </div>
        <p class="shop-note">※ タップ後、Shopifyのお支払い画面に進みます</p>
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
        const product = products.find(p => p.variantId === variantId);
        if (!product) throw new Error('商品が見つかりません');
        const usePoints = Math.min(totalBalance, Math.floor(product.price / 100) * 100);
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

    // 残高取得
    // liff.getFriendship() は LINE Login チャネルとMessaging APIチャネルの紐づきや
    // LIFF起動状態に依存して false になることがあるため、LIFF ShopではDB上の連携状態を正にする。
    // fetchBalance() 側で lineUserId → friends → loyalty_points を確認し、未連携ならエラーにする。
    balance = await fetchBalance(profile.userId);

    // 商品一覧（購入履歴に応じてパーソナライズ）
    const products = await fetchProducts(profile.userId);

    renderShop(products);
  } catch (err) {
    const code = (err as Error & { code?: string })?.code;
    if (code === 'NOT_LINKED') {
      render(`
        <div class="card">
          <h2>友だち追加が必要です</h2>
          <p class="message">ポイントを利用するには、ORYZAE公式LINEの友だち追加が必要です。</p>
          <a href="https://line.me/R/ti/p/@oryzae_foodcosme" class="add-friend-btn">友だち追加する</a>
        </div>
      `);
    } else {
      renderError(err instanceof Error ? err.message : '読み込みに失敗しました');
    }
  }
}
