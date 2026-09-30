# Noto Sans SC · 聊天粗体

本目录自托管 Noto Sans SC 的 700（Bold）字重，来源为固定版本 `@fontsource/noto-sans-sc@5.3.0`。字体免费使用，按 **SIL Open Font License 1.1** 分发；完整版权声明及许可保存在同目录 `LICENSE` 中，随网站一并部署。

- 字体与许可介绍：https://fontsource.org/fonts/noto-sans-sc/about
- 固定版本文件：https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.0/
- 许可原文：https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.0/LICENSE
- 上游项目：https://github.com/google/fonts/tree/main/ofl/notosanssc

`700.css` 使用独立 CSS 家族别名 `Anon Chat Sans`，仅用于聊天区。所有字体二进制保留原始内容，CSS 保留发布包的 `unicode-range`，并去除未下载的旧版 `.woff` 后备地址。101 个 WOFF2 分段合计 **2,461,192 字节**；浏览器根据实际显示的中文、日语假名、英文等字符按需加载，不会在访问时请求 Google Fonts、Fontsource 或 jsDelivr。

`font-display: swap` 保证加载期间文字仍可阅读；字体就绪后统一使用本地文件中的真实粗体。平台不支持或字体不含的罕见字及彩色 Emoji 由系统后备字体显示。

`manifest.json` 记录各字体文件的大小及 SHA-256，抓取脚本还会核对 jsDelivr 发布清单的原始哈希。重新获取固定版本文件：

```powershell
$env:FONT_DOWNLOAD_PROXY = 'http://127.0.0.1:7897' # 可选
node scripts/fetch_chat_font.cjs
```
