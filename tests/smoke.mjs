/**
 * 冒烟测试：用 node vm 模拟浏览器环境，加载 main-world.js 与 content.js，
 * 验证核心逻辑（注入改写、SSE 解析、历史广播、打字机/分页、角色卡存储）。
 * 运行：node tests/smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let passed = 0
let failed = 0
function assert(cond, name, detail) {
  if (cond) {
    passed++
    console.log('  ✓ ' + name)
  } else {
    failed++
    console.error('  ✗ ' + name + (detail ? ' :: ' + detail : ''))
  }
}

// ── 简易 DOM mock（只覆盖脚本用到的 API）──────────────────────────
function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parent: null,
    style: {},
    dataset: {},
    className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    attributes: {},
    _listeners: {},
    _innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    rect: { width: 100, height: 40, top: 0, bottom: 40, left: 0, right: 100 },
    setAttribute(k, v) { this.attributes[k] = String(v) },
    getAttribute(k) { return this.attributes[k] ?? null },
    getBoundingClientRect() { return this.rect },
    attachShadow() { return makeElement('shadow-root') },
    appendChild(c) { c.parent = this; this.children.push(c); return c },
    append(...cs) { for (const c of cs) this.appendChild(c) },
    prepend(c) { c.parent = this; this.children.unshift(c) },
    insertBefore(c, ref) {
      c.parent = this
      const i = ref ? this.children.indexOf(ref) : -1
      if (i === -1) this.children.push(c)
      else this.children.splice(i, 0, c)
      return c
    },
    replaceWith(c) {
      const i = this.parent ? this.parent.children.indexOf(this) : -1
      if (this.parent && i !== -1) this.parent.children.splice(i, 1, c)
      c.parent = this.parent
    },
    remove() {
      if (this.parent) {
        const i = this.parent.children.indexOf(this)
        if (i !== -1) this.parent.children.splice(i, 1)
      }
    },
    addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn) },
    removeEventListener() {},
    dispatchEvent(ev) {
      const fns = this._listeners[ev.type] ?? []
      for (const fn of [...fns]) fn.call(this, ev)
      return true
    },
    click() { this.dispatchEvent({ type: 'click' }) },
    focus() {},
    querySelector(sel) { return queryIn(this, sel) },
    querySelectorAll(sel) { return queryAllIn(this, sel) },
    closest() { return null },
    cloneNode() { return this },
  }
  // 轻量 innerHTML 解析：只支持本插件用到的标签（div/span/button/select/option/textarea/img）
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML },
    set(html) {
      this._innerHTML = String(html)
      this.children = []
      parseInto(this, this._innerHTML)
    },
  })
  return el
}

// 极简 HTML 解析：<tag attr="v" attr2>text</tag>（不处理嵌套复杂结构，够测 UI 初始化）
function parseInto(parent, html) {
  const tagRe = /<([a-zA-Z0-9-]+)((?:\s+[a-zA-Z0-9-]+(?:="[^"]*")?)*)\s*([/]?)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9-]+)((?:\s+[a-zA-Z0-9-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g
  let m
  while ((m = tagRe.exec(html)) !== null) {
    if (m[7] !== undefined) {
      // 纯文本
      const text = m[7]
      if (text.trim()) {
        parent.children.push({ tagName: '#text', children: [], parent, textContent: text, style: {}, dataset: {}, attributes: {}, classList: { contains: () => false }, getAttribute: () => null, setAttribute() {}, addEventListener() {}, querySelector() { return null }, querySelectorAll() { return [] } })
      }
      continue
    }
    const tag = m[1] || m[5]
    const attrsStr = m[2] || m[6] || ''
    const selfClose = m[3] === '/' || m[5] !== undefined
    const el = makeElement(tag)
    // 解析属性
    const attrRe = /([a-zA-Z0-9-]+)(?:="([^"]*)")?/g
    let am
    while ((am = attrRe.exec(attrsStr)) !== null) {
      if (am[1]) {
        el.setAttribute(am[1], am[2] ?? '')
        if (am[1] === 'class') el.className = am[2] ?? ''
        if (am[1] === 'style') el.style.cssText = am[2] ?? ''
        if (am[1] === 'value') el.value = am[2] ?? ''
        if (am[1] === 'disabled') el.disabled = true
      }
    }
    parent.children.push(el)
    el.parent = parent
    if (!selfClose && m[4]) parseInto(el, m[4])
  }
}

function matches(el, sel) {
  if (sel === 'textarea') return el.tagName === 'TEXTAREA'
  if (sel === 'button') return el.tagName === 'BUTTON'
  if (sel.startsWith('.')) return String(el.className || '').split(/\s+/).includes(sel.slice(1))
  if (sel.startsWith('[')) {
    const m = sel.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/)
    if (!m) return false
    if (m[2] !== undefined) return el.getAttribute(m[1]) === m[2]
    return el.getAttribute(m[1]) !== null
  }
  return el.tagName.toLowerCase() === sel
}

function queryIn(root, sel) {
  if (matches(root, sel)) return root
  for (const c of root.children) {
    const r = queryIn(c, sel)
    if (r) return r
  }
  return null
}
function queryAllIn(root, sel, acc = []) {
  if (matches(root, sel)) acc.push(root)
  for (const c of root.children) queryAllIn(c, sel, acc)
  return acc
}

// ── 浏览器环境 mock ────────────────────────────────────────────────
const storage = new Map()
const localStorageMock = {
  getItem: (k) => storage.has(k) ? storage.get(k) : null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
}

const postedMessages = []
const windowMock = {
  localStorage: localStorageMock,
  postMessage: (msg) => postedMessages.push(msg),
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', backgroundColor: 'rgb(0,0,0)' }),
  HTMLTextAreaElement: class { },
  HTMLInputElement: class { },
  HTMLElement: class { },
  ResizeObserver: class { constructor() {} observe() {} disconnect() {} },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  setTimeout,
  clearTimeout,
  URL,
  location: { pathname: '/', href: 'https://chat.deepseek.com/' },
  history: { pushState() {}, replaceState() {} },
  MutationObserver: class { observe() {} },
  FileReader: class { readAsDataURL() {} },
  crypto: { randomUUID: () => 'u-' + Math.random().toString(36).slice(2) },
  __dsgInstalled: false,
}

const documentMock = {
  readyState: 'complete',
  documentElement: makeElement('html'),
  body: makeElement('body'),
  head: makeElement('head'),
  createElement: (tag) => makeElement(tag),
  createTextNode: (t) => ({ textContent: t }),
  getElementById: () => null,
  addEventListener: () => {},
  querySelector: (sel) => queryIn(documentMock.documentElement, sel),
  querySelectorAll: (sel) => queryAllIn(documentMock.documentElement, sel),
  fonts: { ready: Promise.resolve() },
}

const context = {
  window: windowMock,
  document: documentMock,
  localStorage: localStorageMock,
  console,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  URL,
  TextDecoder,
  TextEncoder,
  ReadableStream,
  Response,
  Event: class { constructor(type) { this.type = type } },
  KeyboardEvent: class { constructor(type) { this.type = type } },
  MutationObserver: class { observe() {} },
  ResizeObserver: class { constructor() {} observe() {} disconnect() {} },
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  FileReader: class { readAsDataURL() {} },
  crypto: { randomUUID: () => 'u-' + Math.random().toString(36).slice(2) },
}

// 用 Function 把 IIFE 里的闭包变量暴露出来测（main-world 是 IIFE + 挂 window）
function injectSkillTools(win) {
  const code = readFileSync(join(root, 'src', 'skill-tools.js'), 'utf8')
  new Function('window', 'localStorage', code)(win, {
    getItem: (k) => (win.localStorage && win.localStorage.getItem ? win.localStorage.getItem(k) : null),
    setItem: (k, v) => win.localStorage && win.localStorage.setItem && win.localStorage.setItem(k, String(v)),
  })
}

function runMainWorld(extraGlobals = {}) {
  injectSkillTools(windowMock)
  const code = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    code)(windowMock, documentMock, localStorageMock, console,
      extraGlobals.XMLHttpRequest ?? class {
        open() {}
        send() {}
        addEventListener() {}
      },
      extraGlobals.fetch ?? (() => Promise.resolve(new Response('{}', { status: 200 }))))
  // IIFE 内部在 document.readyState === 'complete' 时立即 install
  return windowMock
}

// ── 测试 ───────────────────────────────────────────────────────────
console.log('== main-world.js：install 与 prompt 注入 ==')

// 预置角色卡
const injectChar = {
  id: 'c1', name: '雾子', description: '神社巫女', personality: '温柔',
  scenario: '黄昏神社', exampleDialogue: '玩家：嗨\n雾子：欢迎', systemPrompt: '',
}
storage.set('dsg_active_character', JSON.stringify(injectChar))

// 干净环境：savedFetch 捕获请求体，验证注入
{
  const storageI = new Map()
  storageI.set('dsg_active_character', JSON.stringify(injectChar))
  const storeI = {
    getItem: (k) => storageI.has(k) ? storageI.get(k) : null,
    setItem: (k, v) => storageI.set(k, String(v)),
  }
  let capturedInit = null
  const savedFetchMock = (input, init) => {
    capturedInit = init
    return Promise.resolve(new Response('{}', { status: 200 }))
  }
  const winI = {}
  const msgsI = []
  winI.localStorage = storeI
  winI.postMessage = (m) => msgsI.push(m)
  winI.addEventListener = () => {}
  winI.__dsgInstalled = false
  winI.fetch = savedFetchMock
  winI.XMLHttpRequest = class { open() {} send() {} addEventListener() {} }
  injectSkillTools(winI)

  const codeI = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    codeI)(winI, { readyState: 'complete', addEventListener: () => {} }, storeI, console,
      class { open() {} send() {} addEventListener() {} },
      savedFetchMock)

  assert(winI.__dsgInstalled === true, 'install 已执行（__dsgInstalled）')

  // 发出对话请求
  await winI.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: '你好呀', chat_session_id: 's1' }),
  })

  assert(capturedInit !== null, 'fetch 请求已拦截')
  const sent = JSON.parse(capturedInit.body)
  assert(sent.prompt.includes('你是「雾子」'), '注入包含角色名', sent.prompt?.slice(0, 40))
  assert(sent.prompt.includes('【角色设定】\n神社巫女'), '注入包含角色设定')
  assert(sent.prompt.includes('dsg-visible-user-prompt:start'), '注入包含可见用户输入标记（deepseek++ 式）')
  assert(sent.prompt.includes('以上是玩家本次输入'), '注入包含用户输入说明')
  assert(sent.prompt.includes('你好呀'), '原始玩家输入保留')
  assert(sent.chat_session_id === 's1', '会话 ID 未被破坏')
  const readyMsg = msgsI.filter((m) => m.type === 'READY')
  assert(readyMsg.length === 1, 'READY 已广播')

  // 关闭注入后不修改，但流仍被拦截
  storeI.setItem('dsg_inject_prompt', '0')
  capturedInit = null
  await winI.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: '原样', chat_session_id: 's2' }),
  })
  const sent2 = JSON.parse(capturedInit.body)
  assert(sent2.prompt === '原样', '注入开关关闭后请求原样透传')
  assert(capturedInit !== null, '注入关闭时仍拦截流（保证舞台能收到回复）')

  // 强制注入：后续消息（非首条）也携带完整角色卡
  storeI.setItem('dsg_inject_prompt', '1')
  capturedInit = null
  await winI.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: '第二轮消息', chat_session_id: 's4', parent_message_id: 'm1' }),
  })
  const sent3 = JSON.parse(capturedInit.body)
  assert(sent3.prompt.includes('你是「雾子」'), '后续消息仍强制注入角色卡（非首条）')
  assert(sent3.prompt.includes('dsg-visible-user-prompt:start'), '后续消息也带可见用户输入标记')

  // 无激活角色时的兜底：只有角色列表 → 用第一个角色注入（修复注入静默失效）
  const storageFB = new Map()
  storageFB.set('dsg_characters', JSON.stringify([{ id: 'c9', name: '兜底娘', description: '兜底角色' }]))
  const storeFB = {
    getItem: (k) => storageFB.has(k) ? storageFB.get(k) : null,
    setItem: (k, v) => storageFB.set(k, String(v)),
  }
  let capturedFB = null
  const winFB = {}
  winFB.localStorage = storeFB
  winFB.postMessage = () => {}
  winFB.addEventListener = () => {}
  winFB.__dsgInstalled = false
  winFB.fetch = (input, init) => { capturedFB = init; return Promise.resolve(new Response('{}', { status: 200 })) }
  winFB.XMLHttpRequest = class { open() {} send() {} addEventListener() {} }
  injectSkillTools(winFB)
  const codeFB = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    codeFB)(winFB, { readyState: 'complete', addEventListener: () => {} }, storeFB, console,
      class { open() {} send() {} addEventListener() {} },
      winFB.fetch)
  await winFB.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: '你好', chat_session_id: 's9' }),
  })
  const sentFB = JSON.parse(capturedFB.body)
  assert(sentFB.prompt.includes('兜底娘'), '无激活角色时自动用列表第一个角色注入（修复静默失效）')
  assert(storageFB.get('dsg_active_character') !== undefined, '兜底后补写激活角色 id')

  // 情感总结注入：预置情感总结后，prompt 应包含调节指令
  storageI.set('dsg_emotion_summary', JSON.stringify({ text: '玩家情绪：焦虑\n对话基调：紧张\n调节建议：温柔安抚' }))
  capturedInit = null
  await winI.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: '我有点慌', chat_session_id: 's5' }),
  })
  const sent4 = JSON.parse(capturedInit.body)
  assert(sent4.prompt.includes('【当前情感状态'), '情感总结注入 prompt（调节情感）')
  assert(sent4.prompt.includes('玩家情绪：焦虑'), '情感总结内容进入 prompt')

  // 情感总结请求通道：content 发 REQUEST_SUMMARY → main world 发起总结 fetch
  storageI.delete('dsg_emotion_summary')
  let summaryFetchCalled = false
  const winSum = {}
  const msgsSum = []
  winSum.localStorage = storeI
  winSum.postMessage = (m) => msgsSum.push(m)
  winSum.addEventListener = (type, fn) => {
    if (type === 'message') winSum._msgHandler = fn
  }
  winSum.__dsgInstalled = false
  winSum.fetch = (input, init) => {
    if (String(input).includes('completion')) {
      summaryFetchCalled = true
      const body = JSON.parse(init.body)
      assert(body.thinking_enabled === false, '总结请求使用非思考快速模式')
      assert(body.prompt.includes('对话情感分析师'), '总结 prompt 正确')
      return Promise.resolve(new Response(
        'data: {"v":"玩家情绪：平静"}\n\ndata: {"p":"response/status","v":"FINISHED"}\n\n',
        { status: 200 },
      ))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }
  winSum.XMLHttpRequest = class { open() {} send() {} addEventListener() {} }
  injectSkillTools(winSum)
  const codeSum = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    codeSum)(winSum, { readyState: 'complete', addEventListener: () => {} }, storeI, console,
      class { open() {} send() {} addEventListener() {} },
      winSum.fetch)

  await winSum._msgHandler({ data: { source: 'dsg-content', type: 'REQUEST_SUMMARY', dialogue: '玩家：我有点慌\n雾子：别怕' } })
  // 等总结 fetch 完成
  await new Promise((r) => setTimeout(r, 50))
  assert(summaryFetchCalled, 'REQUEST_SUMMARY 触发总结请求')
  const emo = storageI.get('dsg_emotion_summary')
  assert(emo !== undefined && emo.includes('平静'), '总结结果写入 localStorage')
  assert(msgsSum.some((m) => m.type === 'EMOTION_SUMMARY'), 'EMOTION_SUMMARY 已广播')
}

console.log('== SSE 解析（通过响应流）==')
// 直接通过 win.fetch 发出一个对话请求，hook 会拦截并调用内部逻辑
// 但 savedFetch 是我们最早设置的 mock，会返回 JSON —— 我们重建环境来测流式
const postedBefore = postedMessages.length
const fakeStreamResponse = new Response(
  new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"p":"response/content","o":"APPEND","v":"你好"}\n\n'))
      c.enqueue(new TextEncoder().encode('data: {"p":"response/content","o":"APPEND","v":"，雾子"}\n\n'))
      c.enqueue(new TextEncoder().encode('data: {"p":"response/status","v":"FINISHED"}\n\n'))
      c.close()
    },
  }),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
)

// fragments 格式（DeepSeek 新版正文格式）
const fakeFragmentsResponse = new Response(
  new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"p":"response/fragments","o":"APPEND","v":[{"content":"你好","type":"text"}]}\n\n'))
      c.enqueue(new TextEncoder().encode('data: {"p":"response/fragments","o":"APPEND","v":[{"content":"，我是雾子","type":"text"}]}\n\n'))
      c.enqueue(new TextEncoder().encode('data: {"p":"response/status","v":"FINISHED"}\n\n'))
      c.close()
    },
  }),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
)

// 无空行分隔的残留 SSE（流结束时兜底解析）
const fakeNoNewlineResponse = new Response(
  new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"p":"response/content","o":"APPEND","v":"兜底文本"}'))
      c.close()
    },
  }),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
)

// 普通 JSON 响应（非流式兜底）
const fakeJsonResponse = new Response(
  JSON.stringify({ code: 0, data: { chat_messages: [{ role: 'assistant', content: 'JSON 兜底回复' }] } }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
)

// 重新跑一个干净环境，让 hook 内部保存我们的流式 mock
{
  const win2 = {}
  const storage2 = new Map()
  const store2 = {
    getItem: (k) => storage2.has(k) ? storage2.get(k) : null,
    setItem: (k, v) => storage2.set(k, String(v)),
  }
  store2.setItem('dsg_active_character', JSON.stringify({ id: 'c1', name: '雾子', description: '神社巫女' }))
  const msgs2 = []
  const win2Obj = {
    localStorage: store2,
    postMessage: (m) => msgs2.push(m),
    addEventListener: () => {},
    __dsgInstalled: false,
  }
  win2Obj.fetch = () => Promise.resolve(fakeStreamResponse)
  win2Obj.XMLHttpRequest = class {
    open() {}
    send() {}
    addEventListener() {}
  }
  injectSkillTools(win2Obj)
  const ctx2 = {
    window: win2Obj, document: { readyState: 'complete', addEventListener: () => {} },
    localStorage: store2, console,
    TextDecoder, TextEncoder, ReadableStream, Response,
    URL, setTimeout, clearTimeout,
  }
  const code2 = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    code2)(win2Obj, ctx2.document, store2, console,
      class { open() {} send() {} addEventListener() {} },
      () => Promise.resolve(fakeStreamResponse))

  // 触发一次对话请求（fetch 已被 hook），并等流读完再断言
  const resp2 = await win2Obj.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: '你好', chat_session_id: 's1' }),
  })
  await resp2.text() // 读完流，确保 STREAM_TEXT/RESPONSE_COMPLETE 广播完成

  const texts = msgs2.filter((m) => m.type === 'STREAM_TEXT')
  const done = msgs2.filter((m) => m.type === 'RESPONSE_COMPLETE')
  const full = texts.map((m) => m.data.text).join('')
  assert(full === '你好，雾子', 'SSE 流式文本正确聚合', `got: ${full}`)
  assert(done.length === 1, 'RESPONSE_COMPLETE 已广播')
  assert(done[0]?.data?.text === '你好，雾子', '完成事件携带全文')
}

// 真实样本复现：ds2api 逆向确认的 DeepSeek 流格式
// 思考阶段：初始化 envelope 带 THINK fragment + 无路径思考 token
// 正文开始：{"p":"response/fragments","o":"APPEND","v":[{type:"RESPONSE",content:"..."}]}
// 正文阶段：无路径 token 继续追加
const fakeRealFormatResponse = new Response(
  new ReadableStream({
    start(c) {
      // 初始化 envelope：fragments 里是 THINK
      c.enqueue(new TextEncoder().encode('data: {"v":{"response":{"message_id":2,"status":"WIP","fragments":[{"id":2,"type":"THINK","content":"（内心开始思考）","elapsed_secs":null}]}}}\n\n'))
      // 思考阶段的 fragments/-1/content 追加
      c.enqueue(new TextEncoder().encode('data: {"p":"response/fragments/-1/content","o":"APPEND","v":"这个题要仔细想想"}\n\n'))
      // 思考阶段的无路径 token（真实格式思考正文走这里！）
      c.enqueue(new TextEncoder().encode('data: {"v":"先分析用户意图"}\n\n'))
      c.enqueue(new TextEncoder().encode('data: {"v":"再组织回答结构"}\n\n'))
      // 正文开始：RESPONSE fragment 出现
      c.enqueue(new TextEncoder().encode('data: {"p":"response/fragments","o":"APPEND","v":[{"id":3,"type":"RESPONSE","content":"你好"}]}\n\n'))
      // 正文阶段的无路径 token
      c.enqueue(new TextEncoder().encode('data: {"v":"，我是雾子"}\n\n'))
      c.enqueue(new TextEncoder().encode('data: {"v":"今天想聊什么"}\n\n'))
      // 结尾 TIP 提示（不应渲染）
      c.enqueue(new TextEncoder().encode('data: {"p":"response/fragments","v":[{"id":4,"type":"TIP","content":"本回答由 AI 生成"}]}\n\n'))
      // 终态
      c.enqueue(new TextEncoder().encode('data: {"p":"response/status","o":"SET","v":"FINISHED"}\n\n'))
      c.close()
    },
  }),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
)

// 真实格式测试：思考 token 全部被过滤，只留 RESPONSE fragment 后的正文
{
  const winR = {}
  const storageR = new Map()
  const storeR = {
    getItem: (k) => storageR.has(k) ? storageR.get(k) : null,
    setItem: (k, v) => storageR.set(k, String(v)),
  }
  storeR.setItem('dsg_active_character', JSON.stringify({ id: 'c1', name: '雾子' }))
  const msgsR = []
  const winRObj = {
    localStorage: storeR,
    postMessage: (m) => msgsR.push(m),
    addEventListener: () => {},
    __dsgInstalled: false,
    fetch: () => Promise.resolve(fakeRealFormatResponse),
    XMLHttpRequest: class { open() {} send() {} addEventListener() {} },
  }
  injectSkillTools(winRObj)
  const codeR = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    codeR)(winRObj, { readyState: 'complete', addEventListener: () => {} }, storeR, console,
      class { open() {} send() {} addEventListener() {} },
      () => Promise.resolve(fakeRealFormatResponse))

  const respR = await winRObj.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: '你好', chat_session_id: 's1' }),
  })
  await respR.text()

  const textsR = msgsR.filter((m) => m.type === 'STREAM_TEXT').map((m) => m.data.text).join('')
  const thinkMsgs = msgsR.filter((m) => m.type === 'THINKING')
  assert(textsR === '你好，我是雾子今天想聊什么', '真实格式：只保留 RESPONSE 后的正文', `got: ${textsR}`)
  assert(!textsR.includes('思考') && !textsR.includes('分析') && !textsR.includes('AI 生成'), '思考 token 与 TIP 未混入')
  assert(thinkMsgs.length >= 1, '思考阶段触发了 THINKING 广播')
  assert(msgsR.some((m) => m.type === 'RESPONSE_COMPLETE'), '真实格式流完成')
}

// 非思考模式（thinking_enabled=false）：也应正确处理（无 THINK fragment 时正文直接输出）
const fakeNoThinkingResponse = new Response(
  new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"v":{"response":{"message_id":2,"status":"WIP","fragments":[{"id":3,"type":"RESPONSE","content":"直接回答"}]}}}\n\n'))
      c.enqueue(new TextEncoder().encode('data: {"v":"，没有思考过程"}\n\n'))
      c.enqueue(new TextEncoder().encode('data: {"p":"response/status","o":"SET","v":"FINISHED"}\n\n'))
      c.close()
    },
  }),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
)

{
  const winN = {}
  const storageN = new Map()
  const storeN = {
    getItem: (k) => storageN.has(k) ? storageN.get(k) : null,
    setItem: (k, v) => storageN.set(k, String(v)),
  }
  storeN.setItem('dsg_active_character', JSON.stringify({ id: 'c1', name: '雾子' }))
  const msgsN = []
  const winNObj = {
    localStorage: storeN,
    postMessage: (m) => msgsN.push(m),
    addEventListener: () => {},
    __dsgInstalled: false,
    fetch: () => Promise.resolve(fakeNoThinkingResponse),
    XMLHttpRequest: class { open() {} send() {} addEventListener() {} },
  }
  injectSkillTools(winNObj)
  const codeN = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    codeN)(winNObj, { readyState: 'complete', addEventListener: () => {} }, storeN, console,
      class { open() {} send() {} addEventListener() {} },
      () => Promise.resolve(fakeNoThinkingResponse))

  const respN = await winNObj.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'hi', chat_session_id: 's1' }),
  })
  await respN.text()
  const fullN = msgsN.filter((m) => m.type === 'STREAM_TEXT').map((m) => m.data.text).join('')
  assert(fullN === '直接回答，没有思考过程', '无思考模式：RESPONSE 起始即正文', `got: ${fullN}`)
}

// 无空行分隔的残留 SSE（流结束兜底）
{
  const winN = {}
  const storageN = new Map()
  const storeN = {
    getItem: (k) => storageN.has(k) ? storageN.get(k) : null,
    setItem: (k, v) => storageN.set(k, String(v)),
  }
  storeN.setItem('dsg_active_character', JSON.stringify({ id: 'c1', name: '雾子' }))
  const msgsN = []
  const winNObj = {
    localStorage: storeN,
    postMessage: (m) => msgsN.push(m),
    addEventListener: () => {},
    __dsgInstalled: false,
    fetch: () => Promise.resolve(fakeNoNewlineResponse),
    XMLHttpRequest: class { open() {} send() {} addEventListener() {} },
  }
  injectSkillTools(winNObj)
  const codeN = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    codeN)(winNObj, { readyState: 'complete', addEventListener: () => {} }, storeN, console,
      class { open() {} send() {} addEventListener() {} },
      () => Promise.resolve(fakeNoNewlineResponse))

  const respN = await winNObj.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'hi', chat_session_id: 's1' }),
  })
  await respN.text()
  const fullN = msgsN.filter((m) => m.type === 'STREAM_TEXT').map((m) => m.data.text).join('')
  assert(fullN === '兜底文本', '无分隔残留 SSE 兜底提取', `got: ${fullN}`)
}

// 普通 JSON 响应（非流式兜底）
{
  const winJ = {}
  const storageJ = new Map()
  const storeJ = {
    getItem: (k) => storageJ.has(k) ? storageJ.get(k) : null,
    setItem: (k, v) => storageJ.set(k, String(v)),
  }
  storeJ.setItem('dsg_active_character', JSON.stringify({ id: 'c1', name: '雾子' }))
  const msgsJ = []
  const winJObj = {
    localStorage: storeJ,
    postMessage: (m) => msgsJ.push(m),
    addEventListener: () => {},
    __dsgInstalled: false,
    fetch: () => Promise.resolve(fakeJsonResponse),
    XMLHttpRequest: class { open() {} send() {} addEventListener() {} },
  }
  injectSkillTools(winJObj)
  const codeJ = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    codeJ)(winJObj, { readyState: 'complete', addEventListener: () => {} }, storeJ, console,
      class { open() {} send() {} addEventListener() {} },
      () => Promise.resolve(fakeJsonResponse))

  const respJ = await winJObj.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'hi', chat_session_id: 's1' }),
  })
  await respJ.text()
  const fullJ = msgsJ.filter((m) => m.type === 'STREAM_TEXT').map((m) => m.data.text).join('')
  assert(fullJ === 'JSON 兜底回复', '普通 JSON 响应兜底提取', `got: ${fullJ}`)
}

console.log('== 历史广播 ==')
{
  const win3 = {}
  const storage3 = new Map()
  const store3 = {
    getItem: (k) => storage3.has(k) ? storage3.get(k) : null,
    setItem: (k, v) => storage3.set(k, String(v)),
  }
  const msgs3 = []
  const win3Obj = {
    localStorage: store3,
    postMessage: (m) => msgs3.push(m),
    addEventListener: () => {},
    __dsgInstalled: false,
  }
  win3Obj.fetch = () => Promise.resolve(new Response(JSON.stringify({
    data: { chat_messages: [
      { role: 'user', content: '你是谁' },
      { role: 'assistant', fragments: [{ content: '我是雾子' }] },
      { role: 'system', content: '跳过' },
    ] },
  }), { status: 200 }))
  win3Obj.XMLHttpRequest = class { open() {} send() {} addEventListener() {} }
  injectSkillTools(win3Obj)
  const ctx3 = { window: win3Obj, document: { readyState: 'complete', addEventListener: () => {} }, localStorage: store3, console, TextDecoder, TextEncoder, ReadableStream, Response, URL, setTimeout, clearTimeout }
  const code3 = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    code3)(win3Obj, ctx3.document, store3, console,
      class { open() {} send() {} addEventListener() {} },
      () => Promise.resolve(new Response('{}', { status: 200 })))

  await win3Obj.fetch('https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=s1')
  const hist = msgs3.filter((m) => m.type === 'HISTORY')
  assert(hist.length === 1, 'HISTORY 已广播')
  assert(hist[0]?.data?.lines?.length === 2, '历史行数正确（跳过 system）', JSON.stringify(hist[0]?.data?.lines))
  assert(hist[0]?.data?.lines?.[0]?.kind === 'player' && hist[0]?.data?.lines?.[1]?.kind === 'assistant', '历史角色映射正确')
  assert(hist[0]?.data?.lines?.[1]?.text === '我是雾子', 'fragments 内容提取正确')
}

console.log('== content.js（打字机/分页/角色卡）==')
{
  // content.js 依赖较多 DOM；至少验证语法与角色卡默认值逻辑
  const code = readFileSync(join(root, 'src', 'content.js'), 'utf8')
  let ok = false
  try {
    new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame',
      code)(windowMock, documentMock, localStorageMock, () => 0, () => {})
    ok = true
  } catch (e) {
    console.error('  content.js 加载异常：' + e.message)
    console.error('  ' + (e.stack || '').split('\n').slice(0, 6).join('\n  '))
  }
  assert(ok, 'content.js 可加载（语法与顶层逻辑）')
}

console.log('== skill 命令与工具调用 ==')
{
  // skill-tools 模块独立验证
  const winS = { localStorage: { getItem: () => null, setItem: () => {} } }
  injectSkillTools(winS)
  const SK = winS.DSG_SKILLS
  const TK = winS.DSG_TOOLS
  assert(SK && typeof SK.getAllSkills === 'function', 'DSG_SKILLS 已挂载')
  assert(TK && typeof TK.toolSchemasBlock === 'function', 'DSG_TOOLS 已挂载')
  assert(SK.getAllSkills().length >= 10, '内置 skill 数量 ≥ 10（deepseek++ 完整默认技能库）', 'count=' + SK.getAllSkills().length)
  // 验证 deepseek++ 原版默认技能都在
  const skillNames = SK.getAllSkills().map((s) => s.name)
  const expected = ['memory', 'ultra-think', 'frontend-design', 'doc-coauthoring', 'brand-guidelines', 'skill-creator', 'algorithmic-art', 'canvas-design', 'pptx-design', 'roleplay']
  const missing = expected.filter((n) => !skillNames.includes(n))
  assert(missing.length === 0, 'deepseek++ 默认技能齐全', 'missing=' + missing.join(','))

  // /skill 命令解析
  const inv = SK.parseSkillCommand('/roleplay 深夜酒馆，气氛暧昧')
  assert(inv && inv.skillName === 'roleplay', '/skill 命令解析')
  assert(inv.args === '深夜酒馆，气氛暧昧', 'skill 参数解析')
  const resolved = SK.resolveSkill('roleplay', inv.args)
  assert(resolved && resolved.instructions.includes('角色扮演'), 'skill 指令解析')

  // 工具 schema
  const schemas = TK.toolSchemasBlock()
  assert(schemas.includes('memory_save'), '工具 schema 含 memory_save')
  assert(schemas.includes('character_learn'), '工具 schema 含 character_learn')

  // 工具调用提取与剥离
  const text = '好的，我明白了。\n<character_learn>{"field":"personality","content":"怕黑但会强撑"}</character_learn>\n然后我继续说台词'
  const calls = TK.extractToolCalls(text)
  assert(calls.length === 1, '提取到 1 个工具调用', JSON.stringify(calls))
  assert(calls[0].name === 'character_learn', '工具名正确')
  assert(calls[0].payload.field === 'personality' && calls[0].payload.content.includes('怕黑'), '工具 payload 正确')
  const stripped = TK.stripToolCalls(text)
  assert(!stripped.includes('<character_learn>'), '工具块已从文本剥离')
  assert(stripped.includes('好的，我明白了') && stripped.includes('然后我继续说台词'), '剥离后保留正文')
}

console.log('== main-world：skill 注入 + 工具调用流过滤 ==')
{
  // skill 注入：/roleplay 请求 → prompt 应包含 skill 指令
  const storageSK = new Map()
  storageSK.set('dsg_active_character', JSON.stringify({ id: 'c1', name: '雾子', description: '神社巫女' }))
  const storeSK = {
    getItem: (k) => storageSK.has(k) ? storageSK.get(k) : null,
    setItem: (k, v) => storageSK.set(k, String(v)),
  }
  let capturedSK = null
  const winSK = {}
  const msgsSK = []
  winSK.localStorage = storeSK
  winSK.postMessage = (m) => msgsSK.push(m)
  winSK.addEventListener = () => {}
  winSK.__dsgInstalled = false
  winSK.fetch = (input, init) => {
    capturedSK = init
    return Promise.resolve(new Response('{}', { status: 200 }))
  }
  winSK.XMLHttpRequest = class { open() {} send() {} addEventListener() {} }
  injectSkillTools(winSK)
  const codeSK = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    codeSK)(winSK, { readyState: 'complete', addEventListener: () => {} }, storeSK, console,
      class { open() {} send() {} addEventListener() {} },
      winSK.fetch)

  await winSK.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: '/roleplay 深夜酒馆', chat_session_id: 's1' }),
  })
  const sentSK = JSON.parse(capturedSK.body)
  assert(sentSK.prompt.includes('当前启用的 Skill：roleplay'), 'skill 指令注入 prompt')
  assert(sentSK.prompt.includes('深度角色扮演模式'), 'skill 内容进入 prompt')
  assert(sentSK.prompt.includes('character_learn'), '工具 schema 随 prompt 注入')

  // 工具调用流过滤：回复中带 <character_learn> 块 → TOOL_CALL 广播 + 台词剥离
  const storageTC = new Map()
  storageTC.set('dsg_active_character', JSON.stringify({ id: 'c1', name: '雾子' }))
  const storeTC = {
    getItem: (k) => storageTC.has(k) ? storageTC.get(k) : null,
    setItem: (k, v) => storageTC.set(k, String(v)),
  }
  const msgsTC = []
  const winTC = {
    localStorage: storeTC,
    postMessage: (m) => msgsTC.push(m),
    addEventListener: () => {},
    __dsgInstalled: false,
    fetch: () => Promise.resolve(new Response(
      'data: {"v":{"response":{"fragments":[{"id":3,"type":"RESPONSE","content":"我会陪着你"}]}}}\n\n' +
      'data: {"v":"，别怕。"}\n\n' +
      'data: {"v":"<character_learn>"}\n\n' +
      'data: {"v":"{\\"field\\":\\"personality\\",\\"content\\":\\"怕黑但会强撑\\"}"}\n\n' +
      'data: {"v":"</character_learn>"}\n\n' +
      'data: {"p":"response/status","v":"FINISHED"}\n\n',
      { status: 200 },
    )),
    XMLHttpRequest: class { open() {} send() {} addEventListener() {} },
  }
  injectSkillTools(winTC)
  const codeTC = readFileSync(join(root, 'src', 'main-world.js'), 'utf8')
  new Function('window', 'document', 'localStorage', 'console', 'XMLHttpRequest', 'fetch',
    codeTC)(winTC, { readyState: 'complete', addEventListener: () => {} }, storeTC, console,
      class { open() {} send() {} addEventListener() {} },
      winTC.fetch)

  const respTC = await winTC.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    body: JSON.stringify({ prompt: '我好怕', chat_session_id: 's1' }),
  })
  await respTC.text()

  const shownTC = msgsTC.filter((m) => m.type === 'STREAM_TEXT').map((m) => m.data.text).join('')
  const toolCalls = msgsTC.filter((m) => m.type === 'TOOL_CALL')
  assert(shownTC === '我会陪着你，别怕。', '工具块从台词剥离，正文保留', `got: ${shownTC}`)
  assert(toolCalls.length === 1, 'TOOL_CALL 已广播')
  assert(toolCalls[0].data.call.name === 'character_learn', '工具名正确')
  assert(toolCalls[0].data.call.payload.field === 'personality', '工具 payload 正确')
}

console.log('== core 模块（记忆/预设/工具/权重）==')
{
  // 用内存 storage 模拟 chrome.storage.local
  const memStore = new Map()
  const fakeStorage = {
    getValue: async (key, fallback, normalize) => {
      const raw = memStore.get(key)
      if (raw === undefined) return fallback
      return normalize ? normalize(raw) : raw
    },
    setValue: async (key, value) => memStore.set(key, value),
    removeValue: async (key) => memStore.delete(key),
  }
  // 共享同一个 fake global，让模块之间能互相看到
  const fakeGlobal = {
    Intl, crypto, Date, Math, Set, Map, Array, String, Number, console, JSON, RegExp,
    DSG_STORAGE: fakeStorage,
  }
  fakeGlobal.globalThis = fakeGlobal
  function loadCore(name) {
    const code = readFileSync(join(root, 'src', 'core', name), 'utf8')
    new Function('globalThis', 'Intl', 'crypto', 'console', code)(fakeGlobal, Intl, crypto, console)
  }

  loadCore('weighting.js')
  loadCore('memory.js')
  assert(fakeGlobal.DSG_MEMORY && typeof fakeGlobal.DSG_MEMORY.saveMemory === 'function', 'DSG_MEMORY 已挂载')

  // 保存记忆
  await fakeGlobal.DSG_MEMORY.saveMemory({ type: 'user', name: '主人职业', content: '前端开发工程师', tags: ['前端'], pinned: false })
  await fakeGlobal.DSG_MEMORY.saveMemory({ type: 'topic', name: '小说设定', content: '主角叫林雾', tags: ['小说'] })
  const all = await fakeGlobal.DSG_MEMORY.getAllMemories()
  assert(all.length === 2, '记忆保存成功')
  assert(all[0].scope === 'permanent', 'user 类型默认 permanent 层级')

  // 注入选择：关键词匹配应优先
  const sel = await fakeGlobal.DSG_MEMORY.selectMemoriesForPrompt('前端工作怎么样', { memories: all })
  assert(sel.selected.length >= 1, '记忆注入选择出条目')
  assert(sel.block.includes('主人职业') || sel.block.includes('前端'), '关键词匹配优先注入相关记忆', sel.block)

  // 预设模块
  loadCore('presets.js')
  await fakeGlobal.DSG_PRESET.savePreset({ id: 'p1', name: '助手模式', content: '你是一位专业助手', createdAt: Date.now() })
  await fakeGlobal.DSG_PRESET.setActivePresetId('p1')
  const active = await fakeGlobal.DSG_PRESET.getActivePreset()
  assert(active && active.id === 'p1', '预设激活生效')

  // 工具模块
  loadCore('tools.js')
  const calls = fakeGlobal.DSG_TOOL.extractToolCalls('回复<memory_save>{"type":"user","name":"测试","content":"内容","tags":[]}</memory_save>完毕')
  assert(calls.length === 1 && calls[0].name === 'memory_save', '工具解析正确')
  const stripped = fakeGlobal.DSG_TOOL.stripToolCalls('正文<memory_save>{"type":"user"}</memory_save>尾部')
  assert(stripped === '正文尾部', '工具剥离正确', stripped)

  // 工具执行：memory_save 真实写入
  const result = await fakeGlobal.DSG_TOOL.executeLocalToolCall({
    name: 'memory_save',
    payload: { type: 'topic', name: '工具测试', content: '通过工具保存', tags: ['测试'] },
  })
  assert(result.ok === true, 'memory_save 工具执行成功')
  const after = await fakeGlobal.DSG_MEMORY.getAllMemories()
  assert(after.length === 3, '工具保存后记忆 +1')
}

console.log('== WebDAV 同步（merge 逻辑）==')
{
  const memStore2 = new Map()
  const fakeStorage2 = {
    getValue: async (key, fallback, normalize) => {
      const raw = memStore2.get(key)
      if (raw === undefined) return fallback
      return normalize ? normalize(raw) : raw
    },
    setValue: async (key, value) => memStore2.set(key, value),
    removeValue: async (key) => memStore2.delete(key),
  }
  const fakeGlobal2 = { Intl, crypto, Date, Math, Set, Map, Array, String, Number, console, JSON, RegExp, DSG_STORAGE: fakeStorage2 }
  fakeGlobal2.globalThis = fakeGlobal2
  function loadCore2(name) {
    const code = readFileSync(join(root, 'src', 'core', name), 'utf8')
    new Function('globalThis', 'Intl', 'crypto', 'console', code)(fakeGlobal2, Intl, crypto, console)
  }
  loadCore2('sync.js')
  const SYNC = fakeGlobal2.DSG_SYNC
  assert(SYNC && typeof SYNC.mergeMemories === 'function', 'DSG_SYNC 已挂载')

  // 合并测试：本地新条目 + 远端新条目 + 冲突取新
  const merged = SYNC.mergeMemories(
    [
      { syncId: 'a', content: '本地旧', updatedAt: 100 },
      { syncId: 'c', content: '本地独有', updatedAt: 300 },
    ],
    [
      { syncId: 'a', content: '远端新', updatedAt: 200 },
      { syncId: 'b', content: '远端独有', updatedAt: 150 },
    ],
  )
  const byId = new Map(merged.map((m) => [m.syncId, m]))
  assert(merged.length === 3, '合并保留三方条目')
  assert(byId.get('a').content === '远端新', '冲突时取更新时间新的一方')
  assert(byId.get('b') && byId.get('c'), '双方独有条目都保留')

  const mergedSkills = SYNC.mergeSkills(
    [{ name: 's1', updatedAt: 100 }],
    [{ name: 's1', updatedAt: 50 }, { name: 's2', updatedAt: 10 }],
  )
  assert(mergedSkills.length === 2 && mergedSkills.find((s) => s.name === 's1').updatedAt === 100, '技能按名称合并')
}

console.log('== MCP 工具链路 ==')
{
  // core/mcp.js：服务 CRUD + 工具发现（用 mock fetch 验证协议请求）
  const memStore3 = new Map()
  const fakeStorage3 = {
    getValue: async (key, fallback, normalize) => {
      const raw = memStore3.get(key)
      if (raw === undefined) return fallback
      return normalize ? normalize(raw) : raw
    },
    setValue: async (key, value) => memStore3.set(key, value),
    removeValue: async (key) => memStore3.delete(key),
  }
  const fakeGlobal3 = { Intl, crypto, Date, Math, Set, Map, Array, String, Number, console, JSON, RegExp, DSG_STORAGE: fakeStorage3 }
  fakeGlobal3.globalThis = fakeGlobal3
  function loadCore3(name) {
    const code = readFileSync(join(root, 'src', 'core', name), 'utf8')
    new Function('globalThis', 'Intl', 'crypto', 'console', code)(fakeGlobal3, Intl, crypto, console)
  }
  loadCore3('mcp.js')
  const MCP = fakeGlobal3.DSG_MCP
  assert(MCP && typeof MCP.createMcpServer === 'function', 'DSG_MCP 已挂载')

  const server = await MCP.createMcpServer({
    id: 'm1', name: '测试服务', enabled: true,
    transport: { kind: 'streamable_http', url: 'http://127.0.0.1:3000/mcp' },
  })
  assert(server.id === 'm1' && server.transport.kind === 'streamable_http', 'MCP 服务创建')

  const listed = await MCP.getAllMcpServers()
  assert(listed.length === 1 && listed[0].name === '测试服务', 'MCP 服务列表')

  await MCP.updateMcpServer('m1', { enabled: false })
  const updated = await MCP.getMcpServerById('m1')
  assert(updated.enabled === false, 'MCP 服务启停')

  await MCP.deleteMcpServer('m1')
  const after = await MCP.getAllMcpServers()
  assert(after.length === 0, 'MCP 服务删除')
}

console.log('== 网络工具 + 保存项（deepseek++ 核心功能）==')
{
  const memStore4 = new Map()
  const fakeStorage4 = {
    getValue: async (key, fallback, normalize) => {
      const raw = memStore4.get(key)
      if (raw === undefined) return fallback
      return normalize ? normalize(raw) : raw
    },
    setValue: async (key, value) => memStore4.set(key, value),
    removeValue: async (key) => memStore4.delete(key),
  }
  const fakeGlobal4 = { Intl, crypto, Date, Math, Set, Map, Array, String, Number, console, JSON, RegExp, DSG_STORAGE: fakeStorage4, URL, fetch: async () => { throw new Error('network test uses no fetch') } }
  fakeGlobal4.globalThis = fakeGlobal4
  function loadCore4(name) {
    const code = readFileSync(join(root, 'src', 'core', name), 'utf8')
    new Function('globalThis', 'Intl', 'crypto', 'console', 'URL', 'fetch', code)(fakeGlobal4, Intl, crypto, console, URL, fakeGlobal4.fetch)
  }
  loadCore4('network.js')
  loadCore4('saved-items.js')

  const NW = fakeGlobal4.DSG_NETWORK
  const SV = fakeGlobal4.DSG_SAVED
  assert(NW && typeof NW.executeWebToolCall === 'function', 'DSG_NETWORK 已挂载')
  assert(NW.WEB_TOOL_NAMES.includes('web_search') && NW.WEB_TOOL_NAMES.includes('web_fetch'), 'web_search/web_fetch 已注册')
  assert(NW.WEB_TOOL_DESCRIPTORS.length === 2, '网络工具 descriptor 2 个')
  assert(NW.isWebToolName('web_search') && !NW.isWebToolName('memory_save'), 'isWebToolName 判断正确')

  // 空参数校验
  const emptySearch = await NW.executeWebToolCall({ name: 'web_search', payload: {} })
  assert(emptySearch.ok === false, 'web_search 空参数校验')

  // web_fetch 协议白名单：file: 应拒绝
  const badScheme = await NW.executeWebToolCall({ name: 'web_fetch', payload: { url: 'file:///etc/passwd' } })
  assert(badScheme.ok === false && badScheme.error && badScheme.error.code === 'unsupported_url_scheme', 'web_fetch 拒绝非 http/https')

  // 保存项 CRUD
  await SV.saveSavedItem({ kind: 'snippet', title: '常用开场白', content: '喵呜～主人想聊什么？', tags: ['prompt', '猫娘'] })
  await SV.saveSavedItem({ kind: 'bookmark', title: '参考文档', content: 'https://example.com/docs', sourceUrl: 'https://example.com/docs', tags: ['参考'] })
  const allItems = await SV.getAllSavedItems()
  assert(allItems.length === 2, '保存项创建成功')
  const snippetItem = allItems.find((s) => s.kind === 'snippet')
  assert(snippetItem && snippetItem.title === '常用开场白', '保存项 snippet 类型正确')
  const found = allItems.find((s) => s.kind === 'bookmark')
  assert(found && found.sourceUrl === 'https://example.com/docs', '书签 sourceUrl 保留')

  // 搜索
  const searchHit = await SV.searchSavedItems('猫娘')
  assert(searchHit.length === 1 && searchHit[0].title === '常用开场白', '保存项按标签搜索')

  // 删除
  const delTarget = allItems.find((s) => s.kind === 'snippet')
  await SV.deleteSavedItem(delTarget.id)
  const afterDel = await SV.getAllSavedItems()
  assert(afterDel.length === 1, '保存项删除')
}

console.log('== 对话导出（deepseek++ 核心功能）==')
{
  const memStore5 = new Map()
  const fakeStorage5 = {
    getValue: async (key, fallback, normalize) => {
      const raw = memStore5.get(key)
      if (raw === undefined) return fallback
      return normalize ? normalize(raw) : raw
    },
    setValue: async (key, value) => memStore5.set(key, value),
    removeValue: async (key) => memStore5.delete(key),
  }
  const fakeGlobal5 = { Intl, crypto, Date, Math, Set, Map, Array, String, Number, console, JSON, RegExp, DSG_STORAGE: fakeStorage5 }
  fakeGlobal5.globalThis = fakeGlobal5
  const codeExport = readFileSync(join(root, 'src', 'core', 'export.js'), 'utf8')
  new Function('globalThis', 'Intl', 'crypto', 'console', codeExport)(fakeGlobal5, Intl, crypto, console)
  const EX = fakeGlobal5.DSG_EXPORT
  assert(EX && typeof EX.buildExportFile === 'function', 'DSG_EXPORT 已挂载')

  const sample = {
    sessions: [{
      title: '测试对话',
      updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '你好', createdAt: Date.now() },
        { role: 'assistant', content: '喵呜～你好主人', createdAt: Date.now() },
      ],
    }],
  }
  const html = EX.buildExportFile(sample, 'html')
  assert(html.format === 'html' && html.content.includes('<!doctype html>'), 'HTML 导出')
  assert(html.content.includes('测试对话') && html.content.includes('喵呜～你好主人'), 'HTML 导出包含对话内容')
  assert(html.content.includes('用户') && html.content.includes('AI'), 'HTML 角色区分')

  const md = EX.buildExportFile(sample, 'md')
  assert(md.format === 'md' && md.content.includes('**用户**：你好'), 'Markdown 导出')
  assert(md.content.includes('**AI**：喵呜～你好主人'), 'Markdown 导出 AI 消息')

  const txt = EX.buildExportFile(sample, 'txt')
  assert(txt.format === 'txt' && txt.content.includes('用户：你好'), '纯文本导出')
}

console.log('== 自动化任务（deepseek++ 核心功能）==')
{
  const memStore6 = new Map()
  const fakeStorage6 = {
    getValue: async (key, fallback, normalize) => {
      const raw = memStore6.get(key)
      if (raw === undefined) return fallback
      return normalize ? normalize(raw) : raw
    },
    setValue: async (key, value) => memStore6.set(key, value),
    removeValue: async (key) => memStore6.delete(key),
  }
  const fakeGlobal6 = { Intl, crypto, Date, Math, Set, Map, Array, String, Number, console, JSON, RegExp, DSG_STORAGE: fakeStorage6 }
  fakeGlobal6.globalThis = fakeGlobal6
  const codeAuto = readFileSync(join(root, 'src', 'core', 'automation.js'), 'utf8')
  new Function('globalThis', 'Intl', 'crypto', 'console', codeAuto)(fakeGlobal6, Intl, crypto, console)
  const AUTO = fakeGlobal6.DSG_AUTOMATION
  assert(AUTO && typeof AUTO.calculateNextRunAt === 'function', 'DSG_AUTOMATION 已挂载')

  // cron 5 段解析：每天 9 点
  const now = Date.now()
  const cronNext = AUTO.calculateNextRunAt({
    enabled: true,
    schedule: { kind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
  }, now)
  assert(typeof cronNext === 'number' && cronNext > now, 'cron 计算下次运行', JSON.stringify(cronNext))
  const cronDate = new Date(cronNext)
  assert(cronDate.getHours() === 9 && cronDate.getMinutes() === 0, 'cron 命中 9:00', cronDate.toISOString())

  // 非法 cron（4 段）
  const badCron = AUTO.calculateNextRunAt({
    enabled: true,
    schedule: { kind: 'cron', expression: '0 9 * *', timezone: 'Asia/Shanghai' },
  }, now)
  assert(badCron && badCron.error, '非法 cron 报错')

  // RRULE：每小时
  const rruleNext = AUTO.calculateNextRunAt({
    enabled: true,
    schedule: { kind: 'rrule', expression: 'FREQ=HOURLY;INTERVAL=1', timezone: 'Asia/Shanghai' },
  }, now)
  assert(typeof rruleNext === 'number' && rruleNext - now >= 3600000, 'RRULE 每小时下次运行')

  // 手动任务 → null
  const manualNext = AUTO.calculateNextRunAt({
    enabled: true,
    schedule: { kind: 'manual', timezone: 'Asia/Shanghai' },
  }, now)
  assert(manualNext === null, '手动任务无定时')

  // 任务 CRUD
  const task = await AUTO.saveTask({
    id: 't1', name: '每日总结', prompt: '请总结今天的对话',
    schedule: { kind: 'cron', expression: '30 22 * * *', timezone: 'Asia/Shanghai' },
    enabled: true,
  })
  assert(task.id === 't1' && task.nextRunAt > now, '任务保存并计算下次运行')
  const tasks = await AUTO.getAllTasks()
  assert(tasks.length === 1, '任务列表')
  await AUTO.deleteTask('t1')
  const afterDel = await AUTO.getAllTasks()
  assert(afterDel.length === 0, '任务删除')
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
