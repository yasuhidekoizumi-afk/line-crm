// GET /api/loyalty/period-stats — 期間指定 KPI（期間・比較方法をクエリで選択）
loyalty.get('/api/loyalty/period-stats', async (c) => {
  try {
    const period = c.req.query('period') || 'this_month';
    const compare = c.req.query('compare') || 'previous_period';

    const VALID_PERIODS = ['this_month', 'last_month', 'yesterday', 'last_7d', 'last_30d', 'last_90d', 'this_year'];
    const VALID_COMPARES = ['previous_period', 'previous_day', 'previous_year', 'none'];
    if (!VALID_PERIODS.includes(period)) {
      return c.json({ success: false, error: `Invalid period: ${period}` }, 400);
    }
    if (!VALID_COMPARES.includes(compare)) {
      return c.json({ success: false, error: `Invalid compare: ${compare}` }, 400);
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    // 現在期間の開始・終了を計算
    let currentStart: Date;
    let currentEnd = now;

    switch (period) {
      case 'this_month':
        currentStart = new Date(y, m, 1);
        break;
      case 'last_month':
        currentStart = new Date(y, m - 1, 1);
        currentEnd = new Date(y, m, 1);
        break;
      case 'yesterday': {
        const todayStart = new Date(y, m, now.getDate());
        currentStart = new Date(todayStart.getTime() - 86400000);
        currentEnd = todayStart;
        break;
      }
      case 'last_7d':
        currentStart = new Date(now.getTime() - 7 * 86400000);
        break;
      case 'last_30d':
        currentStart = new Date(now.getTime() - 30 * 86400000);
        break;
      case 'last_90d':
        currentStart = new Date(now.getTime() - 90 * 86400000);
        break;
      case 'this_year':
        currentStart = new Date(y, 0, 1);
        break;
      default:
        currentStart = new Date(y, m, 1);
    }

    const fmtStart = (d: Date) => d.toISOString().slice(0, 10) + 'T00:00:00.000+09:00';
    const fmtEnd = (d: Date) => d.toISOString();

    const currentStartStr = fmtStart(currentStart);
    const currentEndStr = fmtEnd(currentEnd);

    // 現在期間のデータ
    const [currentTx, currentNew] = await Promise.all([
      c.env.DB
        .prepare(`SELECT type, COALESCE(SUM(ABS(points)), 0) as total FROM loyalty_transactions WHERE type IN ('award','redeem') AND created_at >= ? AND created_at <= ? GROUP BY type`)
        .bind(currentStartStr, currentEndStr)
        .all<{ type: string; total: number }>(),
      c.env.DB
        .prepare(`SELECT COUNT(*) as n FROM loyalty_points WHERE created_at >= ? AND created_at <= ?`)
        .bind(currentStartStr, currentEndStr)
        .first<{ n: number }>(),
    ]);

    const toMap = (rows: { type: string; total: number }[]) => {
      const m: Record<string, number> = { award: 0, redeem: 0 };
      for (const r of rows) m[r.type] = r.total;
      return m;
    };

    const currentMap = toMap(currentTx.results);
    let previousData = { awarded: 0, redeemed: 0, newMembers: 0 };

    // 比較期間のデータ
    if (compare !== 'none') {
      let prevStart: Date;
      let prevEnd: Date;

      if (compare === 'previous_year') {
        prevStart = new Date(currentStart.getTime() - 365 * 86400000);
        prevEnd = new Date(currentEnd.getTime() - 365 * 86400000);
      } else if (compare === 'previous_day') {
        prevStart = new Date(currentStart.getTime() - 86400000);
        prevEnd = new Date(currentEnd.getTime() - 86400000);
      } else {
        // previous_period: 同じ長さの直前の期間
        const duration = currentEnd.getTime() - currentStart.getTime();
        prevStart = new Date(currentStart.getTime() - duration);
        prevEnd = currentStart;
      }

      const prevStartStr = fmtStart(prevStart);
      const prevEndStr = fmtEnd(prevEnd);

      const [prevTx, prevNew] = await Promise.all([
        c.env.DB
          .prepare(`SELECT type, COALESCE(SUM(ABS(points)), 0) as total FROM loyalty_transactions WHERE type IN ('award','redeem') AND created_at >= ? AND created_at < ? GROUP BY type`)
          .bind(prevStartStr, prevEndStr)
          .all<{ type: string; total: number }>(),
        c.env.DB
          .prepare(`SELECT COUNT(*) as n FROM loyalty_points WHERE created_at >= ? AND created_at < ?`)
          .bind(prevStartStr, prevEndStr)
          .first<{ n: number }>(),
      ]);

      const prevMap = toMap(prevTx.results);
      previousData = {
        awarded: prevMap.award,
        redeemed: prevMap.redeem,
        newMembers: prevNew?.n ?? 0,
      };
    }

    return c.json({
      success: true,
      data: {
        current: {
          awarded: currentMap.award,
          redeemed: currentMap.redeem,
          newMembers: currentNew?.n ?? 0,
        },
        previous: previousData,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: 'Failed to fetch period stats' }, 500);
  }
});
