/**
 * 配信の送信前チェック（純粋関数のみ）。
 * DB・ネットワークに触らないため、単体テストで表現検出を固定できる。
 */

const DRUG_CLAIM_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /治(る|す|療)/, label: '治療・治る' },
  { re: /予防(する|効果|に効く|に効果)/, label: '予防効果' },
  { re: /(癌|がん|腫瘍)/, label: '疾患名' },
  { re: /痩せ(る|た)/, label: '痩身' },
  { re: /ダイエット効果/, label: 'ダイエット効果' },
  { re: /(血圧|血糖値|コレステロール)(が|を)(下が|下げ|改善)/, label: '数値の改善' },
  { re: /免疫力(が)?(上が|アップ)/, label: '免疫力アップ' },
  { re: /アンチエイジング/, label: 'アンチエイジング' },
  { re: /デトックス/, label: 'デトックス' },
  { re: /美肌効果/, label: '美肌効果' },
  { re: /便秘(解消|改善)/, label: '便秘解消' },
  { re: /疲労回復/, label: '疲労回復' },
  { re: /老化防止/, label: '老化防止' },
  { re: /若返り/, label: '若返り' },
  { re: /生活習慣病/, label: '生活習慣病' },
];

const AD_CLAIM_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /No\.?\s?1/i, label: 'No.1' },
  { re: /日本一/, label: '日本一' },
  { re: /最安/, label: '最安' },
  { re: /絶対(に)?(効|痩|治)/, label: '絶対表現' },
  { re: /必ず(痩せ|効く|治る)/, label: '必ず表現' },
];

/** multi形式のJSONからテキストだけを取り出す（壊れていればそのまま返す） */
export function extractTextForValidation(messageType: string, messageContent: string): string {
  if (messageType !== 'multi') return messageContent;
  try {
    const arr = JSON.parse(messageContent) as Array<{ type?: string; content?: string }>;
    if (!Array.isArray(arr)) return messageContent;
    return arr
      .filter((m) => m?.type === 'text')
      .map((m) => m?.content ?? '')
      .join('\n');
  } catch {
    return messageContent;
  }
}

/** 本文中のURLを最大5件まで重複なく取り出す */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>）)】]+/g) ?? [];
  return Array.from(new Set(matches)).slice(0, 5);
}

/** 医薬品等の効能効果・景表法上の優良誤認にあたる可能性のある表現を返す */
export function detectClaimWarnings(text: string, kind: 'drug' | 'ad' | 'all' = 'all'): string[] {
  const labels: string[] = [];
  if (kind === 'drug' || kind === 'all') {
    labels.push(...DRUG_CLAIM_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label));
  }
  if (kind === 'ad' || kind === 'all') {
    labels.push(...AD_CLAIM_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label));
  }
  return labels;
}

/** 複数メッセージの各テキストの文字数上限チェック（LINEは1通5,000字） */
export function findTooLongText(texts: string[], limit = 5000): Array<{ index: number; length: number }> {
  return texts
    .map((text, index) => ({ index, length: text.length }))
    .filter((t) => t.length > limit);
}
