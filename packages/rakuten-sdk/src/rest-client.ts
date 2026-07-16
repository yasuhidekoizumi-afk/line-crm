/**
 * Rakuten RMS REST API (Order/Item) — Cloudflare Workers compatible
 *
 * Base: https://api.rms.rakuten.co.jp/es/2.0
 * Auth: ESA Base64(serviceSecret:licenseKey)
 *
 * 注文API・商品APIのRESTエンドポイントを提供する。
 * 問い合わせAPI（ESA SOAP風）は rms-client.ts に残す。
 */

import { RmsApiError, RmsLicenseExpiredError, RmsRateLimitError } from './errors.js';

const REST_BASE = 'https://api.rms.rakuten.co.jp/es/2.0';

const ACTIVE_PROGRESS = [100, 200, 300, 400, 500, 600, 700];

export interface RmsRestOptions {
  serviceSecret: string;
  licenseKey: string;
  baseUrl?: string;
}

// ─── Types ──────────────────────────────────────

export interface RmsOrderSummary {
  orderNumber: string;
  orderDatetime: string;
  totalPrice: number;
  goodsTax: number;
  couponShopPrice: number;
  couponOtherPrice: number;
  deliveryPrice: number;
  progress: number;
  items: RmsOrderItem[];
}

export interface RmsOrderItem {
  itemNumber: string;
  itemName: string;
  units: number;
  price: number;
}

export interface RmsDailySales {
  date: string;
  orders: number;
  revenue: number;
  tax: number;
  shopCoupon: number;
  delivery: number;
}

export interface RmsProductRank {
  itemNumber: string;
  itemName: string;
  qty: number;
  revenue: number;
  gross: number;
  avgPrice: number;
}

export interface RmsDashboardData {
  kpi: {
    totalRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
    period: { start: string; end: string };
  };
  dailySales: RmsDailySales[];
  productRanking: RmsProductRank[];
  baseline: {
    avgDailyRevenue: number;
    avgDailyOrders: number;
  };
}

// ─── Client ─────────────────────────────────────

export class RmsRestClient {
  private readonly serviceSecret: string;
  private readonly licenseKey: string;
  private readonly baseUrl: string;

  constructor(opts: RmsRestOptions) {
    this.serviceSecret = opts.serviceSecret;
    this.licenseKey = opts.licenseKey;
    this.baseUrl = opts.baseUrl ?? REST_BASE;
  }

  private authHeader(): string {
    const raw = `${this.serviceSecret}:${this.licenseKey}`;
    const b64 = btoa(raw);
    return `ESA ${b64}`;
  }

  // ─── Order API ──────────────────────────────

  /**
   * 注文検索: 期間内の注文番号リストを取得（全ページ自動取得）
   */
  async searchOrderNumbers(
    startDatetime: string,
    endDatetime: string,
    opts?: { dateType?: number; progressList?: number[] },
  ): Promise<string[]> {
    const dateType = opts?.dateType ?? 1;
    const progressList = opts?.progressList ?? ACTIVE_PROGRESS;
    const allNumbers: string[] = [];
    let page = 1;
    const pageSize = 1000;
    const maxPages = 100;

    while (true) {
      const body: Record<string, unknown> = {
        dateType,
        startDatetime,
        endDatetime,
        PaginationRequestModel: {
          requestRecordsAmount: pageSize,
          requestPage: page,
        },
        orderProgressList: progressList,
      };
      const res = await this.post<{ orderNumberList: string[] | null; PaginationResponseModel?: { totalPages?: number } }>(
        '/order/searchOrder/',
        body,
      );
      const nums = res.orderNumberList ?? [];
      allNumbers.push(...nums);
      const totalPages = res.PaginationResponseModel?.totalPages ?? 0;
      if (totalPages && page >= totalPages) break;
      if (nums.length < pageSize) break;
      page++;
      if (page > maxPages) break;
    }
    return allNumbers;
  }

  /**
   * 注文詳細取得（100件ずつチャンク）
   */
  async getOrders(orderNumbers: string[]): Promise<RmsOrderSummary[]> {
    const chunkSize = 100;
    const allOrders: RmsOrderSummary[] = [];

    for (let i = 0; i < orderNumbers.length; i += chunkSize) {
      const chunk = orderNumbers.slice(i, i + chunkSize);
      const res = await this.post<{ OrderModelList: Record<string, unknown>[] | null }>(
        '/order/getOrder/',
        { orderNumberList: chunk, version: '7' },
      );
      const orders = res.OrderModelList ?? [];
      for (const o of orders) {
        allOrders.push(this.parseOrder(o));
      }
    }
    return allOrders;
  }

