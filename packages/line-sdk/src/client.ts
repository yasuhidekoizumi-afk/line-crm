import type {
  BroadcastRequest,
  FlexContainer,
  Message,
  MulticastRequest,
  PushMessageRequest,
  ReplyMessageRequest,
  RichMenuObject,
  UserProfile,
} from './types.js';

const LINE_API_BASE = 'https://api.line.me/v2/bot';

export class LineClient {
  constructor(private readonly channelAccessToken: string) {}

  // ─── Core request helper ──────────────────────────────────────────────────

  private async request<T = unknown>(
    path: string,
    body: object,
    method: 'GET' | 'POST' | 'DELETE' = 'POST',
  ): Promise<T> {
    const url = `${LINE_API_BASE}${path}`;

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.channelAccessToken}`,
      },
    };

    if (method !== 'GET' && method !== 'DELETE') {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `LINE API error: ${res.status} ${res.statusText} — ${text}`,
      );
    }

    // Some endpoints (e.g. push, reply) return an empty body with 200.
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return res.json() as Promise<T>;
    }

    return undefined as unknown as T;
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<UserProfile> {
    return this.request<UserProfile>(
      `/profile/${encodeURIComponent(userId)}`,
      {},
      'GET',
    );
  }

  // ─── Message Quota（今月の配信数・上限） ───────────────────────────────────

  /**
   * 当月のメッセージ配信上限を取得。
   * type='limited' のとき value に上限通数（例: 無料枠+追加分の合計プラン上限）。
   * type='none' なら無制限。
   * LINE公式ダッシュボードの「○○通 / △△通」の分母に相当。
   */
  async getMessageQuota(): Promise<{ type: 'none' | 'limited'; value?: number }> {
    return this.request<{ type: 'none' | 'limited'; value?: number }>(
      '/message/quota',
      {},
      'GET',
    );
  }

  /**
   * 当月の「上限にカウントされた送信メッセージ数」を取得。
   * LINE公式ダッシュボードの分子（例: 41,717通）に相当。
   */
  async getMessageQuotaConsumption(): Promise<{ totalUsage: number }> {
    return this.request<{ totalUsage: number }>(
      '/message/quota/consumption',
      {},
      'GET',
    );
  }

  // ─── Messaging ───────────────────────────────────────────────────────────

  async pushMessage(to: string, messages: Message[]): Promise<void> {
    const body: PushMessageRequest = { to, messages };
    await this.request('/message/push', body);
  }

  async multicast(to: string[], messages: Message[]): Promise<void> {
    // 多層防御: NULL/空文字のユーザーIDが1件でも混じると LINE API がリクエスト全体を
    // 400 で弾き、バッチ全員(最大500人)への送信が失敗する。呼び出し側でも除外しているが、
    // 最後の砦としてここでも除外する。
    const validTo = to.filter((id) => typeof id === 'string' && id.trim() !== '');
    if (validTo.length === 0) return; // 有効な宛先ゼロなら何もしない（空バッチはスキップ）
    const body: MulticastRequest = { to: validTo, messages };
    await this.request('/message/multicast', body);
  }

  async broadcast(messages: Message[]): Promise<void> {
    const body: BroadcastRequest = { messages };
    await this.request('/message/broadcast', body);
  }

  async replyMessage(
    replyToken: string,
    messages: Message[],
  ): Promise<void> {
    const body: ReplyMessageRequest = { replyToken, messages };
    await this.request('/message/reply', body);
  }

  // ─── Rich Menu ────────────────────────────────────────────────────────────

  async getRichMenuList(): Promise<{ richmenus: RichMenuObject[] }> {
    return this.request<{ richmenus: RichMenuObject[] }>(
      '/richmenu/list',
      {},
      'GET',
    );
  }

  async createRichMenu(menu: RichMenuObject): Promise<{ richMenuId: string }> {
    return this.request<{ richMenuId: string }>('/richmenu', menu);
  }

  async deleteRichMenu(richMenuId: string): Promise<void> {
    await this.request(
      `/richmenu/${encodeURIComponent(richMenuId)}`,
      {},
      'DELETE',
    );
  }

  async setDefaultRichMenu(richMenuId: string): Promise<void> {
    await this.request(
      `/user/all/richmenu/${encodeURIComponent(richMenuId)}`,
      {},
    );
  }

  async linkRichMenuToUser(userId: string, richMenuId: string): Promise<void> {
    await this.request(
      `/user/${encodeURIComponent(userId)}/richmenu/${encodeURIComponent(richMenuId)}`,
      {},
    );
  }

  async unlinkRichMenuFromUser(userId: string): Promise<void> {
    await this.request(
      `/user/${encodeURIComponent(userId)}/richmenu`,
      {},
      'DELETE',
    );
  }

  async getRichMenuIdOfUser(userId: string): Promise<{ richMenuId: string }> {
    return this.request<{ richMenuId: string }>(
      `/user/${encodeURIComponent(userId)}/richmenu`,
      {},
      'GET',
    );
  }

  async getDefaultRichMenuId(): Promise<{ richMenuId: string }> {
    return this.request<{ richMenuId: string }>(
      '/user/all/richmenu',
      {},
      'GET',
    );
  }

  async cancelDefaultRichMenu(): Promise<void> {
    await this.request(
      '/user/all/richmenu',
      {},
      'DELETE',
    );
  }

  // ─── Rich Menu Aliases ────────────────────────────────────────────────────

  async createRichMenuAlias(
    richMenuAliasId: string,
    richMenuId: string,
  ): Promise<void> {
    await this.request('/richmenu/alias', { richMenuAliasId, richMenuId });
  }

  async deleteRichMenuAlias(richMenuAliasId: string): Promise<void> {
    await this.request(
      `/richmenu/alias/${encodeURIComponent(richMenuAliasId)}`,
      {},
      'DELETE',
    );
  }

  /**
   * Update which rich menu an alias points to.
   * LINE's spec uses POST (not PUT) for this endpoint.
   */
  async updateRichMenuAlias(
    richMenuAliasId: string,
    richMenuId: string,
  ): Promise<void> {
    await this.request(
      `/richmenu/alias/${encodeURIComponent(richMenuAliasId)}`,
      { richMenuId },
    );
  }

  async getRichMenuAlias(
    richMenuAliasId: string,
  ): Promise<{ richMenuAliasId: string; richMenuId: string }> {
    return this.request<{ richMenuAliasId: string; richMenuId: string }>(
      `/richmenu/alias/${encodeURIComponent(richMenuAliasId)}`,
      {},
      'GET',
    );
  }

  async getRichMenuAliasList(): Promise<{
    aliases: Array<{ richMenuAliasId: string; richMenuId: string }>;
  }> {
    return this.request<{
      aliases: Array<{ richMenuAliasId: string; richMenuId: string }>;
    }>('/richmenu/alias/list', {}, 'GET');
  }

  /** Fetch a rich menu image as binary. Returns the body and content-type. */
  async getRichMenuImage(
    richMenuId: string,
  ): Promise<{ body: ArrayBuffer; contentType: string }> {
    const url = `https://api-data.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.channelAccessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LINE API error: ${res.status} ${res.statusText} — ${text}`);
    }
    const contentType = res.headers.get('content-type') ?? 'image/png';
    const body = await res.arrayBuffer();
    return { body, contentType };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async pushTextMessage(to: string, text: string): Promise<void> {
    await this.pushMessage(to, [{ type: 'text', text }]);
  }

  async pushFlexMessage(
    to: string,
    altText: string,
    contents: FlexContainer,
  ): Promise<void> {
    await this.pushMessage(to, [{ type: 'flex', altText, contents }]);
  }

  // ─── Rich Menu Image Upload ─────────────────────────────────────────────

  /** Upload image to a rich menu. Accepts PNG/JPEG binary (ArrayBuffer or Uint8Array). */
  async uploadRichMenuImage(
    richMenuId: string,
    imageData: ArrayBuffer,
    contentType: 'image/png' | 'image/jpeg' = 'image/png',
  ): Promise<void> {
    const url = `https://api-data.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${this.channelAccessToken}`,
      },
      body: imageData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LINE API error: ${res.status} ${res.statusText} — ${text}`);
    }
  }
}
