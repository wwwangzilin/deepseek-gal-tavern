/**
 * GAL 酒馆 — background service worker
 * 消息路由（记忆/技能/预设/MCP/对话/工具/设置/同步），状态广播。
 */
importScripts(
  'core/storage.js',
  'core/weighting.js',
  'core/memory.js',
  'core/presets.js',
  'core/tools.js',
  'core/mcp.js',
  'core/sync.js',
)

const NEW_CHAT_URL = 'https://chat.deepseek.com/a/chat'
const CONVERSATION_SESSION_CACHE_KEY = 'dsg_conversation_session_cache'

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
  globalThis.DSG_MEMORY.archiveStaleMemories().catch(() => {})
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(() => sendResponse(null))
  return true
})

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== 'string') return null
  switch (message.type) {
    case 'GET_MEMORIES': return globalThis.DSG_MEMORY.getAllMemories()
    case 'GET_MEMORY_BY_ID': { const { id } = message.payload || {}; return globalThis.DSG_MEMORY.getMemoryById(Number(id)) }
    case 'SAVE_MEMORY': { const mem = await globalThis.DSG_MEMORY.saveMemory(message.payload); await broadcastStateUpdate(sender.tab && sender.tab.id); return { id: mem.id } }
    case 'UPDATE_MEMORY': { await globalThis.DSG_MEMORY.updateMemory(message.payload); await broadcastStateUpdate(sender.tab && sender.tab.id); return { ok: true } }
    case 'DELETE_MEMORY': { const { id } = message.payload || {}; await globalThis.DSG_MEMORY.deleteMemory(Number(id)); await broadcastStateUpdate(sender.tab && sender.tab.id); return { ok: true } }
    case 'TOUCH_MEMORIES': { const { ids } = message.payload || {}; await globalThis.DSG_MEMORY.touchMemories(ids || []); return { ok: true } }
    case 'REPLACE_ALL_MEMORIES': { await globalThis.DSG_MEMORY.replaceAllMemories(message.payload || []); await broadcastStateUpdate(sender.tab && sender.tab.id); return { ok: true } }
    case 'GET_SKILLS': return globalThis.DSG_SKILLS ? globalThis.DSG_SKILLS.getAllSkills() : []
    case 'SAVE_SKILL': { if (globalThis.DSG_SKILLS) await globalThis.DSG_SKILLS.saveSkill(message.payload); await broadcastStateUpdate(sender.tab && sender.tab.id); return { ok: true } }
    case 'DELETE_SKILL': { const { name } = message.payload || {}; if (globalThis.DSG_SKILLS) await globalThis.DSG_SKILLS.deleteSkill(name); await broadcastStateUpdate(sender.tab && sender.tab.id); return { ok: true } }
    case 'GET_PRESETS': return globalThis.DSG_PRESET.getAllPresets()
    case 'SAVE_PRESET': { await globalThis.DSG_PRESET.savePreset(message.payload); await broadcastStateUpdate(sender.tab && sender.tab.id); return { ok: true } }
    case 'DELETE_PRESET': { const { id } = message.payload || {}; await globalThis.DSG_PRESET.deletePreset(id); await broadcastStateUpdate(sender.tab && sender.tab.id); return { ok: true } }
    case 'SET_ACTIVE_PRESET': { const { id } = message.payload || {}; await globalThis.DSG_PRESET.setActivePresetId(id || null); if (id) await globalThis.DSG_PRESET.touchPreset(id); await broadcastStateUpdate(sender.tab && sender.tab.id); return { ok: true } }
    case 'GET_ACTIVE_PRESET': return globalThis.DSG_PRESET.getActivePreset()
    case 'EXECUTE_TOOL_CALL': { const call = message.payload; const result = await globalThis.DSG_TOOL.executeLocalToolCall(call); await globalThis.DSG_TOOL.addToolCallHistory({ call, result, source: 'manual_chat' }); await broadcastStateUpdate(sender.tab && sender.tab.id); return result }
    case 'GET_TOOL_CALL_HISTORY': { const { limit } = (message.payload || {}); return globalThis.DSG_TOOL.getToolCallHistory(limit) }
    case 'CLEAR_TOOL_CALL_HISTORY': await globalThis.DSG_TOOL.clearToolCallHistory(); return { ok: true }
    case 'GET_CONFIG': return { version: '2.0.0' }
    case 'GET_MEMORY_CONFIG': return globalThis.DSG_STORAGE.getValue('dsg_memory_config', { tokenBudget: 3000 }, (raw) => raw || {})
    case 'SET_MEMORY_CONFIG': { await globalThis.DSG_STORAGE.setValue('dsg_memory_config', message.payload); await broadcastToTabs({ type: 'MEMORY_CONFIG_UPDATED', ...message.payload }, sender.tab && sender.tab.id); return { ok: true } }
    case 'GET_BACKGROUND': return globalThis.DSG_STORAGE.getValue('dsg_background', null, (raw) => raw || null)
    case 'SAVE_BACKGROUND': { await globalThis.DSG_STORAGE.setValue('dsg_background', message.payload); await broadcastToTabs({ type: 'BACKGROUND_UPDATED', config: message.payload }, sender.tab && sender.tab.id); return { ok: true } }
    case 'CLEAR_BACKGROUND': { await globalThis.DSG_STORAGE.removeValue('dsg_background'); await broadcastToTabs({ type: 'BACKGROUND_UPDATED', config: null }, sender.tab && sender.tab.id); return { ok: true } }
    case 'LIST_SESSIONS': { const forceRefresh = (message.payload || {}).forceRefresh === true; return getCachedConversationSessions(forceRefresh) }
    case 'DELETE_SESSION': { const { id } = message.payload || {}; await sendDeepSeekTabMessage({ type: 'DS_DELETE_SESSION', payload: { id } }); await navigateDeepSeekToNewChat(); return { ok: true } }
    case 'DELETE_SESSIONS': { const { ids } = message.payload || {}; for (const id of ids || []) await sendDeepSeekTabMessage({ type: 'DS_DELETE_SESSION', payload: { id } }); await navigateDeepSeekToNewChat(); return { ok: true } }
    case 'RENAME_SESSION': { const { id, title } = message.payload || {}; await sendDeepSeekTabMessage({ type: 'DS_RENAME_SESSION', payload: { id, title } }); return { ok: true } }
    case 'GET_SESSION_HISTORY': { const { id } = message.payload || {}; return sendDeepSeekTabMessage({ type: 'DS_GET_SESSION_HISTORY', payload: { id } }) }
    case 'REFRESH_DEEPSEEK_PAGE': await refreshDeepSeekTab(); return { ok: true }
    case 'GET_MCP_SERVERS': return globalThis.DSG_MCP.getAllMcpServers()
    case 'GET_MCP_SERVER': { const { id } = message.payload || {}; return globalThis.DSG_MCP.getMcpServerById(id) }
    case 'CREATE_MCP_SERVER': { const server = await globalThis.DSG_MCP.createMcpServer(message.payload); await broadcastMcpServersUpdate(sender.tab && sender.tab.id); return server }
    case 'UPDATE_MCP_SERVER': { const { id, patch } = message.payload || {}; const server = await globalThis.DSG_MCP.updateMcpServer(id, patch); await broadcastMcpServersUpdate(sender.tab && sender.tab.id); return server }
    case 'DELETE_MCP_SERVER': { const { id } = message.payload || {}; await globalThis.DSG_MCP.deleteMcpServer(id); await broadcastMcpServersUpdate(sender.tab && sender.tab.id); return { ok: true } }
    case 'REFRESH_MCP_SERVER_TOOLS': { const { serverId } = message.payload || {}; const cache = await globalThis.DSG_MCP.refreshMcpServerDiscovery(serverId); await broadcastMcpServersUpdate(sender.tab && sender.tab.id); return cache }
    case 'EXECUTE_MCP_TOOL': { const { serverId, toolName, args } = message.payload || {}; try { const text = await globalThis.DSG_MCP.executeMcpTool(serverId, toolName, args); return { ok: true, output: text } } catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) } } }
    case 'GET_SYNC_CONFIG': return globalThis.DSG_SYNC ? globalThis.DSG_SYNC.getSyncConfig() : null
    case 'SAVE_SYNC_CONFIG': { await globalThis.DSG_SYNC.saveSyncConfig(message.payload); return { ok: true } }
    case 'WEBDAV_TEST': { await globalThis.DSG_SYNC.webdavTest(message.payload); return { ok: true } }
    case 'WEBDAV_SYNC': { const result = await globalThis.DSG_SYNC.webdavSync(); await broadcastStateUpdate(sender.tab && sender.tab.id); return result }
    default:
      // 通用 DS_* 透传：DS_GET_CHARACTERS / DS_SAVE_CHARACTER 等由 content 处理
      if (typeof message.type === 'string' && message.type.startsWith('DS_')) {
        const data = await sendDeepSeekTabMessage(message)
        return { ok: true, data }
      }
      return null
  }
}

