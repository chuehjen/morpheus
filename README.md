# Morpheus

一个安静的梦境记录 Web 应用。醒来后语音一键记录，AI 整理为结构化故事摘要，存入你自己的 Google Sheets。

> 视觉灵感：Aesop。技术取向：极简、纯静态、可在 GitHub Pages 上 0 成本运行。

## 设计文档

- [`PRD.md`](./PRD.md) — 产品需求
- [`UI_SPEC_AESOP.md`](./UI_SPEC_AESOP.md) — UI 视觉规范
- [`CLAUDE_CODE_PROMPT.md`](./CLAUDE_CODE_PROMPT.md) — 给 Claude 的开发指令

## 当前状态（v0.1）

已经完成的：

- 8 个核心页面 + 底部 tab + OAuth 引导弹层
- Aesop 风格视觉（暖米白、衬线品牌字、克制动效）
- 录音 → AI 解析 → 确认 → 保存全流程
- Web Speech API 语音识别（Chrome/Safari），不支持时降级为手动输入
- 故事集列表（搜索、空状态、详情页）
- 设置页（Google 绑定、重建表、关于）
- localStorage 缓存

尚未接入：

- 真实的 LLM API（当前用关键词启发式 mock 解析）
- 真实的 Google OAuth + Sheets API（点击「绑定 Google」会直接 mock 成已绑定）

## 本地预览

任意静态服务器都可以：

```bash
# Python 自带
python3 -m http.server 8080

# 或 node
npx serve .
```

然后访问 <http://localhost:8080>。

> 注意：`file://` 直接打开 `index.html` 时，Web Speech API 可能受限。建议用 http 服务。

## 目录结构

```
morpheus/
├── index.html
├── styles/
│   ├── reset.css
│   ├── tokens.css
│   ├── main.css
│   ├── components.css
│   └── screens.css
├── scripts/
│   ├── mock-data.js
│   ├── state.js
│   ├── router.js
│   └── app.js
├── .github/workflows/deploy.yml   # GitHub Pages 自动部署
├── PRD.md
├── UI_SPEC_AESOP.md
└── CLAUDE_CODE_PROMPT.md
```

## 部署到 GitHub Pages

仓库已经包含 `.github/workflows/deploy.yml`。第一次推上去后：

1. 进入仓库 Settings → Pages
2. 把 **Source** 改成 **GitHub Actions**
3. 之后每次 push 到 `main`，Actions 会自动部署
4. 部署成功后，地址通常是 `https://<你的用户名>.github.io/<仓库名>/`

## 路线图

- v0.2：接入 Cloudflare Worker + 真实 LLM
- v0.3：接入 Google OAuth + Sheets API
- v0.4：搜索增强、标签筛选、情绪趋势统计
- v0.5：导出 Markdown / PDF
-     trigger deploy
