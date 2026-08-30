/**
 * GAL 酒馆 — MCP 客户端（移植 WebTool core/mcp/*，精简为 HTTP/SSE 传输）
 * 标准 MCP 生命周期：initialize → tools/list → tools/call
 * 传输：Streamable HTTP（POST+SSE）、HTTP POST、SSE。
 */
;(function () {
  'use strict'

  const MCP_KEY = 'dsg_mcp_servers'

  async function readServers() {
    return globalThis.DSG_STORAGE
      ? globalThis.DSG_STORAGE.getValue(MCP_KEY, [], (raw) => Array.isArray(raw) ? raw : [])
      : []
  }
  async function writeServers(list) {
    if (globalThis.DSG_STORAGE) await globalThis.DSG_STORAGE.setValue(MCP_KEY, list)
  }

  function makeId() {
    return 'mcp-' + Math.random().toString(36).slice(2, 10)
  }

  function normalizeServer(raw) {
    return {
      id: raw.id || makeId(),
      name: raw.name || '未命名',
      enabled: raw.enabled !== false,
      transport: {
        kind: raw.transport && raw.transport.kind ? raw.transport.kind : 'streamable_http',
        url: raw.transport && raw.transport.url ? raw.transport.url : '',
      },
      headers: raw.headers || {},
      timeouts: {
        connect: (raw.timeouts && raw.timeouts.connect) || 10000,
        request: (raw.timeouts && raw.timeouts.request) || 60000,
        discovery: (raw.timeouts && raw.timeouts.discovery) || 20000,
      },
      limits: {
        maxResultBytes: (raw.limits && raw.limits.maxResultBytes) || 65536,
        maxToolsPerServer: (raw.limits && raw.limits.maxToolsPerServer) || 128,
      },
      tools: Array.isArray(raw.tools) ? raw.tools : [],
      toolCache: raw.toolCache || null,
      health: raw.health || { status: 'unknown' },
      createdAt: raw.createdAt || Date.now(),
    }
  }

  async function getAllMcpServers() {
    const list = await readServers()
    return list.map(normalizeServer)
  }

  async function getMcpServerById(id) {
    const list = await readServers()
    const found = list.find((s) => s.id === id)
    return found ? normalizeServer(found) : null
  }

  async function createMcpServer(input) {
    const list = await readServers()
    const server = normalizeServer(input)
    list.push(server)
    await writeServers(list)
    return server
  }

  async function updateMcpServer(id, patch) {
    const list = await readServers()
    const idx = list.findIndex((s) => s.id === id)
    if (idx === -1) return null
    list[idx] = normalizeServer({ ...list[idx], ...patch })
    await writeServers(list)
    return list[idx]
  }

  async function deleteMcpServer(id) {
    const list = await readServers()
    await writeServers(list.filter((s) => s.id !== id))
  }

  // ── MCP 协议客户端 ───────────────────────────────────────────────
  async function mcpRequest(server, method, params) {
    const url = server.transport.url
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(server.headers || {}) }
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params || {} })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), server.timeouts.request || 60000)
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      })
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const text = await resp.text()
      // Streamable HTTP 可能返回 SSE 流（含单个 JSON 事件）
      const trimmed = text.trim()
      if (trimmed.startsWith('{')) {
        const json = JSON.parse(trimmed)
        if (json.error) throw new Error(json.error.message || 'MCP error')
        return json.result
      }
      // SSE 解析：找 data: 开头的 JSON
      const lines = trimmed.split('\n')
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const json = JSON.parse(line.slice(5).trim())
          if (json.error) throw new Error(json.error.message || 'MCP error')
          return json.result
        }
      }
      throw new Error('无法解析 MCP 响应')
    } finally {
      clearTimeout(timer)
    }
  }

  async function initialize(server) {
    const result = await mcpRequest(server, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'gal-tavern', version: '2.0.0' },
    })
    // 通知 initialized（可选）
    try {
      await mcpRequest(server, 'notifications/initialized', {})
    } catch { /* ignore */ }
    return result
  }

  async function listTools(server) {
    const result = await mcpRequest(server, 'tools/list', {})
    return Array.isArray(result && result.tools) ? result.tools : []
  }

  async function callTool(server, name, args) {
    const result = await mcpRequest(server, 'tools/call', { name, arguments: args || {} })
    // MCP 结果：{content: [{type:'text', text}], isError}
    if (result && result.isError) {
      const text = extractTextContent(result)
      throw new Error(text || 'MCP tool error')
    }
    return extractTextContent(result)
  }

  function extractTextContent(result) {
    if (!result || !Array.isArray(result.content)) return ''
    return result.content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
  }

  async function refreshMcpServerDiscovery(serverId) {
    const server = await getMcpServerById(serverId)
    if (!server) return null
    try {
      await initialize(server)
      const tools = await listTools(server)
      server.tools = tools.slice(0, server.limits.maxToolsPerServer || 128)
      server.health = { status: 'ready' }
      server.toolCache = { tools: server.tools, updatedAt: Date.now() }
    } catch (err) {
      server.health = { status: 'error', message: err && err.message ? err.message : String(err) }
    }
    await updateMcpServer(serverId, {
      tools: server.tools,
      health: server.health,
      toolCache: server.toolCache,
    })
    return server
  }

  async function executeMcpTool(serverId, toolName, args) {
    const server = await getMcpServerById(serverId)
    if (!server) throw new Error('MCP 服务不存在')
    const text = await callTool(server, toolName, args)
    return text
  }

  globalThis.DSG_MCP = {
    getAllMcpServers,
    getMcpServerById,
    createMcpServer,
    updateMcpServer,
    deleteMcpServer,
    refreshMcpServerDiscovery,
    executeMcpTool,
  }
})()
