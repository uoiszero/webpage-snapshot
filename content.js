/**
 * Webpage Snapshot - content script
 *
 * 流程：
 *   1. popup 发送 WPS_START_SELECT 消息 → 进入选择模式
 *   2. 页面内 hover 高亮，点击选中元素，浮动工具条确认
 *   3. 捕获：深克隆元素 + 内联计算样式 + 图片转 dataURL
 *      → SVG foreignObject → Canvas 重绘 → PNG blob
 *      → 底部追加截图时间与页面链接信息条（weibo.com 取该条微博详情链接）
 *   4. 交由 background（chrome.downloads）保存到本地
 *
 * 格式：
 *   - 默认：按页面当前布局原样捕获
 *   - 手机：把元素放入 375px 宽的隐藏 iframe，以手机视口重排
 *     （站点媒体查询生效，布局与字体自动适配手机），非响应式站点
 *     则按比例缩放到手机宽度
 */
(() => {
  if (window.__webpageSnapshotInjected) return;
  window.__webpageSnapshotInjected = true;

  const t = (window.wpsI18n && window.wpsI18n.t) || ((key) => key);

  const Z_TOP = 2147483647;
  const HINT_TEXT = t('hintText');
  const MOBILE_WIDTH = 375;
  const PADDING = 20; // 截图四周留白（px）
  // 底部信息条高度（px）= 1 分隔线 + 上下各 6 内边距 + 两行各 20 行框。
  // 必须与 appendFooter 里各行的 height/line-height 硬编码值保持一致，
  // 高度整数锁定、零隐式计算，避免任何渲染偏差导致第二行被裁切。
  const FOOTER_HEIGHT = 53;
  const MAX_NODE_COUNT = 5000;
  const MAX_CANVAS_DIM = 16384; // Chrome 单边 32767，留余量
  // 手机格式：隐藏 iframe 的探测高度，以及重排后等待布局稳定的时间
  const IFRAME_PROBE_HEIGHT = 2000;
  const LAYOUT_SETTLE_MS = 200;
  // 资源等待与抓取上限：超时按「资源缺失」降级出图，避免捕获无限挂起
  const RESOURCE_WAIT_MS = 5000;
  const FETCH_TIMEOUT_MS = 15000;
  // 复制成功后「已复制」提示的停留时长，随后收起工具条（与保存成功后一致）
  const COPY_SUCCESS_HIDE_MS = 800;
  // 无法内联的资源（跨域/防盗链）换成透明像素，避免污染画布导致导出失败。
  // 注意：必须保证是真正的透明像素 rgba(0,0,0,0) —— 此前误用了一个
  // 半透明蓝（rgba(0,0,255,127)）的 1x1 PNG，导致图片区域渲染成淡蓝色色块。
  const TRANSPARENT_PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  /* ---------------- UI ---------------- */

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .wps-overlay {
      position: fixed;
      pointer-events: none;
      z-index: ${Z_TOP};
      box-sizing: border-box;
      border: 2px dashed #00bcd4;
      background: rgba(0, 188, 212, 0.15);
      border-radius: 2px;
      display: none;
      transition: left 0.05s, top 0.05s, width 0.05s, height 0.05s;
    }
    .wps-hint {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: ${Z_TOP};
      background: rgba(17, 24, 39, 0.85);
      color: #fff;
      font: 13px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      padding: 8px 16px;
      border-radius: 20px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
      white-space: nowrap;
      display: none;
      pointer-events: none;
    }
    .wps-toolbar {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: ${Z_TOP};
      background: #fff;
      color: #1f2937;
      font: 13px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid #e5e7eb;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
      display: none;
      align-items: center;
      gap: 8px;
      max-width: min(92vw, 680px);
    }
    .wps-toolbar .wps-info {
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #6b7280;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .wps-toolbar button {
      font: 13px/1 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      border: none;
      border-radius: 6px;
      padding: 7px 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .wps-save { background: #0ea5e9; color: #fff; }
    .wps-save:hover { background: #0284c7; }
    .wps-save:disabled { background: #94a3b8; cursor: default; }
    .wps-toolbar .wps-save, .wps-toolbar .wps-copy {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 7px 9px;
    }
    .wps-copy { background: #e5e7eb; color: #1f2937; }
    .wps-copy:hover { background: #d1d5db; }
    .wps-copy:disabled { background: #d1d5db; cursor: default; }
    .wps-reselect { background: #e5e7eb; color: #1f2937; }
    .wps-reselect:hover { background: #d1d5db; }
    .wps-cancel { background: transparent; color: #ef4444; padding: 7px 8px; }
    .wps-cancel:hover { background: #fee2e2; }
    .wps-format {
      display: flex;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      overflow: hidden;
      flex-shrink: 0;
    }
    .wps-format button {
      border-radius: 0;
      background: #fff;
      color: #6b7280;
      padding: 5px 7px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .wps-format button:hover { background: #f3f4f6; }
    .wps-format button.active { background: #e0f2fe; color: #0369a1; }
  `;
  (document.head || document.documentElement).appendChild(styleEl);

  let overlay = null;
  let hint = null;
  let toolbar = null;
  let hoverEl = null;
  let selectedEl = null;
  let selecting = false;
  let saveFormat = 'mobile';

  function ensureUi() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'wps-overlay';

    hint = document.createElement('div');
    hint.className = 'wps-hint';
    hint.textContent = HINT_TEXT;

    toolbar = document.createElement('div');
    toolbar.className = 'wps-toolbar';
    toolbar.innerHTML = `
      <span class="wps-info"></span>
      <div class="wps-format" role="group" aria-label="${t('formatGroupLabel')}">
        <button class="wps-fmt" data-format="default" title="${t('fmtDefaultTitle')}" aria-label="${t('ariaFmtDefault')}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </button>
        <button class="wps-fmt active" data-format="mobile" title="${t('fmtMobileTitle', { width: MOBILE_WIDTH })}" aria-label="${t('ariaFmtMobile')}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
        </button>
      </div>
      <button class="wps-save" title="${t('save')}" aria-label="${t('save')}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      </button>
      <button class="wps-copy" title="${t('copy')}" aria-label="${t('copy')}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>
      </button>
      <button class="wps-reselect">${t('reselect')}</button>
      <button class="wps-cancel" title="${t('cancel')}">✕</button>`;
    toolbar.querySelector('.wps-save').addEventListener('click', onSave);
    toolbar.querySelector('.wps-copy').addEventListener('click', onCopy);
    toolbar
      .querySelector('.wps-reselect')
      .addEventListener('click', () => {
        cleanupSelection();
        startSelection();
      });
    toolbar.querySelector('.wps-cancel').addEventListener('click', cleanupAll);
    toolbar.querySelectorAll('.wps-fmt').forEach((btn) => {
      btn.addEventListener('click', () => setFormat(btn.dataset.format));
    });

    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(hint);
    document.documentElement.appendChild(toolbar);
  }

  /* ---------------- 选择状态机 ---------------- */

  function startSelection() {
    ensureUi();
    cleanupSelection();
    selecting = true;
    overlay.style.display = 'none';
    hint.style.display = 'block';
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mousedown', onMouseDownCapture, true);
    document.addEventListener('click', onSelectClick, true);
    // Esc 在选择态与工具条态都要生效：监听挂在选择入口，cleanupAll 统一移除；
    // 先 remove 再 add 保证重复进入选择时不会堆叠。
    document.removeEventListener('keydown', onKeyDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function cleanupSelection() {
    selecting = false;
    hoverEl = null;
    selectedEl = null;
    copyCache = null;
    if (overlay) overlay.style.display = 'none';
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onMouseDownCapture, true);
    document.removeEventListener('click', onSelectClick, true);
  }

  function cleanupAll() {
    cleanupSelection();
    document.removeEventListener('keydown', onKeyDown, true);
    if (hint) hint.style.display = 'none';
    hideToolbar();
  }

  function onMouseMove(e) {
    if (!selecting) return;
    const el = e.target;
    // 忽略我们自己的 UI 元素
    if (el === overlay || el === hint || el === toolbar || el.closest?.('.wps-toolbar')) return;
    hoverEl = el;
    const r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  function onMouseDownCapture(e) {
    if (!selecting) return;
    // 阻止页面自身处理点击，避免误触发链接/按钮
    e.stopPropagation();
    e.preventDefault();
  }

  function onSelectClick(e) {
    if (!selecting) return;
    e.stopPropagation();
    e.preventDefault();
    if (!hoverEl) return;
    const el = hoverEl;
    cleanupSelection(); // 内部会清空 selectedEl
    selectedEl = el;
    hint.style.display = 'none';
    overlay.style.display = 'none';
    showToolbar(selectedEl);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') cleanupAll();
  }

  function describeElement(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim() : '';
    if (cls) s += '.' + cls.split(/\s+/).filter(Boolean).join('.');
    return s;
  }

  // 统一的格式切换：更新 saveFormat、按钮选中态与工具条信息
  function setFormat(format) {
    saveFormat = format;
    toolbar
      .querySelectorAll('.wps-fmt')
      .forEach((b) => b.classList.toggle('active', b.dataset.format === format));
    refreshToolbarInfo();
  }

  function showToolbar(el) {
    setFormat('mobile');
    toolbar.querySelector('.wps-save').disabled = false;
    toolbar.style.display = 'flex';
  }

  function refreshToolbarInfo() {
    if (!selectedEl) return;
    const info = toolbar.querySelector('.wps-info');
    const fmt = saveFormat === 'mobile' ? t('mobileSuffix', { width: MOBILE_WIDTH }) : '';
    info.textContent = t('selectedPrefix') + describeElement(selectedEl) + fmt;
    // 复位颜色：报错时 setToolbarMessage 会把文字置红，恢复正常文案时需还原
    info.style.color = '#6b7280';
  }

  function hideToolbar() {
    if (toolbar) toolbar.style.display = 'none';
  }

  function setToolbarMessage(text, isError = false) {
    const info = toolbar.querySelector('.wps-info');
    info.textContent = text;
    info.style.color = isError ? '#dc2626' : '#6b7280';
  }

  /* ---------------- 捕获上下文 ---------------- */

  /**
   * 捕获管线需要读取计算样式、创建 Image/canvas 等 DOM 能力。
   * 手机格式在独立 iframe 中重排，这些操作必须作用到 iframe 自己的
   * window/document 上（对主页面 getComputedStyle 获取 iframe 元素会返回空值）。
   */
  function makeContext(win) {
    const doc = win.document;
    return {
      win,
      doc,
      getComputedStyle: win.getComputedStyle.bind(win),
      createImage() {
        return new win.Image();
      },
      createCanvas() {
        return doc.createElement('canvas');
      },
      createElementNS(ns, name) {
        return doc.createElementNS(ns, name);
      },
      serialize(node) {
        return new win.XMLSerializer().serializeToString(node);
      },
    };
  }

  const pageCtx = makeContext(window);

  /* ---------------- 捕获与下载 ---------------- */

  async function onSave() {
    if (!selectedEl) return;
    const saveBtn = toolbar.querySelector('.wps-save');
    saveBtn.disabled = true;
    setToolbarMessage(t('saving'));
    try {
      await captureAndDownload(selectedEl, saveFormat);
      hideToolbar();
    } catch (err) {
      setToolbarMessage(t('saveFailed') + err.message, true);
      saveBtn.disabled = false;
    }
  }

  // 剪贴板能力判断（非安全上下文等环境不支持，重试也不会成功）
  function supportsClipboard() {
    return !!navigator.clipboard && typeof window.ClipboardItem !== 'undefined';
  }

  // 剪贴板 API 需安全上下文且页面聚焦；点击按钮本身就是用户手势，满足要求
  function copyBlobToClipboard(blob) {
    if (!supportsClipboard()) {
      throw new Error(t('copyUnsupported'));
    }
    return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
  }

  // 渲染可能耗时较长（图片逐个抓取），clipboard.write 的瞬态用户激活窗口
  // （Chrome 约 5 秒）会过期导致写入被拒；失败时缓存已渲染的 blob，
  // 提示用户再次点击——第二次点击处于新的激活窗口内，可直接写入。
  // 缓存键必须是元素对象本身：把 DOM 元素拼成字符串会让所有 <div> 共用
  // [object HTMLDivElement]，重选后误命中上一元素的图。
  let copyCache = null; // { el, format, blob }
  // 复制轮次：成功后的延时收起只在「没有更新一轮复制」时生效，
  // 避免上一轮的计时器把下一轮正在展示的「正在生成图片…」工具条收掉
  let copyOpSeq = 0;

  async function onCopy() {
    if (!selectedEl) return;
    const copyBtn = toolbar.querySelector('.wps-copy');
    copyBtn.disabled = true;
    const opSeq = ++copyOpSeq;
    setToolbarMessage(t('copying'));
    try {
      // 命中缓存（同一元素、同一格式）则跳过渲染，立即写入以利用本次点击的激活窗口
      const hit = copyCache && copyCache.el === selectedEl && copyCache.format === saveFormat;
      const blob = hit ? copyCache.blob : await renderToBlob(selectedEl, saveFormat);
      try {
        await copyBlobToClipboard(blob);
        copyCache = null;
        setToolbarMessage(t('copied'));
        // 复制成功后与保存一致收起工具条：先短暂展示「已复制」给用户反馈，
        // 再自动隐藏（此前一直不隐藏，只能按 Esc 手动退出）。
        // 失败路径（激活窗口过期）必须保留工具条供再次点击，故不在这里处理。
        setTimeout(() => {
          const info = toolbar.querySelector('.wps-info');
          if (opSeq === copyOpSeq && info.textContent === t('copied')) hideToolbar();
        }, COPY_SUCCESS_HIDE_MS);
      } catch (err) {
        if (!supportsClipboard()) {
          // 环境不支持剪贴板（非安全上下文等），重试也不会成功
          setToolbarMessage(t('copyFailed') + t('copyUnsupported'), true);
        } else {
          // 写入失败（多为激活窗口过期）：缓存已渲染的图片，提示再次点击
          copyCache = { el: selectedEl, format: saveFormat, blob };
          setToolbarMessage(t('copyRetry'));
        }
      }
    } catch (err) {
      setToolbarMessage(t('copyFailed') + err.message, true);
    } finally {
      copyBtn.disabled = false;
    }
  }

  // 渲染所选元素为 PNG blob（保存与复制共用）
  async function renderToBlob(el, format) {
    const nodeCount = el.querySelectorAll('*').length + 1;
    if (nodeCount > MAX_NODE_COUNT) {
      console.warn(t('nodeWarn', { count: nodeCount }));
    }

    let renderTarget;
    if (format === 'mobile') {
      renderTarget = await setupMobileContext(el);
    } else {
      renderTarget = { element: el, ctx: pageCtx, iframe: null };
    }

    try {
      // 字体必须从捕获上下文取：手机格式下是 iframe 的 document
      await settleWithin(renderTarget.ctx.doc.fonts.ready, RESOURCE_WAIT_MS);
      const { blob, width, height } = await renderElementToBlob(renderTarget.element, renderTarget.ctx);
      if (width <= 0 || height <= 0) {
        throw new Error(t('errZeroSize'));
      }
      return blob;
    } finally {
      renderTarget.iframe?.remove();
    }
  }

  async function captureAndDownload(el, format) {
    const blob = await renderToBlob(el, format);
    const suffix = format === 'mobile' ? 'mobile-' : '';
    const filename = `snapshot-${el.tagName.toLowerCase()}-${suffix}${Date.now()}.png`;
    return downloadBlob(blob, filename);
  }

  /**
   * 手机格式：把元素放进 375px 宽的隐藏 iframe 重排。
   *  - 复制页面全部样式（含内联 <style>，其相对 url 一并转为绝对）
   *  - 元素的相对路径资源（img/srcset）转为绝对地址
   *  - 等待 iframe 内字体与图片加载完成
   *  - 若重排后仍超宽（固定宽度布局）：注入 max-width 样式流式重排，
   *    保持文字字号；个别压不动的元素再用 zoom 等比缩放兜底
   */
  async function setupMobileContext(el) {
    const iframe = document.createElement('iframe');
    iframe.style.cssText =
      `position:fixed;top:0;left:-10000px;width:${MOBILE_WIDTH}px;height:${IFRAME_PROBE_HEIGHT}px;border:0;visibility:hidden;`;
    document.documentElement.appendChild(iframe);

    try {
      const iDoc = iframe.contentDocument;
      const iWin = iframe.contentWindow;
      if (!iDoc || !iWin) throw new Error(t('errIframe'));

      // 先拷贝页面属性再写重排前提：copyAttributes 会用页面 style 属性整体覆盖，
      // 顺序反了会把下面设置的 375px 宽度与零 margin 冲掉。
      copyAttributes(document.documentElement, iDoc.documentElement);
      copyAttributes(document.body, iDoc.body);
      iDoc.body.style.margin = '0';
      iDoc.body.style.width = MOBILE_WIDTH + 'px';

      const pendingLinks = [];
      for (const s of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        if (s.tagName === 'STYLE') {
          const st = iDoc.createElement('style');
          st.textContent = rewriteCssUrls(s.textContent);
          iDoc.head.appendChild(st);
        } else {
          const link = iDoc.createElement('link');
          link.rel = 'stylesheet';
          // 先挂 load/error 监听再设 href，避免缓存命中时错过 load 事件
          pendingLinks.push(waitForStylesheet(link));
          link.href = s.href;
          iDoc.head.appendChild(link);
        }
      }

      const clone = el.cloneNode(true);
      absolutizeUrls(clone);
      iDoc.body.appendChild(clone);

      // 等待样式表生效、字体与图片加载：三者都带超时，慢资源不会永久卡住捕获
      await new Promise((r) => setTimeout(r, LAYOUT_SETTLE_MS));
      await Promise.all([
        waitForStylesheets(pendingLinks),
        settleWithin(iWin.document.fonts.ready, RESOURCE_WAIT_MS),
        waitForImages(iDoc),
      ]);

      let captureTarget = clone;
      const layoutWidth = clone.getBoundingClientRect().width;
      if (layoutWidth > MOBILE_WIDTH) {
        // 非响应式站点（固定宽度布局）：优先流式重排——用 max-width 压掉固定
        // 宽度、保持文字原始字号，让内容在 375px 内自然换行，避免整页等比
        // 缩放导致文字小到看不清。
        clone.classList.add('wps-reflow');
        injectReflowStyles(iDoc);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        // 兜底：表格/代码块等 max-width 压不动的元素重排后仍超宽，此时剩余
        // 超宽比例通常很小，再等比缩放防截断。zoom 元素的 offsetWidth 语义
        // 不可靠，故外包一个固定宽度容器，捕获容器而非缩放元素本身。
        const reflowedWidth = clone.getBoundingClientRect().width;
        if (reflowedWidth > MOBILE_WIDTH) {
          const wrapper = iDoc.createElement('div');
          wrapper.style.width = MOBILE_WIDTH + 'px';
          clone.style.zoom = String(MOBILE_WIDTH / reflowedWidth);
          wrapper.appendChild(clone);
          iDoc.body.appendChild(wrapper);
          captureTarget = wrapper;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
      }

      return { element: captureTarget, ctx: makeContext(iWin), iframe };
    } catch (err) {
      // 任何一步失败都要移除 iframe：renderToBlob 的 finally 拿不到未返回的 target
      iframe.remove();
      throw err;
    }
  }

  function copyAttributes(from, to) {
    for (const a of from.attributes) {
      to.setAttribute(a.name, a.value);
    }
  }

  function rewriteCssUrls(cssText) {
    return cssText.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (match, raw) => {
      const u = raw.trim();
      // 片段引用（#id）必须原样保留：它是同文档内的 SVG 定义引用，
      // 绝对化成页面 URL 后会解析不到，抓取也只会拿回页面 HTML
      if (/^(data:|https?:|#)/i.test(u)) return match;
      return `url("${new URL(u, location.href).href}")`;
    });
  }

  function absolutizeUrls(root) {
    root.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src');
      if (src && !/^(data:|https?:)/i.test(src)) {
        img.setAttribute('src', new URL(src, location.href).href);
      }
      const srcset = img.getAttribute('srcset');
      if (srcset && !srcset.includes('data:')) {
        const next = srcset
          .split(',')
          .map((candidate) => {
            const [urlPart, ...rest] = candidate.trim().split(/\s+/);
            const abs = /^(data:|https?:)/i.test(urlPart) ? urlPart : new URL(urlPart, location.href).href;
            return [abs, ...rest].join(' ');
          })
          .join(', ');
        img.setAttribute('srcset', next);
      }
    });
    const withStyleUrl = [root, ...root.querySelectorAll('[style*="url("]')];
    for (const n of withStyleUrl) {
      const style = n.getAttribute('style');
      if (style && style.includes('url(')) n.setAttribute('style', rewriteCssUrls(style));
    }
  }

  function injectReflowStyles(doc) {
    const style = doc.createElement('style');
    style.textContent = [
      '.wps-reflow { width: auto !important; max-width: ' + MOBILE_WIDTH + 'px !important;' +
        ' box-sizing: border-box !important; margin-left: 0 !important; margin-right: 0 !important; }',
      '.wps-reflow img, .wps-reflow video, .wps-reflow iframe, .wps-reflow svg, .wps-reflow canvas, .wps-reflow table { max-width: 100% !important; }',
      '.wps-reflow img, .wps-reflow video { height: auto !important; }',
      '.wps-reflow * { max-width: 100%; }',
    ].join('\n');
    doc.head.appendChild(style);
  }

  /** 最多等待 ms 毫秒：超时后按「资源未就绪」继续，不让捕获无限挂起 */
  function settleWithin(promise, ms) {
    return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
  }

  /** loadImage 这类无图就无法继续的等待：超时按失败处理 */
  function rejectAfter(promise, ms, error) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(error), ms)),
    ]);
  }

  /** 等待单个样式表加载完成（onload / onerror 都算完成） */
  function waitForStylesheet(link) {
    return new Promise((resolve) => {
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
    });
  }

  /** 等待一批样式表加载完成，整体受 RESOURCE_WAIT_MS 限制 */
  function waitForStylesheets(promises) {
    return settleWithin(Promise.all(promises), RESOURCE_WAIT_MS);
  }

  function waitForImages(doc) {
    const imgs = Array.from(doc.images);
    const allLoaded = Promise.all(
      imgs.map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((r) => {
                img.addEventListener('load', r, { once: true });
                img.addEventListener('error', r, { once: true });
              })
      )
    );
    // 懒加载/悬挂图片可能既不 load 也不 error，必须有超时兜底
    return settleWithin(allLoaded, RESOURCE_WAIT_MS);
  }

  /**
   * 核心重绘：克隆元素并内联计算样式 → 资源转 dataURL → SVG foreignObject
   * → Canvas 按 devicePixelRatio 绘制 → PNG blob
   */
  async function renderElementToBlob(el, ctx) {
    const { svgString, width, height } = await buildSvg(el, ctx);
    const image = await loadImage(svgToDataUrl(svgString), ctx);
    const blob = await renderCanvas(image, width, height, ctx);
    return { blob, width, height };
  }

  async function renderCanvas(image, width, height, ctx) {
    const baseDpr = Math.min(ctx.win.devicePixelRatio || 1, 3);
    // 画布尺寸不能超过浏览器上限（Chrome 单边 32767），超限时按比例收敛 DPR
    const cappedDpr = Math.min(baseDpr, MAX_CANVAS_DIM / width, MAX_CANVAS_DIM / height);
    const candidates = cappedDpr > 0 ? [cappedDpr, 1] : [1];
    let lastError = null;

    for (const dpr of candidates) {
      if (dpr <= 0) continue;
      try {
        const canvas = ctx.createCanvas();
        canvas.width = Math.round((width + PADDING * 2) * dpr);
        canvas.height = Math.round((height + PADDING * 2) * dpr);
        const cctx = canvas.getContext('2d');
        cctx.scale(dpr, dpr);
        // 四周 PADDING 留白（白色），同时保证文字不叠在透明底上
        cctx.fillStyle = '#ffffff';
        cctx.fillRect(0, 0, width + PADDING * 2, height + PADDING * 2);
        cctx.drawImage(image, PADDING, PADDING, width, height);
        const blob = await canvasToBlob(canvas);
        if (blob) return blob;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(
      t('errExport') + (lastError ? ' (' + lastError.message + ')' : ` (${t('errSizeTooLarge')})`)
    );
  }

  function svgToDataUrl(svgString) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  }

  function loadImage(url, ctx) {
    return rejectAfter(
      new Promise((resolve, reject) => {
        const img = ctx.createImage();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(t('errSvgLoad')));
        img.src = url;
      }),
      RESOURCE_WAIT_MS,
      new Error(t('errSvgLoad'))
    );
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error(t('errCanvasPng')))),
        'image/png'
      );
    });
  }

  /**
   * 按文档顺序把原树与克隆体配对：cloneNode(true) 保证两者结构一致。
   * 计算样式必须取自「原 DOM 树」中的元素，再写回 clone 对应节点。
   */
  function pairElements(srcRoot, dstRoot) {
    const srcEls = [srcRoot, ...srcRoot.querySelectorAll('*')];
    const dstEls = [dstRoot, ...dstRoot.querySelectorAll('*')];
    return srcEls.map((src, i) => [src, dstEls[i]]);
  }

  /**
   * 深克隆元素并把整个子树的内联计算样式写回，保证 foreignObject 里
   * 渲染结果与页面一致（高度、颜色、字体、布局等均已解析为具体值）。
   */
  function cloneElementWithStyles(el, ctx) {
    const clone = el.cloneNode(true);
    for (const [src, dst] of pairElements(el, clone)) {
      if (!src || !dst) continue;
      const cs = ctx.getComputedStyle(src);
      const st = dst.style;
      for (let j = 0; j < cs.length; j++) {
        const prop = cs[j];
        st.setProperty(prop, cs.getPropertyValue(prop), cs.getPropertyPriority(prop));
      }
    }
    return clone;
  }

  /**
   * 底部信息条：第一行截图时间（UTC），第二行页面链接（超长以省略号截断）。
   * 追加在克隆体之后，不参与克隆体布局；行高与 FOOTER_HEIGHT 严格对应。
   */
  function appendFooter(wrapper, el, ctx) {
    const footer = ctx.doc.createElement('div');
    footer.style.cssText = [
      'box-sizing: border-box',
      'display: block',
      'width: 100%',
      'height: ' + FOOTER_HEIGHT + 'px',
      'padding: 6px 12px',
      'border-top: 1px solid #e5e7eb',
      'background: #f3f4f6',
      'color: #4b5563',
      'font-size: 12px',
      'font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    ].join(';') + ';';

    // 两行都是 height + line-height 双写硬固定（20px），12px 文字在行框内
    // 上下各留约 4px 余量：即便行高声明意外退化，字形也不会贴到裁切边，
    // 从根上杜绝「字母下半截被切」。
    const timeRow = ctx.doc.createElement('div');
    timeRow.style.cssText =
      'box-sizing: border-box; height: 20px; line-height: 20px; white-space: nowrap; overflow: hidden;';
    timeRow.textContent = t('footerTime', { time: formatUtcTime() });

    const linkRow = ctx.doc.createElement('div');
    linkRow.style.cssText =
      'box-sizing: border-box; height: 20px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    linkRow.textContent = t('footerLink', { url: resolvePageLink(el) });

    footer.appendChild(timeRow);
    footer.appendChild(linkRow);
    wrapper.appendChild(footer);
  }

  /** 当前 UTC 时间，格式 YYYY-MM-DD HH:mm:ss UTC */
  function formatUtcTime() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return (
      d.getUTCFullYear() +
      '-' + p(d.getUTCMonth() + 1) +
      '-' + p(d.getUTCDate()) +
      ' ' + p(d.getUTCHours()) +
      ':' + p(d.getUTCMinutes()) +
      ':' + p(d.getUTCSeconds()) +
      ' UTC'
    );
  }

  /**
   * 截图对应的页面链接：weibo.com 取该条微博详情链接，其他站点用当前地址。
   * 注意：页面级信息必须从主文档读取——手机格式下捕获上下文 ctx 指向
   * about:blank iframe，用 ctx 查不到当前页面的链接。
   */
  function resolvePageLink(el) {
    if (location.hostname === 'weibo.com' || location.hostname.endsWith('.weibo.com')) {
      const postLink = findWeiboPostLink(el);
      if (postLink) return postLink;
    }
    return location.href;
  }

  /**
   * 找微博详情链接：先在所选元素内、再回退整个页面，依次尝试三种形态——
   * 旧版时间元素 a[node-type="feed_list_item_date"]（href 形如 /{uid}/{mid}）、
   * 新版 a[href*="/detail/"]、以及匹配 weibo.com/{uid}/{mid} 的任意链接兜底。
   * 正则天然排除 /u/ 个人主页、/search 搜索页与头像链接。
   */
  function findWeiboPostLink(el) {
    const abs = (h) => {
      try {
        return new URL(h, location.href).href;
      } catch {
        return null;
      }
    };
    for (const root of [el, document]) {
      const legacy = root.querySelector('a[node-type="feed_list_item_date"]');
      const legacyHref = legacy && abs(legacy.getAttribute('href'));
      if (legacyHref) return legacyHref;
      const detail = root.querySelector('a[href*="/detail/"]');
      const detailHref = detail && abs(detail.getAttribute('href'));
      if (detailHref) return detailHref;
      for (const a of root.querySelectorAll('a[href]')) {
        const href = abs(a.getAttribute('href'));
        if (href && /weibo\.com\/\d+\/[A-Za-z0-9]+/i.test(href)) return href;
      }
    }
    return null;
  }

  /**
   * 构造 SVG foreignObject：
   *  - 根元素设置显式宽高（clone 的 computed width/height 可能是 auto）
   *  - 根元素 margin 清零（捕获区域即为该元素边框盒）
   *  - foreignObject 用 XMLSerializer 序列化以保证正确的命名空间
   */
  async function buildSvg(el, ctx) {
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const totalHeight = height + FOOTER_HEIGHT;

    const clone = cloneElementWithStyles(el, ctx);
    // 先内联资源再移除无用节点：stripUnwanted 会改变克隆体结构，
    // 而 inlineResources 按「原树与克隆体同索引」配对，顺序颠倒会导致
    // 被移除节点之后的 img 全部错位、无法内联（如含 <video> 的文章正文）
    await inlineResources(el, clone, ctx);
    // 引用收集同样会改变克隆体结构，故必须在 inlineResources 之后执行；
    // 收集过程会把选区外 def 内部的外部资源一并内联
    await collectExternalSvgRefs(clone);
    stripUnwanted(clone, ctx);

    // 强制 border-box 并清除 min/max 约束：offsetWidth/Height 是边框盒尺寸，
    // 若克隆体保留页面的 content-box，height/width 会把 padding/border 重复
    // 计入，边框盒超出捕获区，把底部 footer 顶出 SVG 视口导致链接行被裁切。
    clone.style.boxSizing = 'border-box';
    clone.style.width = width + 'px';
    clone.style.height = height + 'px';
    clone.style.minWidth = '';
    clone.style.maxWidth = '';
    clone.style.minHeight = '';
    clone.style.maxHeight = '';
    clone.style.margin = '0';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const XHTML_NS = 'http://www.w3.org/1999/xhtml';

    const svg = ctx.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', width);
    svg.setAttribute('height', totalHeight);
    svg.setAttribute('viewBox', `0 0 ${width} ${totalHeight}`);

    const fo = ctx.createElementNS(SVG_NS, 'foreignObject');
    fo.setAttribute('width', width);
    fo.setAttribute('height', totalHeight);

    const div = ctx.createElementNS(XHTML_NS, 'div');
    div.setAttribute('xmlns', XHTML_NS);
    div.style.width = width + 'px';
    div.style.height = totalHeight + 'px';
    div.appendChild(clone);
    appendFooter(div, el, ctx);

    fo.appendChild(div);
    svg.appendChild(fo);

    return { svgString: ctx.serialize(svg), width, height: totalHeight };
  }

  /** 移除克隆体中不参与渲染 / 可能产生副作用的节点 */
  function stripUnwanted(root, ctx) {
    root
      .querySelectorAll('script, style, link, meta, base, iframe, audio, source, input, textarea, select, form, noscript')
      .forEach((n) => n.remove());
    // video 不参与渲染，替换为占位提示，保留其在页面中的占位尺寸
    root.querySelectorAll('video').forEach((video) => video.replaceWith(makeVideoPlaceholder(video, ctx)));
    root
      .querySelectorAll('canvas')
      .forEach((canvas) => {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const img = ctx.doc.createElement('img');
          img.src = dataUrl;
          img.style.cssText = canvas.style.cssText;
          img.width = canvas.width;
          img.height = canvas.height;
          canvas.replaceWith(img);
        } catch {
          /* 跨域污染的 canvas 无法读取，跳过 */
        }
      });
  }

  /**
   * 生成 video 占位 div：尺寸沿用原 video 的计算样式（cloneElementWithStyles
   * 已把计算样式内联到 video.style），虚线圆角蓝框 + 居中提示文字。
   * 与图片缩放一致：内联 max-width: 100% 并在宽高均为像素值时用
   * aspect-ratio 保持原始比例，容器不足时等比收缩，避免手机模式外框溢出。
   */
  function makeVideoPlaceholder(video, ctx) {
    const div = ctx.doc.createElement('div');
    const isPx = (v) => typeof v === 'string' && /px$/.test(v);
    const w = parseFloat(video.style.width);
    const h = parseFloat(video.style.height);
    const ratioOk = isPx(video.style.width) && isPx(video.style.height) && w > 0 && h > 0;
    div.style.cssText = [
      'box-sizing: border-box',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'width: ' + (video.style.width || '100%'),
      'max-width: 100%',
      ratioOk ? 'aspect-ratio: ' + w + ' / ' + h + '; height: auto' : 'height: ' + (isPx(video.style.height) ? video.style.height : '160px'),
      'border: 2px dashed #1677ff',
      'border-radius: 8px',
      'color: #1677ff',
      'font-size: 14px',
      'line-height: 1.5',
      'text-align: center',
      'padding: 8px',
    ].join(';') + ';';
    div.textContent = t('videoPlaceholder');
    return div;
  }

  // 计算样式中需要内联 URL 的属性：[getComputedStyle 属性名, CSS 属性名]
  const CSS_URL_PROPS = [
    ['backgroundImage', 'background-image'],
    ['maskImage', 'mask-image'],
    ['webkitMaskImage', '-webkit-mask-image'],
  ];

  /**
   * 把某个计算样式属性里的 url() 资源内联为 data URL 并写回 clone。
   *  - 片段引用（#id）必须原样保留：它指向同文档的 SVG 定义，抓取只会拿回页面 HTML
   *  - 替换用函数式 replace 按出现顺序进行，避免 url 重复/包含关系时按索引错位
   */
  function inlineCssUrls(ctx, src, dst, getProp, cssProp) {
    const css = ctx.getComputedStyle(src)[getProp];
    if (!css || !css.includes('url(')) return null;
    const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
    const urls = [...css.matchAll(urlRe)].map((m) => m[1]);
    if (!urls.length) return null;
    return Promise.all(
      urls.map((u) =>
        /^(data:|#)/i.test(u) ? Promise.resolve(u) : fetchAsDataUrl(u).catch(() => TRANSPARENT_PIXEL)
      )
    ).then((resolved) => {
      let i = 0;
      dst.style.setProperty(cssProp, css.replace(urlRe, () => resolved[i++]), 'important');
    });
  }

  /**
   * 将 <img>、background-image、mask-image 尽量转为 dataURL，避免 SVG 图像
   * 加载外部资源失败导致截图缺图。抓取失败（跨域无 CORS / 防盗链）时写入
   * TRANSPARENT_PIXEL 透明占位，保证画布不被污染、导出不失败。
   * 注意：计算样式必须取自「原 DOM 树」中的元素（clone 是脱离文档的，
   * getComputedStyle 对其返回空值），再写回 clone 对应节点。
   */
  async function inlineResources(originalEl, clone, ctx) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const jobs = [];

    for (const [src, dst] of pairElements(originalEl, clone)) {
      if (!src || !dst) continue;

      // <img>：内联 src。优先 currentSrc（srcset 实际生效地址），失败后回退
      // src 属性。部分站点（如微博）会给图片 URL 追加一次性签名参数 ssig：
      // 浏览器加载图片后该签名即失效，再次请求被服务器拒绝；剥离签名参数后
      // 重新请求即可成功，故把「剥离 ssig 的 URL」也纳入候选依次尝试。
      if (dst.tagName === 'IMG') {
        const srcAttr = src.getAttribute('src');
        const candidates = [];
        const addCandidate = (u) => {
          if (!u || /^data:/i.test(u) || candidates.includes(u)) return;
          candidates.push(u);
        };
        addCandidate(src.currentSrc);
        if (srcAttr !== src.currentSrc) addCandidate(srcAttr);
        // 微博等站点会给图片 URL 追加一次性签名参数 ssig（加载后被消费，
        // 再次请求会被服务器拒绝）；用 URL 对象移除该参数后重新请求可成功
        if (src.currentSrc && /[?&]ssig=/.test(src.currentSrc)) {
          try {
            const parsed = new URL(src.currentSrc, location.href);
            parsed.searchParams.delete('ssig');
            addCandidate(parsed.href);
          } catch {
            /* URL 解析失败则跳过该候选 */
          }
        }
        if (candidates.length) {
          const job = (async () => {
            let dataUrl = null;
            for (const u of candidates) {
              try {
                dataUrl = await fetchAsDataUrl(u);
                break;
              } catch {
                /* 尝试下一个候选地址 */
              }
            }
            dst.removeAttribute('srcset');
            dst.setAttribute('src', dataUrl || TRANSPARENT_PIXEL);
          })();
          jobs.push(job);
        }
      }

      // SVG <image>：内联 href（SVG2）/ xlink:href（旧写法）。
      // 相对路径在 data URL 文档中无法解析，外部地址又受 img 上下文限制
      // 加载失败，都会导致图像不渲染。
      if (src.namespaceURI === SVG_NS && src.tagName.toLowerCase() === 'image') {
        const href = src.getAttribute('href') || src.getAttribute('xlink:href');
        if (href && !/^data:/i.test(href)) {
          const job = fetchAsDataUrl(href)
            .catch(() => TRANSPARENT_PIXEL)
            .then((dataUrl) => {
              dst.setAttribute('href', dataUrl);
              if (dst.hasAttribute('xlink:href')) dst.removeAttribute('xlink:href');
            });
          jobs.push(job);
        }
      }

      // background-image / mask-image：逐个 url() 转 dataURL（片段引用保留）
      for (const [getProp, cssProp] of CSS_URL_PROPS) {
        const job = inlineCssUrls(ctx, src, dst, getProp, cssProp);
        if (job) jobs.push(job);
      }
    }

    await Promise.all(jobs);
  }

  /**
   * 收集克隆体中引用了、但定义在选区外的 SVG 元素（symbol/linearGradient/
   * radialGradient/pattern/filter/clipPath/mask 等），深克隆后分发到各引用
   * 元素所在的 <svg> 根内。
   *
   * foreignObject 序列化后是独立文档，选区外的定义不会进入克隆体：
   * <use href="#x">、fill="url(#x)" 等引用全部悬空，图形直接不渲染——
   * 表现为"区域内的 SVG 没进截图"。常见于雪碧图（symbol + use）与
   * 图表库（渐变/滤镜定义在页面别处）。
   *
   * 实现要点：
   *  - 从克隆体扫描引用（此时计算样式已内联，url(#id) 以属性值形式可见），
   *    同时覆盖 style 属性与 SVG 的 href/xlink:href
   *  - 定义元素必须用 pageCtx（主文档）克隆：定义来自主文档，手机格式下
   *    iframe 的 getComputedStyle 对其返回空值
   *  - 按「引用元素所在的 <svg> 根」分发：CSS 的 url(#id) 引用只能解析到
   *    同一 svg 根内的元素，统一塞进容器级 defs 会导致渐变/滤镜仍不渲染；
   *    use 的 DOM 引用虽可跨根，但放入同根更稳妥
   *  - 定义自身的嵌套引用（如 symbol 内部再引用渐变）递归归入同一 svg 根
   *  - 需在 inlineResources 之后执行：插入 defs 会改变克隆体节点顺序，
   *    破坏 inlineResources 的"原树与克隆体同索引"配对
   *  - 克隆出的 def 自身也要再 inlineResources 一次：def 内的外部 <image>
   *    与背景图若不内联，序列化成 data URL 文档后会加载失败、图片缺失
   */
  async function collectExternalSvgRefs(clone) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const ID_REF_RE = /^#([A-Za-z_][\w:.-]*)$/;
    const URL_REF_RE = /url\(\s*["']?#([A-Za-z_][\w:.-]*)["']?\s*\)/g;

    const pending = [];
    const doneBySvg = new Map();
    const defsBySvg = new Map();

    const scan = (root, overrideHost, sink) => {
      for (const node of [root, ...root.querySelectorAll('*')]) {
        const svgHost = overrideHost || (node.closest ? node.closest('svg') : null);
        for (const attr of node.attributes) {
          const v = attr.value || '';
          if (node.namespaceURI === SVG_NS && (attr.name === 'href' || attr.name === 'xlink:href')) {
            const m = ID_REF_RE.exec(v);
            if (m) sink(svgHost, m[1]);
            continue;
          }
          for (const m of v.matchAll(URL_REF_RE)) sink(svgHost, m[1]);
        }
      }
    };

    scan(clone, undefined, (svgHost, id) => pending.push({ svgHost, id }));
    while (pending.length) {
      const { svgHost, id } = pending.shift();
      if (!doneBySvg.has(svgHost)) doneBySvg.set(svgHost, new Set());
      if (doneBySvg.get(svgHost).has(id)) continue;
      doneBySvg.get(svgHost).add(id);
      const def = document.getElementById(id);
      // 定义不存在或克隆体里已有同 id（区内引用，如区内 defs 的渐变/symbol）
      // 则跳过。不能依赖 el.contains 判断：手机格式下 el 位于重排 iframe，
      // contains 对主文档元素永远返回 false，会把区内引用误判为区外
      if (!def || clone.querySelector('#' + CSS.escape(id))) continue;
      const defClone = cloneElementWithStyles(def, pageCtx);
      // def 内部的资源（SVG <image>、背景图等）同样必须内联，
      // pageCtx 是因为定义来自主文档（手机格式下 iframe ctx 读不到其计算样式）
      await inlineResources(def, defClone, pageCtx);
      // 定义自身的嵌套引用（如 symbol 内再引用渐变）必须与定义同根解析
      scan(def, svgHost, (host, nestedId) => pending.push({ svgHost: host, id: nestedId }));
      if (!defsBySvg.has(svgHost)) defsBySvg.set(svgHost, []);
      defsBySvg.get(svgHost).push(defClone);
    }

    for (const [svgHost, defClones] of defsBySvg) {
      const host = svgHost || clone.querySelector('svg');
      if (!host) continue;
      let defs = host.querySelector(':scope > defs');
      if (!defs) {
        defs = pageCtx.createElementNS(SVG_NS, 'defs');
        host.prepend(defs);
      }
      defClones.forEach((d) => defs.appendChild(d));
    }
  }

  /**
   * 先尝试直接 fetch（同源 / 已配 CORS 的跨域资源、页面 blob URL 均可直连）；
   * 失败（跨域无 CORS 头）再经 background 借助 <all_urls> host 权限绕过 CORS 抓取。
   */
  async function fetchAsDataUrl(url) {
    try {
      // 直连也要设上限：跨域请求既不返回也不报错时同样会卡住捕获
      const resp = await fetch(url, {
        mode: 'cors',
        credentials: 'include',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await blobToDataUrl(await resp.blob());
    } catch {
      return proxyFetchAsDataUrl(url);
    }
  }

  function proxyFetchAsDataUrl(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'WPS_FETCH_DATA_URL', url }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp && resp.ok && resp.dataUrl) {
          resolve(resp.dataUrl);
          return;
        }
        reject(new Error((resp && resp.error) || t('errResourceLoad')));
      });
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /* ---------------- 下载 ---------------- */

  function downloadBlob(blob, filename) {
    // chrome.downloads 在 content script 中不可用，转成 data URL 交由 background 保存
    return blobToDataUrl(blob).then((dataUrl) =>
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'WPS_DOWNLOAD', dataUrl, filename }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (resp && resp.ok) {
            resolve(resp.filename || filename);
          } else {
            reject(new Error((resp && resp.error) || t('errDownload')));
          }
        });
      })
    );
  }

  /* ---------------- 消息入口 ---------------- */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'WPS_START_SELECT') {
      startSelection();
      sendResponse({ ok: true });
    }
    return false; // 同步响应
  });
})();
