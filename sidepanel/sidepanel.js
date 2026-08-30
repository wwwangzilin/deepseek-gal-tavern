/**
 * GAL 酒馆 — 侧栏应用（原生 JS，六页：记忆/Skill/预设/对话/MCP/设置）
 * 数据持久化走 background（chrome.runtime.sendMessage），本页可直接用 core 模块读缓存。
 */
;(function () {
  'use strict'

  const TABS = [
    { key: 'memory', label: '记忆', icon: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' },
    { key: 'skill', label: 'Skill', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { key: 'preset', label: '预设', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { key: 'conversation', label: '对话', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
    { key: 'mcp', label: 'MCP', icon: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z' },
    { key: 'settings', label: '设置', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  ]

  let currentTab = 'memory'

  // ── 工具 ─────────────────────────────────────────────────────────
  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]))
  }

  function send(type, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, (resp) => {
          if (chrome.runtime.lastError) resolve(null)
          else resolve(resp)
        })
      } catch {
        resolve(null)
      }
    })
  }

  function toast(text) {
    const old = document.querySelector('.sp-toast')
    if (old) old.remove()
    const el = document.createElement('div')
    el.className = 'sp-toast'
    el.textContent = text
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 3000)
  }

  const $ = (sel) => document.querySelector(sel)

  // ── 导航渲染 ─────────────────────────────────────────────────────
  function renderNav() {
    const nav = $('#sp-nav')
    nav.innerHTML = TABS.map((t) => `
      <button class="sp-nav-btn ${t.key === currentTab ? 'is-active' : ''}" data-tab="${t.key}">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="${t.icon}" />
        </svg>
        <span>${t.label}</span>
      </button>`).join('')
    nav.querySelectorAll('.sp-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentTab = btn.dataset.tab
        renderNav()
        renderPage()
      })
    })
  }

  async function renderPage() {
    const main = $('#sp-main')
    main.innerHTML = '<div class="sp-empty">加载中…</div>'
    try {
      if (currentTab === 'memory') await renderMemoryPage(main)
      else if (currentTab === 'skill') await renderSkillPage(main)
      else if (currentTab === 'preset') await renderPresetPage(main)
      else if (currentTab === 'conversation') await renderConversationPage(main)
      else if (currentTab === 'mcp') await renderMcpPage(main)
      else if (currentTab === 'settings') await renderSettingsPage(main)
    } catch (err) {
      main.innerHTML = '<div class="sp-empty">加载失败：' + esc(err && err.message ? err.message : err) + '</div>'
    }
  }

  // ── 记忆页 ───────────────────────────────────────────────────────
  async function renderMemoryPage(main) {
    const memories = (await send('GET_MEMORIES')) || []
    main.innerHTML = `
      <div class="sp-btn-row">
        <button class="sp-btn sp-btn-accent" data-act="new">＋ 新建记忆</button>
        <button class="sp-btn" data-act="export">导出 JSON</button>
        <button class="sp-btn" data-act="import">导入 JSON</button>
        <input type="file" accept=".json" data-file="import" style="display:none">
      </div>
      <div class="sp-section-title">记忆列表（${memories.length}）</div>
      <div class="sp-memory-list">
        ${memories.length === 0 ? '<div class="sp-empty">还没有记忆</div>' : memories.map((m) => `
          <div class="sp-card ${m.pinned ? 'is-active' : ''}" data-id="${m.id}">
            <div class="sp-card-title">${esc(m.name)} ${m.pinned ? '📌' : ''}</div>
            <div class="sp-card-desc">${esc(m.content)}</div>
            <div class="sp-card-meta">
              <span class="sp-tag">${esc(m.type)}</span>
              <span class="sp-tag sp-scope-tag">${esc(m.scope)}</span>
              ${(m.tags || []).map((t) => `<span class="sp-tag">${esc(t)}</span>`).join('')}
            </div>
            <div class="sp-btn-row">
              <button class="sp-btn sp-btn-sm" data-act="edit">编辑</button>
              <button class="sp-btn sp-btn-sm" data-act="pin">${m.pinned ? '取消置顶' : '置顶'}</button>
              <button class="sp-btn sp-btn-sm sp-btn-danger" data-act="del">删除</button>
            </div>
          </div>`).join('')}
      </div>
    `
    main.querySelector('[data-act="new"]').addEventListener('click', () => renderMemoryForm(main, null, memories))
    main.querySelector('[data-act="export"]').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(memories, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'gal-memories.json'
      a.click()
      URL.revokeObjectURL(a.href)
      toast('已导出记忆')
    })
    const fileInput = main.querySelector('[data-file="import"]')
    main.querySelector('[data-act="import"]').addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0]
      if (!file) return
      try {
        const parsed = JSON.parse(await file.text())
        if (!Array.isArray(parsed)) throw new Error('格式错误')
        await send('REPLACE_ALL_MEMORIES', parsed)
        toast('已导入 ' + parsed.length + ' 条记忆')
        renderPage()
      } catch (err) {
        toast('导入失败：' + (err && err.message ? err.message : err))
      }
    })
    main.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.closest('[data-id]').dataset.id)
        await send('DELETE_MEMORY', { id })
        toast('已删除记忆')
        renderPage()
      })
    })
    main.querySelectorAll('[data-act="pin"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.closest('[data-id]').dataset.id)
        const mem = memories.find((m) => m.id === id)
        if (mem) {
          await send('UPDATE_MEMORY', { ...mem, pinned: !mem.pinned })
          renderPage()
        }
      })
    })
    main.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.closest('[data-id]').dataset.id)
        renderMemoryForm(main, memories.find((m) => m.id === id), memories)
      })
    })
  }

  function renderMemoryForm(main, mem, all) {
    const m = mem || { type: 'topic', scope: 'contextual', name: '', content: '', tags: [], pinned: false }
    main.innerHTML = `
      <div class="sp-card">
        <div class="sp-card-title">${mem ? '编辑记忆 #' + mem.id : '新建记忆'}</div>
        <label class="sp-label">类型</label>
        <select class="sp-select" data-f="type">
          ${['user', 'feedback', 'topic', 'reference'].map((t) => `<option value="${t}" ${m.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <label class="sp-label">层级</label>
        <select class="sp-select" data-f="scope">
          ${['permanent', 'contextual', 'temporary'].map((t) => `<option value="${t}" ${m.scope === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <label class="sp-label">标题</label>
        <input class="sp-input" data-f="name" value="${esc(m.name)}">
        <label class="sp-label">内容</label>
        <textarea class="sp-textarea" data-f="content">${esc(m.content)}</textarea>
        <label class="sp-label">标签（逗号分隔）</label>
        <input class="sp-input" data-f="tags" value="${esc((m.tags || []).join(', '))}">
        <div class="sp-row"><span>置顶</span><input type="checkbox" class="sp-checkbox" data-f="pinned" ${m.pinned ? 'checked' : ''}></div>
        <div class="sp-btn-row">
          <button class="sp-btn sp-btn-accent" data-act="save">保存</button>
          <button class="sp-btn" data-act="back">返回</button>
        </div>
      </div>
    `
    main.querySelector('[data-act="back"]').addEventListener('click', () => renderPage())
    main.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const data = {}
      for (const el of main.querySelectorAll('[data-f]')) {
        if (el.dataset.f === 'tags') data.tags = el.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        else if (el.dataset.f === 'pinned') data.pinned = el.checked
        else data[el.dataset.f] = el.value.trim()
      }
      if (!data.name) { toast('标题不能为空'); return }
      if (mem) {
        await send('UPDATE_MEMORY', { ...mem, ...data })
        toast('已更新记忆')
      } else {
        await send('SAVE_MEMORY', { ...data, description: data.name, createdAt: Date.now() })
        toast('已保存记忆')
      }
      renderPage()
    })
  }

  // ── Skill 页 ─────────────────────────────────────────────────────
  async function renderSkillPage(main) {
    const skills = (await send('GET_SKILLS')) || []
    main.innerHTML = `
      <div class="sp-btn-row"><button class="sp-btn sp-btn-accent" data-act="new">＋ 新建 Skill</button></div>
      <div class="sp-section-title">技能列表（${skills.length}）</div>
      ${skills.length === 0 ? '<div class="sp-empty">还没有技能</div>' : skills.map((s) => `
        <div class="sp-card" data-name="${esc(s.name)}">
          <div class="sp-card-title">/${esc(s.name)} ${s.source === 'builtin' ? '<span style="font-size:10px;color:var(--sp-text-dim)">内置</span>' : ''}</div>
          <div class="sp-card-desc">${esc(s.description || '')}</div>
          <div class="sp-card-meta">
            <span>记忆联动：${s.memoryEnabled ? '开' : '关'}</span>
            ${s.usage && s.usage.useCount ? '<span>使用 ' + s.usage.useCount + ' 次</span>' : ''}
          </div>
          ${s.source === 'custom' ? `<div class="sp-btn-row"><button class="sp-btn sp-btn-sm" data-act="edit">编辑</button><button class="sp-btn sp-btn-sm sp-btn-danger" data-act="del">删除</button></div>` : ''}
        </div>`).join('')}
      <div class="sp-hint">在聊天输入框输入 <span class="sp-mono">/技能名 参数</span> 即可启用。</div>
    `
    main.querySelector('[data-act="new"]').addEventListener('click', () => renderSkillForm(main, null, skills))
    main.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await send('DELETE_SKILL', { name: btn.closest('[data-name]').dataset.name })
        toast('已删除技能')
        renderPage()
      })
    })
    main.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.closest('[data-name]').dataset.name
        renderSkillForm(main, skills.find((s) => s.name === name), skills)
      })
    })
  }

  function renderSkillForm(main, skill, all) {
    const s = skill || { name: '', description: '', instructions: '', memoryEnabled: false }
    main.innerHTML = `
      <div class="sp-card">
        <div class="sp-card-title">${skill ? '编辑 Skill /' + skill.name : '新建 Skill'}</div>
        <label class="sp-label">名称（kebab-case，用于 /名称 触发）</label>
        <input class="sp-input" data-f="name" value="${esc(s.name)}" ${skill ? 'readonly' : ''}>
        <label class="sp-label">描述</label>
        <input class="sp-input" data-f="description" value="${esc(s.description || '')}">
        <label class="sp-label">指令（instructions）</label>
        <textarea class="sp-textarea" data-f="instructions" style="min-height:120px">${esc(s.instructions || '')}</textarea>
        <div class="sp-row"><span>注入记忆上下文</span><input type="checkbox" class="sp-checkbox" data-f="memoryEnabled" ${s.memoryEnabled ? 'checked' : ''}></div>
        <div class="sp-btn-row">
          <button class="sp-btn sp-btn-accent" data-act="save">保存</button>
          <button class="sp-btn" data-act="back">返回</button>
        </div>
      </div>
    `
    main.querySelector('[data-act="back"]').addEventListener('click', () => renderPage())
    main.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const data = {}
      for (const el of main.querySelectorAll('[data-f]')) {
        if (el.dataset.f === 'memoryEnabled') data.memoryEnabled = el.checked
        else data[el.dataset.f] = el.value.trim()
      }
      if (!data.name) { toast('名称不能为空'); return }
      await send('SAVE_SKILL', { ...s, ...data, source: 'custom' })
      toast('已保存技能')
      renderPage()
    })
  }

  // ── 预设页 ───────────────────────────────────────────────────────
  async function renderPresetPage(main) {
    const presets = (await send('GET_PRESETS')) || []
    const activePreset = await send('GET_ACTIVE_PRESET')
    const activeId = activePreset ? activePreset.id : null
    main.innerHTML = `
      <div class="sp-btn-row"><button class="sp-btn sp-btn-accent" data-act="new">＋ 新建预设</button></div>
      <div class="sp-section-title">系统提示词预设（${presets.length}）</div>
      ${presets.length === 0 ? '<div class="sp-empty">还没有预设</div>' : presets.map((p) => `
        <div class="sp-card ${p.id === activeId ? 'is-active' : ''}" data-id="${p.id}">
          <div class="sp-card-title">${esc(p.name)} ${p.id === activeId ? '<span class="sp-badge sp-badge-ok">已激活</span>' : ''}</div>
          <div class="sp-card-desc">${esc(p.content || '').slice(0, 80)}${(p.content || '').length > 80 ? '…' : ''}</div>
          <div class="sp-card-meta"><span>记忆联动：${p.memoryEnabled ? '开' : '关'}</span></div>
          <div class="sp-btn-row">
            <button class="sp-btn sp-btn-sm" data-act="activate">${p.id === activeId ? '取消激活' : '激活'}</button>
            <button class="sp-btn sp-btn-sm" data-act="edit">编辑</button>
            <button class="sp-btn sp-btn-sm sp-btn-danger" data-act="del">删除</button>
          </div>
        </div>`).join('')}
      <div class="sp-hint">激活的预设内容会作为系统提示词前缀注入每次请求，与角色卡共存。</div>
    `
    main.querySelector('[data-act="new"]').addEventListener('click', () => renderPresetForm(main, null, presets))
    main.querySelectorAll('[data-act="activate"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]').dataset.id
        await send('SET_ACTIVE_PRESET', { id: id === activeId ? null : id })
        toast('已更新激活预设')
        renderPage()
      })
    })
    main.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]').dataset.id
        renderPresetForm(main, presets.find((p) => p.id === id), presets)
      })
    })
    main.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await send('DELETE_PRESET', { id: btn.closest('[data-id]').dataset.id })
        toast('已删除预设')
        renderPage()
      })
    })
  }

  function renderPresetForm(main, preset, all) {
    const p = preset || { name: '', content: '', memoryEnabled: false }
    main.innerHTML = `
      <div class="sp-card">
        <div class="sp-card-title">${preset ? '编辑预设' : '新建预设'}</div>
        <label class="sp-label">名称</label>
        <input class="sp-input" data-f="name" value="${esc(p.name)}">
        <label class="sp-label">内容（系统提示词）</label>
        <textarea class="sp-textarea" data-f="content" style="min-height:160px">${esc(p.content || '')}</textarea>
        <div class="sp-row"><span>注入记忆上下文</span><input type="checkbox" class="sp-checkbox" data-f="memoryEnabled" ${p.memoryEnabled ? 'checked' : ''}></div>
        <div class="sp-btn-row">
          <button class="sp-btn sp-btn-accent" data-act="save">保存</button>
          <button class="sp-btn" data-act="back">返回</button>
        </div>
      </div>
    `
    main.querySelector('[data-act="back"]').addEventListener('click', () => renderPage())
    main.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const data = {}
      for (const el of main.querySelectorAll('[data-f]')) {
        if (el.dataset.f === 'memoryEnabled') data.memoryEnabled = el.checked
        else data[el.dataset.f] = el.value.trim()
      }
      if (!data.name) { toast('名称不能为空'); return }
      const id = preset ? preset.id : ('p-' + Math.random().toString(36).slice(2, 8))
      await send('SAVE_PRESET', { ...p, ...data, id, createdAt: preset ? preset.createdAt : Date.now(), updatedAt: Date.now() })
      toast('已保存预设')
      renderPage()
    })
  }

  // ── 对话管理页 ───────────────────────────────────────────────────
  async function renderConversationPage(main) {
    main.innerHTML = '<div class="sp-empty">加载会话中…</div>'
    let sessions
    try {
      sessions = (await send('LIST_SESSIONS', { forceRefresh: true })) || []
    } catch (err) {
      main.innerHTML = '<div class="sp-empty">无法加载会话：' + esc(err && err.message ? err.message : err) + '</div>'
      return
    }
    main.innerHTML = `
      <div class="sp-btn-row">
        <button class="sp-btn" data-act="refresh">刷新</button>
        <button class="sp-btn" data-act="new">＋ 新对话</button>
      </div>
      <div class="sp-section-title">DeepSeek 会话（${sessions.length}）</div>
      ${sessions.length === 0 ? '<div class="sp-empty">没有会话，请先在 DeepSeek 创建对话</div>' : sessions.map((s) => `
        <div class="sp-card" data-id="${esc(s.id)}">
          <div class="sp-card-title">${esc(s.title || '未命名对话')}</div>
          <div class="sp-card-meta">
            <span>${new Date(s.updatedAt).toLocaleString()}</span>
            ${s.messageCount ? '<span>' + s.messageCount + ' 条消息</span>' : ''}
          </div>
          <div class="sp-btn-row">
            <button class="sp-btn sp-btn-sm" data-act="rename">重命名</button>
            <button class="sp-btn sp-btn-sm sp-btn-danger" data-act="del">删除</button>
          </div>
        </div>`).join('')}
    `
    main.querySelector('[data-act="refresh"]').addEventListener('click', () => renderPage())
    main.querySelector('[data-act="new"]').addEventListener('click', async () => {
      await send('REFRESH_DEEPSEEK_PAGE')
      toast('已刷新 DeepSeek 页面')
    })
    main.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('删除该会话？')) return
        await send('DELETE_SESSION', { id: btn.closest('[data-id]').dataset.id })
        toast('已删除会话')
        renderPage()
      })
    })
    main.querySelectorAll('[data-act="rename"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]').dataset.id
        const title = prompt('新标题：')
        if (!title) return
        await send('RENAME_SESSION', { id, title })
        toast('已重命名')
        renderPage()
      })
    })
  }

  // ── MCP 页 ───────────────────────────────────────────────────────
  async function renderMcpPage(main) {
    const servers = (await send('GET_MCP_SERVERS')) || []
    main.innerHTML = `
      <div class="sp-btn-row"><button class="sp-btn sp-btn-accent" data-act="new">＋ 添加 MCP 服务</button></div>
      <div class="sp-section-title">MCP 服务（${servers.length}）</div>
      ${servers.length === 0 ? '<div class="sp-empty">还没有 MCP 服务。<br>支持 Streamable HTTP / HTTP POST / SSE 传输。</div>' : servers.map((s) => `
        <div class="sp-card" data-id="${esc(s.id)}">
          <div class="sp-card-title">${esc(s.name)} <span class="sp-badge ${s.enabled ? 'sp-badge-ok' : 'sp-badge-err'}">${s.enabled ? '启用' : '停用'}</span></div>
          <div class="sp-card-desc">${esc(s.transport && s.transport.url || '')}</div>
          <div class="sp-card-meta"><span>传输：${esc(s.transport && s.transport.kind || 'unknown')}</span><span>工具：${(s.tools || []).length}</span></div>
          <div class="sp-btn-row">
            <button class="sp-btn sp-btn-sm" data-act="toggle">${s.enabled ? '停用' : '启用'}</button>
            <button class="sp-btn sp-btn-sm" data-act="refresh">刷新工具</button>
            <button class="sp-btn sp-btn-sm sp-btn-danger" data-act="del">删除</button>
          </div>
        </div>`).join('')}
      <div class="sp-hint">MCP 服务需配置本地或远程端点；HTTP 服务需正确返回 CORS 头。stdio bridge 与 Native Messaging 需额外本地程序。</div>
    `
    main.querySelector('[data-act="new"]').addEventListener('click', () => renderMcpForm(main, null, servers))
    main.querySelectorAll('[data-act="toggle"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]').dataset.id
        const s = servers.find((x) => x.id === id)
        if (s) {
          await send('UPDATE_MCP_SERVER', { id, patch: { enabled: !s.enabled } })
          toast('已更新服务状态')
          renderPage()
        }
      })
    })
    main.querySelectorAll('[data-act="refresh"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]').dataset.id
        toast('正在刷新工具…')
        const result = await send('REFRESH_MCP_SERVER_TOOLS', { serverId: id })
        toast(result && result.ok ? '已刷新工具' : '刷新失败')
        renderPage()
      })
    })
    main.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('删除该 MCP 服务？')) return
        await send('DELETE_MCP_SERVER', { id: btn.closest('[data-id]').dataset.id })
        toast('已删除服务')
        renderPage()
      })
    })
  }

  function renderMcpForm(main, server, all) {
    const s = server || { name: '', transport: { kind: 'streamable_http', url: '' }, enabled: true }
    main.innerHTML = `
      <div class="sp-card">
        <div class="sp-card-title">${server ? '编辑 MCP 服务' : '添加 MCP 服务'}</div>
        <label class="sp-label">名称</label>
        <input class="sp-input" data-f="name" value="${esc(s.name)}">
        <label class="sp-label">传输类型</label>
        <select class="sp-select" data-f="kind">
          ${['streamable_http', 'http', 'sse'].map((k) => `<option value="${k}" ${s.transport && s.transport.kind === k ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
        <label class="sp-label">URL</label>
        <input class="sp-input" data-f="url" value="${esc(s.transport && s.transport.url || '')}" placeholder="http://127.0.0.1:3000/mcp">
        <div class="sp-row"><span>启用</span><input type="checkbox" class="sp-checkbox" data-f="enabled" ${s.enabled !== false ? 'checked' : ''}></div>
        <div class="sp-btn-row">
          <button class="sp-btn sp-btn-accent" data-act="save">保存</button>
          <button class="sp-btn" data-act="back">返回</button>
        </div>
      </div>
    `
    main.querySelector('[data-act="back"]').addEventListener('click', () => renderPage())
    main.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const name = main.querySelector('[data-f="name"]').value.trim()
      const kind = main.querySelector('[data-f="kind"]').value
      const url = main.querySelector('[data-f="url"]').value.trim()
      const enabled = main.querySelector('[data-f="enabled"]').checked
      if (!name || !url) { toast('名称与 URL 必填'); return }
      const id = server ? server.id : ('mcp-' + Math.random().toString(36).slice(2, 8))
      await send('CREATE_MCP_SERVER', { id, name, enabled, transport: { kind, url }, timeouts: { connect: 10000, request: 60000, discovery: 20000 }, limits: { maxResultBytes: 65536, maxToolsPerServer: 128 } })
      toast('已保存 MCP 服务')
      renderPage()
    })
  }

  // ── 设置页 ───────────────────────────────────────────────────────
  async function renderSettingsPage(main) {
    const config = (await send('GET_MEMORY_CONFIG')) || {}
    const background = await send('GET_BACKGROUND') || null
    main.innerHTML = `
      <div class="sp-section-title">记忆注入</div>
      <div class="sp-card">
        <div class="sp-row"><span>Token 预算</span><input class="sp-input" style="width:100px" type="number" min="500" max="10000" data-f="tokenBudget" value="${config.tokenBudget || 3000}"></div>
        <div class="sp-hint">控制记忆注入量（500~10000，默认 3000）。</div>
      </div>
      <div class="sp-section-title">背景</div>
      <div class="sp-card">
        <div class="sp-row"><span>启用背景图</span><input type="checkbox" class="sp-checkbox" data-f="bgEnabled" ${background && background.enabled ? 'checked' : ''}></div>
        <label class="sp-label">背景 URL</label>
        <input class="sp-input" data-f="bgUrl" value="${esc(background && background.url || '')}" placeholder="https://.../image.png">
        <div class="sp-row"><span>不透明度</span><input class="sp-input" style="width:80px" type="number" min="0" max="1" step="0.1" data-f="bgOpacity" value="${background ? background.opacity : 0.6}"></div>
        <div class="sp-btn-row">
          <button class="sp-btn sp-btn-accent" data-act="bgSave">保存背景</button>
          <button class="sp-btn" data-act="bgClear">清除背景</button>
        </div>
      </div>
      <div class="sp-section-title">WebDAV 同步</div>
      <div class="sp-card">
        <label class="sp-label">WebDAV URL</label>
        <input class="sp-input" data-f="davUrl" placeholder="https://dav.example.com/dav/gal/">
        <label class="sp-label">用户名</label>
        <input class="sp-input" data-f="davUser">
        <label class="sp-label">密码</label>
        <input class="sp-input" type="password" data-f="davPass">
        <div class="sp-btn-row"><button class="sp-btn sp-btn-accent" data-act="davSave">保存同步配置</button></div>
        <div class="sp-hint">同步记忆 / 自定义 Skill / 预设（JSON 文件）。</div>
      </div>
      <div class="sp-section-title">关于</div>
      <div class="sp-card">
        <div class="sp-card-desc">DeepSeek GAL 酒馆 v2.0 — 完整移植 DeepSeek++ 功能：记忆系统 / Skill / 预设 / 对话管理 / MCP / 工具调用。</div>
      </div>
    `
    main.querySelector('[data-act="bgSave"]').addEventListener('click', async () => {
      const cfg = {
        enabled: main.querySelector('[data-f="bgEnabled"]').checked,
        type: 'url',
        url: main.querySelector('[data-f="bgUrl"]').value.trim(),
        opacity: Number(main.querySelector('[data-f="bgOpacity"]').value) || 0.6,
      }
      await send('SAVE_BACKGROUND', cfg)
      toast('已保存背景设置')
    })
    main.querySelector('[data-act="bgClear"]').addEventListener('click', async () => {
      await send('CLEAR_BACKGROUND')
      toast('已清除背景')
      renderPage()
    })
    main.querySelector('[data-act="davSave"]').addEventListener('click', async () => {
      const cfg = {
        url: main.querySelector('[data-f="davUrl"]').value.trim(),
        username: main.querySelector('[data-f="davUser"]').value.trim(),
        password: main.querySelector('[data-f="davPass"]').value,
        remotePath: 'gal-tavern',
        lastSyncAt: null,
      }
      if (!cfg.url) { toast('URL 必填'); return }
      await send('SAVE_SYNC_CONFIG', cfg)
      toast('已保存同步配置')
    })
    // Token 预算实时保存
    main.querySelector('[data-f="tokenBudget"]').addEventListener('change', async () => {
      const value = Number(main.querySelector('[data-f="tokenBudget"]').value)
      await send('SET_MEMORY_CONFIG', { ...config, tokenBudget: Math.max(500, Math.min(10000, value)) })
      toast('已更新 Token 预算')
    })
  }

  // ── 启动 ─────────────────────────────────────────────────────────
  function init() {
    renderNav()
    renderPage()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