async function sendDeepSeekTabMessage(message) {
  const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' })
  const target = tabs.find((tab) => tab.active && tab.id !== undefined) || tabs.find((tab) => tab.id !== undefined)
  if (!target || target.id === undefined) throw new Error('请先打开并登录 DeepSeek 页面')
  const response = await chrome.tabs.sendMessage(target.id, message)
  if (!response || !response.ok) throw new Error((response && response.error) || 'DeepSeek 页面通信失败')
  return response.data
}

async function navigateDeepSeekToNewChat() {
  const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' })
  const target = tabs.find((tab) => tab.active && tab.id !== undefined) || tabs.find((tab) => tab.id !== undefined)
  if (!target || target.id === undefined) return
  await chrome.tabs.update(target.id, { url: NEW_CHAT_URL })
}

async function refreshDeepSeekTab() {
  const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' })
  const target = tabs.find((tab) => tab.active && tab.id !== undefined) || tabs.find((tab) => tab.id !== undefined)
  if (!target || target.id === undefined) return
  await chrome.tabs.reload(target.id, { bypassCache: true })
}

async function getCachedConversationSessions(forceRefresh) {
  const today = new Date().toISOString().slice(0, 10)
  if (!forceRefresh) {
    const cache = await globalThis.DSG_STORAGE.getValue(CONVERSATION_SESSION_CACHE_KEY, null, (raw) => raw || null)
    if (cache && cache.date === today && Array.isArray(cache.sessions) && cache.sessions.length > 0) return cache.sessions
  }
  const sessions = await sendDeepSeekTabMessage({ type: 'DS_LIST_SESSIONS' })
  const nextCache = { date: today, sessions: sessions || [], updatedAt: Date.now() }
  await globalThis.DSG_STORAGE.setValue(CONVERSATION_SESSION_CACHE_KEY, nextCache)
  return nextCache.sessions
}

async function broadcastToTabs(payload, excludeTabId) {
  const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' })
  for (const tab of tabs) {
    if (tab.id && tab.id !== excludeTabId) chrome.tabs.sendMessage(tab.id, payload).catch(() => {})
  }
  if (excludeTabId) chrome.tabs.sendMessage(excludeTabId, payload).catch(() => {})
}

async function broadcastStateUpdate(excludeTabId) {
  const [memories, skills, presets, activePreset] = await Promise.all([
    globalThis.DSG_MEMORY.getAllMemories(),
    globalThis.DSG_SKILLS ? globalThis.DSG_SKILLS.getAllSkills() : [],
    globalThis.DSG_PRESET.getAllPresets(),
    globalThis.DSG_PRESET.getActivePreset(),
  ])
  const payload = { type: 'STATE_UPDATED', memories, skills, presets, activePreset }
  await broadcastToTabs(payload, excludeTabId)
  chrome.runtime.sendMessage(payload).catch(() => {})
}

async function broadcastMcpServersUpdate(excludeTabId) {
  const servers = await globalThis.DSG_MCP.getAllMcpServers()
  await broadcastToTabs({ type: 'MCP_SERVERS_UPDATED', servers }, excludeTabId)
}