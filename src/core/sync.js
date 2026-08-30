/**
 * GAL 酒馆 — WebDAV 同步（移植 WebTool core/sync/*）
 * 同步记忆 / 自定义 Skill / 预设 为 JSON 文件；三方合并（local + remote）。
 */
;(function () {
  'use strict'

  const MEMORY_SYNC_KEY = 'dsg_sync_config'

  async function getSyncConfig() {
    return globalThis.DSG_STORAGE
      ? globalThis.DSG_STORAGE.getValue(MEMORY_SYNC_KEY, null, (raw) => raw || null)
      : null
  }

  async function saveSyncConfig(config) {
    if (globalThis.DSG_STORAGE) await globalThis.DSG_STORAGE.setValue(MEMORY_SYNC_KEY, config)
  }

  // ── WebDAV 基础请求 ──────────────────────────────────────────────
  function authHeader(config) {
    if (!config.username && !config.password) return {}
    const token = btoa(unescape(encodeURIComponent(config.username + ':' + config.password)))
    return { Authorization: 'Basic ' + token }
  }

  function joinPath(base, name) {
    const sep = base.endsWith('/') ? '' : '/'
    return base + sep + name
  }

  async function webdavRequest(config, method, path, body, contentType) {
    const headers = { ...authHeader(config) }
    if (contentType) headers['Content-Type'] = contentType
    const resp = await fetch(joinPath(config.url, path), { method, headers, body })
    if (!resp.ok && resp.status !== 404 && resp.status !== 201) {
      throw new Error('WebDAV ' + method + ' ' + path + ' 失败：HTTP ' + resp.status)
    }
    return resp
  }

  async function webdavTest(config) {
    const resp = await webdavRequest(config, 'PROPFIND', '', undefined, 'application/xml')
    if (!resp.ok) throw new Error('WebDAV 连接失败：HTTP ' + resp.status)
  }

  async function webdavMkcol(config) {
    const resp = await webdavRequest(config, 'MKCOL', '', undefined)
    // 405 = 已存在，可接受
    if (!resp.ok && resp.status !== 405) throw new Error('创建目录失败：HTTP ' + resp.status)
  }

  async function webdavGet(config, name) {
    const resp = await webdavRequest(config, 'GET', name)
    if (resp.status === 404) return null
    if (!resp.ok) throw new Error('读取 ' + name + ' 失败：HTTP ' + resp.status)
    return resp.text()
  }

  async function webdavPut(config, name, content) {
    const resp = await webdavRequest(config, 'PUT', name, content, 'application/json')
    if (!resp.ok) throw new Error('写入 ' + name + ' 失败：HTTP ' + resp.status)
  }

  // ── 三方合并（移植 merge.ts：按 syncId/更新时间合并，保留本地删除意图）──
  function mergeMemories(local, remote) {
    const map = new Map()
    const localById = new Map(local.map((m) => [String(m.syncId || m.id), m]))
    for (const r of remote || []) {
      const key = String(r.syncId || r.id)
      const l = localById.get(key)
      if (!l) map.set(key, r)
      else map.set(key, l.updatedAt >= (r.updatedAt || 0) ? l : r)
    }
    // 本地独有的条目
    const remoteKeys = new Set((remote || []).map((r) => String(r.syncId || r.id)))
    for (const l of local || []) {
      const key = String(l.syncId || l.id)
      if (!remoteKeys.has(key)) map.set(key, l)
    }
    return [...map.values()]
  }

  function mergeSkills(local, remote) {
    const map = new Map()
    for (const s of local || []) map.set(s.name, s)
    for (const r of remote || []) {
      const l = map.get(r.name)
      if (!l || (l.updatedAt || 0) < (r.updatedAt || 0)) map.set(r.name, r)
    }
    return [...map.values()]
  }

  function mergePresets(local, remote) {
    const map = new Map()
    for (const p of local || []) map.set(p.id, p)
    for (const r of remote || []) {
      const l = map.get(r.id)
      if (!l || (l.updatedAt || 0) < (r.updatedAt || 0)) map.set(r.id, r)
    }
    return [...map.values()]
  }

  // ── 完整同步流程 ─────────────────────────────────────────────────
  async function webdavSync() {
    const config = await getSyncConfig()
    if (!config) throw new Error('未配置 WebDAV')

    await webdavMkcol(config)

    const [localMemories, localSkills, localPresets] = await Promise.all([
      globalThis.DSG_MEMORY.getAllMemories(),
      globalThis.DSG_SKILLS ? globalThis.DSG_SKILLS.getAllSkills() : [],
      globalThis.DSG_PRESET.getAllPresets(),
    ])
    const localCustomSkills = (localSkills || []).filter((s) => s.source === 'custom')

    const [remoteMemJson, remoteSkillJson, remotePresetJson] = await Promise.all([
      webdavGet(config, 'memories.json'),
      webdavGet(config, 'skills.json'),
      webdavGet(config, 'presets.json'),
    ])

    const remoteMemories = remoteMemJson ? JSON.parse(remoteMemJson) : []
    const remoteSkills = remoteSkillJson ? JSON.parse(remoteSkillJson) : []
    const remotePresets = remotePresetJson ? JSON.parse(remotePresetJson) : []

    const mergedMemories = mergeMemories(localMemories, remoteMemories)
    const mergedSkills = mergeSkills(localCustomSkills, remoteSkills)
    const mergedPresets = mergePresets(localPresets, remotePresets)

    await Promise.all([
      globalThis.DSG_MEMORY.replaceAllMemories(mergedMemories),
      globalThis.DSG_SKILLS ? globalThis.DSG_SKILLS.replaceAllCustomSkills ? globalThis.DSG_SKILLS.replaceAllCustomSkills(mergedSkills) : Promise.resolve() : Promise.resolve(),
      globalThis.DSG_PRESET.replaceAllPresets(mergedPresets),
    ])

    await Promise.all([
      webdavPut(config, 'memories.json', JSON.stringify(mergedMemories)),
      webdavPut(config, 'skills.json', JSON.stringify(mergedSkills)),
      webdavPut(config, 'presets.json', JSON.stringify(mergedPresets)),
    ])

    const now = Date.now()
    await saveSyncConfig({ ...config, lastSyncAt: now })
    return { ok: true, lastSyncAt: now, memories: mergedMemories.length, skills: mergedSkills.length, presets: mergedPresets.length }
  }

  globalThis.DSG_SYNC = {
    getSyncConfig,
    saveSyncConfig,
    webdavTest,
    webdavSync,
    mergeMemories,
    mergeSkills,
    mergePresets,
  }
})()
