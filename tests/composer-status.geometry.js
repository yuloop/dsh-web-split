// Evaluate on a real split with detailed statistics and the Turbo controls visible.
// Read-only: does not create DOM, invoke controls or read conversation contents.
(() => {
  const rect = el => el.getBoundingClientRect();
  const visible = r => r.width > 0 && r.height > 0;
  const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
  const outside = (a, b) => a.left < b.left - 1 || a.right > b.right + 1 || a.top < b.top - 1 || a.bottom > b.bottom + 1;
  function ink(root) {
    const out = [], walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode, text = node.textContent.trim();
      if (!text || node.parentElement.closest('svg,[hidden]') || getComputedStyle(node.parentElement).visibility !== 'visible') continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const box of range.getClientRects()) if (visible(box)) out.push({ el: node.parentElement, text, box });
    }
    return out;
  }
  function clipped(mark, pane) {
    if (outside(mark.box, rect(pane))) return true;
    for (let el = mark.el; el && el !== pane; el = el.parentElement) {
      const style = getComputedStyle(el), box = rect(el);
      if (style.display === 'contents') continue;
      if (style.overflowX !== 'visible' && (mark.box.left < box.left - 1 || mark.box.right > box.right + 1)) return true;
      if (style.overflowY !== 'visible' && (mark.box.top < box.top - 1 || mark.box.bottom > box.bottom + 1)) return true;
    }
    return false;
  }
  function inspect(pane) {
    const card = pane.querySelector('[data-composer-card]'), dock = card?.nextElementSibling, row = card?.querySelector('[data-input-scroll] + div');
    if (!row || !dock?.matches('[data-composer-dock]')) return { pass: false, missing: 'composer' };
    const stats = ink(dock), toolInk = ink(row), controls = [...row.querySelectorAll('button,input[type=range],[role=slider],label')].filter(e => visible(rect(e)));
    const targets = [...toolInk, ...controls.map(el => ({ text: el.getAttribute('aria-label') || el.tagName, box: rect(el) }))];
    const collisions = stats.flatMap(s => targets.filter(t => intersects(s.box, t.box)).map(t => [s.text, t.text]));
    const cut = stats.filter(s => clipped(s, pane)).map(s => s.text);
    const controlsOutside = controls.filter(el => outside(rect(el), rect(pane))).map(el => el.getAttribute('aria-label') || el.tagName);
    const labels = stats.map(s => s.text).join(' '), goal = pane.querySelector('[data-goal-bar]');
    const dockGap = rect(dock).top - rect(card).bottom, inkGap = stats.length ? Math.min(...stats.map(s => s.box.top)) - Math.max(...controls.map(el => rect(el).bottom)) : null;
    const meters = /tok\/s/i.test(labels) && /(?:缓存命中|cache hit)/i.test(labels) && /%/.test(labels);
    const slider = controls.some(el => el.matches('input[type=range],[role=slider]')), model = controls.some(el => /模型|model/i.test(el.getAttribute('aria-label') || ''));
    const send = controls.some(el => /停止生成|发送|stop|send/i.test(el.getAttribute('aria-label') || ''));
    const primaryGap = goal ? rect(card).top - rect(goal).bottom : null;
    const pass = meters && slider && model && send && !collisions.length && !cut.length && !controlsOutside.length && dockGap >= -.5 && inkGap >= 2 && (primaryGap === null || primaryGap >= 0);
    return { pass, paneWidth: pane.clientWidth, labels, metricRows: new Set(stats.map(s => Math.round(s.box.bottom))).size, controls: controls.length, metricRanges: stats.length, toolRanges: toolInk.length, slider, model, send, dockGap, inkGap, primaryGap, collisions, cut, controlsOutside };
  }
  const panes = [...document.querySelectorAll('.dshSplit_pane')].filter(p => p.querySelector('[data-composer-card]'));
  return panes.length ? panes.map(inspect) : [{ pass: false, missing: 'populated split pane' }];
})()
