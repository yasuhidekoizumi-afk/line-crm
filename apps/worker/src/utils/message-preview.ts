/**
 * messages_log の内容を、チャット画面に表示できる文章へ変換する。
 *
 * 背景:
 *   一斉配信の本文は内部形式で保存されている。
 *   - text:      そのままの文字列
 *   - image:     { originalContentUrl, previewImageUrl } のJSON
 *   - flex:      Flex Message のJSON
 *   - imagemap:  { baseUrl, altText, ... } のJSON
 *   - multi:     [{ type, content, altText? }, ...] のJSON配列
 *   そのまま画面に出すとJSONが生表示されるため、人が読める形に要約する。
 */
const IMAGE_LABEL = '[画像]';
const IMAGEMAP_LABEL = '[リッチメッセージ]';
const VIDEO_LABEL = '[動画]';
const STICKER_LABEL = '[スタンプ]';

/**
 * Flex JSON から最初のテキストを取り出す（通知のaltText相当）。
 * 表示専用の要約なので、utils/flex-alt-text.ts とは独立させて単体テスト可能にしている。
 */
function flexHeadline(node: unknown, depth = 0): string | null {
  if (depth > 10 || !node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') return record.text.slice(0, 100);
  if (Array.isArray(record.contents)) {
    for (const child of record.contents) {
      const found = flexHeadline(child, depth + 1);
      if (found) return found;
    }
  }
  for (const key of ['header', 'body', 'footer']) {
    const found = flexHeadline(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function summarizeSingle(type: string, content: string, altText?: string | null): string {
  switch (type) {
    case 'text':
      return content;
    case 'image':
    case 'video':
      return type === 'image' ? IMAGE_LABEL : VIDEO_LABEL;
    case 'imagemap':
      if (altText) return altText;
      try {
        const parsed = JSON.parse(content) as { altText?: string };
        if (parsed?.altText) return parsed.altText;
      } catch {
        // JSONでない場合は既定ラベル
      }
      return IMAGEMAP_LABEL;
    case 'sticker':
      return STICKER_LABEL;
    case 'flex': {
      if (altText) return altText;
      try {
        return flexHeadline(JSON.parse(content)) ?? '[カード]';
      } catch {
        return '[カード]';
      }
    }
    default:
      return content;
  }
}

/** 1メッセージ分の表示文字列を作る（multi は配列を展開して連結） */
export function toDisplayContent(messageType: string, content: string): string {
  if (!content) return '';

  if (messageType === 'multi') {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => {
            if (!item || typeof item !== 'object') return '';
            const record = item as Record<string, unknown>;
            const type = typeof record.type === 'string' ? record.type : 'text';
            const body = typeof record.content === 'string' ? record.content : '';
            const alt = typeof record.altText === 'string' ? record.altText : null;
            return summarizeSingle(type, body, alt);
          })
          .filter((text) => text.trim() !== '')
          .join('\n\n');
      }
    } catch {
      // 壊れたJSONはそのまま出さず、先頭だけ見せる
      return content.slice(0, 200);
    }
  }

  if (messageType === 'flex' || messageType === 'imagemap' || messageType === 'image') {
    return summarizeSingle(messageType, content, null);
  }

  return content;
}
