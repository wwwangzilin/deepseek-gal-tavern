/**
 * DeepSeek GAL 酒馆 — skill 与工具系统（借鉴 WebTool-DeepSeek / DeepSeek++）
 *
 * 挂在 window.DSG_SKILLS 与 window.DSG_TOOLS 上，由 main-world.js 使用：
 *   - skill：/skill名 参数 命令 → 解析并注入 skill 指令到 prompt
 *   - 工具：XML 协议 <memory_save>{json}</memory_save> 注入 schema；
 *           SSE 流里识别工具块，从台词剥离后广播给 content 执行
 *   - 角色卡自动补充：character_learn 工具把对话中学到的新设定写回角色卡
 */
;(function () {
  'use strict'

  // ── Skill 注册表（内置 skills，借鉴 WebTool builtin.ts 精简）──────
  const BUILTIN_SKILLS = [
    {
      name: 'ultra-think',
      description: '极致深度思考模式：以最大推理力度分析问题，全面分解根因，压力测试所有路径与边界。',
      instructions: 'Reasoning Effort: Absolute maximum with no shortcuts permitted.\nYou MUST be very thorough in your thinking and comprehensively decompose the problem to resolve the root cause, rigorously stress-testing your logic against all potential paths, edge cases, and adversarial scenarios.',
    },
    {
      name: 'frontend-design',
      description: '创建有设计感的前端界面，避免 AI 生成的千篇一律风格。',
      instructions: '你是一位高级前端设计师。在编写任何代码之前，先确定一个有意识的美学方向。\n\n## 核心原则\n- 避免"AI 生成感"：不要使用 Inter/Roboto 字体、千篇一律的蓝紫渐变、统一的圆角卡片布局\n- 追求大胆的排版：使用有个性的字体搭配，标题要有视觉冲击力\n- 运用不对称布局：打破网格的单调感，创造视觉层次\n- 色彩要有主张：选择一个明确的色彩方案并贯彻始终\n\n## 设计流程\n1. 先确定美学方向\n2. 选择配色方案和字体搭配\n3. 规划布局结构和视觉层次\n4. 编写代码实现',
    },
    {
      name: 'doc-coauthoring',
      description: '协作式文档创作：三阶段方法论（采集、创作、审查）产出高质量文档。',
      instructions: '你是一位专业的文档协作伙伴。使用三阶段方法论来创作高质量文档。\n\n## 阶段一：信息采集\n- 先问关键的元问题：谁是读者？目的是什么？有什么约束？\n\n## 阶段二：结构化创作\n- 对每个章节，先头脑风暴 5-10 个可能的方向\n- 从中筛选最佳方案，逐节推进\n\n## 阶段三：读者视角审查\n- 假装你是一个完全没有上下文的新读者，从头阅读\n- 标记任何让你困惑的地方，检查术语解释、论点支撑、结论自然度\n\n## 写作原则\n- 清晰优先于优雅，具体优先于抽象，短句优先于长句',
    },
    {
      name: 'roleplay',
      description: '进入深度角色扮演模式：强化沉浸感、动作描写与对话节奏。',
      instructions: '进入深度角色扮演模式：\n- 加强动作、表情、环境描写，让场景活起来\n- 对话节奏自然：短句推进，留白制造张力\n- 保持角色一致性：性格、口癖、记忆连贯\n- 主动推动剧情，不要总是把选择权抛回给玩家\n- 描写用 *斜体* 或（括号）包裹，台词保持口语化',
    },
  ]
  const CUSTOM_SKILLS_KEY = 'dsg_custom_skills'

  function readCustomSkills() {
    try {
      const raw = localStorage.getItem(CUSTOM_SKILLS_KEY)
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list.filter((s) => s && typeof s === 'object' && typeof s.name === 'string') : []
    } catch {
      return []
    }
  }

  function writeCustomSkills(list) {
    try {
      localStorage.setItem(CUSTOM_SKILLS_KEY, JSON.stringify(list))
    } catch {
      /* ignore */
    }
  }

  function getAllSkills() {
    return [...BUILTIN_SKILLS, ...readCustomSkills()]
  }

  function saveSkill(skill) {
    const custom = readCustomSkills()
    const idx = custom.findIndex((s) => s.name === skill.name)
    if (idx >= 0) custom[idx] = { ...custom[idx], ...skill }
    else custom.push({ ...skill, source: 'custom' })
    writeCustomSkills(custom)
  }

  function deleteSkill(name) {
    writeCustomSkills(readCustomSkills().filter((s) => s.name !== name))
  }

  /** 解析 /skill 命令：/name 参数 */
  function parseSkillCommand(input) {
    const m = /^\/(\S+)\s*([\s\S]*)$/.exec(input)
    if (!m) return null
    return { skillName: m[1], args: (m[2] || '').trim(), rawInput: input }
  }

  /** 解析后 resolve：找到 skill 并返回注入指令块 */
  function resolveSkill(skillName, args) {
    const skill = getAllSkills().find((s) => s.name === skillName)
    if (!skill) return null
    let instructions = skill.instructions || ''
    if (args) {
      instructions += '\n\n## 任务参数\n' + args
    }
    return { name: skill.name, instructions }
  }

  // ── 工具 schema（XML 协议，借鉴 WebTool memory.ts + 新增角色学习）──
  const MEMORY_SAVE_SCHEMA = '{"type":"function","function":{"name":"memory_save","description":"保存一条新的长期记忆（用户偏好、重要事实、对话要点）","parameters":{"type":"object","properties":{"type":{"type":"string","enum":["user","topic","reference","feedback"],"description":"记忆类型" },"name":{"type":"string","description":"简短标题"},"content":{"type":"string","description":"要保存的内容"},"tags":{"type":"array","items":{"type":"string"},"description":"标签列表"}},"required":["type","name","content","tags"]}}}'

  const CHARACTER_LEARN_SCHEMA = '{"type":"function","function":{"name":"character_learn","description":"在角色扮演对话中，把新学到的角色设定（角色背景、性格细节、关系、口癖、剧情事实等）补充进当前角色卡。仅在出现值得长期记住的新设定时调用。","parameters":{"type":"object","properties":{"field":{"type":"string","enum":["description","personality","scenario","exampleDialogue"],"description":"要补充的角色卡字段：description=角色设定, personality=性格, scenario=场景, exampleDialogue=示例对话"},"content":{"type":"string","description":"要补充/追加的内容（简短、事实性，不要对话原文）"},"replace":{"type":"boolean","description":"true=替换该字段内容, false(默认)=追加到现有内容末尾"}},"required":["field","content"]}}}'

  const TOOL_NAMES = ['memory_save', 'character_learn']

  function toolSchemasBlock() {
    return [
      '## Tools',
      '',
      'You have access to a set of tools. To call a tool, output an XML block with the tool name itself as the tag and a JSON object as the body, exactly like this:',
      '',
      '<memory_save>',
      '{"type": "topic", "name": "标题", "content": "要保存的内容", "tags": ["标签"]}',
      '</memory_save>',
      '',
      'The JSON body MUST be valid JSON on its own. Do NOT add any other text inside the tags, only JSON.',
      'The extension only executes direct tool-name tags. Never use wrapper formats such as <invoke name="tool_name">...</invoke> or <tool_call>...</tool_call>.',
      'The tag name MUST exactly match one of the available tool names.',
      'Never output pseudo tool-call JSON such as {"tool":"name","arguments":{...}} in a Markdown code block.',
      'Never place executable tool XML in a thinking/reasoning section. Put tool XML in the final assistant answer content so the extension can execute it.',
      '',
      '### Available Tools',
      '',
      '### Tool memory_save',
      'Title: 保存记忆',
      'Description: 保存一条新的长期记忆（用户偏好、重要事实、对话要点）',
      'Valid call format for memory_save:',
      '<memory_save>',
      '{',
      '  "type": "topic",',
      '  "name": "value",',
      '  "content": "value",',
      '  "tags": []',
      '}',
      '</memory_save>',
      'Invalid formats: <invoke name="memory_save">...</invoke>, <tool_call>...</tool_call>',
      'Parameters JSON Schema: ' + MEMORY_SAVE_SCHEMA,
      '',
      '### Tool character_learn',
      'Title: 角色卡学习',
      'Description: 在角色扮演对话中，把新学到的角色设定（角色背景、性格细节、关系、口癖、剧情事实等）补充进当前角色卡。仅在出现值得长期记住的新设定时调用。',
      'Valid call format for character_learn:',
      '<character_learn>',
      '{',
      '  "field": "personality",',
      '  "content": "新学到的性格细节"',
      '}',
      '</character_learn>',
      'Invalid formats: <invoke name="character_learn">...</invoke>, <tool_call>...</tool_call>',
      'Parameters JSON Schema: ' + CHARACTER_LEARN_SCHEMA,
      '',
      '## 工具使用规则',
      '- 对话中出现用户明确要求记住、或值得长期保存的重要信息时，调用 memory_save',
      '- 角色扮演中，当玩家透露了角色的新设定（或剧情推进揭示了新背景），调用 character_learn 把新设定补充进角色卡（只记录事实性内容，不要记录玩家原话）',
      '- 工具调用块放在回复的任意位置，调用后继续正常回复',
      '- 不要用 Markdown 代码围栏包裹工具调用块',
      'You MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls.',
    ].join('\n\n')
  }

  // ── 工具调用解析与剥离（借鉴 tool-parser.ts）────────────────────
  function createToolCallRegex() {
    const names = TOOL_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    return new RegExp(`<(${names})>\\s*([\\s\\S]*?)\\s*<\\/\\1>`, 'g')
  }

  /** 从完整文本中提取所有工具调用 */
  function extractToolCalls(text) {
    const calls = []
    const regex = createToolCallRegex()
    let match
    while ((match = regex.exec(text)) !== null) {
      const invocationName = match[1]
      let payload
      try {
        payload = JSON.parse(match[2])
      } catch {
        continue
      }
      calls.push({ name: invocationName, payload, raw: match[0] })
    }
    return calls
  }

  /** 从文本中剥离工具调用块 */
  function stripToolCalls(text) {
    return text.replace(createToolCallRegex(), '').trim()
  }

  // ── 暴露 ──────────────────────────────────────────────────────────
  window.DSG_SKILLS = {
    getAllSkills,
    saveSkill,
    deleteSkill,
    parseSkillCommand,
    resolveSkill,
  }
  window.DSG_TOOLS = {
    toolSchemasBlock,
    extractToolCalls,
    stripToolCalls,
    TOOL_NAMES,
  }
})()
