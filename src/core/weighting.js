/**
 * GAL 酒馆 �?权重计算（移�?WebTool core/weighting.ts�? * 记忆分层权重、使用频�?新鲜�?关键词匹配、技�?预设排序�? */
;(function () {
  'use strict'

  const MEMORY_SCOPE_BASE = { permanent: 300, contextual: 180, temporary: 80 }

  function normalizeUsageStats(usage) {
    usage = usage || {}
    return {
      useCount: Number.isFinite(usage.useCount) ? Math.max(0, usage.useCount) : 0,
      lastUsedAt: typeof usage.lastUsedAt === 'number' ? usage.lastUsedAt : null,
      createdAt: typeof usage.createdAt === 'number' ? usage.createdAt : undefined,
      updatedAt: typeof usage.updatedAt === 'number' ? usage.updatedAt : undefined,
    }
  }

  function defaultMemoryScope(memory) {
    if (memory.type === 'user' || memory.type === 'feedback') return 'permanent'
    return 'contextual'
  }

  function normalizeMemoryScope(memory) {
    if (memory.scope === 'permanent' || memory.scope === 'contextual' || memory.scope === 'temporary') {
      return memory.scope
    }
    return defaultMemoryScope(memory)
  }

  function usageCountScore(useCount) {
    return Math.min(100, Math.log1p(Math.max(0, useCount)) * 25)
  }

  function usageRecencyScore(lastUsedAt, now) {
    if (!lastUsedAt) return 0
    const days = Math.max(0, (now - lastUsedAt) / 86400000)
    return Math.max(0, 80 - days * 4)
  }

  function memoryUsageScore(accessCount) {
    return Math.min(80, Math.log1p(Math.max(0, accessCount)) * 18)
  }

  function memoryRecencyScore(lastAccessedAt, now) {
    const days = Math.max(0, (now - lastAccessedAt) / 86400000)
    return Math.max(0, 60 - days * 2)
  }

  function memoryWeight(memory, keywordScore, now) {
    now = now || Date.now()
    const scope = normalizeMemoryScope(memory)
    const expiresPenalty = memory.expiresAt && memory.expiresAt < now ? 500 : 0
    return (
      MEMORY_SCOPE_BASE[scope] +
      (memory.pinned ? 1000 : 0) +
      memoryUsageScore(memory.accessCount || 0) +
      memoryRecencyScore(memory.lastAccessedAt || now, now) +
      (keywordScore || 0) -
      expiresPenalty
    )
  }

  function queryMatchScore(name, description, query) {
    const q = (query || '').trim().toLowerCase()
    if (!q) return 0
    const n = (name || '').toLowerCase()
    const d = (description || '').toLowerCase()
    if (n === q) return 1000
    if (n.startsWith(q)) return 600
    if (n.includes(q)) return 300
    if (d.includes(q)) return 120
    return 0
  }

  function skillWeight(skill, query, now) {
    const usage = normalizeUsageStats(skill.usage)
    const base = skill.source === 'custom' ? 120 : 100
    return (
      base +
      usageCountScore(usage.useCount) +
      usageRecencyScore(usage.lastUsedAt, now) +
      queryMatchScore(skill.name, skill.description, query)
    )
  }

  function presetWeight(preset, query, now) {
    const usage = normalizeUsageStats(preset.usage)
    return (
      120 +
      usageCountScore(usage.useCount) +
      usageRecencyScore(usage.lastUsedAt, now) +
      queryMatchScore(preset.name, preset.content, query)
    )
  }

  globalThis.DSG_WEIGHT = {
    normalizeUsageStats,
    defaultMemoryScope,
    normalizeMemoryScope,
    memoryWeight,
    skillWeight,
    presetWeight,
    queryMatchScore,
  }
})()
