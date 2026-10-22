# Changelog

本项目为 Chrome 扩展（Manifest V3），所有重要变更记录于此文件。
版本号遵循 `major.minor.patch`，与 `manifest.json` 的 `version` 保持一致。

## [1.0.1] - 2026-10-22

### 🐛 Bug Fixes (修复)

- **微博截图：** 恢复 `*.sinaimg.cn` 配图的跨域抓取。防盗链用的 DNR Referer 会话规则此前被 `tabIds` 限定到「发起标签页」，而抓取请求实际由扩展 service worker 发起、不关联任何标签页，导致规则永不命中、Referer 未被改写成页面 origin，图床返回 403，截图里的微博配图整块变成透明占位（`d.sinaimg.cn`、`h5.sinaimg.cn` 等静态域名不校验 Referer，所以只有配图丢失）
- **复制到剪贴板：** 复制成功后工具条不再一直悬浮，改为展示 800ms「已复制到剪贴板」提示后自动收起，与「保存到本地」的行为对齐；剪贴板写入失败（激活窗口过期，需要用户再次点击）时仍保留工具条以便重试

### 📝 Documentation (文档)

- **AGENTS：** 补充 DNR Referer 规则不能使用 `tabIds` 的约束与表现、`COPY_SUCCESS_HIDE_MS`(800) 常量，以及「保存与复制成功后都要收起工具条、复制失败时禁止收起」的一致性约定
