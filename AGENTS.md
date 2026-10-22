# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-29
**Commit:** 56de885
**Branch:** main

> ## ⚠️ 工作语言：**中文**
>
> 本项目的工作语言为**中文**。代码注释、AGENTS 文档、提交信息、与用户/代理的沟通一律使用中文；
> 代码中的标识符、API 名、关键词等保持英文。i18n 词典是唯一允许存放非工作语言文案的地方（`zh` / `en` 两套）。

## OVERVIEW

Chrome 扩展（Manifest V3，无构建步骤）：在页面中选择任意元素，经 SVG foreignObject + Canvas 重绘为 PNG 并保存到本地。
核心为单文件 content script（1202 行），背景服务 worker 代理下载与跨域抓取，界面文案走统一 i18n 语言文件。

## STRUCTURE

```
webpage-snapshot/          # 全部文件位于根目录，无子目录
├── manifest.json          # MV3 清单：downloads 权限 + <all_urls> host + content_scripts
├── i18n.js                # 语言文件（zh/en 词典 + 浏览器语言检测），必须先于 content.js 加载
├── content.js             # 核心：选择交互 + SVG/Canvas 捕获 + 下载（1202 行）
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
| `renderToBlob(el, format)` | function | content.js | 统一入口：加载字体→节点数检查→按格式取渲染目标→`renderElementToBlob` |
| `captureAndDownload(el, format)` | function | content.js | 入口：默认/手机两格式分发，生成文件名并调用 `downloadBlob` |
| `setupMobileContext(el)` | function | content.js | 手机格式：iframe 重排 + 字体/图片等待 + 流式重排 + zoom 回退 |
| `renderElementToBlob(el, ctx)` | function | content.js | `buildSvg` → `renderCanvas` → `canvasToBlob` 的整条管线 |
| `buildSvg(el, ctx)` | function | content.js | 克隆+内联样式+剥离干扰+序列化 SVG foreignObject |
| `cloneElementWithStyles(el, ctx)` | function | content.js | 深克隆并把整棵子树内联计算样式写回 |
| `pairElements(srcRoot, dstRoot)` | function | content.js | 原树与克隆体按文档顺序配对（计算样式/资源内联共用） |
| `inlineCssUrls(ctx, src, dst, getProp, cssProp)` | function | content.js | background/mask 的 `url()` 转 data URL，`#id` 片段引用保留 |
| `settleWithin(promise, ms)` | function | content.js | 资源等待上限，超时按未就绪继续（防永久挂起） |
| `renderCanvas(image, w, h, ctx)` | function | content.js | Canvas 绘制，DPR 自适应（上限 16384） |
| `appendFooter(wrapper, el, ctx)` | function | content.js | 底部信息条：UTC 时间 + 页面链接，行高与 FOOTER_HEIGHT 严格对应 |
| `formatUtcTime()` | function | content.js | 当前 UTC 时间，格式 `YYYY-MM-DD HH:mm:ss UTC` |
| `resolvePageLink(el)` | function | content.js | 页面链接：weibo.com 取该条微博详情链接，其他站点用当前地址 |
| `findWeiboPostLink(el)` | function | content.js | 微博详情链接三形态匹配（旧版 node-type / 新版 /detail/ / 正则兜底） |
| `inlineResources(el, clone, ctx)` | function | content.js | 图片/背景转 data URL，失败换透明占位 |
| `stripUnwanted(root, ctx)` | function | content.js | 剔除 script/style/link/iframe/表单等，替换 video/canvas 为可渲染内容 |
| `makeVideoPlaceholder(video, ctx)` | function | content.js | video → 虚线蓝框占位 div，保持原尺寸与比例 |
| `collectExternalSvgRefs(clone)` | function | content.js | 收集克隆体内外部 `<svg>`/`<use>` 引用，供选区外资源补内（内部资源二次内联） |
| `copyAttributes(from, to)` | function | content.js | 拷贝全部属性到克隆对应节点 |
| `rewriteCssUrls(cssText)` | function | content.js | 样式表相对 `url()` 改写为绝对地址 |
| `absolutizeUrls(root)` | function | content.js | 元素相对资源（img/srcset 等）转绝对地址 |
| `injectReflowStyles(doc)` | function | content.js | 手机模式注入流式重排样式 |
| `waitForImages(doc)` | function | content.js | 等待 iframe 内字体与图片加载完成 |
| `fetchAsDataUrl(url)` | function | content.js | 直连失败→background 代理（绕过 CORS） |
| `window.wpsI18n.t(key, params)` | global | i18n.js | 文案获取，`{param}` 占位符 |

## CONVENTIONS

