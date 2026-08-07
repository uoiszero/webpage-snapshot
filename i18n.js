/**
 * Webpage Snapshot - 语言文件
 *
 * 加载时检测浏览器语言：中文（zh*）→ zh，其他 → en。
 * 通过 window.wpsI18n.t(key, params) 获取文案，{param} 为占位符。
 * 由 manifest 的 content_scripts 与 popup 页面共同引入。
 */
(function () {
  const messages = {
    zh: {
      title: '网页快照',
      description: '在页面上选择任意元素，保存为图片。',
      startSelect: '开始选择元素',
      tipFormats: '支持默认、手机两种格式',
      tipEsc: '选中后按 {key} 可取消',
      tipDownload: '图片自动保存到「下载」文件夹',
      popupError:
        '无法在此页面使用（浏览器内置页面如 chrome:// 或扩展商店页面不支持）。请在有内容的网页上重试。',
      hintText: '🖱 移动鼠标选择元素 · 点击选中 · Esc 取消',
      save: '保存',
      copy: '复制到剪贴板',
      copying: '正在生成图片…',
      copied: '已复制到剪贴板',
      copyFailed: '复制失败：',
      copyUnsupported: '当前页面不支持复制图片到剪贴板',
      copyRetry: '图片已就绪，请再次点击复制',
      reselect: '重新选择',
      cancel: '取消',
      fmtDefaultTitle: '默认格式：按页面原样捕获',
      fmtMobileTitle: '手机格式：以 {width}px 手机视口渲染',
      ariaFmtDefault: '默认格式',
      ariaFmtMobile: '手机格式',
      formatGroupLabel: '图片格式',
      selectedPrefix: '已选择：',
      mobileSuffix: ' · 手机 {width}px',
      saving: '正在重绘并保存…',
      saveFailed: '保存失败：',
      nodeWarn: '[Webpage Snapshot] 元素包含 {count} 个节点，捕获可能较慢。',
      errZeroSize: '元素尺寸为 0，无法捕获',
      errIframe: '无法创建手机预览环境',
      errSvgLoad: 'SVG 图像加载失败',
      errCanvasPng: 'Canvas 转 PNG 失败',
      errExport: '无法导出 PNG，部分图片可能受跨域限制或元素尺寸过大',
      errSizeTooLarge: '尺寸过大',
      errResourceLoad: '资源加载失败',
      errDownload: '下载失败',
      videoPlaceholder: '视频无法截图',
    },
    en: {
      title: 'Webpage Snapshot',
      description: 'Select any element on the page and save it as an image.',
      startSelect: 'Start Selecting',
      tipFormats: 'Default & mobile formats',
      tipEsc: 'Press the {key} key to cancel',
      tipDownload: 'Images are saved to the "Downloads" folder',
      popupError:
        'Cannot use on this page (browser built-in pages like chrome:// or the Web Store are not supported). Try again on a regular webpage.',
      hintText: '🖱 Hover to select an element · Click to confirm · Esc to cancel',
      save: 'Save',
      copy: 'Copy to clipboard',
      copying: 'Rendering image…',
      copied: 'Copied to clipboard',
      copyFailed: 'Copy failed: ',
      copyUnsupported: 'This page does not support copying images to the clipboard',
      copyRetry: 'Image ready, click copy again',
      reselect: 'Reselect',
      cancel: 'Cancel',
      fmtDefaultTitle: 'Default format: capture the element as-is',
      fmtMobileTitle: 'Mobile format: render at {width}px mobile viewport',
      ariaFmtDefault: 'Default format',
      ariaFmtMobile: 'Mobile format',
      formatGroupLabel: 'Image format',
      selectedPrefix: 'Selected: ',
      mobileSuffix: ' · Mobile {width}px',
      saving: 'Rendering and saving…',
      saveFailed: 'Save failed: ',
      nodeWarn: '[Webpage Snapshot] Element contains {count} nodes, capture may be slow.',
      errZeroSize: 'Element has zero size, cannot capture',
      errIframe: 'Failed to create mobile preview environment',
      errSvgLoad: 'Failed to load SVG image',
      errCanvasPng: 'Failed to convert canvas to PNG',
      errExport: 'Failed to export PNG. Some images may be CORS-restricted or the element is too large',
      errSizeTooLarge: 'element too large',
      errResourceLoad: 'Failed to load resource',
      errDownload: 'Download failed',
      videoPlaceholder: 'Video cannot be captured',
    },
  };

  const raw = (
    typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage
      ? chrome.i18n.getUILanguage()
      : navigator.language || 'en'
  ).toLowerCase();
  const lang = raw.startsWith('zh') ? 'zh' : 'en';
  const dict = messages[lang];

  function t(key, params) {
    let s = dict[key];
    if (s === undefined) s = messages.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.split('{' + k + '}').join(String(v));
      }
    }
    return s;
  }

  window.wpsI18n = { lang, t };
})();
