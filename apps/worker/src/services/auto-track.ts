import { createTrackedLink } from '@line-crm/db';

// Domains where Universal Links / App Links should be used
const APP_LINK_DOMAINS = new Set([
  'x.com',
  'twitter.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'facebook.com',
  'github.com',
]);

function isAppLinkDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return APP_LINK_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

const URL_REGEX = /https?:\/\/[^\s"'<>\])}]+/g;

// URLs that should NOT be wrapped (internal/system URLs)
const SKIP_PATTERNS = [
  /\/t\/[0-9a-f-]{36}/,       // already a tracking link
  /liff\.line\.me/,            // LIFF URLs
  /line\.me\/R\//,             // LINE deep links
  /line-crm-worker/,           // our own worker
];

function shouldSkip(url: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(url));
}

/** Flex内のタップ操作URLだけを抽出する。画像取得URLはクリックではないため除外する。 */
export function extractFlexActionUris(value: unknown): string[] {
  const urls = new Set<string>();

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const record = node as Record<string, unknown>;
    if (record.type === 'uri') {
      if (typeof record.uri === 'string' && !shouldSkip(record.uri.trim())) {
        urls.add(record.uri.trim());
      }
      const altUri = record.altUri;
      if (altUri && typeof altUri === 'object') {
        const desktop = (altUri as Record<string, unknown>).desktop;
        if (typeof desktop === 'string' && !shouldSkip(desktop.trim())) {
          urls.add(desktop.trim());
        }
      }
    }

    Object.values(record).forEach(visit);
  };

  visit(value);
  return Array.from(urls);
}

function toTrackingUrl(trackingUrl: string, originalUrl: string): string {
  return isAppLinkDomain(originalUrl)
    ? `${trackingUrl}${trackingUrl.includes('?') ? '&' : '?'}openExternalBrowser=1`
    : trackingUrl;
}

async function createTrackingDestination(
  db: D1Database,
  originalUrl: string,
  workerUrl: string,
  name: string,
  broadcastId?: string | null,
): Promise<string> {
  const link = await createTrackedLink(db, {
    name,
    originalUrl,
    broadcastId: broadcastId ?? null,
  });
  return toTrackingUrl(`${workerUrl}/t/${link.id}`, originalUrl);
}

type FlexTrackingLocation = {
  messageIndex?: number;
  cardIndex?: number;
  actionIndex: number;
};

function flexTrackingName(location: FlexTrackingLocation, actionLabel?: string): string {
  const message = location.messageIndex ? `${location.messageIndex}件目 / ` : '';
  const card = location.cardIndex ? `カード${location.cardIndex}` : 'Flex';
  const label = actionLabel?.trim() ? `「${actionLabel.trim()}」` : '';
  return `${message}${card} / CTA${location.actionIndex}${label}`;
}

/**
 * FlexのURIアクションを出現箇所ごとに別リンクとして計測する。
 * 同じ遷移先でもカードごとにIDを分けるため、カルーセル間の比較ができる。
 */
async function replaceFlexActionUrisByOccurrence(
  db: D1Database,
  value: unknown,
  workerUrl: string,
  broadcastId: string | null | undefined,
  location: FlexTrackingLocation,
): Promise<unknown> {
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      result.push(await replaceFlexActionUrisByOccurrence(db, item, workerUrl, broadcastId, location));
    }
    return result;
  }
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;

  if (source.type === 'carousel' && Array.isArray(source.contents)) {
    const result: Record<string, unknown> = { ...source };
    const cards: unknown[] = [];
    for (const [index, card] of source.contents.entries()) {
      cards.push(await replaceFlexActionUrisByOccurrence(db, card, workerUrl, broadcastId, {
        messageIndex: location.messageIndex,
        cardIndex: index + 1,
        actionIndex: 0,
      }));
    }
    result.contents = cards;
    return result;
  }

  if (source.type === 'uri') {
    const result: Record<string, unknown> = { ...source };
    location.actionIndex += 1;
    const name = flexTrackingName(
      location,
      typeof source.label === 'string' ? source.label : undefined,
    );
    const primaryUrl = typeof source.uri === 'string' ? source.uri.trim() : '';
    let primaryTrackingUrl: string | null = null;
    if (primaryUrl && !shouldSkip(primaryUrl)) {
      primaryTrackingUrl = await createTrackingDestination(
        db,
        primaryUrl,
        workerUrl,
        name,
        broadcastId,
      );
      result.uri = primaryTrackingUrl;
    }

    if (source.altUri && typeof source.altUri === 'object') {
      const altUri = source.altUri as Record<string, unknown>;
      const desktopUrl = typeof altUri.desktop === 'string' ? altUri.desktop.trim() : '';
      let desktopTrackingUrl = altUri.desktop;
      if (desktopUrl && desktopUrl === primaryUrl && primaryTrackingUrl) {
        desktopTrackingUrl = primaryTrackingUrl;
      } else if (desktopUrl && !shouldSkip(desktopUrl)) {
        desktopTrackingUrl = await createTrackingDestination(
          db,
          desktopUrl,
          workerUrl,
          `${name}（PC）`,
          broadcastId,
        );
      }
      result.altUri = { ...altUri, ...(desktopUrl ? { desktop: desktopTrackingUrl } : {}) };
    }
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    result[key] = await replaceFlexActionUrisByOccurrence(db, child, workerUrl, broadcastId, location);
  }
  return result;
}

