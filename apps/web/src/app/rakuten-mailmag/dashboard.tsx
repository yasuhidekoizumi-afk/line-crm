'use client'

interface DashboardData {
  kpi: {
    totalRevenue: number
    totalOrders: number
    avgOrderValue: number
    period: { start: string; end: string }
  }
  baseline: { avgDailyRevenue: number; avgDailyOrders: number }
  dailySales: {
    date: string
    orders: number
    revenue: number
  }[]
  productRanking: {
    itemNumber: string
    itemName: string
    qty: number
    revenue: number
    avgPrice: number
  }[]
}

interface RakutenEvent {
  date: string
  name: string
  type: string
}

function fmtYen(n: number) {
  return n >= 10000 ? `¥${Math.round(n / 10000)}万` : `¥${n.toLocaleString()}`
}

function daysUntil(dateStr: string) {
  const target = new Date(dateStr + 'T00:00:00+09:00')
  const now = new Date()
  const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  return diff
}

export default function Dashboard({ data, events }: { data: DashboardData; events: RakutenEvent[] }) {
  const { kpi, baseline, dailySales, productRanking } = data
  const maxRev = Math.max(...dailySales.map((d) => d.revenue), 1)
  const upcomingEvents = events.slice(0, 5)

  // スパイク日判定（平常日平均の3倍以上）
  const spikeThreshold = baseline.avgDailyRevenue * 3

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">過去30日 売上</p>
          <p className="text-2xl font-bold text-gray-900">{fmtYen(kpi.totalRevenue)}</p>
          <p className="text-xs text-gray-400 mt-1">{kpi.period.start} 〜 {kpi.period.end}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">過去30日 受注数</p>
          <p className="text-2xl font-bold text-gray-900">{kpi.totalOrders.toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1">1日平均 {(kpi.totalOrders / 30).toFixed(0)}件</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">平均単価</p>
          <p className="text-2xl font-bold text-gray-900">¥{kpi.avgOrderValue.toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1">平常日平均 {fmtYen(baseline.avgDailyRevenue)}/日</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">次回イベント</p>
          {upcomingEvents[0] ? (
            <>
              <p className="text-sm font-bold text-[#6D2E46]">{upcomingEvents[0].name.split('（')[0]}</p>
              <p className="text-xs text-gray-400 mt-1">
                {upcomingEvents[0].date}（あと{daysUntil(upcomingEvents[0].date)}日）
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400">予定なし</p>
          )}
        </div>
      </div>

      {/* Sales Chart */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-base font-bold text-[#6D2E46] mb-4">日別売上推移（直近{dailySales.length}日）</h2>
        <div className="flex items-end gap-1 h-48 border-b border-gray-100 pb-1">
          {dailySales.map((d) => {
            const isSpike = d.revenue >= spikeThreshold
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                <span className="text-[10px] text-gray-600 font-medium">
                  {d.revenue >= 100000 ? `${Math.round(d.revenue / 10000)}万` : ''}
                </span>
                <div
                  className={`w-full rounded-t-sm transition-opacity group-hover:opacity-80 cursor-pointer ${
                    isSpike ? 'bg-[#B5862E]' : 'bg-[#D4788E]'
                  }`}
                  style={{ height: `${(d.revenue / maxRev) * 140}px`, minHeight: '4px' }}
                  title={`${d.date}: ${d.orders}件 ${fmtYen(d.revenue)}`}
                />
                <span className="text-[9px] text-gray-400 -rotate-45 whitespace-nowrap origin-center">
                  {d.date.slice(5)}
                </span>
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-[#D4788E]" /> 通常日
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-[#B5862E]" /> イベント日
          </span>
          <span className="ml-auto">
            平常日平均: <strong className="text-gray-700">{fmtYen(baseline.avgDailyRevenue)}</strong> ｜
            スパイク閾値: <strong className="text-[#B5862E]">{fmtYen(spikeThreshold)}</strong>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Product Ranking */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-base font-bold text-[#6D2E46] mb-4">商品ランキング TOP10</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="text-left py-2 font-medium">#</th>
                <th className="text-left py-2 font-medium">商品名</th>
                <th className="text-right py-2 font-medium">数量</th>
                <th className="text-right py-2 font-medium">売上</th>
              </tr>
            </thead>
            <tbody>
              {productRanking.slice(0, 10).map((p, i) => (
                <tr key={p.itemNumber || i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        i === 0
                          ? 'bg-[#B5862E] text-white'
                          : i === 1
                            ? 'bg-[#C4A878] text-white'
                            : i === 2
                              ? 'bg-[#D4B896] text-white'
                              : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td className="py-2.5 pr-2 text-gray-700">{p.itemName.slice(0, 30)}</td>
                  <td className="py-2.5 text-right text-gray-500">{p.qty}個</td>
                  <td className="py-2.5 text-right font-semibold text-gray-800">{fmtYen(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Event Calendar */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-base font-bold text-[#6D2E46] mb-4">楽天イベントカレンダー</h2>
          <div className="space-y-2">
            {upcomingEvents.map((e, i) => {
              const days = daysUntil(e.date)
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-gray-50 border-l-3 border-[#B5862E]"
                  style={{ borderLeftWidth: '3px' }}
                >
                  <span className="text-sm font-bold text-[#6D2E46] min-w-[70px]">{e.date}</span>
                  <span className="text-sm font-medium text-gray-700 flex-1">{e.name}</span>
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full text-white ${
                      days <= 3 ? 'bg-red-500' : 'bg-[#B5862E]'
                    }`}
                  >
                    あと{days}日
                  </span>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-gray-400 mt-4">
            ⚡ イベント3日前から予告メルマガ→前日→当日の3連打で効果最大化
          </p>
        </div>
      </div>
    </div>
  )
}
