/**
 * GAL 酒馆 — 工具系统（移植 WebTool core/tool/*）
 * 统一工具抽象：descriptor（XML 协议注入）、invocation 解析、执行 runtime、历史记录。
 * 本地工具：memory_save / memory_update / memory_delete / character_learn。
 */
;(function () {
  'use strict'

  const HISTORY_KEY = 'dsg_tool_call_history'

  const LOCAL_TOOLS = [
    {
      id: 'local:memory:memory_save',
      name: 'memory_save',
      invocationName: 'memory_save',
      title: '保存记忆',
      description: '保存一条新的长期记忆或上下文记忆',
      provider: { kind: 'local', id: 'memory', displayName: 'GAL Memory', transport: 'in_process' },
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['user', 'feedback', 'topic', 'reference'], description: '记忆类型：user/feedback/topic/reference' },
          scope: { type: 'string', enum: ['permanent', 'contextual', 'temporary'], description: '记忆层级' },
          name: { type: 'string', description: '简短标题' },
          content: { type: 'string', description: '要保存的内容' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
        },
        required: ['type', 'name', 'content', 'tags'],
        additionalProperties: false,
      },
      execution: { mode: 'auto', enabled: true, risk: 'low' },
    },
    {
      id: 'local:memory:memory_update',
      name: 'memory_update',
      invocationName: 'memory_update',
      title: '更新记忆',
      description: '更新已有记忆',
      provider: { kind: 'local', id: 'memory', displayName: 'GAL Memory', transport: 'in_process' },
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '记忆 ID' },
          type: { type: 'string', enum: ['user', 'feedback', 'topic', 'reference'], description: '记忆类型' },
          scope: { type: 'string', enum: ['permanent', 'contextual', 'temporary'], description: '记忆层级' },
          name: { type: 'string', description: '更新后的标题' },
          content: { type: 'string', description: '更新后的内容' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
        },
        required: ['id', 'type', 'name', 'content', 'tags'],
        additionalProperties: false,
      },
      execution: { mode: 'auto', enabled: true, risk: 'medium' },
    },
    {
      id: 'local:memory:memory_delete',
      name: 'memory_delete',
      invocationName: 'memory_delete',
      title: '删除记忆',
      description: '删除指定记忆',
      provider: { kind: 'local', id: 'memory', displayName: 'GAL Memory', transport: 'in_process' },
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'integer', description: '记忆 ID' } },
        required: ['id'],
        additionalProperties: false,
      },
      execution: { mode: 'auto', enabled: true, risk: 'medium' },
    },
    {
      id: 'local:character:character_learn',
      name: 'character_learn',
      invocationName: 'character_learn',
      title: '角色卡学习',
      description: '把对话中学到的角色设定补充进当前角色卡',
      provider: { kind: 'local', id: 'character', displayName: 'GAL Character', transport: 'in_process' },
      inputSchema: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['description', 'personality', 'scenario', 'exampleDialogue'], description: '要补充的角色卡字段' },
          content: { type: 'string', description: '要补充的内容' },
          replace: { type: 'boolean', description: 'true=替换, false=追加' },
        },
        required: ['field', 'content'],
        additionalProperties: false,
      },
      execution: { mode: 'auto', enabled: true, risk: 'medium' },
    },
  ]

  const DEFAULT_RECOGNIZED_TOOL_TAGS = LOCAL_TOOLS.map((t) => t.invocationName)

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function createToolInvocationCatalog(descriptors, recognizedTags) {
    descriptors = descriptors || LOCAL_TOOLS
    recognizedTags = recognizedTags || DEFAULT_RECOGNIZED_TOOL_TAGS
    const descriptorByInvocationName = new Map()
    const descriptorByName = new Map()
    const invocationNames = new Set(recognizedTags.map((t) => String(t).trim()).filter(Boolean))
    for (const d of descriptors) {
      const inv = String(d.invocationName || '').trim()
      if (inv) {
        invocationNames.add(inv)
        if (!descriptorByInvocationName.has(inv)) descriptorByInvocationName.set(inv, d)
      }
      const name = String(d.name || '').trim()
      if (name && !descriptorByName.has(name)) descriptorByName.set(name, d)
    }
    return { descriptors, invocationNames: [...invocationNames], descriptorByInvocationName, descriptorByName }
  }

  function createXmlToolCallRegex(catalog) {
    if (!catalog.invocationNames.length) return /$a/g
    const names = catalog.invocationNames.map(escapeRegExp).join('|')
    return new RegExp(`<(${names})>\\s*([\\s\\S]*?)\\s*<\\/\\1>`, 'g')
  }

  function createToolCallFromInvocation(invocationName, payload, raw, catalog) {
    const descriptor = catalog.descriptorByInvocationName.get(invocationName) || catalog.descriptorByName.get(invocationName)
    return {
      name: descriptor ? descriptor.name : invocationName,
      invocationName: descriptor ? descriptor.invocationName : invocationName,
      payload,
      raw,
      descriptorId: descriptor ? descriptor.id : undefined,
      provider: descriptor ? descriptor.provider : undefined,
    }
  }

  function extractToolCalls(text, options) {
    const calls = []
    const catalog = createToolInvocationCatalog(
      options && options.descriptors,
      options && options.recognizedTags,
    )
    const regex = createXmlToolCallRegex(catalog)
    let match
    while ((match = regex.exec(text)) !== null) {
      let payload
      try {
        payload = JSON.parse(match[2])
      } catch {
        continue
      }
      calls.push(createToolCallFromInvocation(match[1], payload, match[0], catalog))
    }
    return calls
  }

  function stripToolCalls(text, options) {
    const catalog = createToolInvocationCatalog(
      options && options.descriptors,
      options && options.recognizedTags,
    )
    return String(text).replace(createXmlToolCallRegex(catalog), '').trim()
  }

  function hasXmlToolMarker(text, options) {
    const catalog = createToolInvocationCatalog(
      options && options.descriptors,
      options && options.recognizedTags,
    )
    return catalog.invocationNames.some((name) => text.includes('<' + name + '>') || text.includes('</' + name + '>'))
  }

  async function executeLocalToolCall(call) {
    try {
      if (call.name === 'memory_save') {
        const mem = await globalThis.DSG_MEMORY.saveMemory({
          type: String(call.payload.type || 'topic'),
          scope: call.payload.scope,
          name: String(call.payload.name || '记忆'),
          content: String(call.payload.content || ''),
          tags: Array.isArray(call.payload.tags) ? call.payload.tags.filter((t) => typeof t === 'string') : [],
          pinned: false,
        })
        return { ok: true, summary: '已保存', detail: mem.name, output: { id: mem.id } }
      }
      if (call.name === 'memory_update') {
        const id = Number(call.payload.id)
        const existing = await globalThis.DSG_MEMORY.getMemoryById(id)
        if (!existing) return { ok: false, summary: '未找到记忆', detail: 'ID ' + id + ' 不存在' }
        await globalThis.DSG_MEMORY.updateMemory({
          ...existing,
          type: call.payload.type || existing.type,
          scope: call.payload.scope || existing.scope,
          name: String(call.payload.name || existing.name),
          content: String(call.payload.content || existing.content),
          tags: Array.isArray(call.payload.tags) ? call.payload.tags : existing.tags,
        })
        return { ok: true, summary: '已更新', detail: existing.name }
      }
      if (call.name === 'memory_delete') {
        const id = Number(call.payload.id)
        await globalThis.DSG_MEMORY.deleteMemory(id)
        return { ok: true, summary: '已删除', detail: '#' + id }
      }
      if (call.name === 'character_learn') {
        return { ok: true, summary: '已请求角色学习', detail: String(call.payload.field || '') }
      }
      return { ok: false, summary: '不支持的本地工具', detail: call.name }
    } catch (err) {
      return { ok: false, summary: '执行失败', detail: err && err.message ? err.message : String(err) }
    }
  }

  async function addToolCallHistory(record) {
    if (!globalThis.DSG_STORAGE) return
    const list = await globalThis.DSG_STORAGE.getValue(HISTORY_KEY, [], (raw) => Array.isArray(raw) ? raw : [])
    list.push({
      id: record.id || (crypto.randomUUID ? crypto.randomUUID() : 'h' + Math.random().toString(36).slice(2)),
      call: record.call,
      result: record.result,
      createdAt: Date.now(),
      source: record.source || 'manual_chat',
    })
    const trimmed = list.slice(-200)
    await globalThis.DSG_STORAGE.setValue(HISTORY_KEY, trimmed)
  }

  async function getToolCallHistory(limit) {
    if (!globalThis.DSG_STORAGE) return []
    const list = await globalThis.DSG_STORAGE.getValue(HISTORY_KEY, [], (raw) => Array.isArray(raw) ? raw : [])
    return limit ? list.slice(-limit) : list
  }

  async function clearToolCallHistory() {
    if (!globalThis.DSG_STORAGE) return
    await globalThis.DSG_STORAGE.removeValue(HISTORY_KEY)
  }

  globalThis.DSG_TOOL = {
    LOCAL_TOOLS,
    DEFAULT_RECOGNIZED_TOOL_TAGS,
    createToolInvocationCatalog,
    createXmlToolCallRegex,
    createToolCallFromInvocation,
    extractToolCalls,
    stripToolCalls,
    hasXmlToolMarker,
    executeLocalToolCall,
    addToolCallHistory,
    getToolCallHistory,
    clearToolCallHistory,
  }
})()