  /**
   * 期間内の全注文を取得（searchOrder + getOrder の組み合わせ）
   * Workers実行時間上限（30s）を考慮し、日次分割で取得する。
   */
  async getOrdersInRange(
    startDatetime: string,
    endDatetime: string,
    opts?: { dateType?: number; progressList?: number[] },
  ): Promise<RmsOrderSummary[]> {
    const numbers = await this.searchOrderNumbers(startDatetime, endDatetime, opts);
    if (numbers.length === 0) return [];
    return this.getOrders(numbers);
  }

  // ─── Item API (REST 2.0) ────────────────────

  /**
   * 商品検索 (GET /items/search/)
   * 10件/ページ固定。search_all相当は呼び出し側でループ。
   */
  async searchItems(opts?: {
    searchType?: number;
    offset?: number;
    itemUrl?: string;
    genreId?: number;
  }): Promise<{ numFound: number; results: Record<string, unknown>[] }> {
    const params = new URLSearchParams();
    params.set('searchType', String(opts?.searchType ?? 1));
    params.set('offset', String(opts?.offset ?? 0));
    if (opts?.itemUrl) params.set('itemUrl', opts.itemUrl);
    if (opts?.genreId) params.set('genreId', String(opts.genreId));

    const res = await this.get<{ numFound: number; results?: Record<string, unknown>[] }>(
      `/items/search/?${params.toString()}`,
    );
    return { numFound: res.numFound ?? 0, results: res.results ?? [] };
  }

