/**
 * GAL 酒馆 — 自动化任务（移植 deepseek-pp core/automation/*）
 * 定时/手动任务：cron 5 段表达式 + RRULE（MINUTELY/HOURLY/DAILY），最小间隔 15 分钟。
 * 任务触发后通过 background 发往 DeepSeek 独立会话执行。
 */
;(function () {
  'use strict'

  const STORAGE_KEY = 'dsg_automation_tasks'
  const MINIMUM_INTERVAL_MINUTES = 15
  const MAX_LOOKAHEAD_DAYS = 370
  const MINUTE_MS = 60000
  const DAY_MS = 86400000

  // ── 调度解析（移植 schedule.ts）──────────────────────────────────
  function parseCronField(field, min, max, normalize) {
    normalize = normalize || ((v) => v)
    const values = new Set()
    const wildcard = field === '*' || field === '?'
    for (const token of field.split(',')) {
      const parsed = parseCronToken(token.trim(), min, max)
      if (parsed.error) return parsed
      for (let v = parsed.start; v <= parsed.end; v += parsed.step) values.add(normalize(v))
    }
    if (values.size === 0) return { error: 'invalid_cron_field: ' + field }
    return { values, wildcard }
  }

  function parseCronToken(token, min, max) {
    if (!token) return { error: 'empty cron token' }
    const [rangePart, stepPart] = token.split('/')
    const step = stepPart == null ? 1 : Number.parseInt(stepPart, 10)
    if (!Number.isInteger(step) || step < 1) return { error: 'invalid cron step' }
    if (rangePart === '*' || rangePart === '?') return { start: min, end: max, step }
    const [startRaw, endRaw] = rangePart.split('-')
    const start = Number.parseInt(startRaw, 10)
    const end = endRaw == null ? start : Number.parseInt(endRaw, 10)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      return { error: 'invalid cron range: ' + rangePart }
    }
    return { start, end, step }
  }

  function normalizeDayOfWeek(v) { return v === 7 ? 0 : v }

  function parseCron(expression) {
    const fields = expression.trim().split(/\s+/)
    if (fields.length !== 5) return { error: 'Cron 表达式必须为 5 段' }
    const [minute, hour, dom, month, dow] = fields
    const pMinute = parseCronField(minute, 0, 59)
    const pHour = parseCronField(hour, 0, 23)
    const pDom = parseCronField(dom, 1, 31)
    const pMonth = parseCronField(month, 1, 12)
    const pDow = parseCronField(dow, 0, 7, normalizeDayOfWeek)
    if (pMinute.error || pHour.error || pDom.error || pMonth.error || pDow.error) {
      return { error: [pMinute, pHour, pDom, pMonth, pDow].find((p) => p.error).error }
    }
    return { minute: pMinute, hour: pHour, dayOfMonth: pDom, month: pMonth, dayOfWeek: pDow }
  }

  function weekdayToNumber(value) {
    switch (value) {
      case 'Sun': return 0
      case 'Mon': return 1
      case 'Tue': return 2
      case 'Wed': return 3
      case 'Thu': return 4
      case 'Fri': return 5
      case 'Sat': return 6
      default: return 0
    }
  }

  function getZonedParts(timestamp, timezone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    })
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((p) => [p.type, p.value]))
    return {
      minute: Number(parts.minute),
      hour: Number(parts.hour),
      dayOfMonth: Number(parts.day),
      month: Number(parts.month),
      dayOfWeek: weekdayToNumber(parts.weekday),
    }
  }

  function matchesCron(cron, parts) {
    const domMatches = cron.dayOfMonth.values.has(parts.dayOfMonth)
    const dowMatches = cron.dayOfWeek.values.has(parts.dayOfWeek)
    const dayMatches = !cron.dayOfMonth.wildcard && !cron.dayOfWeek.wildcard
      ? domMatches || dowMatches
      : domMatches && dowMatches
    return cron.minute.values.has(parts.minute)
      && cron.hour.values.has(parts.hour)
      && cron.month.values.has(parts.month)
      && dayMatches
  }

  function findNextCronRun(cron, timezone, referenceAt) {
    const endAt = referenceAt + MAX_LOOKAHEAD_DAYS * DAY_MS
    let candidate = Math.floor(referenceAt / MINUTE_MS) * MINUTE_MS + MINUTE_MS
    while (candidate <= endAt) {
      if (matchesCron(cron, getZonedParts(candidate, timezone))) return candidate
      candidate += MINUTE_MS
    }
    return null
  }

  function parseRRule(expression) {
    const normalized = String(expression).replace(/^RRULE:/i, '')
    const parts = new Map()
    for (const part of normalized.split(';')) {
      const [rawKey, rawValue] = part.split('=')
      const key = rawKey ? rawKey.trim().toUpperCase() : ''
      const value = rawValue ? rawValue.trim().toUpperCase() : ''
      if (!key || !value) return { error: 'RRULE 格式错误' }
      parts.set(key, value)
    }
    const freq = parts.get('FREQ')
    if (freq !== 'MINUTELY' && freq !== 'HOURLY' && freq !== 'DAILY') return { error: 'RRULE FREQ 仅支持 MINUTELY/HOURLY/DAILY' }
    const interval = Number.parseInt(parts.get('INTERVAL') || '1', 10)
    if (!Number.isInteger(interval) || interval < 1) return { error: 'RRULE INTERVAL 必须为正整数' }
    const minutes = freq === 'MINUTELY' ? interval : freq === 'HOURLY' ? interval * 60 : interval * 1440
    return { minutes }
  }

  /** 计算下次运行时间戳；manual 或无 enabled 返回 null */
  function calculateNextRunAt(task, referenceAt) {
    referenceAt = referenceAt || Date.now()
    if (!task || task.enabled === false || !task.schedule || task.schedule.kind === 'manual') return null
    const schedule = task.schedule
    const timezone = schedule.timezone || 'UTC'
    if (schedule.kind === 'rrule') {
      const parsed = parseRRule(schedule.expression)
      if (parsed.error) return { error: parsed.error }
      if (parsed.minutes < MINIMUM_INTERVAL_MINUTES) return { error: '任务间隔不能小于 15 分钟' }
      return referenceAt + parsed.minutes * MINUTE_MS
    }
    const cron = parseCron(schedule.expression)
    if (cron.error) return { error: cron.error }
    const next = findNextCronRun(cron, timezone, referenceAt)
    if (next == null) return { error: '在查找窗口内没有匹配的运行时间' }
    // 检查最小间隔
    const second = findNextCronRun(cron, timezone, next)
    if (second != null && (second - next) / MINUTE_MS < MINIMUM_INTERVAL_MINUTES) {
      return { error: '任务间隔不能小于 15 分钟' }
    }
    return next
  }

  function validateSchedule(task) {
    const result = calculateNextRunAt(task, Date.now())
    if (result && result.error) return { ok: false, error: result.error }
    return { ok: true }
  }

  // ── 存储 ─────────────────────────────────────────────────────────
  async function readTasks() {
    return globalThis.DSG_STORAGE
      ? globalThis.DSG_STORAGE.getValue(STORAGE_KEY, [], (raw) => Array.isArray(raw) ? raw : [])
      : []
  }
  async function writeTasks(list) {
    if (globalThis.DSG_STORAGE) await globalThis.DSG_STORAGE.setValue(STORAGE_KEY, list)
  }

  function makeId() {
    return 'task-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))
  }

  function normalizeTask(raw) {
    return {
      id: raw.id || makeId(),
      name: raw.name || '未命名任务',
      prompt: raw.prompt || '',
      schedule: {
        kind: raw.schedule && raw.schedule.kind ? raw.schedule.kind : 'manual',
        expression: raw.schedule && raw.schedule.expression ? raw.schedule.expression : '',
        timezone: raw.schedule && raw.schedule.timezone ? raw.schedule.timezone : 'Asia/Shanghai',
      },
      enabled: raw.enabled !== false,
      sessionId: raw.sessionId || null,
      lastRunAt: raw.lastRunAt || null,
      nextRunAt: raw.nextRunAt || null,
      lastStatus: raw.lastStatus || 'idle',
      lastError: raw.lastError || null,
      createdAt: raw.createdAt || Date.now(),
    }
  }

  async function getAllTasks() {
    const list = await readTasks()
    return list.map(normalizeTask)
  }

  async function saveTask(input) {
    const list = await readTasks()
    const task = normalizeTask(input)
    // 计算下次运行
    if (task.enabled && task.schedule.kind !== 'manual') {
      const next = calculateNextRunAt(task, Date.now())
      task.nextRunAt = next && next.error ? null : next
    } else {
      task.nextRunAt = null
    }
    const idx = list.findIndex((t) => t.id === task.id)
    if (idx >= 0) list[idx] = task
    else list.push(task)
    await writeTasks(list)
    return task
  }

  async function deleteTask(id) {
    const list = await readTasks()
    await writeTasks(list.filter((t) => t.id !== id))
  }

  async function updateTaskStatus(id, patch) {
    const list = await readTasks()
    const idx = list.findIndex((t) => t.id === id)
    if (idx === -1) return
    list[idx] = { ...list[idx], ...patch }
    await writeTasks(list)
  }

  // ── 运行 ─────────────────────────────────────────────────────────
  // 任务运行：把 prompt 发给 DeepSeek（独立会话），通过 content 的 DS_ 通道。
  async function runTaskNow(task, sendToContent) {
    try {
      await updateTaskStatus(task.id, { lastRunAt: Date.now(), lastStatus: 'running', lastError: null })
      // 通过 content 执行：使用 DeepSeek 页面会话发送消息
      const result = await sendToContent({ type: 'DS_RUN_TASK', payload: { taskId: task.id, prompt: task.prompt, sessionId: task.sessionId } })
      await updateTaskStatus(task.id, { lastStatus: 'success', lastError: null, sessionId: result && result.sessionId ? result.sessionId : task.sessionId })
      return { ok: true, sessionId: result && result.sessionId ? result.sessionId : null }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      await updateTaskStatus(task.id, { lastStatus: 'error', lastError: msg })
      return { ok: false, error: msg }
    }
  }

  globalThis.DSG_AUTOMATION = {
    calculateNextRunAt,
    validateSchedule,
    getAllTasks,
    saveTask,
    deleteTask,
    updateTaskStatus,
    runTaskNow,
  }
})()
