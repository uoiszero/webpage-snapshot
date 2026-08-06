/**
 * Webpage Snapshot - content script
 *
 * 流程：
 *   1. popup 发送 WPS_START_SELECT 消息 → 进入选择模式
 *   2. 页面内 hover 高亮，点击选中元素，浮动工具条确认
 *   3. 捕获：深克隆元素 + 内联计算样式 + 图片转 dataURL
 *      → SVG foreignObject → Canvas 重绘 → PNG blob
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
  const MAX_NODE_COUNT = 5000;
  const MAX_CANVAS_DIM = 16384; // Chrome 单边 32767，留余量
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
  let saveFormat = 'default';

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
        <button class="wps-fmt active" data-format="default" title="${t('fmtDefaultTitle')}" aria-label="${t('ariaFmtDefault')}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </button>
        <button class="wps-fmt" data-format="mobile" title="${t('fmtMobileTitle', { width: MOBILE_WIDTH })}" aria-label="${t('ariaFmtMobile')}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
        </button>
      </div>
      <button class="wps-save">${t('save')}</button>
      <button class="wps-reselect">${t('reselect')}</button>
      <button class="wps-cancel" title="${t('cancel')}">✕</button>`;
    toolbar.querySelector('.wps-save').addEventListener('click', onSave);
    toolbar
      .querySelector('.wps-reselect')
      .addEventListener('click', () => {
        cleanupSelection();
        startSelection();
      });
    toolbar.querySelector('.wps-cancel').addEventListener('click', cleanupAll);
    toolbar.querySelectorAll('.wps-fmt').forEach((btn) => {
      btn.addEventListener('click', () => {
        toolbar.querySelectorAll('.wps-fmt').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        saveFormat = btn.dataset.format;
        refreshToolbarInfo();
      });
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
    document.addEventListener('keydown', onKeyDown, true);
  }

  function cleanupSelection() {
    selecting = false;
    hoverEl = null;
    selectedEl = null;
    if (overlay) overlay.style.display = 'none';
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onMouseDownCapture, true);
    document.removeEventListener('click', onSelectClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function cleanupAll() {
    cleanupSelection();
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

  function showToolbar(el) {
    saveFormat = 'default';
    toolbar.querySelectorAll('.wps-fmt').forEach((b) => b.classList.toggle('active', b.dataset.format === 'default'));
    toolbar.querySelector('.wps-save').disabled = false;
    toolbar.style.display = 'flex';
    refreshToolbarInfo();
  }

  function refreshToolbarInfo() {
    if (!selectedEl) return;
    const fmt =
      saveFormat === 'mobile' ? t('mobileSuffix', { width: MOBILE_WIDTH }) : '';
    toolbar.querySelector('.wps-info').textContent = t('selectedPrefix') + describeElement(selectedEl) + fmt;
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

  async function captureAndDownload(el, format) {
    await document.fonts.ready;

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
      const { blob, width, height } = await renderElementToBlob(renderTarget.element, renderTarget.ctx);
      if (width <= 0 || height <= 0) {
        throw new Error(t('errZeroSize'));
      }
      const suffix = format === 'mobile' ? 'mobile-' : '';
      const filename = `snapshot-${el.tagName.toLowerCase()}-${suffix}${Date.now()}.png`;
      await downloadBlob(blob, filename);
      return filename;
    } finally {
      renderTarget.iframe?.remove();
    }
  }

  /**
   * 手机格式：把元素放进 375px 宽的隐藏 iframe 重排。
   *  - 复制页面全部样式（含内联 <style>，其相对 url 一并转为绝对）
   *  - 元素的相对路径资源（img/srcset）转为绝对地址
   *  - 等待 iframe 内字体与图片加载完成
   *  - 若重排后仍超宽（非响应式站点），用 zoom 等比缩放到手机宽度
   */
  async function setupMobileContext(el) {
    const iframe = document.createElement('iframe');
    iframe.style.cssText =
      `position:fixed;top:0;left:-10000px;width:${MOBILE_WIDTH}px;height:2000px;border:0;visibility:hidden;`;
    document.documentElement.appendChild(iframe);

    const iDoc = iframe.contentDocument;
    const iWin = iframe.contentWindow;
    if (!iDoc || !iWin) throw new Error(t('errIframe'));

    iDoc.body.style.margin = '0';
    iDoc.body.style.width = MOBILE_WIDTH + 'px';
    copyAttributes(document.documentElement, iDoc.documentElement);
    copyAttributes(document.body, iDoc.body);

    for (const s of document.querySelectorAll('style, link[rel="stylesheet"]')) {
      if (s.tagName === 'STYLE') {
        const st = iDoc.createElement('style');
        st.textContent = rewriteCssUrls(s.textContent);
        iDoc.head.appendChild(st);
      } else {
        const link = iDoc.createElement('link');
        link.rel = 'stylesheet';
        link.href = s.href;
        iDoc.head.appendChild(link);
      }
    }

    const clone = el.cloneNode(true);
    absolutizeUrls(clone);
    iDoc.body.appendChild(clone);

    // 等待样式表生效、字体与图片加载
    await new Promise((r) => setTimeout(r, 200));
    await iWin.document.fonts.ready;
    await waitForImages(iDoc);

    let captureTarget = clone;
    const layoutWidth = clone.getBoundingClientRect().width;
    if (layoutWidth > MOBILE_WIDTH) {
      // 非响应式站点：等比缩放使内容恰好适配手机宽度，字体随比例变小。
      // zoom 元素的 offsetWidth 语义不可靠，故外包一个固定宽度容器，
      // 捕获容器而非缩放元素本身。
      const wrapper = iDoc.createElement('div');
      wrapper.style.width = MOBILE_WIDTH + 'px';
      clone.style.zoom = String(MOBILE_WIDTH / layoutWidth);
      wrapper.appendChild(clone);
      iDoc.body.appendChild(wrapper);
      captureTarget = wrapper;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }

    return { element: captureTarget, ctx: makeContext(iWin), iframe };
  }

  function copyAttributes(from, to) {
    for (const a of from.attributes) {
      to.setAttribute(a.name, a.value);
    }
  }

  function rewriteCssUrls(cssText) {
    return cssText.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (match, raw) => {
      const u = raw.trim();
      if (/^(data:|https?:)/i.test(u)) return match;
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

  function waitForImages(doc) {
    const imgs = Array.from(doc.images);
    return Promise.all(
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
    return new Promise((resolve, reject) => {
      const img = ctx.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('errSvgLoad')));
      img.src = url;
    });
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
   * 深克隆元素并把整个子树的内联计算样式写回，保证 foreignObject 里
   * 渲染结果与页面一致（高度、颜色、字体、布局等均已解析为具体值）。
   */
  function cloneElementWithStyles(el, ctx) {
    const clone = el.cloneNode(true);
    const srcEls = [el, ...el.querySelectorAll('*')];
    const dstEls = [clone, ...clone.querySelectorAll('*')];

    for (let i = 0; i < srcEls.length; i++) {
      const src = srcEls[i];
      const dst = dstEls[i];
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
   * 构造 SVG foreignObject：
   *  - 根元素设置显式宽高（clone 的 computed width/height 可能是 auto）
   *  - 根元素 margin 清零（捕获区域即为该元素边框盒）
   *  - foreignObject 用 XMLSerializer 序列化以保证正确的命名空间
   */
  async function buildSvg(el, ctx) {
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    const clone = cloneElementWithStyles(el, ctx);
    stripUnwanted(clone);
    await inlineResources(el, clone, ctx);

    clone.style.width = width + 'px';
    clone.style.height = height + 'px';
    clone.style.margin = '0';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const XHTML_NS = 'http://www.w3.org/1999/xhtml';

    const svg = ctx.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const fo = ctx.createElementNS(SVG_NS, 'foreignObject');
    fo.setAttribute('width', '100%');
    fo.setAttribute('height', '100%');

    const div = ctx.createElementNS(XHTML_NS, 'div');
    div.setAttribute('xmlns', XHTML_NS);
    div.style.width = '100%';
    div.style.height = '100%';
    div.appendChild(clone);

    fo.appendChild(div);
    svg.appendChild(fo);

    return { svgString: ctx.serialize(svg), width, height };
  }

  /** 移除克隆体中不参与渲染 / 可能产生副作用的节点 */
  function stripUnwanted(root) {
    root
      .querySelectorAll('script, style, link, meta, base, iframe, video, audio, source, input, textarea, select, form, noscript')
      .forEach((n) => n.remove());
    root
      .querySelectorAll('canvas')
      .forEach((canvas) => {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const img = document.createElement('img');
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
   * 将 <img> 与 background-image 尽量转为 dataURL，避免 SVG 图像
   * 加载外部资源失败导致截图缺图。fetch 失败（跨域无 CORS）时保留原地址。
   * 注意：计算样式必须取自「原 DOM 树」中的元素（clone 是脱离文档的，
   * getComputedStyle 对其返回空值），再写回 clone 对应节点。
   */
  async function inlineResources(originalEl, clone, ctx) {
    const jobs = [];
    const srcEls = [originalEl, ...originalEl.querySelectorAll('*')];
    const dstEls = [clone, ...clone.querySelectorAll('*')];

    for (let i = 0; i < srcEls.length; i++) {
      const src = srcEls[i];
      const dst = dstEls[i];
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

      // background-image：逐个 url() 转 dataURL
      const bg = ctx.getComputedStyle(src).backgroundImage;
      if (!bg || !bg.includes('url(')) continue;
      const urls = [...bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
      const job = Promise.all(
        urls.map((u) =>
          /^data:/i.test(u) ? Promise.resolve(u) : fetchAsDataUrl(u).catch(() => TRANSPARENT_PIXEL)
        )
      ).then((resolved) => {
        let next = bg;
        resolved.forEach((dataUrl, idx) => {
          next = next.replace(urls[idx], dataUrl);
        });
        dst.style.setProperty('background-image', next, 'important');
      });
      jobs.push(job);
    }

    await Promise.all(jobs);
  }

  /**
   * 先尝试直接 fetch（同源 / 已配 CORS 的跨域资源、页面 blob URL 均可直连）；
   * 失败（跨域无 CORS 头）再经 background 借助 <all_urls> host 权限绕过 CORS 抓取。
   */
  async function fetchAsDataUrl(url) {
    try {
      const resp = await fetch(url, { mode: 'cors', credentials: 'include' });
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