  /**
   * 全商品取得（10件/ページで自動ページング）
   * 商品数が多い場合は時間がかかるため、キャッシュを推奨。
   */
  async searchAllItems(): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    let offset = 0;
    const pageSize = 10;
    while (true) {
      const r = await this.searchItems({ offset });
      all.push(...r.results);
      if (all.length >= r.numFound || r.results.length === 0) break;
      offset += pageSize;
    }
    return all;
  }

  // ─── Dashboard helpers（高レベル集計） ──────

  /**
   * ダッシュボード用データを一括取得
   * 過去N日の売上サマリー + 商品ランキング + 平常日ベースライン
   */
  async getDashboardData(days: number = 30): Promise<RmsDashboardData> {
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const nowJst = new Date(now.getTime() + jstOffset);
    const start = new Date(nowJst.getTime() - days * 24 * 60 * 60 * 1000);

    const startStr = this.toRmsDatetime(start);
    const endStr = this.toRmsDatetime(nowJst);

    const orders = await this.getOrdersInRange(startStr, endStr);

    // KPI
    const totalRevenue = orders.reduce((s, o) => s + (o.totalPrice ?? 0), 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? Math.floor(totalRevenue / totalOrders) : 0;

    // Daily sales
    const dailyMap = new Map<string, { orders: number; revenue: number; tax: number; shopCoupon: number; delivery: number }>();
    for (const o of orders) {
      const d = (o.orderDatetime ?? '').slice(0, 10);
      if (!d) continue;
      const cur = dailyMap.get(d) ?? { orders: 0, revenue: 0, tax: 0, shopCoupon: 0, delivery: 0 };
      cur.orders++;
      cur.revenue += o.totalPrice ?? 0;
      cur.tax += o.goodsTax ?? 0;
      cur.shopCoupon += o.couponShopPrice ?? 0;
      cur.delivery += o.deliveryPrice ?? 0;
      dailyMap.set(d, cur);
    }
    const dailySales: RmsDailySales[] = [...dailyMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Product ranking
    const prodMap = new Map<string, { itemNumber: string; itemName: string; qty: number; revenue: number; gross: number }>();
    for (const o of orders) {
      let gross = 0;
      for (const item of o.items) {
        gross += (item.units ?? 0) * (item.price ?? 0);
      }
      for (const item of o.items) {
        const key = item.itemNumber || item.itemName;
        const cur = prodMap.get(key) ?? { itemNumber: item.itemNumber, itemName: item.itemName, qty: 0, revenue: 0, gross: 0 };
        cur.qty += item.units ?? 0;
        const lineTotal = (item.units ?? 0) * (item.price ?? 0);
        cur.gross += lineTotal;
        if (o.totalPrice && gross) {
          cur.revenue += Math.round((o.totalPrice * lineTotal) / gross);
        } else {
          cur.revenue += lineTotal;
        }
        prodMap.set(key, cur);
      }
    }
    const productRanking: RmsProductRank[] = [...prodMap.values()]
      .map((p) => ({
        itemNumber: p.itemNumber,
        itemName: p.itemName,
        qty: p.qty,
        revenue: p.revenue,
        gross: p.gross,
        avgPrice: p.qty > 0 ? Math.floor(p.revenue / p.qty) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Baseline: 平常日平均（中央値ベース、スパイク日を除外）
    const sortedRev = dailySales.map((d) => d.revenue).sort((a, b) => a - b);
    const mid = Math.floor(sortedRev.length / 2);
    const baselineRevenue = sortedRev.length > 0 ? sortedRev[mid] : 0;
    const sortedOrd = dailySales.map((d) => d.orders).sort((a, b) => a - b);
    const baselineOrders = sortedOrd.length > 0 ? sortedOrd[Math.floor(sortedOrd.length / 2)] : 0;

    return {
      kpi: {
        totalRevenue,
        totalOrders,
        avgOrderValue,
        period: { start: startStr.slice(0, 10), end: endStr.slice(0, 10) },
      },
      dailySales,
      productRanking,
      baseline: {
        avgDailyRevenue: baselineRevenue,
        avgDailyOrders: baselineOrders,
      },
    };
  }

  /**
   * 特定日の売上を取得（効果測定用）
   */
  async getDailySales(date: string): Promise<{ orders: number; revenue: number; topProducts: { name: string; qty: number }[] }> {
    const start = `${date}T00:00:00+0900`;
    const end = `${date}T23:59:59+0900`;
    const orders = await this.getOrdersInRange(start, end);
    const revenue = orders.reduce((s, o) => s + (o.totalPrice ?? 0), 0);

    const prodMap = new Map<string, { name: string; qty: number }>();
    for (const o of orders) {
      for (const item of o.items) {
        const key = item.itemNumber || item.itemName;
        const cur = prodMap.get(key) ?? { name: item.itemName, qty: 0 };
        cur.qty += item.units ?? 0;
        prodMap.set(key, cur);
      }
    }
    const topProducts = [...prodMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
    return { orders: orders.length, revenue, topProducts };
  }

  // ─── Internal ───────────────────────────────

  private parseOrder(raw: Record<string, unknown>): RmsOrderSummary {
    const items: RmsOrderItem[] = [];
    const packages = (raw.PackageModelList ?? []) as Record<string, unknown>[];
    for (const pkg of packages) {
      const itemModels = (pkg.ItemModelList ?? []) as Record<string, unknown>[];
      for (const item of itemModels) {
        items.push({
          itemNumber: String(item.itemNumber ?? ''),
          itemName: String(item.itemName ?? ''),
          units: Number(item.units ?? 0),
          price: Number(item.price ?? 0),
        });
      }
    }
    return {
      orderNumber: String(raw.orderNumber ?? ''),
      orderDatetime: String(raw.orderDatetime ?? ''),
      totalPrice: Number(raw.totalPrice ?? 0),
      goodsTax: Number(raw.goodsTax ?? 0),
      couponShopPrice: Number(raw.couponShopPrice ?? 0),
      couponOtherPrice: Number(raw.couponOtherPrice ?? 0),
      deliveryPrice: Number(raw.deliveryPrice ?? 0),
      progress: Number(raw.orderProgress ?? 0),
      items,
    };
  }

  private toRmsDatetime(d: Date): string {
    // RMS expects: YYYY-MM-DDTHH:MM:SS+0900
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+0900`;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.baseUrl + path;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res, path);
  }

  private async get<T>(path: string): Promise<T> {
    const url = this.baseUrl + path;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader(),
      },
    });
    return this.handleResponse<T>(res, path);
  }

  private async handleResponse<T>(res: Response, path: string): Promise<T> {
    const text = await res.text();
    if (res.status === 401) {
      throw new RmsLicenseExpiredError(path, text);
    }
    if (res.status === 429) {
      throw new RmsRateLimitError(path, text);
    }
    if (!res.ok) {
      throw new RmsApiError(`Rakuten REST API ${res.status} at ${path}`, res.status, path, text);
    }
    return JSON.parse(text) as T;
  }
}
