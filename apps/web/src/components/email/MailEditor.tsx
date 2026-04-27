'use client'

import { useEffect, useRef } from 'react'
import 'grapesjs/dist/css/grapes.min.css'

interface MailEditorProps {
  initialHtml?: string
  onChange?: (html: string) => void
  onSave?: (html: string) => void
}

export default function MailEditor({ initialHtml = '', onChange, onSave }: MailEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<unknown>(null)

  useEffect(() => {
    let cancelled = false
    // GrapesJS の型はランタイム拡張が多いため any にフォールバック
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let editor: any = null

    ;(async () => {
      const grapesjs = (await import('grapesjs')).default
      const presetNewsletter = (await import('grapesjs-preset-newsletter')).default
      const pluginExport = (await import('grapesjs-plugin-export')).default

      if (cancelled || !containerRef.current) return

      editor = grapesjs.init({
        container: containerRef.current,
        height: '100%',
        width: 'auto',
        plugins: [presetNewsletter, pluginExport],
        pluginsOpts: {
          'grapesjs-preset-newsletter': {
            modalLabelImport: 'インポートする HTML を貼り付けてください',
            modalLabelExport: 'エクスポート用 HTML',
            codeViewerTheme: 'material',
            importPlaceholder: '<table>...</table>',
            cellStyle: {
              padding: '0',
              margin: '0',
              'vertical-align': 'top',
            },
          },
        },
        storageManager: false,
        // iframe 内（メール本文）のスタイル: 余白を確保してプレビューの読みやすさ向上
        canvas: {
          styles: [
            'data:text/css;base64,' + btoa(
              'body{margin:24px auto;max-width:600px;background:#fff;color:#222;line-height:1.8;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic UI",sans-serif;padding:24px 20px;}'
              + 'h1,h2,h3{margin:24px 0 12px;line-height:1.4;}'
              + 'p{margin:0 0 16px;}'
              + 'a{color:#225533;}'
              + 'img{max-width:100%;height:auto;}'
            ),
          ],
        },
        components: initialHtml || '<p>{{name}}さん、こんにちは。</p>',
      })

      editorRef.current = editor

      editor.on('update', () => {
        if (onChange && editor) {
          const html = `<style>${editor.getCss() ?? ''}</style>${editor.getHtml() ?? ''}`
          onChange(html)
        }
      })

      // 保存ボタン（カスタムパネル）
      editor.Panels.addButton('options', {
        id: 'save-template',
        className: 'fa fa-floppy-o',
        command: () => {
          if (onSave && editor) {
            const html = `<style>${editor.getCss() ?? ''}</style>${editor.getHtml() ?? ''}`
            onSave(html)
          }
        },
        attributes: { title: 'テンプレートを保存' },
      })
    })()

    return () => {
      cancelled = true
      try {
        editor?.destroy?.()
      } catch {
        /* noop */
      }
    }
  }, [initialHtml, onChange, onSave])

  return (
    <div className="w-full" style={{ height: 'calc(100vh - 200px)', minHeight: 600 }}>
      <div ref={containerRef} />
    </div>
  )
}
