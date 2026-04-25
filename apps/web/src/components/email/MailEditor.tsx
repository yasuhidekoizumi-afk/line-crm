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
