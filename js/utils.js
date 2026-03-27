// ============================================
// COBALT — utils.js
// Shared utilities
// ============================================

export function generateId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function throttle(fn, ms) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn.apply(this, args);
    }
  };
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}