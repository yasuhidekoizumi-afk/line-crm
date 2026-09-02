'use client'

import { useState, useRef } from 'react'
import { api } from '@/lib/api'

interface ImageUploaderProps {
  onUploaded: (
    url: string,
    meta?: {
      imagemapBaseUrl?: string
      width?: number
      height?: number
    },
  ) => void
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
      // LINEの画像要件（JPEG/PNG、1024px以内、プレビュー1MB以内）へ自動調整する。
      const normalized = await normalizeForLine(file)
      const dimensions = await getImageDimensions(normalized)
      const result = await api.images.upload(normalized)
      setPreview(result.url)
      onUploaded(result.url, {
        imagemapBaseUrl: result.imagemapBaseUrl,
        width: dimensions?.width,
        height: dimensions?.height,
      })
    } catch {
      setPreview(null)
      setError('画像の変換またはアップロードに失敗しました')
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
            <p className="text-xs text-gray-400 mt-1">PNG / JPEG / GIF / WebP, 最大5MB（LINE用に自動最適化）</p>
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

async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    return { width: image.width, height: image.height }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('画像の読み込みに失敗しました'))
    image.src = src
  })
}

const LINE_MAX_IMAGE_DIMENSION = 1024
const LINE_PREVIEW_TARGET_BYTES = 950 * 1024

/**
 * LINEの通常画像・Flex画像の双方で安全に表示できる形式へ変換する。
 * 条件内のJPEG/PNGは再圧縮せず、画質と透過情報を維持する。
 */
async function normalizeForLine(file: File): Promise<File> {
  const dimensions = await getImageDimensions(file)
  const isSupportedType = file.type === 'image/jpeg' || file.type === 'image/png'
  const isWithinDimensions = dimensions.width <= LINE_MAX_IMAGE_DIMENSION
    && dimensions.height <= LINE_MAX_IMAGE_DIMENSION

  if (isSupportedType && isWithinDimensions && file.size <= LINE_PREVIEW_TARGET_BYTES) {
    return file
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    const initialScale = Math.min(
      1,
      LINE_MAX_IMAGE_DIMENSION / image.width,
      LINE_MAX_IMAGE_DIMENSION / image.height,
    )

    // JPEG品質を先に調整し、それでも1MB近くを超える場合のみ寸法を段階的に下げる。
    for (const sizeScale of [1, 0.9, 0.8, 0.7]) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * initialScale * sizeScale))
      canvas.height = Math.max(1, Math.round(image.height * initialScale * sizeScale))

      const context = canvas.getContext('2d')
      if (!context) throw new Error('画像変換を開始できません')

      // 透過画像をJPEG化した際に黒背景にならないよう白で塗る。
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)

      for (const quality of [0.92, 0.85, 0.75, 0.65]) {
        const blob = await canvasToBlob(canvas, quality)
        if (blob.size <= LINE_PREVIEW_TARGET_BYTES) {
          const baseName = file.name.replace(/\.[^.]+$/, '') || 'line-image'
          return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
        }
      }
    }

    throw new Error('画像を1MB以内に変換できませんでした')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('画像変換に失敗しました')),
      'image/jpeg',
      quality,
    )
  })
}
