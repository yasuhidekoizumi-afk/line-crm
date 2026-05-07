/**
 * ローディング中に表示するスケルトン。
 * pages ディレクトリの loading.tsx で使う想定。
 */
export default function LoadingSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-6">
      {/* ヘッダー */}
      <div className="h-8 w-48 bg-gray-200 rounded" />
      <div className="h-4 w-72 bg-gray-100 rounded" />

      {/* カード群 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="h-4 w-24 bg-gray-100 rounded mb-4" />
            <div className="h-8 w-32 bg-gray-200 rounded" />
          </div>
        ))}
      </div>

      {/* テーブル行 */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-48 bg-gray-100 rounded" />
          <div className="h-4 w-32 bg-gray-100 rounded ml-auto" />
          <div className="h-4 w-24 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}
