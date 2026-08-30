/**
 * GAL 酒馆 �?storage 层（替代 WebTool �?Dexie + chrome storage 封装�? * 统一�?chrome.storage.local 持久化记�?技�?预设/MCP/配置�? * 纯函数风格，可在 background / sidepanel / content 中使用�? */
;(function () {
  'use strict'

  const api = chrome && chrome.storage && chrome.storage.local ? chrome.storage.local : null

  async function getValue(key, fallback, normalize) {
    try {
      if (!api) return fallback
      const data = await api.get(key)
      const raw = data[key]
      if (raw === undefined) return fallback
      return normalize ? normalize(raw) : raw
    } catch {
      return fallback
    }
  }

  async function setValue(key, value) {
    if (!api) return
    await api.set({ [key]: value })
  }

  async function removeValue(key) {
    if (!api) return
    await api.remove(key)
  }

  async function getMany(keys) {
    try {
      if (!api) return {}
      return await api.get(keys)
    } catch {
      return {}
    }
  }

  async function setMany(entries) {
    if (!api) return
    await api.set(entries)
  }

  globalThis.DSG_STORAGE = { getValue, setValue, removeValue, getMany, setMany }
})()
