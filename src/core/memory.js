/**
 * GAL 酒馆 — 记忆系统（移植 WebTool core/memory/*）
 * 四种类型（user/feedback/topic/reference）× 三层权重（permanent/contextual/temporary）
 * 分层预算分配（40%/45%/15%）+ 关键词匹配 + 权重排序的智能注入。
 */
;(function () {
  'use strict'

  const STORAGE_KEY = 'dsg_memories_v2'
  const MEMORY_TOKEN_BUDGET = 3000

  const STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
    '自己', '这', '他', '她', '它', '们', '那', '里', '之', '中', '与', '而', '为',
    '以', '及', '等', '被', '把', '让', '给', '从', '向', '对', '但', '如果', '因为',
    '所以', '虽然', '可以', '能', '想', '知道', '时候', '没', '什么', '怎么', '这个',
    '那个', '还', '过', '吗', '呢', '吧', '啊', '嗯', '哦', '呀', '啦',
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for',
    'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his',
    'by', 'from', 'they', 'we', 'she', 'or', 'an', 'will', 'my', 'one', 'all',
    'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who',
    'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'no', 'just',
    'him', 'know', 'take', 'into', 'your', 'some', 'could', 'them', 'than',
    'other', 'been', 'has', 'its', 'use', 'two', 'how', 'our', 'way',
  ])

  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('zh-Hans', { granularity: 'word' })
    : null

  function segmentText(text) {
    if (segmenter) {
      return [...segmenter.segment(text)]
        .filter((s) => s.isWordLike)
        .map((s) => s.segment.toLowerCase())
        .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    }
    return String(text).toLowerCase()
      .split(/[\s,，。！？；：、\-_/]+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
  }

  function estimateTokens(text) {
    return Math.ceil(String(text).length * 0.35)
  }

  async function readAll() {
    return globalThis.DSG_STORAGE
      ? globalThis.DSG_STORAGE.getValue(STORAGE_KEY, [], (raw) => Array.isArray(raw) ? raw : [])
      : []
  }
  async function writeAll(list) {
    if (globalThis.DSG_STORAGE) await globalThis.DSG_STORAGE.setValue(STORAGE_KEY, list)
  }

  function normalizeMemory(memory) {
    return {
      id: memory.id,
      syncId: memory.syncId || (crypto.randomUUID ? crypto.randomUUID() : 'u' + Math.random().toString(36).slice(2)),
      type: ['user', 'feedback', 'topic', 'reference'].includes(memory.type) ? memory.type : 'topic',
      scope: globalThis.DSG_WEIGHT ? globalThis.DSG_WEIGHT.normalizeMemoryScope(memory) : 'contextual',
      name: memory.name || '记忆',
      content: memory.content || '',
      description: memory.description || '',
      tags: Array.isArray(memory.tags) ? memory.tags.filter((t) => typeof t === 'string') : [],
      pinned: memory.pinned === true,
      createdAt: memory.createdAt || Date.now(),
      updatedAt: memory.updatedAt || Date.now(),
      accessCount: Number.isFinite(memory.accessCount) ? memory.accessCount : 0,
      lastAccessedAt: memory.lastAccessedAt || Date.now(),
      expiresAt: memory.expiresAt,
    }
  }

  async function getAllMemories() {
    const list = await readAll()
    return list.map(normalizeMemory)
  }

  async function getMemoryById(id) {
    const list = await readAll()
    const found = list.find((m) => m.id === id)
    return found ? normalizeMemory(found) : null
  }

  async function saveMemory(mem) {
    const list = await readAll()
    const nextId = list.reduce((max, m) => Math.max(max, m.id || 0), 0) + 1
    const entry = normalizeMemory({ id: nextId, ...mem })
    list.push(entry)
    await writeAll(list)
    return entry
  }

  async function updateMemory(mem) {
    const list = await readAll()
    const idx = list.findIndex((m) => m.id === mem.id)
    if (idx === -1) return
    list[idx] = normalizeMemory({ ...list[idx], ...mem, updatedAt: Date.now() })
    await writeAll(list)
  }

  async function deleteMemory(id) {
    const list = await readAll()
    await writeAll(list.filter((m) => m.id !== id))
  }

  async function touchMemories(ids) {
    const now = Date.now()
    const list = await readAll()
    let changed = false
    for (const m of list) {
      if (ids.includes(m.id)) {
        m.accessCount = (m.accessCount || 0) + 1
        m.lastAccessedAt = now
        changed = true
      }
    }
    if (changed) await writeAll(list)
  }

  async function replaceAllMemories(memories) {
    await writeAll(memories.map(normalizeMemory))
  }

  async function archiveStaleMemories() {
    const threshold = Date.now() - 90 * 86400000
    const list = await readAll()
    const kept = list.filter((m) => m.pinned || m.accessCount >= 3 || m.lastAccessedAt >= threshold)
    if (kept.length !== list.length) {
      await writeAll(kept)
      return list.length - kept.length
    }
    return 0
  }

  function keywordScore(promptWords, memory) {
    const promptSet = new Set(promptWords)
    let tagHits = 0
    for (const tag of memory.tags || []) {
      const tagLower = String(tag).toLowerCase()
      if (tagLower.length > 1 && promptSet.has(tagLower)) tagHits++
      for (const pw of promptWords) {
        if (pw.length > 2 && tagLower.includes(pw) && tagLower !== pw) tagHits += 0.5
      }
    }
    const nameWords = segmentText(memory.name)
    let nameHits = 0
    for (const w of nameWords) if (promptSet.has(w)) nameHits++
    const contentWords = segmentText(memory.content)
    let contentHits = 0
    for (const w of contentWords) if (promptSet.has(w)) contentHits++
    return tagHits * 20 + nameHits * 15 + contentHits * 5
  }

  function decayScore(memory) {
    const daysSinceAccess = (Date.now() - (memory.lastAccessedAt || Date.now())) / 86400000
    const freshness = Math.max(0, 10 - daysSinceAccess * 0.1)
    return Math.min(memory.accessCount || 0, 20) + freshness
  }

  function getMemoryBudget(promptTokens, baseBudget) {
    baseBudget = baseBudget || MEMORY_TOKEN_BUDGET
    if (promptTokens > 3000) {
      return Math.max(800, baseBudget - Math.floor((promptTokens - 3000) * 0.2))
    }
    return baseBudget
  }

  const SCOPE_BUDGET_RATIO = { permanent: 0.4, contextual: 0.45, temporary: 0.15 }
  const SCOPE_ORDER = ['permanent', 'contextual', 'temporary']

  function sanitizeContent(text) {
    return String(text || '')
      .replace(/｜DSML｜/g, '|DSML|')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  }

  function formatMemoryLine(m) {
    const idPrefix = m.id != null ? '#' + m.id + ' ' : ''
    return '- ' + idPrefix + '[' + m.type + '] ' + sanitizeContent(m.name) + ': ' + sanitizeContent(m.content)
  }

  function formatMemoriesBlock(memories) {
    if (!memories || memories.length === 0) return '(暂无记忆)'
    return memories.map(formatMemoryLine).join('\n')
  }

  async function selectMemoriesForPrompt(prompt, options) {
    options = options || {}
    const allMemories = options.memories || (await getAllMemories())
    if (allMemories.length === 0) return { selected: [], block: '(暂无记忆)', budget: MEMORY_TOKEN_BUDGET }

    const budget = options.budget || getMemoryBudget(estimateTokens(prompt))
    const identityOnly = options.identityOnly === true
    const candidates = identityOnly
      ? allMemories.filter((m) => m.type === 'user' || m.type === 'feedback' || m.pinned)
      : allMemories
    if (candidates.length === 0) return { selected: [], block: '(暂无记忆)', budget }

    const promptWords = segmentText(prompt)
    const byScope = new Map()
    for (const memory of candidates) {
      const scope = globalThis.DSG_WEIGHT.normalizeMemoryScope(memory)
      if (!byScope.has(scope)) byScope.set(scope, [])
      const score = globalThis.DSG_WEIGHT.memoryWeight(memory, keywordScore(promptWords, memory)) + decayScore(memory)
      const cost = estimateTokens(formatMemoryLine(memory))
      byScope.get(scope).push({ memory, score, cost })
    }
    for (const group of byScope.values()) group.sort((a, b) => b.score - a.score)
    const masterSorted = [...byScope.values()].flat().sort((a, b) => b.score - a.score)

    const selected = []
    const selectedSet = new Set()
    const tryAdd = (entry, remaining) => {
      const memId = entry.memory.id
      if (memId != null && selectedSet.has(memId)) return remaining
      if (remaining - entry.cost < 0 && selected.length > 0) return remaining
      selected.push(entry.memory)
      if (memId != null) selectedSet.add(memId)
      return remaining - entry.cost
    }

    let overflowBudget = 0
    for (const scope of SCOPE_ORDER) {
      const group = byScope.get(scope)
      if (!group || group.length === 0) {
        overflowBudget += Math.floor(budget * SCOPE_BUDGET_RATIO[scope])
        continue
      }
      const scopeBudget = Math.floor(budget * SCOPE_BUDGET_RATIO[scope]) + overflowBudget
      overflowBudget = 0
      let remaining = scopeBudget
      for (const entry of group) {
        const next = tryAdd(entry, remaining)
        if (next === remaining) break
        remaining = next
      }
      overflowBudget = remaining
    }
    if (overflowBudget > 0) {
      for (const entry of masterSorted) {
        overflowBudget = tryAdd(entry, overflowBudget)
      }
    }

    return { selected, block: formatMemoriesBlock(selected), budget }
  }

  globalThis.DSG_MEMORY = {
    MEMORY_TOKEN_BUDGET,
    getAllMemories,
    getMemoryById,
    saveMemory,
    updateMemory,
    deleteMemory,
    touchMemories,
    replaceAllMemories,
    archiveStaleMemories,
    selectMemoriesForPrompt,
    formatMemoriesBlock,
    estimateTokens,
  }
})()
