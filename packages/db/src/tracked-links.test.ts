import { describe, expect, it } from 'vitest';
import { buildClickedNonBuyerQuery } from './tracked-links';

describe('buildClickedNonBuyerQuery', () => {
  it('requires at least one stable product matcher', () => {
    expect(() =>
      buildClickedNonBuyerQuery({ trackedLinkId: 'link-1', windowDays: 7 }),
    ).toThrow('productId, variantId, or sku is required');
  });

  it('builds a query that returns clickers and excludes matching purchases inside the click window', () => {
    const query = buildClickedNonBuyerQuery({
      trackedLinkId: 'link-1',
      productId: 'prod-1',
      sku: 'CRUNCH-3',
      windowDays: 3,
    });

    expect(query.sql).toContain('FROM link_clicks lc');
    expect(query.sql).toContain('JOIN friends f ON f.id = fc.friend_id');
    expect(query.sql).toContain('f.is_following = 1');
    expect(query.sql).toContain('NOT EXISTS');
    expect(query.sql).toContain('shopify_orders o');
    expect(query.sql).toContain('shopify_order_items oi');
    expect(query.sql).toContain('oi.shopify_product_id = ?');
    expect(query.sql).toContain('oi.sku = ?');
    expect(query.sql).toContain('datetime(o.processed_at) >= datetime(fc.first_clicked_at)');
    expect(query.sql).toContain("datetime(fc.first_clicked_at, '+' || ? || ' days')");
    expect(query.bindings).toEqual(['link-1', 'prod-1', 'CRUNCH-3', 3]);
  });
});
