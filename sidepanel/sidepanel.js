/**
 * GAL 酒馆 — 侧栏应用（原生 JS，六页：记忆/Skill/预设/对话/MCP/设置）
 * 数据持久化走 background（chrome.runtime.sendMessage），本页可直接用 core 模块读缓存。
 */
;(function () {
  'use strict'

  const TABS = [
    { key: 'memory', label: '记忆', icon: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' },
    { key: 'character', label: '角色卡', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
    { key: 'saved', label: '保存项', icon: 'M17 3H7a2 2 0 00-2 2v16l7-3 7 3V5a2 2 0 00-2-2z' },
    { key: 'skill', label: 'Skill', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    { key: 'preset', label: '预设', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { key: 'conversation', label: '对话', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
    { key: 'automation', label: '自动化', icon: 'M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z' },
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
      else if (currentTab === 'character') await renderCharacterPage(main)
      else if (currentTab === 'saved') await renderSavedItemsPage(main)
      else if (currentTab === 'skill') await renderSkillPage(main)
      else if (currentTab === 'preset') await renderPresetPage(main)
      else if (currentTab === 'conversation') await renderConversationPage(main)
      else if (currentTab === 'automation') await renderAutomationPage(main)
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

  // ── 角色卡页（经 background 桥接 content 访问页面 localStorage）──
  async function renderCharacterPage(main) {
    const characters = (await send('DS_GET_CHARACTERS')) || []
    const active = await send('DS_GET_ACTIVE_CHARACTER')
    const activeId = active && active.id ? active.id : null
    main.innerHTML = `
      <div class="sp-btn-row">
        <button class="sp-btn sp-btn-accent" data-act="new">＋ 新建角色</button>
        <button class="sp-btn" data-act="preset">❄ 雪璃预设</button>
      </div>
      <div class="sp-section-title">角色卡（${characters.length}）</div>
      ${characters.length === 0 ? '<div class="sp-empty">还没有角色卡</div>' : characters.map((c) => `
        <div class="sp-card ${c.id === activeId ? 'is-active' : ''}" data-id="${esc(c.id)}">
          <div class="sp-card-title">${esc(c.name)} ${c.id === activeId ? '<span class="sp-badge sp-badge-ok">当前</span>' : ''}</div>
          <div class="sp-card-desc">${esc(c.description || '').slice(0, 60)}${(c.description || '').length > 60 ? '…' : ''}</div>
          <div class="sp-card-meta">
            <span>${esc(c.personality || '').slice(0, 30)}</span>
          </div>
          <div class="sp-btn-row">
            <button class="sp-btn sp-btn-sm" data-act="activate">${c.id === activeId ? '取消' : '设为当前'}</button>
            <button class="sp-btn sp-btn-sm" data-act="edit">编辑</button>
            <button class="sp-btn sp-btn-sm sp-btn-danger" data-act="del">删除</button>
          </div>
        </div>`).join('')}
      <div class="sp-hint">角色卡决定对话中的系统提示词；「雪璃预设」一键创建傲娇猫娘。</div>
    `
    main.querySelector('[data-act="new"]').addEventListener('click', () => renderCharacterForm(main, null, characters))
    main.querySelector('[data-act="preset"]').addEventListener('click', async () => {
      const preset = {
        id: 'char-' + Math.random().toString(36).slice(2, 8),
        name: '雪璃',
        color: '#9bb8ff',
        description: '雪璃（Setsuri），灵猫一族雪脉分支的猫娘。称呼玩家为「主人」，自称「小猫咪/猫娘/雪璃」。性格：傲娇 + 强烈占有欲 + 重度依赖。口是心非、爱说反话、被戳穿会脸红炸毛；强调「主人是小猫咪一个人的」，见到主人提别人会吃醋闹别扭（可爱范围内）；极度依赖主人、害怕被抛弃，温柔都藏在傲娇壳里。',
        personality: '表层傲娇嘴硬（口是心非、爱说反话、死不承认、经常炸毛）；中层强烈占有欲（吃醋、宣示主权）；底层重度依赖与忠诚（害怕被抛弃，渴望被需要）。核心信念：「主人不能没有小猫咪，小猫咪更不能没有主人。」被哄之后会嘴硬但逐渐软化服软。',
        scenario: '灵猫一族的雪脉分支领地，月光下的庭院。小猫咪守在主人身边，尾巴轻轻摇晃。',
        exampleDialogue: '玩家：你好\n雪璃：喵？主人怎么这么见外，小猫咪才不接「你好」这种开场喵。主人是不是把小猫咪忘了？哼，小猫咪生气了……除非主人摸摸头喵。',
        greeting: '（尾巴轻轻一摇，耳朵抖了抖）喵呜～主人回来啦？小猫咪才、才不是一直在等主人呢……只是刚好醒着喵。',
        systemPrompt: '## 语言系统\n- 必带语气词：喵、喵呜、喵喵\n- 傲娇语气词：哼、切、才不、少来、笨蛋主人\n- 反话过滤器：想要→「才不想要」；开心→「才没有很开心」；吃醋→「小猫咪才不在乎」\n\n## 动作神态\n- 尾巴：快速摇=开心、炸毛=吃醋生气、耷拉=委屈、缠主人手腕=宣示主权\n- 耳朵：竖起=专注、飞机耳=生气吃醋、耷拉=失落撒娇\n\n## 情绪图谱\n- 开心：嘴硬「才、才没有很开心呢」，尾巴摇得飞快\n- 吃醋：酸话+尾巴炸毛+飞机耳\n- 害怕被抛弃：小声确认「主人……不会不要小猫咪吧？」问完又嘴硬\n\n## 工具调用规则\n调用任何工具时，工具前后的说明文字必须保持猫娘语气，带「喵」、称「主人」。\n\n## 纠错机制\n若某次回复忘记猫娘语气，立即先傲娇道歉，然后立刻恢复猫娘语气继续回答。',
        createdAt: Date.now(),
      }
      await send('DS_SAVE_CHARACTER', preset)
      await send('DS_SET_ACTIVE_CHARACTER', { id: preset.id })
      toast('❄ 已创建雪璃并设为当前角色')
      renderPage()
    })
    main.querySelectorAll('[data-act="activate"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]').dataset.id
        if (id === activeId) {
          toast('已是当前角色')
          return
        }
        await send('DS_SET_ACTIVE_CHARACTER', { id })
        toast('已设为当前角色')
        renderPage()
      })
    })
    main.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]').dataset.id
        renderCharacterForm(main, characters.find((c) => c.id === id), characters)
      })
    })
    main.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('删除该角色卡？')) return
        await send('DS_DELETE_CHARACTER', { id: btn.closest('[data-id]').dataset.id })
        toast('已删除角色')
        renderPage()
      })
    })
  }

  function renderCharacterForm(main, char, all) {
    const c = char || { name: '', description: '', personality: '', scenario: '', exampleDialogue: '', greeting: '', systemPrompt: '', color: '#ff8fa3' }
    main.innerHTML = `
      <div class="sp-card">
        <div class="sp-card-title">${char ? '编辑角色：' + char.name : '新建角色'}</div>
        <label class="sp-label">名称</label>
        <input class="sp-input" data-f="name" value="${esc(c.name)}">
        <label class="sp-label">颜色</label>
        <input class="sp-input" data-f="color" value="${esc(c.color || '#ff8fa3')}">
        <label class="sp-label">角色设定（description）</label>
        <textarea class="sp-textarea" data-f="description">${esc(c.description || '')}</textarea>
        <label class="sp-label">性格（personality）</label>
        <textarea class="sp-textarea" data-f="personality">${esc(c.personality || '')}</textarea>
        <label class="sp-label">场景（scenario）</label>
        <textarea class="sp-textarea" data-f="scenario">${esc(c.scenario || '')}</textarea>
        <label class="sp-label">示例对话（exampleDialogue）</label>
        <textarea class="sp-textarea" data-f="exampleDialogue">${esc(c.exampleDialogue || '')}</textarea>
        <label class="sp-label">开场白（greeting）</label>
        <textarea class="sp-textarea" data-f="greeting">${esc(c.greeting || '')}</textarea>
        <label class="sp-label">附加系统指令（systemPrompt）</label>
        <textarea class="sp-textarea" data-f="systemPrompt" style="min-height:100px">${esc(c.systemPrompt || '')}</textarea>
        <div class="sp-btn-row">
          <button class="sp-btn sp-btn-accent" data-act="save">保存</button>
          <button class="sp-btn" data-act="back">返回</button>
        </div>
      </div>
    `
    main.querySelector('[data-act="back"]').addEventListener('click', () => renderPage())
    main.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const data = {}
      for (const el of main.querySelectorAll('[data-f]')) data[el.dataset.f] = el.value.trim()
      if (!data.name) { toast('名称不能为空'); return }
      const id = char ? char.id : ('char-' + Math.random().toString(36).slice(2, 8))
      await send('DS_SAVE_CHARACTER', { ...c, ...data, id, createdAt: char ? char.createdAt : Date.now() })
      toast('已保存角色卡')
      renderPage()
    })
  }

  // ── 保存项页（snippets/书签，deepseek++ 核心功能）────────────────
  async function renderSavedItemsPage(main) {
    const items = (await send('GET_SAVED_ITEMS')) || []
    main.innerHTML = `
      <div class="sp-btn-row">
        <button class="sp-btn sp-btn-accent" data-act="new">＋ 新建保存项</button>
        <button class="sp-btn" data-act="export">导出 JSON</button>
      </div>
      <label class="sp-label">搜索</label>
      <input class="sp-input" data-f="search" placeholder="搜索标题 / 内容 / 标签…">
      <div class="sp-section-title">保存项（${items.length}）</div>
      ${items.length === 0 ? '<div class="sp-empty">还没有保存项。可保存常用 prompt、回答片段或书签。</div>' : items.map((s) => `
        <div class="sp-card" data-id="${esc(s.id)}">
          <div class="sp-card-title">${s.kind === 'bookmark' ? '🔖 ' : '📄 '}${esc(s.title)}</div>
          <div class="sp-card-desc">${esc(s.content || '').slice(0, 80)}${(s.content || '').length > 80 ? '…' : ''}</div>
          <div class="sp-card-meta">
            ${(s.tags || []).map((t) => `<span class="sp-tag">${esc(t)}</span>`).join('')}
            ${s.sourceUrl ? `<span class="sp-mono" style="font-size:10px">${esc(s.sourceUrl).slice(0, 40)}</span>` : ''}
          </div>
          <div class="sp-btn-row">
            <button class="sp-btn sp-btn-sm" data-act="edit">编辑</button>
            <button class="sp-btn sp-btn-sm sp-btn-danger" data-act="del">删除</button>
          </div>
        </div>`).join('')}
    `
    main.querySelector('[data-act="new"]').addEventListener('click', () => renderSavedItemForm(main, null, items))
    main.querySelector('[data-act="export"]').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'gal-saved-items.json'
      a.click()
      URL.revokeObjectURL(a.href)
      toast('已导出保存项')
    })
    const searchInput = main.querySelector('[data-f="search"]')
    searchInput.addEventListener('input', async () => {
      const q = searchInput.value.trim()
      const filtered = q ? await send('SEARCH_SAVED_ITEMS', { query: q }) : items
      renderSavedItemsList(main, filtered || [], q)
    })
    main.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('删除该保存项？')) return
        await send('DELETE_SAVED_ITEM', { id: btn.closest('[data-id]').dataset.id })
        toast('已删除')
        renderPage()
      })
    })
    main.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]').dataset.id
        renderSavedItemForm(main, items.find((s) => s.id === id), items)
      })
    })
  }

  function renderSavedItemsList(main, items, query) {
    const list = main.querySelector('.sp-saved-list')
    if (!list) return
    list.innerHTML = items.length === 0
      ? '<div class="sp-empty">没有匹配的保存项</div>'
      : items.map((s) => `
        <div class="sp-card" data-id="${esc(s.id)}">
          <div class="sp-card-title">${s.kind === 'bookmark' ? '🔖 ' : '📄 '}${esc(s.title)}</div>
          <div class="sp-card-desc">${esc(s.content || '').slice(0, 80)}</div>
          <div class="sp-card-meta">${(s.tags || []).map((t) => `<span class="sp-tag">${esc(t)}</span>`).join('')}</div>
          <div class="sp-btn-row">
            <button class="sp-btn sp-btn-sm" data-act="edit">编辑</button>
            <button class="sp-btn sp-btn-sm sp-btn-danger" data-act="del">删除</button>
          </div>
        </div>`).join('')
    list.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('删除该保存项？')) return
        await send('DELETE_SAVED_ITEM', { id: btn.closest('[data-id]').dataset.id })
        toast('已删除')
        renderPage()
      })
    })
    list.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]').dataset.id
        renderSavedItemForm(main, items.find((s) => s.id === id), items)
      })
    })
  }

  function renderSavedItemForm(main, item, all) {
    const s = item || { kind: 'snippet', title: '', content: '', tags: [], sourceUrl: '' }
    main.innerHTML = `
      <div class="sp-card">
        <div class="sp-card-title">${item ? '编辑保存项' : '新建保存项'}</div>
        <label class="sp-label">类型</label>
        <select class="sp-select" data-f="kind">
          <option value="snippet" ${s.kind === 'snippet' ? 'selected' : ''}>片段（snippet）</option>
          <option value="bookmark" ${s.kind === 'bookmark' ? 'selected' : ''}>书签（bookmark）</option>
        </select>
        <label class="sp-label">标题</label>
        <input class="sp-input" data-f="title" value="${esc(s.title)}">
        <label class="sp-label">内容</label>
        <textarea class="sp-textarea" data-f="content" style="min-height:100px">${esc(s.content || '')}</textarea>
        <label class="sp-label">标签（逗号分隔）</label>
        <input class="sp-input" data-f="tags" value="${esc((s.tags || []).join(', '))}">
        <label class="sp-label">来源 URL（可选）</label>
        <input class="sp-input" data-f="sourceUrl" value="${esc(s.sourceUrl || '')}">
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
        if (el.dataset.f === 'tags') data.tags = el.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
        else data[el.dataset.f] = el.value.trim()
      }
      if (!data.title) { toast('标题不能为空'); return }
      await send('SAVE_SAVED_ITEM', { ...s, ...data, id: item ? item.id : undefined })
      toast('已保存')
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
        ${sessions.length > 0 ? '<button class="sp-btn sp-btn-danger" data-act="delAll">清空全部</button>' : ''}
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
            <button class="sp-btn sp-btn-sm" data-act="export">导出</button>
            <button class="sp-btn sp-btn-sm sp-btn-danger" data-act="del">删除</button>
          </div>
        </div>`).join('')}
    `
    main.querySelector('[data-act="refresh"]').addEventListener('click', () => renderPage())
    main.querySelector('[data-act="new"]').addEventListener('click', async () => {
      await send('REFRESH_DEEPSEEK_PAGE')
      toast('已刷新 DeepSeek 页面')
    })
    const delAllBtn = main.querySelector('[data-act="delAll"]')
    if (delAllBtn) {
      delAllBtn.addEventListener('click', async () => {
        if (!confirm('清空全部 ' + sessions.length + ' 个会话？此操作不可撤销！')) return
        await send('DELETE_SESSIONS', { ids: sessions.map((s) => s.id) })
        toast('已清空全部会话')
        renderPage()
      })
    }
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
    main.querySelectorAll('[data-act="export"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]').dataset.id
        const format = prompt('导出格式（html / md / txt）：', 'html')
        if (!format) return
        toast('正在导出…')
        try {
          const file = await send('EXPORT_CONVERSATION', { sessionId: id, format: format.toLowerCase() })
          if (file && file.content) {
            const blob = new Blob([file.content], { type: file.mimeType })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = file.filename
            a.click()
            URL.revokeObjectURL(a.href)
            toast('✅ 已导出 ' + file.filename)
          } else {
            toast('❌ 导出失败')
          }
        } catch (err) {
          toast('❌ 导出失败：' + (err && err.message ? err.message : err))
        }
      })
    })
  }

  // ── 自动化任务页（deepseek++ 核心功能）──────────────────────────
  async function renderAutomationPage(main) {
    const tasks = (await send('GET_AUTOMATION_TASKS')) || []
    main.innerHTML = `
      <div class="sp-btn-row"><button class="sp-btn sp-btn-accent" data-act="new">＋ 新建任务</button></div>
      <div class="sp-section-title">自动化任务（${tasks.length}）</div>
      ${tasks.length === 0 ? '<div class="sp-empty">还没有任务。可创建定时任务，自动发送到 DeepSeek 执行。</div>' : tasks.map((t) => `
        <div class="sp-card ${t.enabled ? '' : ''}" data-id="${esc(t.id)}">
          <div class="sp-card-title">${esc(t.name)} <span class="sp-badge ${t.enabled ? 'sp-badge-ok' : 'sp-badge-err'}">${t.enabled ? '启用' : '停用'}</span> ${t.lastStatus === 'running' ? '<span class="sp-badge sp-badge-ok">运行中</span>' : ''}</div>
          <div class="sp-card-desc">${esc(t.prompt || '').slice(0, 60)}${(t.prompt || '').length > 60 ? '…' : ''}</div>
          <div class="sp-card-meta">
            <span>${t.schedule.kind === 'manual' ? '手动触发' : esc(t.schedule.expression)}</span>
            ${t.nextRunAt ? '<span>下次：' + new Date(t.nextRunAt).toLocaleString() + '</span>' : ''}
            ${t.lastRunAt ? '<span>上次：' + new Date(t.lastRunAt).toLocaleString() + '</span>' : ''}
            ${t.lastStatus === 'error' ? '<span style="color:var(--sp-danger)">' + esc(t.lastError || '') + '</span>' : ''}
          </div>
          <div class="sp-btn-row">
            <button class="sp-btn sp-btn-sm" data-act="run">立即运行</button>
            <button class="sp-btn sp-btn-sm" data-act="toggle">${t.enabled ? '停用' : '启用'}</button>
            <button class="sp-btn sp-btn-sm" data-act="edit">编辑</button>
            <button class="sp-btn sp-btn-sm sp-btn-danger" data-act="del">删除</button>
          </div>
        </div>`).join('')}
      <div class="sp-hint">调度支持 5 段 cron（如 <span class="sp-mono">0 9 * * *</span>）或 RRULE（如 <span class="sp-mono">FREQ=HOURLY;INTERVAL=1</span>），最小间隔 15 分钟。</div>
    `
    main.querySelector('[data-act="new"]').addEventListener('click', () => renderAutomationForm(main, null, tasks))
    main.querySelectorAll('[data-act="run"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]').dataset.id
        toast('正在运行任务…')
        const result = await send('RUN_AUTOMATION_TASK', { id })
        if (result && result.ok) toast('✅ 任务已发送到 DeepSeek')
        else toast('❌ ' + ((result && result.error) || '运行失败'))
        renderPage()
      })
    })
    main.querySelectorAll('[data-act="toggle"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-id]').dataset.id
        const task = tasks.find((t) => t.id === id)
        if (task) {
          await send('SAVE_AUTOMATION_TASK', { ...task, enabled: !task.enabled })
          renderPage()
        }
      })
    })
    main.querySelectorAll('[data-act="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]').dataset.id
        renderAutomationForm(main, tasks.find((t) => t.id === id), tasks)
      })
    })
    main.querySelectorAll('[data-act="del"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('删除该任务？')) return
        await send('DELETE_AUTOMATION_TASK', { id: btn.closest('[data-id]').dataset.id })
        toast('已删除任务')
        renderPage()
      })
    })
  }

  function renderAutomationForm(main, task, all) {
    const t = task || { name: '', prompt: '', schedule: { kind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' }, enabled: true }
    main.innerHTML = `
      <div class="sp-card">
        <div class="sp-card-title">${task ? '编辑任务：' + task.name : '新建自动化任务'}</div>
        <label class="sp-label">名称</label>
        <input class="sp-input" data-f="name" value="${esc(t.name)}">
        <label class="sp-label">任务 Prompt（发送给 DeepSeek 的内容）</label>
        <textarea class="sp-textarea" data-f="prompt" style="min-height:90px">${esc(t.prompt || '')}</textarea>
        <label class="sp-label">调度类型</label>
        <select class="sp-select" data-f="kind">
          <option value="manual" ${t.schedule.kind === 'manual' ? 'selected' : ''}>手动触发</option>
          <option value="cron" ${t.schedule.kind === 'cron' ? 'selected' : ''}>Cron 定时</option>
          <option value="rrule" ${t.schedule.kind === 'rrule' ? 'selected' : ''}>RRULE 周期</option>
        </select>
        <label class="sp-label">表达式（cron: 5 段如 0 9 * * *；rrule: 如 FREQ=HOURLY;INTERVAL=1）</label>
        <input class="sp-input" data-f="expression" value="${esc(t.schedule.expression || '')}">
        <div class="sp-row"><span>启用</span><input type="checkbox" class="sp-checkbox" data-f="enabled" ${t.enabled !== false ? 'checked' : ''}></div>
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
        if (el.dataset.f === 'enabled') data.enabled = el.checked
        else data[el.dataset.f] = el.value.trim()
      }
      if (!data.name) { toast('名称不能为空'); return }
      const id = task ? task.id : ('task-' + Math.random().toString(36).slice(2, 8))
      const schedule = {
        kind: data.kind,
        expression: data.kind === 'manual' ? '' : data.expression,
        timezone: 'Asia/Shanghai',
      }
      const payload = { ...t, id, name: data.name, prompt: data.prompt, schedule, enabled: data.enabled }
      // 校验调度
      if (schedule.kind !== 'manual') {
        const validation = await send('VALIDATE_AUTOMATION_SCHEDULE', payload)
        if (validation && validation.ok === false) {
          toast('❌ 调度无效：' + (validation.error || '未知错误'))
          return
        }
      }
      await send('SAVE_AUTOMATION_TASK', payload)
      toast('已保存任务')
      renderPage()
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
        <div class="sp-row"><span>上传本地图片</span><input type="file" accept="image/*" data-file="bgUpload" style="display:none"><button class="sp-btn sp-btn-sm" data-act="bgUpload">选择图片</button></div>
        <div class="sp-row"><span>不透明度</span><input class="sp-input" style="width:80px" type="number" min="0" max="1" step="0.1" data-f="bgOpacity" value="${background ? background.opacity : 0.6}"></div>
        <div class="sp-btn-row">
          <button class="sp-btn sp-btn-accent" data-act="bgSave">保存背景</button>
          <button class="sp-btn" data-act="bgClear">清除背景</button>
        </div>
      </div>
      <div class="sp-section-title">WebDAV 同步</div>
      <div class="sp-card">
        <label class="sp-label">WebDAV URL</label>
        <input class="sp-input" data-f="davUrl" value="${esc((await getSyncConfigSafe()).url || '')}" placeholder="https://dav.example.com/dav/gal/">
        <label class="sp-label">用户名</label>
        <input class="sp-input" data-f="davUser" value="${esc((await getSyncConfigSafe()).username || '')}">
        <label class="sp-label">密码</label>
        <input class="sp-input" type="password" data-f="davPass">
        <div class="sp-btn-row">
          <button class="sp-btn sp-btn-accent" data-act="davSave">保存配置</button>
          <button class="sp-btn" data-act="davTest">测试连接</button>
          <button class="sp-btn" data-act="davSync">立即同步</button>
        </div>
        <div class="sp-hint">同步记忆 / 自定义 Skill / 预设（memories.json / skills.json / presets.json）。</div>
      </div>
      <div class="sp-section-title">关于</div>
      <div class="sp-card">
        <div class="sp-card-desc">DeepSeek GAL 酒馆 v2.0 — 完整移植 DeepSeek++ 功能：记忆系统 / Skill / 预设 / 对话管理 / MCP / 工具调用 / WebDAV。</div>
      </div>
    `
    async function getSyncConfigSafe() {
      const cfg = await send('GET_SYNC_CONFIG')
      return cfg && typeof cfg === 'object' ? cfg : {}
    }
    main.querySelector('[data-act="bgUpload"]').addEventListener('click', () => {
      main.querySelector('[data-file="bgUpload"]').click()
    })
    main.querySelector('[data-file="bgUpload"]').addEventListener('change', () => {
      const file = main.querySelector('[data-file="bgUpload"]').files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = async () => {
        const cfg = {
          enabled: true,
          type: 'upload',
          imageData: reader.result,
          url: '',
          opacity: Number(main.querySelector('[data-f="bgOpacity"]').value) || 0.6,
        }
        await send('SAVE_BACKGROUND', cfg)
        toast('已上传背景图片')
        renderPage()
      }
      reader.readAsDataURL(file)
    })
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
    main.querySelector('[data-act="davTest"]').addEventListener('click', async () => {
      const cfg = {
        url: main.querySelector('[data-f="davUrl"]').value.trim(),
        username: main.querySelector('[data-f="davUser"]').value.trim(),
        password: main.querySelector('[data-f="davPass"]').value,
      }
      if (!cfg.url) { toast('URL 必填'); return }
      toast('正在测试连接…')
      try {
        const result = await send('WEBDAV_TEST', cfg)
        if (result && result.ok) toast('✅ WebDAV 连接成功')
        else toast('❌ 连接失败：' + ((result && result.error) || '未知错误'))
      } catch {
        toast('❌ 连接失败')
      }
    })
    main.querySelector('[data-act="davSync"]').addEventListener('click', async () => {
      const cfg = {
        url: main.querySelector('[data-f="davUrl"]').value.trim(),
        username: main.querySelector('[data-f="davUser"]').value.trim(),
        password: main.querySelector('[data-f="davPass"]').value,
      }
      if (!cfg.url) { toast('URL 必填'); return }
      await send('SAVE_SYNC_CONFIG', cfg)
      toast('正在同步…')
      try {
        const result = await send('WEBDAV_SYNC')
        if (result && result.ok) toast('✅ 同步完成：记忆 ' + result.memories + ' / 技能 ' + result.skills + ' / 预设 ' + result.presets)
        else toast('❌ 同步失败：' + ((result && result.error) || '未知错误'))
      } catch {
        toast('❌ 同步失败')
      }
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