/** Extract trackable URLs from content string */
function extractUrls(content: string): Set<string> {
  const urls = new Set<string>();
  for (const match of content.matchAll(URL_REGEX)) {
    const url = match[0].replace(/[.,;:!?)]+$/, '');
    if (!shouldSkip(url)) urls.add(url);
  }
  return urls;
}

/** Create tracking links and return a map of original → tracking URL */
async function createTrackingMap(
  db: D1Database,
  urls: Set<string>,
  workerUrl: string,
  broadcastId?: string | null,
): Promise<Map<string, { trackingUrl: string; originalUrl: string; label: string }>> {
  const urlMap = new Map<string, { trackingUrl: string; originalUrl: string; label: string }>();
  for (const url of urls) {
    const link = await createTrackedLink(db, {
      name: `auto: ${url.slice(0, 60)}`,
      originalUrl: url,
      broadcastId: broadcastId ?? null,
    });
    // Use direct /t/ URL — Worker handles LINE app detection and LIFF redirect server-side
    const trackingUrl = `${workerUrl}/t/${link.id}`;
    const hostname = new URL(url).hostname.replace('www.', '');
    const label = hostname.length > 20 ? hostname.slice(0, 20) + '…' : hostname;
    urlMap.set(url, { trackingUrl, originalUrl: url, label });
  }
  return urlMap;
}

/** Build a Flex bubble from text + tracked URLs */
function textToFlex(
  text: string,
  links: { trackingUrl: string; originalUrl: string; label: string }[],
): string {
  // Remove URLs from the text body
  let cleanText = text;
  for (const link of links) {
    cleanText = cleanText.split(link.originalUrl).join('').trim();
  }
  // Clean up leftover whitespace/punctuation
  cleanText = cleanText.replace(/\s{2,}/g, ' ').replace(/[👉🔗➡️]\s*$/g, '').trim();

  const bodyContents: unknown[] = [];
  if (cleanText) {
    bodyContents.push({
      type: 'text',
      text: cleanText,
      size: 'md',
      color: '#333333',
      wrap: true,
    });
  }

  const buttons = links.map((link) => {
    // Append openExternalBrowser=1 for app-link domains (opens Safari/Chrome instead of LINE browser)
    const uri = isAppLinkDomain(link.originalUrl)
      ? `${link.trackingUrl}${link.trackingUrl.includes('?') ? '&' : '?'}openExternalBrowser=1`
      : link.trackingUrl;
    return {
      type: 'button',
      action: {
        type: 'uri',
        label: `${link.label} を開く`,
        uri,
      },
      style: 'primary',
      color: '#1a1a2e',
      margin: 'sm',
    };
  });

  const bubble = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
      paddingAll: '16px',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: buttons,
      paddingAll: '12px',
    },
  };

  return JSON.stringify(bubble);
}

export interface AutoTrackResult {
  messageType: string;
  content: string;
}

/**
 * Auto-wrap URLs in message content with tracking links.
 * For text messages with URLs, converts to Flex with button.
 * For flex messages, replaces URLs inline.
 */
