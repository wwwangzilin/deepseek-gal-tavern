# DeepSeek GAL 酒馆

把网页版 [DeepSeek](https://chat.deepseek.com) 变成 **Galgame 风格的角色扮演酒馆** 的浏览器插件（Chrome MV3），并**完整移植 DeepSeek++（WebTool-DeepSeek）全部功能**，功能入口在侧栏。

- **gal 界面** 借鉴 [Ayase34/gal-view](https://github.com/Ayase34/gal-view)：16:9 舞台、角色立绘（说话发光，内置 DeepSeek娘立绘/卧室背景素材）、对话框 + 名牌、打字机效果、台词点击翻页、自动播放、历史面板。
- **提示词注入** 借鉴 [zhu1090093659/deepseek-pp](https://github.com/zhu1090093659/deepseek-pp)（DeepSeek++）与二开版 [illegal-xd/WebTool-DeepSeek](https://github.com/illegal-xd/WebTool-DeepSeek)：在页面 MAIN world 拦截 `fetch`/`XHR`/`EventSource`，改写 DeepSeek 对话接口的 `body.prompt`，把「角色卡系统提示词 + 已有记忆 + 激活预设 + Tools schema + 玩家输入」注入**每一次请求**。注入结构对齐 DeepSeek++：系统提示词在前，用户输入用 `<!-- dsg-visible-user-prompt:start/end -->` 标记包裹。
- **思考/正文分离**（基于 DeepSeek 真实流格式逆向）：跟踪 `fragments` 的 `THINK → RESPONSE` 类型分界，思考内容只闪动「思考中」指示，不混入台词。
- **情感调节**：每 60 秒用**快速模式（非思考）**总结对话情绪并注入角色提示词。
- **Skill 技能系统**：`/技能名 参数` 一键启用（内置 + 自定义），指令随请求注入。
- **工具调用**（XML 协议）：`memory_save` / `memory_update` / `memory_delete` / `character_learn`（角色卡学习），调用块自动从台词剥离。
- **雪璃预设**：角色面板一键创建傲娇猫娘角色（完整系统提示词）。

## DeepSeek++ 完整功能（v2.0 侧栏）

| 模块 | 说明 |
| --- | --- |
| 🎭 **角色卡** | 侧栏管理：新建/编辑/切换/删除、❄ 雪璃预设、角色卡随对话学习成长（character_learn） |
| 🧠 **记忆系统** | 四类型（user/feedback/topic/reference）× 三层权重（permanent/contextual/temporary），分层预算分配（40%/45%/15%）、关键词匹配 + 权重排序智能注入、Token 预算可配置、置顶/归档、导入导出 |
| 🔎 **网络工具** | `web_search`（Bing 搜索，无 API key）+ `web_fetch`（网页可视文本提取），模型自动调用 |
| 📄 **保存项** | 保存常用 prompt / 片段 / 书签，搜索与标签管理，JSON 导入导出 |
| 💾 **对话导出** | 侧栏导出 DeepSeek 会话为 HTML / Markdown / 纯文本 |
| ⏰ **自动化任务** | cron 5 段 / RRULE 定时任务，自动发送到 DeepSeek 独立会话执行，手动/定时/状态追踪 |
| ⚡ **Skill 技能** | **deepseek++ 完整默认技能库（10 个）** + 自定义技能，`/技能名` 触发，记忆联动 |
| 📋 **系统提示词预设** | 自定义预设、一键激活、首条注入、与角色卡/记忆/技能共存 |
| 💬 **对话管理** | 列出/删除/重命名 DeepSeek 会话、批量删除、查看历史 |
| 🔌 **MCP 工具** | Streamable HTTP / HTTP POST / SSE 传输，initialize → tools/list → tools/call 标准生命周期 |
| ⚙️ **设置** | 记忆 Token 预算、背景图（URL/上传/透明度）、WebDAV 同步配置 |

源码仓库：<https://github.com/wwwangzilin/deepseek-gal-tavern>

## 效果

- 打开 chat.deepseek.com，页面被 Galgame 舞台覆盖：深色夜晚背景（内置卧室场景图）+ 角色立绘 + 大对话框 + 打字机台词。
- 顶部可切换角色卡；输入台词后，DeepSeek 以该角色身份回复，台词逐字打出，点击文本框可翻页/快进。
- 左下角浮动按钮可一键切换 **GAL 酒馆界面 ↔ DeepSeek 原版界面**。
- 点击扩展图标打开**侧栏**：角色卡 / 记忆 / 保存项 / Skill / 预设 / 对话 / 自动化 / MCP / 设置九个页面。
- 历史面板保留本会话对话；刷新页面后自动从 DeepSeek 历史接口恢复对话。
- 角色卡可上传立绘、自定义性格/场景/示例对话/开场白/附加系统指令；侧栏「角色卡」页可新建/编辑/切换/删除。
- 思考过程只闪动「思考中」指示；每 60 秒自动总结对话情绪并调节角色回应。
- `/技能名 参数` 启用技能（内置 10 个 deepseek++ 默认技能）；对话中模型会自动把新学的角色设定写回角色卡。
- **联网搜索**：模型可调用 `web_search`（Bing 搜索）与 `web_fetch`（网页提取）获取实时信息。
- **对话导出**：侧栏对话页可导出会话为 HTML / Markdown / 纯文本。
- **保存项**：侧栏保存常用 prompt、片段、书签，支持搜索与标签。
- **自动化任务**：侧栏创建定时任务（cron 5 段 / RRULE），自动发送到 DeepSeek 执行，最小间隔 15 分钟。

## 安装（开发者模式加载）

1. 下载/克隆本项目到本地目录 `ds-gal-tavern`。
2. 打开 Chrome（或 Edge），地址栏输入 `chrome://extensions/`（Edge 为 `edge://extensions/`）。
3. 打开右上角 **开发者模式**。
4. 点击 **加载已解压的扩展程序**，选择本项目的 `ds-gal-tavern` 目录。
5. 打开（或刷新）[chat.deepseek.com](https://chat.deepseek.com) 并登录，即可看到 GAL 酒馆舞台。

> 提示：如果加载后舞台没有出现，请刷新页面。插件只在 `chat.deepseek.com` 域名下生效。

## 使用

| 操作 | 说明 |
| --- | --- |
| 输入框 | 输入你想说的话，Enter 发送（Shift+Enter 换行） |
| 点击台词框 | 打字中 → 追平当前页；已打完且有下一页 → 翻页 |
| 顶部「自动」 | 自动逐页播放台词 |
| 顶部「历史」 | 查看本会话对话记录 |
| 顶部「角色」 | 角色卡列表：切换/新建/删除 |
| 顶部「设置」 | 启用酒馆模式 / 注入角色卡提示词开关 |
| 顶部「技能」 | 技能列表：查看内置技能 / 新建自定义技能（/技能名 触发） |
| 工具调用 | 对话中模型自动调用：🧠 保存记忆 / 📖 角色卡补充（自动从台词剥离） |
| 编辑角色 | 角色面板 → 点角色卡 → 编辑弹窗（或在列表中新建） |
| 立绘 | 编辑角色时「上传图片」，支持本地图片（存为 dataURL） |

## 工作原理

```
玩家输入 → 舞台输入框 → 桥接写入 DeepSeek 原输入框并触发发送
        → 页面发起 /api/v0/chat/completion 请求
        → MAIN world 拦截：body.prompt 改写为 [角色卡系统提示词] + [玩家输入]
        → DeepSeek 流式返回（SSE JSON-patch）
        → MAIN world 解析文本块 → postMessage 广播
        → 舞台打字机逐字显示 → 点击翻页
```

历史恢复：拦截 `/api/v0/chat/history_messages` 响应，解析 `chat_messages` 广播为舞台历史。

## 项目结构

```
ds-gal-tavern/
├── manifest.json          # MV3 清单
├── icons/                 # 插件图标
└── src/
    ├── main-world.js      # MAIN world：fetch/XHR 拦截、prompt 注入、SSE 解析、历史广播
    ├── styles.js          # 舞台样式（Shadow DOM 内注入，window.GAL_CSS）
    └── content.js         # ISOLATED world：Galgame 舞台 UI、角色卡管理、输入桥接
```

## 说明与限制

- 插件以**覆盖层**方式叠加在 DeepSeek 页面之上（Shadow DOM 隔离样式），不修改页面本身；关闭插件开关即恢复原页面。
- 注入只改写每次请求的 `prompt` 字段，不触碰登录态、会话 ID 等敏感字段。
- 输入桥接依赖 DeepSeek 页面的 `<textarea>` 输入框与发送按钮；若 DeepSeek 改版导致找不到输入框，控制台会提示，等待适配。
- 立绘与角色卡数据存于浏览器 localStorage（域名 `chat.deepseek.com` 下），卸载插件不丢失。
- 使用前请确认 DeepSeek 账号已登录且有可用会话。

## 参考项目

- [Ayase34/gal-view](https://github.com/Ayase34/gal-view) — DSH 会话页 Galgame 视图（界面借鉴）
- [zhu1090093659/deepseek-pp](https://github.com/zhu1090093659/deepseek-pp) — DeepSeek++（提示词注入机制借鉴）
- [illegal-xd/WebTool-DeepSeek](https://github.com/illegal-xd/WebTool-DeepSeek) — DeepSeek++ 二开（拦截实现参考）
