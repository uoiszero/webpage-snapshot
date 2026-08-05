# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-05
**Commit:** 932a7ee
**Branch:** main

> ## ⚠️ 工作语言：**中文**
>
> 本项目的工作语言为**中文**。代码注释、AGENTS 文档、提交信息、与用户/代理的沟通一律使用中文；
> 代码中的标识符、API 名、关键词等保持英文。i18n 词典是唯一允许存放非工作语言文案的地方（`zh` / `en` 两套）。

## OVERVIEW

Chrome 扩展（Manifest V3，无构建步骤）：在页面中选择任意元素，经 SVG foreignObject + Canvas 重绘为 PNG 并保存到本地。
核心为单文件 content script（747 行），背景服务 worker 代理下载与跨域抓取，界面文案走统一 i18n 语言文件。

## STRUCTURE

```
webpage-snapshot/          # 全部文件位于根目录，无子目录
├── manifest.json          # MV3 清单：downloads 权限 + <all_urls> host + content_scripts
├── i18n.js                # 语言文件（zh/en 词典 + 浏览器语言检测），必须先于 content.js 加载
├── content.js             # 核心：选择交互 + SVG/Canvas 捕获 + 下载（747 行）
├── background.js          # service worker：代理 chrome.downloads 与 CORS 绕过抓取
├── popup.html/.css/.js    # 扩展弹窗（启动选择）
└── README.md / README_en.md
```

## WHERE TO LOOK

| 任务 | 位置 | 说明 |
|------|------|------|
| 修改选择交互 / 工具条 UI | `content.js` 顶部 UI 区 + 选择状态机 | hover 高亮、浮动工具条 |
| 修改捕获/重绘管线 | `content.js` 捕获区 | makeContext / buildSvg / renderCanvas |
| 手机格式重排 | `content.js` 的 `setupMobileContext` | 375px 隐藏 iframe + zoom 回退 |
| 下载/跨域抓取代理 | `background.js` | WPS_DOWNLOAD / WPS_FETCH_DATA_URL |
| 新增/修改界面文案 | `i18n.js` | 必须 zh 与 en 两个词典同步加 key |
| 权限/清单调整 | `manifest.json` | content_scripts 顺序：i18n.js 在 content.js 前 |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `makeContext(win)` | function | content.js | 捕获上下文，把 DOM 操作作用到指定窗口（iframe 必需） |
| `captureAndDownload(el, format)` | function | content.js | 入口：默认/手机两格式分发 |
| `setupMobileContext(el)` | function | content.js | 手机格式：iframe 重排 + 行高/缩放适配 |
| `buildSvg(el, ctx)` | function | content.js | 克隆+内联样式+序列化 SVG foreignObject |
| `renderCanvas(image, w, h, ctx)` | function | content.js | Canvas 绘制，DPR 自适应（上限 16384） |
| `inlineResources(el, clone, ctx)` | function | content.js | 图片/背景转 data URL，失败换透明占位 |
| `fetchAsDataUrl(url)` | function | content.js | 直连失败→background 代理（绕过 CORS） |
| `window.wpsI18n.t(key, params)` | global | i18n.js | 文案获取，`{param}` 占位符 |

## CONVENTIONS

- **文案必须走 `wpsI18n.t()`**，禁止在 content.js / popup 中硬编码用户可见字符串
- 新增 i18n key 必须 zh 与 en **两个词典同步添加**，参数占位符（`{width}`/`{count}`/`{key}`）两边一致
- content script 与 background 通信统一 `chrome.runtime.sendMessage`，消息类型前缀 `WPS_`（`WPS_START_SELECT` / `WPS_DOWNLOAD` / `WPS_FETCH_DATA_URL`）
- 捕获管线必须通过 `ctx` 操作 DOM（`getComputedStyle`/`Image`/canvas/`XMLSerializer` 均从 ctx 取），不直接用全局
- 可调常量集中在 `content.js` 顶部：`MOBILE_WIDTH`(375)、`PADDING`(20)、`MAX_CANVAS_DIM`(16384)、`MAX_NODE_COUNT`(5000)

## ANTI-PATTERNS (THIS PROJECT)

- **禁止在 content script 直接调用扩展 API**（`chrome.downloads` 等）——content script 中不可用，会抛 undefined 错误，必须经 background 代理
- **禁止对脱离文档的 clone 读 `getComputedStyle`**——返回空值，必须取原 DOM 树元素再写回 clone 对应节点
- **禁止把跨域图片原样留在克隆体里**——会污染画布导致 `toBlob` 导出失败，必须内联为 data URL，失败则换透明占位
- **禁止删除 `img` 的 `srcset` 却不内联 `src`**——srcset 优先于 src，会导致内联地址失效
- **禁止依赖词典中的字面量子串做 DOM 替换**（如匹配 `'Esc'`）——用 `{key}` 占位符
- **禁止注释/文档使用英文**（工作语言为中文）

## COMMANDS

```bash
node --check *.js            # 语法校验（i18n/background/popup/content）
# 无构建、无测试、无 lint 配置。安装/调试：chrome://extensions → 开发者模式 → 加载已解压的扩展程序
```

## NOTES

- content script 无 `chrome.downloads` 访问权；`chrome.i18n.getUILanguage()` 可用于语言检测
- 手机格式在 about:blank iframe 中重排，需把样式表相对 `url()` 与元素相对资源重写为绝对地址
- 画布单边上限受浏览器限制（Chrome 32767），代码内 `MAX_CANVAS_DIM` 留余量；超限时降低 DPR 而非失败
- 超长元素（>5000 节点）捕获会明显变慢
- `saveAs: false` 选项在 `background.js` 的 downloads 调用处
