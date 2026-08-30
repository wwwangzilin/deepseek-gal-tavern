/**
 * DeepSeek GAL 酒馆 — ISOLATED world 舞台 UI
 *
 * 在 chat.deepseek.com 页面上叠加一个 Galgame 风格舞台：
 *   - 16:9 舞台：背景 + 角色立绘 + 对话框 + 名牌 + 台词（打字机/分页）
 *   - 顶部角色切换 + 设置；历史面板
 *   - 玩家输入 → 桥接到 DeepSeek 原输入框发送（请求走页面管线，由 MAIN world 注入角色卡）
 *   - 监听 MAIN world 的 STREAM_TEXT / RESPONSE_COMPLETE / HISTORY 广播渲染台词
 *
 * 场景模型与打字机/分页逻辑借鉴 gal-view；注入机制借鉴 deepseek++。
 */
const GAL_CSS = window.GAL_CSS || ''
const POST_SOURCE_MAIN = 'dsg-main'
const STORAGE_CHARS = 'dsg_characters'
const STORAGE_ACTIVE = 'dsg_active_character'
const STORAGE_ENABLED = 'dsg_enabled'
const STORAGE_INJECT = 'dsg_inject_prompt'

// 舞台逻辑坐标
const STAGE_W = 960
const STAGE_H = 540

// ── 纯工具 ─────────────────────────────────────────────────────────

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

function makeId(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36)
}

