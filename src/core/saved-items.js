/**
 * GAL 酒馆 — 保存项（移植 deepseek-pp core/saved-items/*）
 * 保存片段（snippet）与书签（bookmark），可搜索、按标签管理。
 */
;(function () {
  'use strict'

  const STORAGE_KEY = 'dsg_saved_items'

  function createId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'saved-' + Date.now() + '-' + Math.random().toString(16).slice(2)
  }

  function normalizeTags(value) {
    if (!Array.isArray(value)) return []
    return [...new Set(value
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean))]
  }

  async function readState() {
    return globalThis.DSG_STORAGE
      ? globalThis.DSG_STORAGE.getValue(STORAGE_KEY, { schemaVersion: 1, items: [] }, (raw) => {
          if (!raw || typeof raw !== 'object') return { schemaVersion: 1, items: [] }
          return { schemaVersion: 1, items: Array.isArray(raw.items) ? raw.items : [] }
        })
      : { schemaVersion: 1, items: [] }
  }
  async function writeState(state) {
    if (globalThis.DSG_STORAGE) await globalThis.DSG_STORAGE.setValue(STORAGE_KEY, state)
  }

  async function getAllSavedItems() {
    const state = await readState()
    return state.items || []
  }

  async function saveSavedItem(input) {
    const state = await readState()
    const now = Date.now()
    const item = {
      id: input.id || createId(),
      syncId: input.syncId || createId(),
      kind: input.kind === 'bookmark' ? 'bookmark' : 'snippet',
      title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : '未命名',
      content: typeof input.content === 'string' && input.content.trim() ? input.content.trim() : '',
      sourceUrl: input.sourceUrl && input.sourceUrl.trim() ? input.sourceUrl.trim() : undefined,
      tags: normalizeTags(input.tags),
      createdAt: input.createdAt || now,
      updatedAt: now,
    }
    const items = [
      ...(state.items || []).filter((existing) => existing.id !== item.id),
      item,
    ].sort((a, b) => b.updatedAt - a.updatedAt)
    await writeState({ ...state, schemaVersion: 1, items })
    return item
  }

  async function deleteSavedItem(id) {
    const state = await readState()
    await writeState({ ...state, items: (state.items || []).filter((item) => item.id !== id) })
  }

  async function searchSavedItems(query) {
    const items = await getAllSavedItems()
    const q = String(query || '').trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => {
      return String(item.title || '').toLowerCase().includes(q)
        || String(item.content || '').toLowerCase().includes(q)
        || (item.tags || []).some((t) => String(t).toLowerCase().includes(q))
    })
  }

  async function replaceAllSavedItems(items) {
    await writeState({ schemaVersion: 1, items: items || [] })
  }

  globalThis.DSG_SAVED = {
    getAllSavedItems,
    saveSavedItem,
    deleteSavedItem,
    searchSavedItems,
    replaceAllSavedItems,
  }
})()
