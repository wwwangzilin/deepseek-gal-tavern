/**
 * GAL 酒馆 — 对话导出（移植 deepseek-pp core/export/*）
 * 把 DeepSeek 会话历史导出为 HTML / Markdown / 纯文本。
 */
;(function () {
  'use strict'

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]))
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleString()
    } catch {
      return String(ts || '')
    }
  }

  /** 对话导出数据结构：{ sessions: [{ title, updatedAt, messages: [{role, content, createdAt}] }] } */
  function exportToHtml(exportData) {
    const sessions = (exportData.sessions || []).map((session) => {
      const messages = (session.messages || []).map((m) => `
        <div class="message ${m.role === 'user' ? 'is-user' : 'is-assistant'}">
          <div class="who">${m.role === 'user' ? '用户' : 'AI'}</div>
          <div class="content">${escapeHtml(m.content || '')}</div>
          ${m.createdAt ? '<div class="meta">' + escapeHtml(fmtTime(m.createdAt)) + '</div>' : ''}
        </div>`).join('\n')
      return `
        <section class="section">
          <h2>${escapeHtml(session.title || '未命名对话')}</h2>
          <div class="meta">${escapeHtml(fmtTime(session.updatedAt))} · ${(session.messages || []).length} 条消息</div>
          ${messages}
        </section>`
    }).join('\n')

    const total = (exportData.sessions || []).reduce((n, s) => n + (s.messages || []).length, 0)
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GAL 酒馆对话导出</title>
<style>
  :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif; color: #1d1d1f; background: #ffffff; }
  body { margin: 0; padding: 32px; font-size: 14px; line-height: 1.62; }
  h1, h2 { margin: 0 0 12px; line-height: 1.25; }
  h1 { font-size: 26px; }
  h2 { font-size: 19px; margin-top: 28px; }
  .meta { color: #64748b; font-size: 12px; }
  .section { max-width: 920px; margin: 0 auto 28px; }
  .summary { display: flex; gap: 12px; margin: 16px 0 24px; flex-wrap: wrap; }
  .metric { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; }
  .metric strong { display: block; font-size: 17px; }
  .message { border-top: 1px solid #e5e7eb; padding: 14px 0; }
  .message.is-user .who { color: #2563eb; }
  .message.is-assistant .who { color: #7c3aed; }
  .who { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
  .content { white-space: pre-wrap; overflow-wrap: anywhere; }
  @media print { body { padding: 18mm; } .section { break-inside: avoid; } }
</style>
</head>
<body>
<main>
  <section class="section">
    <h1>GAL 酒馆对话导出</h1>
    <div class="meta">导出于 ${escapeHtml(fmtTime(Date.now()))}</div>
    <div class="summary">
      <div class="metric"><strong>${exportData.sessions.length}</strong>会话</div>
      <div class="metric"><strong>${total}</strong>消息</div>
    </div>
  </section>
  ${sessions}
</main>
</body>
</html>`
  }

  function exportToMarkdown(exportData) {
    const lines = ['# GAL 酒馆对话导出', '', '> 导出于 ' + fmtTime(Date.now()), '']
    for (const session of exportData.sessions || []) {
      lines.push('## ' + (session.title || '未命名对话'), '')
      lines.push('> ' + fmtTime(session.updatedAt), '')
      for (const m of session.messages || []) {
        const who = m.role === 'user' ? '**用户**' : '**AI**'
        lines.push(who + '：' + (m.content || ''), '')
      }
      lines.push('---', '')
    }
    return lines.join('\n')
  }

  function exportToText(exportData) {
    const lines = []
    for (const session of exportData.sessions || []) {
      lines.push('==== ' + (session.title || '未命名对话') + ' ====')
      lines.push('(' + fmtTime(session.updatedAt) + ')')
      for (const m of session.messages || []) {
        lines.push((m.role === 'user' ? '用户' : 'AI') + '：' + (m.content || ''))
      }
      lines.push('')
    }
    return lines.join('\n')
  }

  function buildExportFile(exportData, format) {
    format = format === 'md' ? 'md' : format === 'txt' ? 'txt' : 'html'
    if (format === 'md') {
      return { format: 'md', mimeType: 'text/markdown;charset=utf-8', filename: 'gal-conversation.md', content: exportToMarkdown(exportData) }
    }
    if (format === 'txt') {
      return { format: 'txt', mimeType: 'text/plain;charset=utf-8', filename: 'gal-conversation.txt', content: exportToText(exportData) }
    }
    return { format: 'html', mimeType: 'text/html;charset=utf-8', filename: 'gal-conversation.html', content: exportToHtml(exportData) }
  }

  globalThis.DSG_EXPORT = {
    exportToHtml,
    exportToMarkdown,
    exportToText,
    buildExportFile,
  }
})()
