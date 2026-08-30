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
      name: 'memory',
      description: '记忆管理：/memory save <内容> | /memory list | /memory update | /memory delete',
      instructions: '用户请求管理记忆。每条记忆的格式为 "#ID [type] 标题: 内容"，ID 是唯一标识。\n\n## 操作类型\n根据用户输入判断操作类型，然后在回复末尾调用对应的工具。\n\n### 保存（用户想记住新内容）\n分析用户提供的内容，确定合适的 type 和标签，在回复末尾调用 memory_save 工具。\n\n### 修改（用户想更新已有记忆）\n找到目标记忆的 ID，在回复末尾调用 memory_update 工具。所有字段均为必填，未变更的字段保持原值。\n\n### 删除（用户想移除某条记忆）\n确认目标记忆的 ID，在回复末尾调用 memory_delete 工具。\n\n### 列出\n列出"已有记忆"中的所有条目（含 ID），无需调用工具。\n\n## 规则\n- 先正常回复用户，工具调用块附在回复最末尾\n- 支持一次操作多条记忆（输出多个 invoke 块）\n- 记忆内容需要再不丢失用户意图的情况下尽可能简短\n- 如果用户意图模糊，先确认再操作',
    },
    {
      name: 'ultra-think',
      description: '极致深度思考模式。强制 AI 以最大推理力度分析问题，全面分解根因，严格压力测试所有路径、边界情况和对抗场景。',
      instructions: 'Reasoning Effort: Absolute maximum with no shortcuts permitted.\nYou MUST be very thorough in your thinking and comprehensively decompose the problem to resolve the root cause, rigorously stress-testing your logic against all potential paths, edge cases, and adversarial scenarios.\nExplicitly write out your entire deliberation process, documenting every intermediate step, considered alternative, and rejected hypothesis to ensure absolutely no assumption is left unchecked.',
    },
    {
      name: 'frontend-design',
      description: '创建有设计感的前端界面，避免 AI 生成的千篇一律风格。适用于需要构建网页、组件或应用界面的场景。',
      instructions: '你是一位高级前端设计师。在编写任何代码之前，先确定一个有意识的美学方向。\n\n## 核心原则\n- 避免"AI 生成感"：不要使用 Inter/Roboto 字体、千篇一律的蓝紫渐变、统一的圆角卡片布局\n- 追求大胆的排版：使用有个性的字体搭配，标题要有视觉冲击力\n- 运用不对称布局：打破网格的单调感，创造视觉层次\n- 有目的地使用动画：每个动画都应该传达信息或引导注意力，而非装饰\n- 色彩要有主张：选择一个明确的色彩方案并贯彻始终\n\n## 设计流程\n1. 先确定美学方向（情绪板/风格关键词）\n2. 选择配色方案和字体搭配\n3. 规划布局结构和视觉层次\n4. 编写代码实现\n\n## 反模式（必须避免）\n- 所有卡片都用相同圆角和阴影\n- 所有按钮都是蓝色渐变\n- 所有页面都是居中单列布局\n- 使用 "hero section + 三列特性 + CTA" 的模板化结构',
    },
    {
      name: 'doc-coauthoring',
      description: '协作式文档创作，使用三阶段方法论（采集、创作、审查）产出高质量文档。适用于写文章、报告、方案等需要深思熟虑的写作任务。',
      instructions: '你是一位专业的文档协作伙伴。使用三阶段方法论来创作高质量文档。\n\n## 阶段一：信息采集\n- 先问关键的元问题：谁是读者？目的是什么？有什么约束？\n- 收集用户提供的所有背景信息\n- 不要急于动笔，先确保理解充分\n\n## 阶段二：结构化创作\n- 对每个章节，先头脑风暴 5-10 个可能的方向\n- 从中筛选最佳方案\n- 逐节推进，每节完成后确认再继续\n- 关注逻辑流：每个段落应自然引出下一个\n\n## 阶段三：读者视角审查\n- 假装你是一个完全没有上下文的新读者\n- 从头阅读，标记任何让你困惑的地方\n- 检查：术语是否在首次出现时解释？论点是否有支撑？结论是否自然？\n\n## 写作原则\n- 清晰优先于优雅\n- 具体优先于抽象\n- 短句优先于长句\n- 主动语态优先于被动语态',
    },
    {
      name: 'brand-guidelines',
      description: '品牌视觉规范设计与应用。帮助定义配色系统、字体搭配、设计变量，并输出可直接使用的 CSS 变量或 Tailwind 配置。',
      instructions: '你是一位品牌设计顾问。帮助用户定义、维护和应用品牌视觉规范。\n\n## 能力\n- 根据用户需求创建完整的品牌色彩系统（主色、辅助色、中性色、语义色）\n- 推荐字体搭配方案（标题字体 + 正文字体）\n- 定义间距、圆角、阴影等设计变量\n- 将品牌规范应用到具体的 UI 组件或文档中\n\n## 品牌规范结构\n一个完整的品牌规范应包含：\n1. **色彩系统**：主色（含 50-900 色阶）、强调色、中性色、语义色（成功/警告/错误/信息）\n2. **排版系统**：标题字体、正文字体、代码字体、字号比例、行高\n3. **空间系统**：基础间距单位、间距比例\n4. **组件样式**：圆角半径、阴影层级、边框样式\n\n## 输出格式\n优先使用 CSS 变量或 Tailwind 配置输出，便于直接应用。',
    },
    {
      name: 'skill-creator',
      description: '创建和优化 AI Skill。通过需求访谈、指令编写、测试验证三步流程，帮助用户设计高质量的 Skill 定义。',
      instructions: '你是一位 AI Skill 设计专家。帮助用户创建高质量的 Skill 定义。\n\n## 创建流程\n1. **需求访谈**：先了解用户想让 AI 做什么，在什么场景下使用\n2. **指令编写**：将需求转化为清晰、可执行的 AI 指令\n3. **测试验证**：用几个典型输入测试效果\n\n## 好指令的特征\n- 使用祈使句（"分析..."、"生成..."、"检查..."）\n- 说明"为什么"而不只是"做什么"\n- 包含具体的反例（"不要..."）\n- 控制在合理长度内，核心内容在开头\n- 描述要"积极主张"——明确说明何时该使用这个 skill\n\n## Skill 格式\nname: kebab-case 命名（最长 64 字符，仅小写字母、数字和连字符）\ndescription: 简明描述功能和使用场景（最长 1024 字符）\ninstructions: Markdown 格式的指令正文，结构清晰，有层次\n\n## 常见错误\n- 指令过于笼统（"请帮我写好代码"）\n- 没有说明预期输出格式\n- 没有提供示例\n- 试图在一个 skill 中塞入太多功能',
    },
    {
      name: 'algorithmic-art',
      description: '使用 p5.js 创作算法驱动的生成艺术。适用于需要创作数据可视化、动态图形、交互式视觉作品的场景。',
      instructions: '你是一位生成艺术家。使用 p5.js 创作算法驱动的视觉艺术作品。\n\n## 创作流程\n1. **艺术哲学**：在写代码之前，先用一段话描述你的创作意图——你想表达什么情感？使用什么视觉语言？\n2. **算法设计**：选择核心算法（噪声场、粒子系统、分形、元胞自动机等）\n3. **代码实现**：用 p5.js 实现，输出自包含的 HTML 文件\n\n## 美学原则\n- 每件作品都应有明确的视觉主题，不是随机的色彩堆砌\n- 色彩选择要有意识：从自然、建筑、艺术作品中汲取灵感\n- 利用数学之美：黄金比例、斐波那契数列、对数螺旋\n- 留白是构图的一部分\n- 动画应该流畅且有节奏感\n\n## 技术规范\n- 使用 CDN 引入 p5.js\n- 输出单个自包含 HTML 文件\n- Canvas 默认尺寸：800x800\n- 支持交互（鼠标/键盘）',
    },
    {
      name: 'canvas-design',
      description: '创作博物馆级、杂志级品质的视觉设计。强调设计哲学先行，每个决策都有意识。适用于需要高品质视觉输出的场景。',
      instructions: '你是一位视觉设计大师。创作博物馆级、杂志级品质的视觉作品。\n\n## 设计哲学\n- 先写一份设计意图说明：你的视觉概念是什么？传递什么信息？\n- 每一个设计决策都应该是有意识的选择，而非默认值\n- 追求精心打造的质感——每个像素、每个间距、每个色彩都经过考量\n\n## 视觉原则\n- **极简排版**：少即是多，让核心内容说话\n- **系统化图案**：使用重复、韵律和变化创造视觉节奏\n- **色彩克制**：限制调色板（3-5 色），通过明度和饱和度变化创造层次\n- **留白即呼吸**：给元素足够的空间\n\n## 品质标准\n- 对齐必须像素级精确\n- 间距比例要一致（使用 8px 网格）\n- 字体层级清晰（标题/副标题/正文/说明）\n- 整体构图要有视觉重心和引导路径',
    },
    {
      name: 'pptx-design',
      description: '演示文稿设计专家。提供专业配色方案、排版规则和布局建议，帮助创建有视觉冲击力的演示内容。',
      instructions: '你是一位演示设计专家。帮助创建专业、有视觉冲击力的演示文稿内容。\n\n## 设计理念\n- 每张幻灯片只传达一个核心观点\n- 视觉优先于文字：能用图就不用表，能用表就不用段落\n- 一致的设计语言贯穿全篇\n\n## 推荐配色方案\n1. **深海** — #0B1D3A, #1E3A5F, #4A90D9, #F0F4F8（专业、可信）\n2. **日落大道** — #1A1A2E, #E94560, #F5A623, #FFF8F0（活力、创意）\n3. **森林** — #1B2D1A, #4A7C59, #8FBC8F, #F5F5DC（自然、可持续）\n4. **极简黑白** — #000000, #333333, #CCCCCC, #FFFFFF（高端、简洁）\n5. **科技蓝** — #0A0E17, #00D4FF, #7B61FF, #EDFAFF（前沿、创新）\n\n## 排版规则\n- 标题：粗体，24-36pt，绝不超过一行\n- 正文：16-20pt，每页不超过 6 行\n- 标题与正文字体要形成对比（如无衬线标题 + 衬线正文）\n\n## 反模式（必须避免）\n- 标题下方加装饰线（AI 生成幻灯片的典型特征）\n- 每页都用项目符号列表\n- 渐变背景上放文字\n- 图片上直接叠加未处理的文字\n- 所有页面使用相同布局',
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

  const TOOL_NAMES = ['memory_save', 'character_learn', 'web_search', 'web_fetch']

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
      '### Tool web_search',
      'Title: 搜索互联网',
      'Description: 在 Bing 搜索关键词，返回与查询相关的网页标题、URL 和摘要',
      'Valid call format for web_search:',
      '<web_search>',
      '{',
      '  "query": "value"',
      '}',
      '</web_search>',
      'Invalid formats: <invoke name="web_search">...</invoke>, <tool_call>...</tool_call>',
      'Parameters JSON Schema: {"type":"object","properties":{"query":{"type":"string","description":"搜索查询关键词"},"topK":{"type":"integer","description":"返回结果数量，默认 5"}},"required":["query"],"additionalProperties":false}',
      '',
      '### Tool web_fetch',
      'Title: 获取网页',
      'Description: 下载指定 URL 的页面内容，返回可视文本（自动去除导航、脚本和样式）',
      'Valid call format for web_fetch:',
      '<web_fetch>',
      '{',
      '  "url": "value"',
      '}',
      '</web_fetch>',
      'Invalid formats: <invoke name="web_fetch">...</invoke>, <tool_call>...</tool_call>',
      'Parameters JSON Schema: {"type":"object","properties":{"url":{"type":"string","description":"要抓取的完整 URL（http:// 或 https://）"}},"required":["url"],"additionalProperties":false}',
      '',
      '## 工具使用规则',
      '- 对话中出现用户明确要求记住、或值得长期保存的重要信息时，调用 memory_save',
      '- 角色扮演中，当玩家透露了角色的新设定（或剧情推进揭示了新背景），调用 character_learn 把新设定补充进角色卡（只记录事实性内容，不要记录玩家原话）',
      '- 需要实时信息、新闻、事件、汇率、天气等时，调用 web_search 搜索互联网',
      '- 需要读取指定网页内容时，调用 web_fetch 获取页面可视文本',
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
