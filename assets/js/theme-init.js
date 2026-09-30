/* 在样式绘制前恢复主题，避免夜间模式刷新时闪白。 */
(() => {
  let saved = null;
  try { saved = localStorage.getItem('anon-theme'); } catch { /* 存储不可用时仍可跟随系统。 */ }
  const theme = saved === 'day' || saved === 'night' ? saved :
    (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day');
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'night' ? '#121020' : '#fff7f9');
})();
