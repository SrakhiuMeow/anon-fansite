/* 长页面阅读辅助；不保存阅读轨迹。 */
(() => {
  const progress = document.getElementById('readingProgress');
  const topButton = document.getElementById('backToTop');
  const top = document.getElementById('top');
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const height = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.transform = `scaleX(${height > 0 ? Math.min(1, Math.max(0, window.scrollY / height)) : 0})`;
    if (topButton) topButton.hidden = window.scrollY < window.innerHeight ||
      !!document.querySelector('dialog[open], .lightbox:not([hidden])');
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(document.body);
  // 弹窗出现后移除背后的浮动入口，关闭后恢复。
  const observer = new MutationObserver(schedule);
  document.querySelectorAll('dialog, .lightbox').forEach((node) => observer.observe(node, { attributes: true, attributeFilter: ['open', 'hidden'] }));
  topButton?.addEventListener('click', () => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    top?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' });
  });
  update();
})();
