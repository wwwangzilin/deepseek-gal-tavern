/**
 * GAL 酒馆 — 系统提示词预设（移植 WebTool core/preset/store.ts）
 * 自定义预设 + 一键激活 + 首条注入 + 记忆联动。
 */
;(function () {
  'use strict'

  const STORAGE_KEY = 'dsg_presets'
  const ACTIVE_KEY = 'dsg_active_preset_id'

  function normalizePreset(preset) {
    return {
      id: preset.id,
      name: preset.name || '未命名预设',
      content: preset.content || '',
      createdAt: preset.createdAt || Date.now(),
      updatedAt: preset.updatedAt || Date.now(),
      memoryEnabled: preset.memoryEnabled === true,
      memoryIds: Array.isArray(preset.memoryIds) ? preset.memoryIds : [],
      usage: globalThis.DSG_WEIGHT ? globalThis.DSG_WEIGHT.normalizeUsageStats(preset.usage) : {},
    }
  }

  async function readPresets() {
    return globalThis.DSG_STORAGE
      ? globalThis.DSG_STORAGE.getValue(STORAGE_KEY, [], (raw) => Array.isArray(raw) ? raw.map(normalizePreset) : [])
      : []
  }
  async function writePresets(list) {
    if (globalThis.DSG_STORAGE) await globalThis.DSG_STORAGE.setValue(STORAGE_KEY, list.map(normalizePreset))
  }

  async function getAllPresets() {
    return readPresets()
  }

  async function savePreset(preset) {
    const presets = await readPresets()
    const idx = presets.findIndex((p) => p.id === preset.id)
    const next = normalizePreset(idx >= 0 ? { ...presets[idx], ...preset } : preset)
    if (idx >= 0) presets[idx] = next
    else presets.push(next)
    await writePresets(presets)
    return next
  }

  async function deletePreset(id) {
    const presets = (await readPresets()).filter((p) => p.id !== id)
    await writePresets(presets)
    const activeId = await getActivePresetId()
    if (activeId === id) await setActivePresetId(null)
  }

  async function touchPreset(id) {
    const presets = await readPresets()
    const idx = presets.findIndex((p) => p.id === id)
    if (idx === -1) return
    const now = Date.now()
    const usage = globalThis.DSG_WEIGHT ? globalThis.DSG_WEIGHT.normalizeUsageStats(presets[idx].usage) : {}
    presets[idx] = {
      ...presets[idx],
      usage: { ...usage, useCount: (usage.useCount || 0) + 1, lastUsedAt: now, updatedAt: now },
    }
    await writePresets(presets)
  }

  async function getActivePresetId() {
    return globalThis.DSG_STORAGE
      ? globalThis.DSG_STORAGE.getValue(ACTIVE_KEY, null, (raw) => typeof raw === 'string' ? raw : null)
      : null
  }

  async function setActivePresetId(id) {
    if (!globalThis.DSG_STORAGE) return
    if (id === null) await globalThis.DSG_STORAGE.removeValue(ACTIVE_KEY)
    else await globalThis.DSG_STORAGE.setValue(ACTIVE_KEY, id)
  }

  async function getActivePreset() {
    const activeId = await getActivePresetId()
    if (!activeId) return null
    const presets = await readPresets()
    return presets.find((p) => p.id === activeId) || null
  }

  async function replaceAllPresets(presets) {
    await writePresets(presets)
  }

  globalThis.DSG_PRESET = {
    getAllPresets,
    savePreset,
    deletePreset,
    touchPreset,
    getActivePresetId,
    setActivePresetId,
    getActivePreset,
    replaceAllPresets,
  }
})()
