/**
 * GAL 酒馆 — 内置网络工具（移植 deepseek-pp core/tool/web-search.ts）
 * web_search：Bing 搜索（无需 API key），web_fetch：抓取网页可视文本。
 * 运行于 background（有 host_permissions，可跨域 fetch）。
 */
;(function () {
  'use strict'

  const WEB_TOOL_NAMES = ['web_search', 'web_fetch']

  const WEB_TOOL_DESCRIPTORS = [
    {
      id: 'local:web:web_search',
      provider: { kind: 'local', id: 'web', displayName: 'GAL Web', transport: 'in_process' },
      name: 'web_search',
      invocationName: 'web_search',
      title: '搜索互联网',
      description: '在 Bing 搜索关键词，返回标题、URL 和摘要',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询关键词' },
          topK: { type: 'integer', description: '返回结果数量，默认 5' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execution: { mode: 'auto', enabled: true, risk: 'low' },
    },
    {
      id: 'local:web:web_fetch',
      provider: { kind: 'local', id: 'web', displayName: 'GAL Web', transport: 'in_process' },
      name: 'web_fetch',
      invocationName: 'web_fetch',
      title: '获取网页',
      description: '下载指定 URL 的页面内容，返回可视文本（自动去除导航、脚本和样式）',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的完整 URL（http:// 或 https://）' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      execution: { mode: 'auto', enabled: true, risk: 'medium' },
    },
  ]

  function isWebToolName(name) {
    return WEB_TOOL_NAMES.includes(name)
  }

  async function executeWebToolCall(call) {
    try {
      if (call.name === 'web_search') return await performWebSearch(call)
      if (call.name === 'web_fetch') return await performWebFetch(call)
      return { ok: false, summary: '不支持的网页工具', detail: call.name }
    } catch (err) {
      return { ok: false, summary: '网页工具执行失败', detail: err && err.message ? err.message : String(err) }
    }
  }

  // ── Bing 搜索（无 API key）───────────────────────────────────────
  async function performWebSearch(call) {
    const query = typeof call.payload.query === 'string' ? call.payload.query.trim() : ''
    if (!query) {
      return { ok: false, summary: '搜索词为空', detail: 'query is required', error: { code: 'empty_query', message: 'query is required', retryable: false } }
    }
    const topK = typeof call.payload.topK === 'number'
      ? Math.min(Math.max(1, Math.floor(call.payload.topK)), 10)
      : 5

    const domains = ['cn.bing.com', 'www.bing.com']
    let lastError = null
    const startTime = Date.now()

    for (const domain of domains) {
      if (Date.now() - startTime > 18000) {
        lastError = lastError || 'Search timed out (>18s)'
        break
      }
      try {
        const results = await bingSearch(domain, query, topK)
        if (results.length === 0) {
          lastError = domain + ' returned no parseable search results'
          continue
        }
        return {
          ok: true,
          name: call.name,
          summary: '搜索完成，共 ' + results.length + ' 条结果',
          output: results,
          detail: results.map((r, i) => (i + 1) + '. [' + r.title + '](' + r.url + ')\n   ' + r.snippet).join('\n'),
        }
      } catch (error) {
        lastError = error && error.message ? error.message : String(error)
        if (lastError.includes('opaque') || lastError.includes('status 0')) break
      }
    }

    const isPermissionError = lastError && (lastError.includes('Failed to fetch') || lastError.includes('NetworkError') || lastError.includes('opaque') || lastError.includes('status 0'))
    return {
      ok: false,
      name: call.name,
      summary: isPermissionError ? '搜索需要主机权限' : '搜索失败',
      detail: isPermissionError ? '请检查扩展的 host_permissions 是否包含 cn.bing.com / www.bing.com' : (lastError || 'unknown error'),
      error: { code: isPermissionError ? 'search_permission_denied' : 'search_failed', message: lastError || 'unknown error', retryable: !isPermissionError },
    }
  }

  async function bingSearch(domain, query, topK) {
    const url = new URL('https://' + domain + '/search')
    url.searchParams.set('q', query)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      })
      if (!response.ok) {
        if (response.status === 0) throw new Error('Host permission denied (opaque response) for ' + domain)
        throw new Error(domain + ' returned status ' + response.status)
      }
      const html = await response.text()
      if (html.length < 200) throw new Error(domain + ' returned an empty or blocked response')
      return parseBingResults(html, topK)
    } finally {
      clearTimeout(timer)
    }
  }

  function parseBingResults(html, topK) {
    const results = []
    const algoRegex = /<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
    let match
    while ((match = algoRegex.exec(html)) !== null && results.length < topK) {
      const block = match[1]
      const titleLink = /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i.exec(block)
      if (!titleLink) continue
      let url = titleLink[1]
      const title = stripHtml(titleLink[2]).replace(/\s+/g, ' ').trim()
      const captionBlock = /<div[^>]*class="[^"]*\bb_caption\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)
      let snippet = ''
      if (captionBlock) {
        const paraText = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(captionBlock[1])
        snippet = paraText
          ? stripHtml(paraText[1]).replace(/\s+/g, ' ').trim()
          : stripHtml(captionBlock[1]).replace(/\s+/g, ' ').trim()
      }
      if (url.startsWith('//')) url = 'https:' + url
      if (title && url) results.push({ title, url, snippet })
    }
    return results.slice(0, topK)
  }

  // ── Web Fetch ────────────────────────────────────────────────────
  async function performWebFetch(call) {
    const url = typeof call.payload.url === 'string' ? call.payload.url.trim() : ''
    if (!url) {
      return { ok: false, summary: 'URL 为空', detail: 'url is required', error: { code: 'empty_url', message: 'url is required', retryable: false } }
    }
    let parsedUrl
    try {
      parsedUrl = new URL(url)
    } catch {
      return { ok: false, summary: '无效 URL', detail: 'Invalid URL: ' + url, error: { code: 'invalid_url', message: 'Invalid URL', retryable: false } }
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { ok: false, summary: '不支持的协议', detail: '仅支持 http/https', error: { code: 'unsupported_url_scheme', message: 'Unsupported URL scheme', retryable: false } }
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          signal: controller.signal,
        })
        if (!response.ok) {
          if (response.body) response.body.cancel().catch(() => {})
          throw new Error('HTTP ' + response.status + ': ' + response.statusText)
        }
        const contentType = response.headers.get('content-type') || ''
        let text
        if (contentType.includes('text/html') || contentType.includes('text/plain') || contentType.includes('application/json')) {
          text = await response.text()
        } else {
          if (response.body) response.body.cancel().catch(() => {})
          return { ok: true, name: call.name, summary: '内容类型：' + contentType, detail: '该 URL 返回 ' + contentType + '，非文本，未提取', output: { url, contentType } }
        }
        const extracted = contentType.includes('text/html') ? extractTextFromHtml(text) : text
        const maxLength = 50000
        const truncated = extracted.length > maxLength
        const outputText = truncated ? extracted.slice(0, maxLength) + '\n[内容已截断，原文 ' + extracted.length + ' 字符]' : extracted
        return {
          ok: true,
          name: call.name,
          summary: '已获取 ' + url,
          detail: truncated ? '已截断（' + extracted.length + ' → ' + maxLength + '）' : ('内容长度 ' + extracted.length + ' 字符'),
          output: { url, content: outputText, contentType, truncated },
        }
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      const isPermissionError = message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('opaque') || message.includes('status 0')
      return {
        ok: false,
        name: call.name,
        summary: '获取失败',
        detail: isPermissionError ? '缺少 ' + parsedUrl.origin + ' 的主机权限，请检查扩展 host_permissions' : message,
        error: { code: isPermissionError ? 'fetch_permission_denied' : 'fetch_failed', message, retryable: isPermissionError },
      }
    }
  }

  function extractTextFromHtml(html) {
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/[\r\n]+/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
    return text.trim()
  }

  function stripHtml(html) {
    return String(html).replace(/<[^>]+>/g, '').trim()
  }

  globalThis.DSG_NETWORK = {
    WEB_TOOL_NAMES,
    WEB_TOOL_DESCRIPTORS,
    isWebToolName,
    executeWebToolCall,
  }
})()
