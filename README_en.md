# Webpage Snapshot

**[中文](README.md)**

Chrome extension (Manifest V3): click the icon, then move your mouse to select any element on the page. After confirming, it redraws the element via **SVG foreignObject + Canvas** into a PNG image and saves it automatically to your local "Downloads" folder.

## How it works

1. Click the toolbar icon → the popup opens → click "Start Selecting"
2. The page enters selection mode: hovering shows a highlight border, clicking selects the element, and the floating toolbar confirms
3. Capture process (`content.js`):
   - Deep-clones the selected element and inlines the **computed styles** of every element in the subtree (width, color, font, layout — all resolved to concrete values)
   - Images / `background-image` are converted to `data:` URLs whenever possible, so missing external resources don't break the capture
   - Serialized as `<svg><foreignObject>` and loaded as an `<img>`
   - Redrawn on a Canvas at `devicePixelRatio`, exported as a PNG blob
4. Saved via the background worker (`chrome.downloads`) as `snapshot-<tag>-<timestamp>.png`

## Two image formats

After selecting an element, choose a format on the toolbar:

- **Default**: captures the element as-is (width matches the element)
- **Mobile**: renders at a mobile viewport, automatically adapting to narrow screens and fonts
  - Reflows the element inside a **375px-wide hidden iframe**; the site's responsive media queries actually apply, so layout and fonts adjust for mobile screens
  - Non-responsive sites (still wider after reflow): reflowed to 375px — fixed widths are collapsed so text keeps its original size while re-wrapping; elements that cannot collapse (tables, code blocks, etc.) are proportionally scaled as a last resort
  - Output is a tall portrait image, ideal for mobile screens

Mobile format files are saved as `snapshot-<tag>-mobile-<timestamp>.png`.

## Install

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select this directory (`webpage-snapshot`)
4. Pin the icon to the toolbar

## Usage

1. On the target page, click the extension icon → "Start Selecting"
2. Move your mouse to select an element (live highlight), then click to confirm
3. On the floating toolbar:
   - **Save (icon)** — redraws and downloads to the "Downloads" folder
   - **Copy (icon)** — redraws and copies to the clipboard
   - **Reselect** — return to selection mode
   - **✕** — exit

Shortcut: press `Esc` while in selection mode to cancel.

## File structure

```
manifest.json   MV3 manifest (downloads permission + content script injection + background worker)
background.js   background service worker (proxies chrome.downloads for saving)
i18n.js         language file (zh / en dictionaries + browser language detection)
popup.html/css  extension popup (starts selection)
popup.js        popup logic (sends the start message to the content script)
content.js      selection interaction + SVG/Canvas capture + download (core logic)
```

## Multi-language

All UI strings live in the `i18n.js` language file. The language is detected at load time: Chinese browsers show Chinese, everything else shows English. Add a key to both dictionaries to add new strings.

## Known limitations

- **Hotlink-protected / inaccessible images**: `<img>` and `background-image` are first fetched directly; on failure, the background worker inlines them as data URLs using host permissions to bypass CORS. Resources that still fail (e.g., CDNs with Referer checks) are shown as transparent placeholders, so export always succeeds.
- **Fonts**: rendering relies on the browser resolving the font stack in the data URL SVG, which mostly matches the live page; individual web fonts may differ slightly.
- **Very tall elements**: each canvas side is capped at 16384px; beyond that the output resolution is automatically reduced rather than failing. Elements with more than 5000 nodes capture noticeably slower — prefer a smaller selection.
- **Dynamic content / form controls**: `input`, `textarea`, `select`, `iframe` etc. are not rendered (removed from the clone); `video` is replaced in place with a dashed blue placeholder box saying "Video cannot be captured"; `canvas` is converted to a static image.
- Browser built-in pages (`chrome://`, Web Store) cannot have content scripts injected and are not supported.
- Files are saved to the system "Downloads" folder; to show a "Save As" dialog instead, change `saveAs: false` to `true` in `background.js`.