export async function autoTrackContent(
  db: D1Database,
  messageType: string,
  content: string,
  workerUrl: string,
  broadcastId?: string | null,
  messageIndex?: number,
): Promise<AutoTrackResult> {
  if (messageType === 'multi') {
    return autoTrackMultiContent(db, content, workerUrl, broadcastId);
  }

  if (messageType === 'image') return { messageType, content };

  if (messageType === 'imagemap') {
    return autoTrackImageMapContent(db, content, workerUrl, broadcastId);
  }

  if (messageType === 'flex') {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (extractFlexActionUris(parsed).length === 0) return { messageType, content };
      const tracked = await replaceFlexActionUrisByOccurrence(db, parsed, workerUrl, broadcastId, {
        messageIndex,
        actionIndex: 0,
      });
      return { messageType, content: JSON.stringify(tracked) };
    } catch {
      return { messageType, content };
    }
  }

  const urls = extractUrls(content);
  if (urls.size === 0) return { messageType, content };

  const urlMap = await createTrackingMap(db, urls, workerUrl, broadcastId);

  // Text messages → convert to Flex with buttons
  if (messageType === 'text') {
    const links = Array.from(urlMap.values());
    return {
      messageType: 'flex',
      content: textToFlex(content, links),
    };
  }

  // Flex messages → replace URLs inline in the JSON
  // For app-link domains, also inject openExternalBrowser=1 into the URI action
  let result = content;
  for (const [original, { trackingUrl, originalUrl }] of urlMap) {
    const finalUrl = isAppLinkDomain(originalUrl)
      ? `${trackingUrl}${trackingUrl.includes('?') ? '&' : '?'}openExternalBrowser=1`
      : trackingUrl;
    result = result.split(original).join(finalUrl);
  }
  return { messageType, content: result };
}

async function autoTrackMultiContent(
  db: D1Database,
  content: string,
  workerUrl: string,
  broadcastId?: string | null,
): Promise<AutoTrackResult> {
  try {
    const blocks = JSON.parse(content) as Array<{ type: string; content: string; altText?: string }>;
    if (!Array.isArray(blocks)) return { messageType: 'multi', content };

    const trackedBlocks = await Promise.all(
      blocks.map(async (block, blockIndex) => {
        if (!block || typeof block !== 'object' || typeof block.content !== 'string') {
          return block;
        }

        if (block.type === 'image') {
          return {
            ...block,
            content: await autoTrackImageLinkUrl(db, block.content, workerUrl, broadcastId),
          };
        }

        const tracked = await autoTrackContent(
          db,
          block.type,
          block.content,
          workerUrl,
          broadcastId,
          blockIndex + 1,
        );
        return {
          ...block,
          type: tracked.messageType,
          content: tracked.content,
        };
      }),
    );

    return { messageType: 'multi', content: JSON.stringify(trackedBlocks) };
  } catch {
    return { messageType: 'multi', content };
  }
}

async function autoTrackImageMapContent(
  db: D1Database,
  content: string,
  workerUrl: string,
  broadcastId?: string | null,
): Promise<AutoTrackResult> {
  try {
    const parsed = JSON.parse(content) as {
      baseUrl?: string;
      altText?: string;
      baseSize?: { width: number; height: number };
      actions?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.actions)) {
      return { messageType: 'imagemap', content };
    }

    const urls = new Set<string>();
    for (const action of parsed.actions) {
      if (action?.type !== 'uri' || typeof action.linkUri !== 'string') continue;
      const linkUri = action.linkUri.trim();
      if (linkUri && !shouldSkip(linkUri)) urls.add(linkUri);
    }
    if (urls.size === 0) return { messageType: 'imagemap', content };

    const urlMap = await createTrackingMap(db, urls, workerUrl, broadcastId);
    const actions = parsed.actions.map((action) => {
      if (action?.type !== 'uri' || typeof action.linkUri !== 'string') return action;
      const tracked = urlMap.get(action.linkUri.trim());
      if (!tracked) return action;
      const finalUrl = isAppLinkDomain(tracked.originalUrl)
        ? `${tracked.trackingUrl}${tracked.trackingUrl.includes('?') ? '&' : '?'}openExternalBrowser=1`
        : tracked.trackingUrl;
      return { ...action, linkUri: finalUrl };
    });

    return {
      messageType: 'imagemap',
      content: JSON.stringify({ ...parsed, actions }),
    };
  } catch {
    return { messageType: 'imagemap', content };
  }
}

async function autoTrackImageLinkUrl(
  db: D1Database,
  content: string,
  workerUrl: string,
  broadcastId?: string | null,
): Promise<string> {
  try {
    const parsed = JSON.parse(content) as {
      originalContentUrl?: string;
      previewImageUrl?: string;
      linkUrl?: string;
    };
    const linkUrl = parsed.linkUrl?.trim();
    if (!linkUrl || shouldSkip(linkUrl)) return content;

    const urlMap = await createTrackingMap(db, new Set([linkUrl]), workerUrl, broadcastId);
    const tracked = urlMap.get(linkUrl);
    if (!tracked) return content;

    const finalUrl = isAppLinkDomain(tracked.originalUrl)
      ? `${tracked.trackingUrl}${tracked.trackingUrl.includes('?') ? '&' : '?'}openExternalBrowser=1`
      : tracked.trackingUrl;

    return JSON.stringify({ ...parsed, linkUrl: finalUrl });
  } catch {
    return content;
  }
}
