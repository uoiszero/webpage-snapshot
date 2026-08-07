# Webpage Snapshot

**[English](README_en.md)**

Chrome 插件（Manifest V3）：点击图标后，在页面上移动鼠标选择任意元素，确认后通过
**SVG foreignObject + Canvas 重绘**生成 PNG 图片并自动保存到本地「下载」文件夹。

## 工作原理

1. 点击工具栏图标 → 弹出启动面板，点击「开始选择元素」
2. 页面进入选择模式：鼠标 hover 时显示高亮边框，点击即选中元素，浮动工具条确认
3. 捕获过程（`content.js`）：
   - 深克隆所选元素，并把子树中所有元素的**计算样式内联**（宽度、颜色、字体、布局均为解析后的具体值）
   - 图片 / `background-image` 尽量转为 `data:` URL，避免外部资源加载失败导致缺图
   - 序列化为 `<svg><foreignObject>`，作为 `<img>` 加载
   - 按 `devicePixelRatio` 在 Canvas 上重绘，导出 PNG blob
4. 通过 background（`chrome.downloads`）保存为 `snapshot-<标签名>-<时间戳>.png`

## 两种图片格式

选中元素后，工具条上可选择：

- **默认**：按页面当前布局原样捕获（宽度与元素一致）
- **手机**：以手机视口渲染，自动适配窄屏与字体
  - 把元素放入 **375px 宽的隐藏 iframe** 重排，站点的响应式媒体查询真实生效，布局与字体按手机屏幕自动调整
  - 非响应式站点（重排后仍超宽）：流式重排到 375px——压掉固定宽度、
    保持文字原始字号自动换行；个别压不动的元素（表格/代码块等）再按比例微缩兜底
  - 输出为竖版长图，适合手机屏幕展示

手机格式保存的文件名为 `snapshot-<标签名>-mobile-<时间戳>.png`。

## 安装

1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录（`webpage-snapshot`）
4. 固定图标到工具栏即可使用

## 使用

1. 在目标网页点击扩展图标 → 「开始选择元素」
2. 移动鼠标选择元素（实时高亮），点击确认
3. 在浮动工具条中：
   - **保存（图标）** — 重绘并下载到「下载」文件夹
   - **复制（图标）** — 重绘并复制到剪贴板
   - **重新选择** — 返回选择模式
   - **✕** — 退出

快捷键：选择模式下按 `Esc` 取消。

## 文件结构

```
manifest.json   MV3 清单（downloads 权限 + content script 注入 + background worker）
background.js   background service worker（代理 chrome.downloads 执行下载）
i18n.js         语言文件（zh / en 词典 + 浏览器语言检测）
popup.html/css  扩展弹窗（启动选择）
popup.js        弹窗逻辑（向 content script 发送启动消息）
content.js      选择交互 + SVG/Canvas 捕获 + 下载（核心逻辑）
```

## 多语言

界面文案统一放在 `i18n.js` 语言文件中，加载时检测浏览器语言：
中文环境显示中文，其他语言显示英文。新增文案在词典中添加对应 key 即可。

## 已知限制

- **防盗链 / 无法访问的图片**：`<img>` 与 `background-image` 会先尝试直连，
  失败后经 background 借助 host 权限绕过 CORS 内联为 data URL；仍失败的
  （如 CDN 带 Referer 校验）会以透明占位显示，保证图片始终可正常导出。
- **字体**：截图依赖浏览器对 data URL SVG 中的字体栈解析，与页面渲染基本一致；
  个别 web font 可能存在细微差异。
- **超长元素**：Canvas 单边上限 16384px，超出时会自动降低输出分辨率以适配，
  不会导出失败；节点数超过 5000 时捕获会明显变慢，建议选择更小范围。
- **动态内容 / 表单控件**：`input`、`textarea`、`select`、`iframe` 等元素不会被渲染
  （会从克隆体中移除）；`video` 在原位置以虚线蓝框占位并提示「视频无法截图」；
  `canvas` 会被转为静态图片。
- 浏览器内置页面（`chrome://`、扩展商店）无法注入 content script，不能使用。
- 保存位置为系统默认「下载」文件夹；如需弹出「另存为」对话框，
  把 `background.js` 中 `saveAs: false` 改为 `true`。
