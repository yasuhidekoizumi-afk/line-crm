/**
 * 計測リンクのリダイレクト先に配信IDを付ける（2026-11-15）。
 *
 * 目的: クリック時の friend_id 充足率が低い（全体14.6%）ため、注文側の landing_site からも
 * 配信を特定できるようにする。Shopifyはセッション最初のURLを landing_site に保存するので、
 * utm_campaign=linebc_<配信ID先頭8文字> が注文に残る。
 *
 * - 既存のutmパラメータは上書きしない（手動で付けたキャンペーン名を壊さない）
 * - appリンク（X/Instagram等）はShopifyに着地しないため付与しない
 */

export interface TrackedLinkUtmInput {
  linkId: string;
  broadcastId: string | null;
  isAppLink: boolean;
}

const compact = (value: string): string => value.replace(/-/g, '').slice(0, 8);

export function buildTrackedDestination(originalUrl: string, input: TrackedLinkUtmInput): string {
  if (input.isAppLink || !input.broadcastId) return originalUrl;

  let url: URL;
  try {
    url = new URL(originalUrl);
  } catch {
    return originalUrl;
  }

  if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', 'line');
  if (!url.searchParams.has('utm_medium')) url.searchParams.set('utm_medium', 'broadcast');
  if (!url.searchParams.has('utm_campaign')) {
    url.searchParams.set('utm_campaign', `linebc_${compact(input.broadcastId)}`);
  }
  if (!url.searchParams.has('utm_content') && input.linkId) {
    url.searchParams.set('utm_content', `lk_${compact(input.linkId)}`);
  }

  return url.toString();
}

/** 帰属クエリ用のcampaign値（buildTrackedDestinationと必ず同じ規則にする） */
export function broadcastUtmCampaign(broadcastId: string): string {
  return `linebc_${compact(broadcastId)}`;
}
