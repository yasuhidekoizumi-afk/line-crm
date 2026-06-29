'use client'

import { useState, useRef } from 'react'
import { api } from '@/lib/api'

interface ImageUploaderProps {
  onUploaded: (url: string, meta?: { imagemapBaseUrl?: string }) => void
}

export default function ImageUploader({ onUploaded }: ImageUploaderProps) {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError('')
    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選択してください')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('ファイルサイズは5MB以内にしてください')
      return
    }

    // Show local preview
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)

    setUploading(true)
    try {
      const result = await api.images.upload(file)
      setPreview(result.url)
      onUploaded(result.url, { imagemapBaseUrl: result.imagemapBaseUrl })
    } catch {
      setPreview(null)
      setError('アップロードに失敗しました')
    } finally {
      setUploading(false)
      URL.revokeObjectURL(objectUrl)
    }
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        {uploading ? (
          <p className="text-sm text-gray-500">アップロード中...</p>
        ) : (
          <div>
            <p className="text-sm text-gray-500">画像をドロップ、またはクリックして選択</p>
            <p className="text-xs text-gray-400 mt-1">PNG / JPEG / GIF / WebP, 最大5MB</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {preview && !uploading && (
        <div className="relative">
          <img src={preview} alt="preview" className="max-h-40 rounded border border-gray-200" />
        </div>
      )}
    </div>
  )
}
