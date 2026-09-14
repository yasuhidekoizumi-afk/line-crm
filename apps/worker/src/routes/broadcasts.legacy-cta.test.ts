import { describe, expect, it } from 'vitest';
import { extractActionableLinkDescriptors, groupTrackedLinksByLogicalCta } from './broadcasts.js';

const destination = 'https://oryzae.shop/';

function multiFlex(cards: string[]): string {
  return JSON.stringify([{
    type: 'flex',
    content: JSON.stringify({
      type: 'carousel',
      contents: cards.map((label) => ({
        type: 'bubble',
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [{ type: 'button', action: { type: 'uri', label, uri: destination } }],
        },
      })),
    }),
  }]);
}

describe('旧配信の論理CTA集約', () => {
  it('同じ1ボタンに重複発行されたリンクをCTA1・CTA2と誤表示しない', () => {
    const descriptors = extractActionableLinkDescriptors('multi', multiFlex(['詳しく見る']));
    const groups = groupTrackedLinksByLogicalCta([
      { id: 'link-a', name: `auto: ${destination}`, original_url: destination, click_count: 16 },
      { id: 'link-b', name: `auto: ${destination}`, original_url: destination, click_count: 125 },
    ], descriptors);

    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual(['link-a', 'link-b']);
    expect(groups[0].name).toBe('1件目 / カード1 / CTA1「詳しく見る」（旧配信・重複発行分を統合）');
    expect(groups[0].fallbackClickCount).toBe(141);
  });

  it('旧版で同一URLにまとめられた2カードは分割値を捏造せず合算と示す', () => {
    const descriptors = extractActionableLinkDescriptors(
      'multi',
      multiFlex(['オンラインストアへ', 'オンラインストアへ']),
    );
    const groups = groupTrackedLinksByLogicalCta([
      { id: 'link-a', name: `auto: ${destination}`, original_url: destination, click_count: 75 },
    ], descriptors);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe(
      '1件目 / カード1 / CTA1「オンラインストアへ」 ＋ カード2 / CTA1「オンラインストアへ」（旧配信・合算）',
    );
    expect(groups[0].isLegacyAggregate).toBe(true);
  });

  it('現在の位置名付きリンクは同じ遷移先でも別CTAとして残す', () => {
    const groups = groupTrackedLinksByLogicalCta([
      { id: 'link-a', name: '2件目 / カード1 / CTA1「商品A」', original_url: destination, click_count: 3 },
      { id: 'link-b', name: '2件目 / カード2 / CTA1「商品B」', original_url: destination, click_count: 5 },
    ], []);

    expect(groups.map((group) => group.name)).toEqual([
      '2件目 / カード1 / CTA1「商品A」',
      '2件目 / カード2 / CTA1「商品B」',
    ]);
  });
});