- **文案必须走 `wpsI18n.t()`**，禁止在 content.js / popup 中硬编码用户可见字符串
- 新增 i18n key 必须 zh 与 en **两个词典同步添加**，参数占位符（`{width}`/`{count}`/`{key}`）两边一致
- content script 与 background 通信统一 `chrome.runtime.sendMessage`，消息类型前缀 `WPS_`（`WPS_DOWNLOAD` / `WPS_FETCH_DATA_URL`）；popup 启动选择用 `chrome.tabs.sendMessage` 发送 `WPS_START_SELECT`（popup → content）
- 捕获管线必须通过 `ctx` 操作 DOM（`getComputedStyle`/`Image`/canvas/`XMLSerializer` 均从 ctx 取），不直接用全局
- 可调常量集中在 `content.js` 顶部：`MOBILE_WIDTH`(375)、`PADDING`(20)、`MAX_CANVAS_DIM`(16384)、`MAX_NODE_COUNT`(5000)、`FOOTER_HEIGHT`(53)、`TRANSPARENT_PIXEL`、`IFRAME_PROBE_HEIGHT`(2000)、`LAYOUT_SETTLE_MS`(200)、`RESOURCE_WAIT_MS`(5000)、`FETCH_TIMEOUT_MS`(15000)、`COPY_SUCCESS_HIDE_MS`(800)；`RESOURCE_WAIT_MS`/`FETCH_TIMEOUT_MS` 是资源等待/抓取上限，超时按资源缺失降级出图，避免捕获无限挂起
- 「保存」与「复制」成功后的收尾必须一致：都收起工具条。复制要先展示 `COPY_SUCCESS_HIDE_MS`（800ms）的「已复制到剪贴板」提示再隐藏；复制**失败**（激活窗口过期，需用户再点一次）时禁止隐藏，否则用户无法重试
- `appendFooter` 的信息条高度必须与 `FOOTER_HEIGHT` 严格一致，修改底部信息条布局时需同步更新该常量

## ANTI-PATTERNS (THIS PROJECT)

- **禁止在 content script 直接调用扩展 API**（`chrome.downloads` 等）——content script 中不可用，会抛 undefined 错误，必须经 background 代理
- **禁止对脱离文档的 clone 读 `getComputedStyle`**——返回空值，必须取原 DOM 树元素再写回 clone 对应节点
- **禁止把跨域图片原样留在克隆体里**——会污染画布导致 `toBlob` 导出失败，必须内联为 data URL，失败则换透明占位
- **禁止删除 `img` 的 `srcset` 却不内联 `src`**——srcset 优先于 src，会导致内联地址失效
- **禁止把半透明色当作透明像素使用**——`TRANSPARENT_PIXEL` 必须是真的 `rgba(0,0,0,0)`，否则图片区域会渲染成色块
- **禁止用整棵 document 快照代替元素快照**——`buildSvg` 的克隆体可能带有选区外的 SVG 引用/外部资源，需经 `collectExternalSvgRefs` 等补内
- **禁止在注释里遗漏 video 处理**——`stripUnwanted` 会把 `<video>` 换成占位 div，新增对媒体/表单类标签的处理时需同步到这里
- **禁止依赖词典中的字面量子串做 DOM 替换**（如匹配 `'Esc'`）——用 `{key}` 占位符
- **禁止注释/文档使用英文**（工作语言为中文）

## COMMANDS

```bash
node --check *.js            # 语法校验（i18n/background/popup/content）
# 无构建、无测试、无 lint 配置。安装/调试：chrome://extensions → 开发者模式 → 加载已解压的扩展程序
```

## NOTES

- content script 无 `chrome.downloads` 访问权；`chrome.i18n.getUILanguage()` 可用于语言检测
- content script 用 `window.__webpageSnapshotInjected` 做注入单例防护，重复注入直接 return
- 手机格式在 about:blank iframe 中重排，需把样式表相对 `url()` 与元素相对资源重写为绝对地址
- 画布单边上限受浏览器限制（Chrome 32767），代码内 `MAX_CANVAS_DIM` 留余量；超限时降低 DPR 而非失败
- 底部信息条追加在克隆体之后、不参与布局；`buildSvg` 强制根元素 `box-sizing: border-box` 并清除 `margin`/`min`/`max`，避免边框盒超出 SVG 视口把第二行链接裁掉
- 复制缓存按「元素对象身份 + 格式」命中，重选/取消时清空；不能用元素字符串（所有 div 都是 `[object HTMLDivElement]`）
- 选区外 SVG 定义由 `collectExternalSvgRefs` 克隆进克隆体后，必须再对其执行 `inlineResources`，否则 def 内的外部 `<image>`/背景图不会内联
- `Esc` 在选择态与工具条态都生效：`keydown` 监听在 `startSelection` 注册、`cleanupAll` 移除，`cleanupSelection` 只清选择态监听
- 微博图片 URL 带一次性签名参数 `ssig`（加载后失效），`inlineResources` 会剥离该参数后重试
- 防盗链用的 DNR Referer 会话规则**不能**加 `condition.tabIds`：抓取由扩展 service worker 发起，这类请求不关联任何标签页，带 `tabIds` 的规则永不命中，Referer 不会被改写，sinaimg 返回 403，微博配图在截图里全部变成透明占位；影响面靠「精确到单条 URL 的 `regexFilter` + 抓取结束立即移除」收敛
- 超长元素（>5000 节点）捕获会明显变慢，超限仅告警不中止
- `saveAs: false` 选项在 `background.js` 的 downloads 调用处