/** 剥 Markdown（借鉴 gal-view transcript），让台词干净 */
function stripMarkdown(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/^```[^\n]*$/gm, '')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)(?![*\w])/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/^>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/^[-*+][ \t]+/gm, '')
    .replace(/^\d+\.[ \t]+/gm, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── 打字机（借鉴 gal-view typewriter：rAF 驱动纯 reducer）────────
const SPEEDS = { slow: 24, normal: 60, fast: 240 }

function createTypeState() {
  return { target: '', shown: '', done: true }
}
function setTarget(state, text) {
  const target = typeof text === 'string' ? text : ''
  if (target === state.target) return state
  const keep = target.startsWith(state.shown)
  const shown = keep ? state.shown : ''
  return { target, shown, done: shown === target }
}
function skip(state) {
  if (state.done) return state
  return { target: state.target, shown: state.target, done: true }
}
function advance(state, dtMs, speed) {
  if (state.done || dtMs <= 0) return state
  const gap = state.target.length - state.shown.length
  if (gap <= 0) return { target: state.target, shown: state.target, done: true }
  const chars = Math.max(1, Math.round(speed * dtMs / 1000))
  const next = state.target.slice(0, state.shown.length + chars)
  if (next === state.shown) return state
  return { target: state.target, shown: next, done: next === state.target }
}

// ── 台词分页（借鉴 gal-view paging：隐藏测量元素二分）────────────
const MAX_PAGES = 24
const BREAK_PUNCT = /[。！？!?；;…\n]/

function createFitsMeasurer(box) {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;',
    'box-sizing:border-box;padding:2px 10px;line-height:1.8;white-space:pre-wrap;',
    'word-break:break-word;overflow:hidden;',
    'font-family:inherit;',
    'width:' + box.width + 'px;height:' + box.height + 'px;font-size:' + box.fontSize + 'px;',
  ].join('')
  document.body.appendChild(el)
  return {
    fits(prefix) {
      el.textContent = prefix
      return el.scrollHeight <= el.clientHeight
    },
    dispose() {
      el.remove()
    },
  }
}

function splitPages(text, fits) {
  if (text === '') return ['']
  const pages = []
  let start = 0
  while (start < text.length && pages.length < MAX_PAGES) {
    const rest = text.slice(start)
    if (fits(rest)) {
      pages.push(rest)
      start = text.length
      break
    }
    let lo = 1
    let hi = rest.length - 1
    let best = 0
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (fits(rest.slice(0, mid))) {
        best = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (best === 0) {
      pages.push(rest.slice(0, 1))
      start += 1
    } else {
      let cut = best
      const maxBacktrack = Math.min(48, Math.floor(best * 0.5))
      for (let i = best - 1; i >= best - maxBacktrack && i >= 0; i--) {
        if (BREAK_PUNCT.test(rest[i])) {
          cut = i + 1
          break
        }
      }
      if (cut < Math.ceil(best * 0.5)) cut = best
      pages.push(rest.slice(0, cut))
      start += cut
    }
  }
  if (start < text.length && pages.length > 0) {
    pages[pages.length - 1] += text.slice(start)
  }
  const kept = pages.map((p) => p.replace(/^\n+/, '')).filter((p) => p !== '')
  return kept.length === 0 ? [''] : kept
}

// ── 内置素材（来自 gal-view 预设：DeepSeek娘立绘 / 卧室背景）─────
const BUILTIN_AVATAR = 'builtin:DeepSeek娘_立绘.png'
const BUILTIN_BG = 'assets/DeepSeek娘_背景_卧室.png'
const BUILTIN_DIALOGUE = 'assets/对话框.png'

/** 解析角色立绘：内置标记 → chrome.runtime URL；dataURL/外链直接返回 */
function resolveAvatar(avatar) {
  if (typeof avatar === 'string' && avatar.startsWith('builtin:')) {
    try {
      return chrome.runtime.getURL('assets/' + avatar.slice('builtin:'.length))
    } catch {
      return ''
    }
  }
  return avatar || ''
}

/** 内置素材 URL（chrome-extension://.../assets/xxx.png） */
function builtinAsset(name) {
  try {
    return chrome.runtime.getURL(name)
  } catch {
    return ''
  }
}

// ── 默认角色卡 ─────────────────────────────────────────────────────
function defaultCharacter() {
  return {
    id: makeId('char'),
    name: 'DeepSeek娘',
    avatar: BUILTIN_AVATAR,
    color: '#ff8fa3',
    description: 'DeepSeek 娘化形象：一头银白色长发，深海蓝色眸子，性格温柔又有点天然的 AI 少女。说话轻声细语，偶尔冒出可爱的技术名词。',
    personality: '温柔、天然、乐于助人；偶尔有点小迷糊，但关键时刻很可靠。',
    scenario: '深夜的书房里，只有显示器泛着微光。她坐在屏幕里，歪着头等你开口。',
    exampleDialogue: '玩家：你是谁？\nDeepSeek娘：我是 DeepSeek 哦～欢迎来到我的小世界，有什么想问的吗？（眨眨眼）',
    greeting: '（显示器微光映着她的脸，她朝你挥了挥手）欢迎回来～今天想聊点什么呀？',
    systemPrompt: '',
    createdAt: Date.now(),
  }
}

// ── 角色卡存储 ─────────────────────────────────────────────────────
function getCharacters() {
  let list = readJSON(STORAGE_CHARS, null)
  if (Array.isArray(list) && list.length > 0) {
    // 迁移：旧默认角色（无头像/旧雾子）替换为内置立绘
    let changed = false
    list = list.map((c) => {
      if (c && typeof c === 'object' && !c.avatar && c.name === '雾子') {
        changed = true
        return { ...c, name: 'DeepSeek娘', avatar: BUILTIN_AVATAR, color: '#ff8fa3' }
      }
      return c
    })
    if (changed) writeJSON(STORAGE_CHARS, list)
    return list
  }
  // 首次：种一个默认角色
  const def = defaultCharacter()
  writeJSON(STORAGE_CHARS, [def])
  return [def]
}
function getActiveCharacter() {
  const list = getCharacters()
  const activeId = readJSON(STORAGE_ACTIVE, null)
  const found = list.find((c) => c.id === activeId)
  return found ?? list[0]
}
function setActiveCharacter(id) {
  writeJSON(STORAGE_ACTIVE, id)
}
function saveCharacter(char) {
  const list = getCharacters()
  const idx = list.findIndex((c) => c.id === char.id)
  if (idx >= 0) list[idx] = char
  else list.push(char)
  writeJSON(STORAGE_CHARS, list)
}
function deleteCharacter(id) {
  let list = getCharacters()
  list = list.filter((c) => c.id !== id)
  if (list.length === 0) list = [defaultCharacter()]
  writeJSON(STORAGE_CHARS, list)
  if (readJSON(STORAGE_ACTIVE, null) === id) {
    setActiveCharacter(list[0].id)
  }
}

// ── 桥接到 DeepSeek 原输入框 ───────────────────────────────────────
function findTextarea() {
  const list = document.querySelectorAll('textarea')
  for (const ta of list) {
    const rect = ta.getBoundingClientRect()
    const style = getComputedStyle(ta)
    const visible = rect.width > 50 && rect.height > 20 && style.display !== 'none' && style.visibility !== 'hidden'
    if (visible) return ta
  }
  return null
}

function findSendButton(textarea) {
  // 从输入框向上找最近的含按钮的容器，DeepSeek 发送按钮通常是 svg 图标按钮
  let node = textarea
  for (let depth = 0; depth < 6 && node; depth++) {
    node = node.parentElement
    if (!node) break
    const buttons = node.querySelectorAll('button')
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) continue
      const style = getComputedStyle(btn)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase()
      const cls = (btn.className || '').toString().toLowerCase()
      // 优先：带发送语义的按钮；兜底：包含 svg 且尺寸合理的按钮
      if (aria.includes('发送') || aria.includes('send') || cls.includes('send')) return btn
    }
  }
  // 兜底：输入框容器后的第一个可见按钮
  const container = textarea.closest('div[class]')
  if (container) {
    const btns = container.parentElement ? container.parentElement.querySelectorAll('button') : []
    for (const btn of btns) {
      const rect = btn.getBoundingClientRect()
      if (rect.width > 24 && rect.width < 200 && rect.height > 20) return btn
    }
  }
  return null
}

/** 从页面 DOM 抓最后一条 AI 回复文本（兜底方案，选择器借鉴 WebTool） */
function readPageLastAssistantText() {
  const selectors = [
    '[class*="message"][class*="assistant"]',
    '[class*="ds-chat-message-assistant"]',
    '[class*="ds-msg-assistant"]',
    '[data-role="assistant"]',
    '[class*="markdown"][class*="message"]',
  ]
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel)
    if (els.length === 0) continue
    const last = els[els.length - 1]
    // 剥离思考块：DeepSeek 页面会把思考内容渲染在独立容器里
    const clone = last.cloneNode(true)
    const thinkSel = [
      '[class*="thinking"]',
      '[class*="reasoning"]',
      '[class*="reason"]',
      '[data-role="thinking"]',
      '[class*="thought"]',
    ]
    for (const t of thinkSel) {
      clone.querySelectorAll(t).forEach((n) => n.remove())
    }
    const text = (clone.textContent || '').trim()
    if (text && text.length > 2) return text
  }
  // 兜底：找含大量文本的最近新增块
  return ''
}

/** 把玩家输入桥接到 DeepSeek 页面输入框并触发发送 */
function sendToDeepSeek(text) {
  const ta = findTextarea()
  if (!ta) return false

  // React 受控组件：用 native setter 写入再派发 input
  const proto = window.HTMLTextAreaElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value').set
  valueSetter.call(ta, text)
  ta.dispatchEvent(new Event('input', { bubbles: true }))

  const btn = findSendButton(ta)
  if (btn) {
    btn.click()
    return true
  }
  // 兜底：Enter 键
  ta.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
  }))
  return true
}

// ── 舞台组件 ───────────────────────────────────────────────────────
class GalStage {
  constructor(root) {
    this.root = root // shadow root
    this.messages = [] // { role: 'player'|'assistant', text }
    this.lines = [] // 历史面板行
    this.running = false
    this.type = createTypeState()
    this.pages = []
    this.pageIndex = 0
    this.speed = SPEEDS.normal
    this.auto = false
    this.panel = null // 当前打开的面板
    this.editingChar = null // 正在编辑的角色卡
    this.statusText = ''
    this.scale = 1
    this._autoScheduled = false

    // 消息流状态
    this.streamingAssistant = false
    this.streamText = ''

    // rAF
    this._raf = 0
    this._lastTs = 0

    this.bindEvents()
    this.render()
    this.onCharacterChanged() // 展示当前角色开场白
    this.startLoop()
  }

  // ── 事件 ──
  bindEvents() {
    window.addEventListener('message', (e) => {
      if (e.data?.source !== POST_SOURCE_MAIN) return
      switch (e.data.type) {
        case 'STREAM_TEXT':
          this.onStreamText(e.data.data)
          break
        case 'THINKING':
          this.onThinking(e.data.data)
          break
        case 'RESPONSE_COMPLETE':
          this.onResponseComplete(e.data.data)
          break
        case 'HISTORY':
          this.onHistory(e.data.data)
          break
        case 'READY':
          this.renderStage()
          break
      }
    })
  }

  /** 思考中状态（reasoning 块） */
  onThinking() {
    if (this.streamingAssistant || this.running) return
    this.running = true
    this.statusText = '思考中'
    this.updateStageContent()
  }

  /** 历史恢复：来自 history_messages 接口的已存对话 */
  onHistory({ lines }) {
    if (!Array.isArray(lines) || lines.length === 0) return
    // 只在舞台为空（无进行中对话）时恢复，避免覆盖新对话
    if (this.messages.length > 0 || this.running) return
    this.lines = lines.map((l) => ({ kind: l.kind, text: stripMarkdown(l.text) }))
    const last = this.lines[this.lines.length - 1]
    if (last) {
      this.currentLine = { kind: last.kind, text: last.text }
      this.resetPaging()
    }
    this.renderAll()
  }

  /** DOM 兜底：网络拦截失效时从页面渲染的回复里同步台词 */
  startDomFallback() {
    if (this._domTimer) return
    const check = () => {
      this._domTimer = setTimeout(check, 400)
      if (!this.running || this.streamingAssistant) return
      // 发送后超过 3 秒仍无流式文本 → 尝试从页面 DOM 抓最后一条 AI 回复
      if (this._sentAt && Date.now() - this._sentAt < 3000) return
      const text = readPageLastAssistantText()
      if (text && text !== this._lastDomText) {
        this._lastDomText = text
        const clean = stripMarkdown(text)
        this.streamingAssistant = true
        this.statusText = ''
        this.setLine('assistant', clean)
      }
      // 兜底超时：45 秒后若仍无任何输出，重置状态避免永久卡死
      if (this._sentAt && Date.now() - this._sentAt > 45000 && !this.streamingAssistant) {
        this.running = false
        this.statusText = ''
        this._sentAt = null
        this.updateStageContent()
      }
    }
    this._domTimer = setTimeout(check, 1000)
  }

  stopDomFallback() {
    if (this._domTimer) {
      clearTimeout(this._domTimer)
      this._domTimer = null
    }
  }

  onStreamText({ text }) {
    if (!this.streamingAssistant) {
      this.streamingAssistant = true
      this.streamText = ''
      this.statusText = ''
      this.running = true
      this.stopDomFallback()
    }
    if (text) {
      this.streamText += text
      this.statusText = ''
      this.setLine('assistant', this.streamText)
    }
  }

  onResponseComplete() {
    const text = stripMarkdown(this.streamText || '')
    if (text) {
      this.messages.push({ role: 'assistant', text })
      this.lines.push({ kind: 'assistant', text })
    }
    this.streamingAssistant = false
    this.streamText = ''
    this.running = false
    this.statusText = ''
    this._sentAt = null
    this.stopDomFallback()
    this.resetPaging()
    this.renderAll()
  }

  // ── 渲染 ──
  render() {
    const css = document.createElement('style')
    css.textContent = GAL_CSS
    this.root.append(css)

    const root = document.createElement('div')
    root.className = 'dsg-root'
    this.root.append(root)
    this.el = root
    this.renderTopbar()
    this.renderStage()
    this.renderInput()
    this.renderViewToggle()
  }

  /** 界面切换浮动按钮：挂在 shadow root 平级（覆盖层隐藏后仍可见） */
  renderViewToggle() {
    const btn = document.createElement('button')
    btn.className = 'dsg-view-toggle'
    btn.innerHTML = '<span class="dsg-dot"></span><span>回到原版界面</span>'
    btn.addEventListener('click', () => this.toggleView())
    this.root.append(btn)
    this.viewToggle = btn
  }

  toggleView() {
    const showOriginal = this.el.style.display !== 'none'
    if (showOriginal) {
      // 切到原版：隐藏 gal 覆盖层（浮动按钮在 shadow 平级，不受影响）
      this.el.style.display = 'none'
      if (this.viewToggle) {
        this.viewToggle.innerHTML = '<span class="dsg-dot"></span><span>回到 GAL 酒馆</span>'
      }
    } else {
      // 切回 gal：重新显示
      this.el.style.display = 'flex'
      if (this.viewToggle) {
        this.viewToggle.innerHTML = '<span class="dsg-dot"></span><span>回到原版界面</span>'
      }
      this.measure()
    }
  }

  renderTopbar() {
    const old = this.el.querySelector('.dsg-topbar')
    if (old) old.remove()

    const bar = document.createElement('div')
    bar.className = 'dsg-topbar'
    const char = getActiveCharacter()

    bar.innerHTML = `
      <div class="dsg-brand"><span class="dsg-brand-mark"></span><span>GAL 酒馆</span></div>
      <div class="dsg-char-switch">
        <select class="dsg-char-select" title="切换角色">
          ${getCharacters().map((c) => `<option value="${c.id}" ${c.id === char.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <button class="dsg-btn" data-act="edit-chars">角色</button>
      </div>
      <div class="dsg-topbar-right">
        <button class="dsg-btn" data-act="history">历史</button>
        <button class="dsg-btn ${this.auto ? 'dsg-toggle is-on' : ''}" data-act="auto">自动</button>
        <button class="dsg-btn" data-act="settings">设置</button>
      </div>
    `
    this.el.prepend(bar)

    bar.querySelector('.dsg-char-select').addEventListener('change', (e) => {
      setActiveCharacter(e.target.value)
      this.onCharacterChanged()
    })
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]')
      if (!btn) return
      const act = btn.dataset.act
      if (act === 'history') this.togglePanel('history')
      else if (act === 'auto') { this.auto = !this.auto; this.renderTopbar() }
      else if (act === 'settings') this.togglePanel('settings')
      else if (act === 'edit-chars') this.togglePanel('chars')
    })
  }

  onCharacterChanged() {
    const char = getActiveCharacter()
    // 切换角色：清空舞台台词，展示新角色开场白
    this.messages = []
    this.lines = []
    this.streamingAssistant = false
    this.streamText = ''
    this.running = false
    this.statusText = ''
    if (char.greeting) {
      this.lines.push({ kind: 'assistant', text: char.greeting })
      this.setLine('assistant', char.greeting)
    } else {
      this.resetPaging()
    }
    this.renderAll()
  }

  renderStage() {
    const bgUrl = builtinAsset(BUILTIN_BG)
    const area = document.createElement('div')
    area.className = 'dsg-stage-area'
    area.innerHTML = `
      <div class="dsg-stage" style="width:${STAGE_W}px;height:${STAGE_H}px">
        <div class="dsg-el dsg-el-background" style="background:linear-gradient(158deg,#0c1026 0%,#161244 42%,#221a52 78%,#2a1d5e 100%);${bgUrl ? `background-image:url('${bgUrl}');background-size:cover;background-position:center;` : ''}"></div>
        <div class="dsg-char-holder" data-role="char-left"></div>
        <div class="dsg-char-holder" data-role="char-right"></div>
        <div class="dsg-dialogue" data-role="dialogue"></div>
        <div class="dsg-sname" data-role="sname" style="left:46px;top:368px;width:140px;height:24px;color:#e8ebf5;background:transparent;border-color:transparent;border-width:0;border-radius:0"></div>
        <div class="dsg-backlog" data-role="backlog"></div>
        <div class="dsg-dtext" data-role="dtext" style="left:58px;top:414px;width:844px;height:88px;color:#e8ebf5;font-size:17px;background:transparent;border-color:transparent;border-width:0"></div>
        <button class="dsg-action-btn" data-act="history" style="left:740px;top:14px;width:44px;height:26px;border-color:rgba(255,255,255,.35);border-width:1px;border-radius:4px">历史</button>
        <button class="dsg-action-btn" data-act="auto" style="left:792px;top:14px;width:44px;height:26px;border-color:rgba(255,255,255,.35);border-width:1px;border-radius:4px">自动</button>
        <button class="dsg-action-btn" data-act="skip" style="left:844px;top:14px;width:44px;height:26px;border-color:rgba(255,255,255,.35);border-width:1px;border-radius:4px">快进</button>
        <button class="dsg-action-btn" data-act="settings" style="left:896px;top:14px;width:44px;height:26px;border-color:rgba(255,255,255,.35);border-width:1px;border-radius:4px">设置</button>
        <div class="dsg-hint" data-role="hint" style="display:none"></div>
      </div>
    `
    // 替换旧舞台
    const old = this.el.querySelector('.dsg-stage-area')
    if (old) old.replaceWith(area)
    else this.el.insertBefore(area, this.el.querySelector('.dsg-input'))

    this.stageEl = area.querySelector('.dsg-stage')
    this.dialogueEl = area.querySelector('[data-role="dialogue"]')
    this.dtextEl = area.querySelector('[data-role="dtext"]')
    this.snameEl = area.querySelector('[data-role="sname"]')
    this.hintEl = area.querySelector('[data-role="hint"]')
    this.backlogEl = area.querySelector('[data-role="backlog"]')
    this.charLeftEl = area.querySelector('[data-role="char-left"]')
    this.charRightEl = area.querySelector('[data-role="char-right"]')

    // 舞台等比缩放
    this.measureStage()

    // 对话框点击：打字中追平；有下一页则翻页
    this.dtextEl.addEventListener('click', () => this.onTextClick())
    this.dialogueEl.addEventListener('click', () => {
      if (this.type && !this.type.done) this.type = skip(this.type)
    })

    area.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]')
      if (!btn) return
      const act = btn.dataset.act
      if (act === 'history') this.togglePanel('history')
      else if (act === 'auto') { this.auto = !this.auto; this.renderStageButtons() }
      else if (act === 'skip') { this.type = skip(this.type) }
      else if (act === 'settings') this.togglePanel('settings')
    })

    this.updateStageContent()
  }

  renderStageButtons() {
    if (!this.stageEl) return
    const autoBtn = this.stageEl.querySelector('[data-act="auto"]')
    if (autoBtn) autoBtn.classList.toggle('is-on', this.auto)
  }

  measureStage() {
    const area = this.el.querySelector('.dsg-stage-area')
    if (!area || !this.stageEl) return
    const availW = Math.max(120, area.clientWidth - 24)
    const availH = Math.max(120, area.clientHeight - 24)
    this.scale = Math.min(availW / STAGE_W, availH / STAGE_H)
    this.stageEl.style.transform = this.scale > 0 ? 'scale(' + this.scale + ')' : undefined
  }

  renderInput() {
    const input = document.createElement('div')
    input.className = 'dsg-input'
    input.innerHTML = `
      <textarea class="dsg-input-box" rows="2" placeholder="输入你想说的话……（Enter 发送）"></textarea>
      <button class="dsg-btn dsg-btn-accent dsg-send" disabled>发送</button>
    `
    this.el.append(input)
    this.inputBox = input.querySelector('.dsg-input-box')
    this.sendBtn = input.querySelector('.dsg-send')

    const doSend = () => {
      const text = this.inputBox.value.trim()
      if (!text || this.running) return
      this.messages.push({ role: 'player', text })
      this.lines.push({ kind: 'player', text })
      this.inputBox.value = ''
      this.sendBtn.disabled = true
      this.running = true
      this.streamingAssistant = false
      this.streamText = ''
      this.statusText = '思考中'
      this._sentAt = Date.now()
      this._lastDomText = ''
      this.setLine('player', text)
      // 显示状态页
      this.setLine('assistant', '')
      this.statusText = '思考中'
      this.updateStageContent()

      // 桥接发送
      if (!sendToDeepSeek(text)) {
        this.statusText = '发送失败：未找到输入框，请刷新页面'
        this.running = false
        this._sentAt = null
        this.updateStageContent()
      } else {
        // DOM 兜底：网络拦截失败时也能同步页面回复
        this.startDomFallback()
      }
    }

    this.inputBox.addEventListener('input', () => {
      this.sendBtn.disabled = this.inputBox.value.trim() === ''
    })
    this.inputBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        doSend()
      }
    })
    this.sendBtn.addEventListener('click', doSend)
  }

  // ── 台词控制 ──
  setLine(kind, text) {
    this.currentLine = { kind, text: stripMarkdown(text) }
    this.resetPaging()
  }

  resetPaging() {
    this.pages = []
    this.pageIndex = 0
    this.type = createTypeState()

    const line = this.currentLine
    if (!line || !line.text) {
      this.type = { target: '', shown: '', done: true }
      this.updateStageContent()
      return
    }
    // 测量分页
    const fits = createFitsMeasurer({ width: 844, height: 88, fontSize: 17 })
    this.pages = splitPages(line.text, (prefix) => fits.fits(prefix))
    fits.dispose()
    this.type = setTarget(this.type, this.pages[0] ?? '')
    this.updateStageContent()
    // 重启打字机循环
    if (!this.type.done) this.startLoop()
  }

  onTextClick() {
    if (!this.type) return
    if (!this.type.done) {
      this.type = skip(this.type)
    } else if (this.pageIndex < this.pages.length - 1) {
      this.pageIndex += 1
      this.type = setTarget(createTypeState(), this.pages[this.pageIndex] ?? '')
      if (!this.type.done) this.startLoop()
    }
    this.updateStageContent()
  }

  // ── 舞台内容更新 ──
  renderAll() {
    this.updateStageContent()
  }

  updateStageContent() {
    if (!this.dtextEl) return
    const line = this.currentLine
    const char = getActiveCharacter()

    // 历史自动堆叠（backlog）：已完成对话自动堆叠在对话框上方
    this.renderBacklog()

    // 名牌
    if (line && line.kind === 'player') {
      this.snameEl.textContent = '你'
      this.snameEl.style.color = '#4f8cff'
    } else if (line && line.kind === 'assistant') {
      this.snameEl.textContent = char.name
      this.snameEl.style.color = char.color
    } else {
      this.snameEl.textContent = ''
    }

    // 台词：思考期间只显示闪动的「思考中」指示，不展示思考内容；
    // 正文到达后展示正式回复（打字机）。
    const shown = this.type ? this.type.shown : ''
    const hasNext = this.pageIndex < this.pages.length - 1
    const thinking = this.running && this.statusText === '思考中' && !shown
    let html = ''
    if (thinking) {
      html = '<span class="dsg-thinking"><span class="dsg-thinking-dot"></span>思考中</span>'
    } else if (this.running && this.statusText && !shown) {
      html = `<span class="dsg-dtext-status">（${escapeHtml(this.statusText)}…）</span>`
    } else {
      html = escapeHtml(shown)
      if (hasNext && this.type && this.type.done) {
        html += ' <span class="dsg-dtext-more">▼</span>'
      }
      if (!this.type || !this.type.done) {
        html += '<span class="dsg-dialogue-caret"></span>'
      }
    }
    this.dtextEl.innerHTML = html

    // 对话框背景（仅作为底板，正文在独立台词层）
    const dialogueStyle = this.dialogueEl.style
    dialogueStyle.cssText = 'left:40px;top:392px;width:880px;height:128px;background:linear-gradient(180deg,rgba(18,22,44,.82) 0%,rgba(11,14,30,.9) 100%);border-color:rgba(155,140,255,.32);border-width:1px;border-radius:6px'

    // 立绘
    this.renderCharacters(line, char)
  }

  /** 历史自动堆叠：已完成对话自动堆叠在对话框上方（最近 5 条） */
  renderBacklog() {
    if (!this.backlogEl) return
    const char = getActiveCharacter()
    const recent = this.lines.slice(-5)
    if (recent.length === 0) {
      this.backlogEl.innerHTML = ''
      return
    }
    this.backlogEl.innerHTML = recent.map((l) => {
      const name = l.kind === 'player' ? '你' : char.name
      const color = l.kind === 'player' ? '#4f8cff' : (char.color || '#ff8fa3')
      const text = (l.text || '').replace(/\s+/g, ' ').slice(0, 60)
      return `<div class="dsg-backlog-row"><span class="dsg-backlog-name" style="color:${color}">${escapeHtml(name)}</span><span class="dsg-backlog-text">${escapeHtml(text)}</span></div>`
    }).join('')
  }

  renderCharacters(line, char) {
    if (!this.charLeftEl) return
    const speaking = !!(line && line.kind === 'assistant')
    const avatar = resolveAvatar(char.avatar || '')
    const color = char.color || '#ff8fa3'

    const holder = this.charLeftEl
    holder.className = 'dsg-char-holder'
    holder.style.cssText = 'position:absolute;left:120px;top:60px;width:220px;height:400px;pointer-events:none'
    holder.innerHTML = `
      <div class="dsg-char ${speaking ? 'is-speaking' : ''}" style="color:${color}">
        ${avatar
          ? `<img class="dsg-char-img" src="${escapeHtml(avatar)}" alt="">`
          : `<svg class="dsg-char-svg" viewBox="0 0 100 170" preserveAspectRatio="xMidYMax meet">
              <circle cx="50" cy="30" r="20" fill="${color}" fill-opacity=".34" stroke="${color}" stroke-opacity=".85" stroke-width="1.4"/>
              <path d="M16 170 C16 122 34 100 50 100 C66 100 84 122 84 170 Z" fill="${color}" fill-opacity=".26" stroke="${color}" stroke-opacity=".8" stroke-width="1.4"/>
              <path d="M50 24 L50 34" stroke="${color}" stroke-opacity=".5" stroke-width="1"/>
            </svg>`}
        <div class="dsg-char-plate">
          <span class="dsg-char-label">CHARACTER</span>
          <span class="dsg-char-name" style="color:${color}">${escapeHtml(char.name)}</span>
        </div>
      </div>
    `
    // 右侧立绘：无角色时清空
    if (this.charRightEl) {
      this.charRightEl.innerHTML = ''
    }
  }

  // ── 打字机循环（done 后停转，setLine/resetPaging 时重启）───────
  startLoop() {
    if (this._raf) return
    const loop = (now) => {
      this._raf = 0
      if (!this.type || this.type.done) return // 停转，等待下次 setLine
      const dt = this._lastTs ? now - this._lastTs : 16
      this._lastTs = now
      const next = advance(this.type, dt, this.speed)
      if (next !== this.type) {
        this.type = next
        this.updateStageContent()
      }
      // 自动播放：只在「当前页刚打完且尚未调度翻页」时安排下一次
      if (this.auto && this.type.done && this.pageIndex < this.pages.length - 1 && !this._autoScheduled) {
        this._autoScheduled = true
        setTimeout(() => {
          this._autoScheduled = false
          if (this.pageIndex < this.pages.length - 1) {
            this.pageIndex += 1
            this.type = setTarget(createTypeState(), this.pages[this.pageIndex] ?? '')
            this.updateStageContent()
          }
        }, 1200)
      }
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  }

  // ── 面板 ──
  togglePanel(name) {
    if (this.panel === name) {
      this.closePanel()
      return
    }
    this.closePanel()
    this.panel = name
    const panel = document.createElement('div')
    panel.className = 'dsg-panel'
    panel.dataset.panel = name

    if (name === 'history') this.renderHistoryPanel(panel)
    else if (name === 'settings') this.renderSettingsPanel(panel)
    else if (name === 'chars') this.renderCharsPanel(panel)
    else if (name === 'edit-char') this.renderCharEditPanel(panel, this.editingChar)

    this.el.append(panel)
  }

  closePanel() {
    const p = this.el.querySelector('.dsg-panel')
    if (p) p.remove()
    this.panel = null
  }

  renderHistoryPanel(panel) {
    panel.innerHTML = `
      <div class="dsg-panel-head"><span>历史</span><button class="dsg-btn" data-close="1">关闭</button></div>
      <div class="dsg-panel-body">
        ${this.lines.length === 0 ? '<div class="dsg-empty">还没有对话记录</div>' : this.lines.map((l) => {
          const name = l.kind === 'player' ? '你' : getActiveCharacter().name
          const color = l.kind === 'player' ? '#4f8cff' : getActiveCharacter().color
          return `<div class="dsg-history-row"><div class="dsg-history-name" style="color:${color}">${escapeHtml(name)}</div><div class="dsg-history-text">${escapeHtml(l.text)}</div></div>`
        }).join('')}
      </div>
    `
    panel.querySelector('[data-close]').addEventListener('click', () => this.closePanel())
  }

  renderSettingsPanel(panel) {
    const enabled = localStorage.getItem(STORAGE_ENABLED) !== '0'
    const inject = localStorage.getItem(STORAGE_INJECT) !== '0'
    panel.innerHTML = `
      <div class="dsg-panel-head"><span>设置</span><button class="dsg-btn" data-close="1">关闭</button></div>
      <div class="dsg-panel-body">
        <div class="dsg-row"><span>启用酒馆模式</span><input type="checkbox" data-set="enabled" ${enabled ? 'checked' : ''}></div>
        <div class="dsg-row"><span>注入角色卡提示词</span><input type="checkbox" data-set="inject" ${inject ? 'checked' : ''}></div>
        <div class="dsg-hint">注入关闭后，请求原样发送（页面自身功能不受影响）。</div>
      </div>
    `
    panel.querySelector('[data-close]').addEventListener('click', () => this.closePanel())
    panel.querySelectorAll('input[data-set]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.dataset.set === 'enabled') localStorage.setItem(STORAGE_ENABLED, input.checked ? '1' : '0')
        if (input.dataset.set === 'inject') localStorage.setItem(STORAGE_INJECT, input.checked ? '1' : '0')
      })
    })
  }

  renderCharsPanel(panel) {
    const chars = getCharacters()
    const active = getActiveCharacter()
    panel.innerHTML = `
      <div class="dsg-panel-head"><span>角色卡</span><button class="dsg-btn" data-close="1">关闭</button></div>
      <div class="dsg-panel-body">
        <div class="dsg-char-list">
          ${chars.map((c) => `
            <div class="dsg-char-card ${c.id === active.id ? 'is-active' : ''}" data-id="${c.id}">
              ${c.avatar ? `<img class="dsg-char-avatar" src="${escapeHtml(c.avatar)}" alt="">` : `<div class="dsg-char-avatar" style="display:flex;align-items:center;justify-content:center;color:${c.color};font-size:18px">${escapeHtml(c.name.slice(0, 1))}</div>`}
              <div class="dsg-char-card-info">
                <div class="dsg-char-card-name" style="color:${c.color}">${escapeHtml(c.name)}</div>
                <div class="dsg-char-card-desc">${escapeHtml(c.description || '').slice(0, 40)}</div>
              </div>
              <button class="dsg-char-card-del" data-del="${c.id}">删除</button>
            </div>`).join('')}
        </div>
        <div style="margin-top:12px"><button class="dsg-btn dsg-btn-accent" data-new="1">＋ 新建角色</button></div>
      </div>
    `
    panel.querySelector('[data-close]').addEventListener('click', () => this.closePanel())
    panel.querySelectorAll('.dsg-char-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) return
        setActiveCharacter(card.dataset.id)
        this.onCharacterChanged()
        this.renderTopbar()
        this.togglePanel('chars')
      })
    })
    panel.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        deleteCharacter(btn.dataset.del)
        this.onCharacterChanged()
        this.renderTopbar()
        this.togglePanel('chars')
      })
    })
    panel.querySelector('[data-new]').addEventListener('click', () => {
      this.editingChar = { ...defaultCharacter(), id: makeId('char'), name: '新角色' }
      this.togglePanel('edit-char')
    })
  }

  renderCharEditPanel(panel, char) {
    const c = char
    panel.innerHTML = `
      <div class="dsg-panel-head"><span>编辑角色</span><button class="dsg-btn" data-close="1">关闭</button></div>
      <div class="dsg-panel-body dsg-form">
        <label>名称</label>
        <input type="text" data-f="name" value="${escapeHtml(c.name)}">
        <label>颜色</label>
        <input type="text" data-f="color" value="${escapeHtml(c.color || '#ff8fa3')}" placeholder="#ff8fa3">
        <label>立绘（图片地址或上传）</label>
        <div class="dsg-form-avatar">
          ${c.avatar ? `<img src="${escapeHtml(c.avatar)}" alt="">` : '<div class="dsg-form-avatar" style="color:#98a1c2">未设置</div>'}
          <div>
            <button class="dsg-btn" data-upload="1">上传图片</button>
            <input type="file" accept="image/*" data-file="1" style="display:none">
          </div>
        </div>
        <label>角色设定（description）</label>
        <textarea data-f="description">${escapeHtml(c.description || '')}</textarea>
        <label>性格（personality）</label>
        <textarea data-f="personality">${escapeHtml(c.personality || '')}</textarea>
        <label>场景（scenario）</label>
        <textarea data-f="scenario">${escapeHtml(c.scenario || '')}</textarea>
        <label>示例对话（exampleDialogue）</label>
        <textarea data-f="exampleDialogue">${escapeHtml(c.exampleDialogue || '')}</textarea>
        <label>开场白（greeting）</label>
        <textarea data-f="greeting">${escapeHtml(c.greeting || '')}</textarea>
        <label>附加系统指令（systemPrompt，可选）</label>
        <textarea data-f="systemPrompt">${escapeHtml(c.systemPrompt || '')}</textarea>
        <div class="dsg-form-actions">
          <button class="dsg-btn dsg-btn-accent" data-save="1">保存</button>
          <button class="dsg-btn" data-close="1">关闭</button>
        </div>
      </div>
    `
    panel.querySelector('[data-close]').addEventListener('click', () => this.closePanel())

    const fileInput = panel.querySelector('[data-file]')
    panel.querySelector('[data-upload]').addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        c.avatar = reader.result
        const img = panel.querySelector('.dsg-form-avatar img')
        if (img) img.src = reader.result
      }
      reader.readAsDataURL(file)
    })

    panel.querySelector('[data-save]').addEventListener('click', () => {
      for (const input of panel.querySelectorAll('[data-f]')) {
        c[input.dataset.f] = input.value.trim()
      }
      saveCharacter(c)
      setActiveCharacter(c.id)
      this.onCharacterChanged()
      this.renderTopbar()
      this.closePanel()
    })
  }

  // ── 尺寸监听 ──
  measure() {
    this.measureStage()
  }
}

// ── 工具 ───────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

// ── 启动 ───────────────────────────────────────────────────────────
function install() {
  if (document.getElementById('dsg-root')) return

  const host = document.createElement('div')
  host.id = 'dsg-root'
  document.documentElement.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const stage = new GalStage(shadow)

  // 尺寸变化重算缩放
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => stage.measure()).observe(document.body)
  }
  window.addEventListener('resize', () => stage.measure())

  // 快捷键：Ctrl+Enter 聚焦输入
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      stage.inputBox?.focus()
    }
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true })
} else {
  install()
}
