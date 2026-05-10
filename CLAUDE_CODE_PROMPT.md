# 给 Claude 的开发指令

你要为 `Morpheus` 项目编写前端代码。

## 目标
根据 `PRD.md` 和 `UI_SPEC_AESOP.md`，完成一个 **移动端优先** 的静态 Web App 原型，技术栈只能使用：
- HTML
- CSS
- Vanilla JavaScript

## 严格要求
1. 不要使用 React / Vue / Tailwind / Bootstrap / 任何 UI 框架
2. 不要偏离 Aesop 风格
3. 所有“历史”统一改成“故事集”
4. 先实现页面与交互状态，再保留 API 接口占位
5. 代码结构清晰，可继续扩展

## 需要完成的页面
1. 首页（记录）
2. 录音中
3. AI 解析中
4. 确认记录
5. 保存成功
6. 故事集
7. 故事详情
8. 设置
9. Google OAuth 弹层 / 流程占位
10. 异常状态卡片（录音不可用 / 网络失败 / AI 解析失败 / 保存失败）

## 推荐目录结构
```text
morpheus/
  index.html
  styles/
    reset.css
    tokens.css
    main.css
    components.css
    screens.css
  scripts/
    app.js
    state.js
    router.js
    mock-data.js
  assets/
    icons/
```

## UI 要求
- 390px mobile first
- 视觉参考：Aesop 风格
- 大量留白
- 暖米白背景
- 深棕黑主按钮
- 衬线品牌字 + 无衬线 UI 字体
- 非常克制的边框和状态色

## 交互要求
- 底部 tab：记录 / 故事集
- 点击录音按钮 → 切换到录音中
- 录音停止 → 进入 AI 解析中
- AI 完成 → 进入确认记录
- 保存成功 → 可进入故事集
- 故事集点击列表项 → 进入故事详情
- 设置页可显示 Google 绑定状态（先 mock）
- 支持若干 mock 梦境数据

## 输出要求
请直接输出完整文件代码，不要只给思路。
优先从以下文件开始：
1. `index.html`
2. `styles/tokens.css`
3. `styles/main.css`
4. `styles/components.css`
5. `styles/screens.css`
6. `scripts/mock-data.js`
7. `scripts/state.js`
8. `scripts/router.js`
9. `scripts/app.js`

并确保复制到本地后可以直接打开 `index.html` 查看。
