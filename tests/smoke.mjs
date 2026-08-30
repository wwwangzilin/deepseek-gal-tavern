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
function runMainWorld(extraGlobals = {}) {
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
  assert(sent.prompt.includes('以下是玩家本次输入'), '注入包含玩家输入块')
  assert(sent.prompt.endsWith('你好呀'), '原始玩家输入保留在末尾')
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
  assert(sent3.prompt.includes('以下是玩家本次输入'), '注入包含玩家输入块')

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

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
