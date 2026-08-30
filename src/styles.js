/**
 * DeepSeek GAL 酒馆 — gal 舞台样式（注入 Shadow DOM）
 * 视觉基调借鉴 gal-view：深色夜晚 + 紫蓝渐变 + 半透明毛玻璃 + 克制发光。
 * 全部作用域限定在 #dsg-root 的 shadow root 内，不污染宿主页面。
 */
window.GAL_CSS = `
:host {
  all: initial;
}
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
.dsg-root {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(1200px 500px at 18% -10%, rgba(79, 140, 255, .08), transparent 60%),
    radial-gradient(900px 420px at 85% 110%, rgba(143, 123, 255, .09), transparent 60%),
    #0a0d1c;
  color: #e6e9f4;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
  user-select: none;
  overflow: hidden;
}
.dsg-root input, .dsg-root textarea, .dsg-root select {
  user-select: text;
  font-family: inherit;
}

/* ── 顶部栏 ── */
.dsg-topbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, .09);
  background: linear-gradient(180deg, rgba(20, 24, 44, .7), rgba(14, 17, 34, .35));
  z-index: 5;
}
.dsg-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .12em;
  color: #e6e9f4;
}
.dsg-brand-mark {
  width: 10px;
  height: 10px;
  transform: rotate(45deg);
  background: linear-gradient(135deg, #8f7bff, #4f8cff);
  box-shadow: 0 0 10px rgba(143, 123, 255, .55);
}
.dsg-char-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsg-char-select {
  background: rgba(10, 13, 28, .72);
  border: 1px solid rgba(255, 255, 255, .17);
  border-radius: 4px;
  color: #e6e9f4;
  font-size: 12px;
  padding: 4px 10px;
  outline: none;
  max-width: 220px;
}
.dsg-char-select:focus {
  border-color: rgba(143, 123, 255, .6);
}
.dsg-topbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsg-btn {
  border: 1px solid rgba(255, 255, 255, .17);
  background: rgba(255, 255, 255, .03);
  color: #e6e9f4;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease, color .15s ease;
}
.dsg-btn:hover:not(:disabled) {
  border-color: rgba(143, 123, 255, .65);
  background: rgba(143, 123, 255, .10);
  box-shadow: 0 0 12px rgba(143, 123, 255, .22);
  color: #fff;
}
.dsg-btn:disabled {
  opacity: .38;
  cursor: not-allowed;
}
.dsg-btn-accent {
  border-color: rgba(143, 123, 255, .55);
  background: linear-gradient(180deg, rgba(143, 123, 255, .20), rgba(79, 140, 255, .12));
}
.dsg-toggle.is-on {
  border-color: rgba(143, 123, 255, .7);
  background: rgba(143, 123, 255, .14);
  color: #fff;
  box-shadow: 0 0 10px rgba(143, 123, 255, .2);
}

/* ── 舞台 ── */
.dsg-stage-area {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  background: radial-gradient(900px 460px at 50% 30%, rgba(30, 36, 70, .5), transparent 70%), #070912;
}
.dsg-stage {
  position: relative;
  flex: none;
  transform-origin: 50% 50%;
  background: #0c1026;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .06), 0 22px 60px rgba(0, 0, 0, .55);
  overflow: hidden;
}
.dsg-el {
  position: absolute;
  border-style: solid;
  pointer-events: none;
  overflow: visible;
}
.dsg-el-background {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.dsg-bg-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  letter-spacing: .5em;
  text-indent: .5em;
  opacity: .4;
  color: inherit;
  text-shadow: 0 1px 12px rgba(0, 0, 0, .5);
  pointer-events: none;
}

/* 角色立绘 */
.dsg-char {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: dsg-float 4.6s ease-in-out infinite;
}
.dsg-char-img {
  width: 100%;
  height: calc(100% - 30px);
  object-fit: contain;
  object-position: bottom center;
  filter: drop-shadow(0 10px 22px rgba(0, 0, 0, .5));
  pointer-events: none;
}
.dsg-char-svg {
  width: 100%;
  height: calc(100% - 30px);
  filter: drop-shadow(0 10px 22px rgba(0, 0, 0, .5));
  pointer-events: none;
}
.dsg-char.is-speaking .dsg-char-img,
.dsg-char.is-speaking .dsg-char-svg {
  filter: drop-shadow(0 0 12px currentColor) drop-shadow(0 10px 22px rgba(0, 0, 0, .5));
}
.dsg-char-plate {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 3px 12px;
  background: rgba(12, 15, 30, .78);
  border: 1px solid rgba(255, 255, 255, .17);
  border-radius: 2px;
}
.dsg-char-label {
  font-size: 10px;
  letter-spacing: .28em;
  color: #98a1c2;
}
.dsg-char-name {
  font-size: 12px;
  font-weight: 600;
}

/* 对话框 */
.dsg-dialogue {
  position: absolute;
  pointer-events: auto;
  cursor: pointer;
  border-style: solid;
}
.dsg-dialogue-body {
  position: absolute;
  inset: 10px 18px 8px 18px;
  overflow: hidden;
  font-size: inherit;
  line-height: 1.8;
  letter-spacing: .02em;
  white-space: pre-wrap;
  word-break: break-word;
  color: inherit;
}
.dsg-dtext {
  position: absolute;
  pointer-events: auto;
  cursor: pointer;
  overflow: hidden;
  padding: 2px 10px;
  line-height: 1.8;
  letter-spacing: .02em;
  white-space: pre-wrap;
  word-break: break-word;
  border-style: solid;
}
.dsg-dtext-more {
  position: absolute;
  right: 8px;
  bottom: 2px;
  font-size: .7em;
  color: #8f7bff;
  animation: dsg-pulse 1.4s ease-in-out infinite;
}
.dsg-dtext-status {
  color: #98a1c2;
  letter-spacing: .04em;
  animation: dsg-pulse 1.6s ease-in-out infinite;
}
/* 思考中指示器：闪动 + 呼吸，不展示思考内容 */
.dsg-thinking {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  letter-spacing: .18em;
  color: #8f9bbd;
  animation: dsg-thinking-blink 1.1s ease-in-out infinite;
}
.dsg-thinking .dsg-thinking-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8f7bff, #4f8cff);
  box-shadow: 0 0 10px rgba(143, 123, 255, .9);
  animation: dsg-thinking-pulse 1.1s ease-in-out infinite;
}
/* 历史堆叠区：对话框上方，半透明小字，自动堆叠最近对话 */
.dsg-backlog {
  position: absolute;
  left: 46px;
  right: 46px;
  bottom: 368px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  overflow: hidden;
  z-index: 30;
}
.dsg-backlog-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(230, 233, 244, .55);
  background: rgba(10, 13, 28, .45);
  padding: 1px 10px;
  border-radius: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsg-backlog-row:last-child {
  color: rgba(230, 233, 244, .72);
}
.dsg-backlog-name {
  flex: none;
  font-weight: 700;
  letter-spacing: .08em;
}
.dsg-backlog-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsg-sname {
  position: absolute;
  border-style: solid;
  display: flex;
  align-items: center;
  padding: 2px 8px;
  white-space: nowrap;
  letter-spacing: .14em;
  font-weight: 700;
  font-size: 14px;
  overflow: hidden;
}
.dsg-dialogue-caret {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  margin-left: 3px;
  background: #4f8cff;
  vertical-align: text-bottom;
  animation: dsg-blink 1s steps(2, start) infinite;
}

/* 透明功能按钮（舞台内） */
.dsg-action-btn {
  position: absolute;
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: solid;
  font-size: 12px;
  letter-spacing: .12em;
  background: transparent;
  color: #e6e9f4;
  transition: border-color .15s ease, background .15s ease, color .15s ease;
}
.dsg-action-btn:hover {
  border-color: rgba(143, 123, 255, .6);
  background: rgba(143, 123, 255, .12);
  color: #fff;
}
.dsg-action-btn.is-on {
  border-color: #8f7bff;
  background: rgba(143, 123, 255, .14);
  color: #fff;
}

/* 打字提示 */
.dsg-hint {
  position: absolute;
  bottom: 12px;
  right: 16px;
  font-size: 11px;
  color: #98a1c2;
  letter-spacing: .08em;
  opacity: .7;
  pointer-events: none;
}

/* ── 输入区 ── */
.dsg-input {
  flex: none;
  height: 84px;
  display: flex;
  gap: 10px;
  align-items: stretch;
  padding: 8px 16px 10px;
  border-top: 1px solid rgba(255, 255, 255, .09);
  background: linear-gradient(180deg, rgba(20, 24, 44, .6), rgba(14, 17, 34, .3));
  z-index: 5;
}
.dsg-input-box {
  flex: 1 1 auto;
  resize: none;
  background: rgba(10, 13, 28, .72);
  border: 1px solid rgba(255, 255, 255, .17);
  border-radius: 4px;
  color: #e6e9f4;
  font-size: 14px;
  line-height: 1.6;
  padding: 8px 12px;
  outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.dsg-input-box:focus {
  border-color: rgba(143, 123, 255, .6);
  box-shadow: 0 0 0 1px rgba(143, 123, 255, .25), 0 0 16px rgba(143, 123, 255, .12);
}
.dsg-input-box::placeholder {
  color: #98a1c2;
}
.dsg-send {
  align-self: stretch;
  min-width: 84px;
}

/* ── 面板（历史/设置/角色编辑） ── */
.dsg-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 80;
  width: min(420px, 92%);
  display: flex;
  flex-direction: column;
  background: rgba(13, 16, 32, .96);
  border-left: 1px solid rgba(143, 123, 255, .3);
  box-shadow: -18px 0 44px rgba(0, 0, 0, .5);
  backdrop-filter: blur(10px);
  animation: dsg-slide-in .24s cubic-bezier(.16, 1, .3, 1);
}
.dsg-panel-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, .17);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .2em;
}
.dsg-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 14px 16px;
}
.dsg-history-row {
  padding: 9px 0;
  border-bottom: 1px solid rgba(255, 255, 255, .09);
}
.dsg-history-name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .1em;
}
.dsg-history-text {
  margin: 3px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: #e6e9f4;
  white-space: pre-wrap;
  word-break: break-word;
}
.dsg-empty {
  padding: 24px 0;
  text-align: center;
  color: #98a1c2;
  font-size: 13px;
}

/* 设置行 */
.dsg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  font-size: 12px;
  color: #98a1c2;
}
.dsg-row input[type="text"], .dsg-row select, .dsg-row textarea {
  width: 200px;
  background: rgba(10, 13, 28, .7);
  border: 1px solid rgba(255, 255, 255, .17);
  color: #e6e9f4;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 3px;
  outline: none;
}
.dsg-row input:focus, .dsg-row select:focus, .dsg-row textarea:focus {
  border-color: rgba(143, 123, 255, .6);
}
.dsg-row textarea {
  height: 64px;
  resize: vertical;
  white-space: pre-wrap;
}
.dsg-row input[type="checkbox"] {
  accent-color: #8f7bff;
  width: 15px;
  height: 15px;
}
.dsg-hint {
  font-size: 11px;
  color: #98a1c2;
  line-height: 1.6;
  margin-top: 8px;
}

/* 角色列表 */
.dsg-char-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsg-char-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease;
}
.dsg-char-card:hover {
  border-color: rgba(143, 123, 255, .5);
  background: rgba(143, 123, 255, .06);
}
.dsg-char-card.is-active {
  border-color: #8f7bff;
  background: rgba(143, 123, 255, .14);
}
.dsg-char-avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, .2);
  background: rgba(143, 123, 255, .2);
}
.dsg-char-card-info {
  flex: 1;
  min-width: 0;
}
.dsg-char-card-name {
  font-size: 13px;
  font-weight: 600;
}
.dsg-char-card-desc {
  font-size: 11px;
  color: #98a1c2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsg-char-card-del {
  flex: none;
  border: 1px solid rgba(224, 90, 107, .4);
  background: transparent;
  color: #e05a6b;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
}
.dsg-char-card-del:hover {
  background: rgba(224, 90, 107, .15);
}

/* 角色编辑表单 */
.dsg-form label {
  display: block;
  font-size: 11px;
  color: #98a1c2;
  letter-spacing: .08em;
  margin: 10px 0 4px;
}
.dsg-form input[type="text"], .dsg-form textarea {
  width: 100%;
  background: rgba(10, 13, 28, .7);
  border: 1px solid rgba(255, 255, 255, .17);
  color: #e6e9f4;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 3px;
  outline: none;
  font-family: inherit;
}
.dsg-form textarea {
  height: 72px;
  resize: vertical;
  white-space: pre-wrap;
  line-height: 1.6;
}
.dsg-form input:focus, .dsg-form textarea:focus {
  border-color: rgba(143, 123, 255, .6);
}
.dsg-form-avatar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dsg-form-avatar img {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, .2);
  background: rgba(143, 123, 255, .2);
}
.dsg-form-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

/* ── 覆盖层提示 ── */
.dsg-overlay-note {
  position: fixed;
  right: 16px;
  bottom: 104px;
  z-index: 90;
  max-width: 320px;
  padding: 8px 12px;
  border: 1px solid rgba(143, 123, 255, .4);
  border-radius: 4px;
  background: rgba(13, 16, 32, .92);
  color: #e6e9f4;
  font-size: 12px;
  line-height: 1.6;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .4);
  animation: dsg-rise .18s cubic-bezier(.16, 1, .3, 1);
}

/* ── 界面切换浮动按钮（shadow 内，但根覆盖层可整体隐藏）── */
.dsg-view-toggle {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 15px;
  border: 1px solid rgba(143, 123, 255, .55);
  border-radius: 20px;
  background: rgba(13, 16, 32, .92);
  color: #e6e9f4;
  font-size: 12px;
  letter-spacing: .08em;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0, 0, 0, .5);
  backdrop-filter: blur(8px);
  transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}
.dsg-view-toggle:hover {
  border-color: #8f7bff;
  box-shadow: 0 6px 24px rgba(143, 123, 255, .4);
  transform: translateY(-1px);
}
.dsg-view-toggle .dsg-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8f7bff, #4f8cff);
  box-shadow: 0 0 8px rgba(143, 123, 255, .8);
}

/* ── 动画 ── */
@keyframes dsg-blink { 50% { opacity: 0; } }
@keyframes dsg-pulse { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
@keyframes dsg-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes dsg-slide-in { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes dsg-rise { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes dsg-thinking-blink { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@keyframes dsg-thinking-pulse { 0%, 100% { transform: scale(1); opacity: .6; } 50% { transform: scale(1.35); opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .dsg-char { animation: none; }
  .dsg-dialogue-caret { animation: none; }
}
`
