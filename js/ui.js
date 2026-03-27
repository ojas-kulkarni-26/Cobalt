// ============================================
// COBALT — ui.js
// All UI: sidebar, command palette, block menus,
// modals, toasts, context menu, tag popup
// ============================================

import { getState, setState } from './store.js';
import { BLOCK_TYPES } from './blocks.js';
import * as db from './db.js';

// ── Toast ─────────────────────────────────────
export function showToast(message, type = 'default', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast${type !== 'default' ? ` toast-${type}` : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// ── Sync status ───────────────────────────────
export function setSyncStatus(status) {
  const el = document.getElementById('sync-status');
  const label = document.getElementById('sync-label');
  if (!el || !label) return;
  el.className = `sync-status ${status}`;
  label.textContent = { syncing: 'Saving…', ok: 'Synced', error: 'Sync error' }[status] || 'Synced';
}

// ── Notes List ────────────────────────────────
export function renderNotesList(notes, activeId, onSelect, onDelete) {
  const list = document.getElementById('notes-list');
  if (!list) return;
  if (!notes.length) {
    list.innerHTML = `<div class="notes-empty-hint">No notes yet</div>`;
    return;
  }
  list.innerHTML = '';
  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = `note-item${note.id === activeId ? ' active' : ''}`;
    item.dataset.noteId = note.id;
    item.innerHTML = `
      <div class="note-item-icon">${note.icon || '📄'}</div>
      <div class="note-item-title">${esc(note.title || 'Untitled')}</div>
      <div class="note-item-actions">
        <button class="icon-btn delete-note-btn" title="Delete">
          <svg width="13" height="13"><use href="#icon-trash"/></svg>
        </button>
      </div>
    `;
    item.addEventListener('click', e => {
      if (e.target.closest('.delete-note-btn')) return;
      onSelect(note.id);
    });
    item.querySelector('.delete-note-btn').addEventListener('click', e => {
      e.stopPropagation();
      onDelete(note.id, note.title);
    });
    list.appendChild(item);
  });
}

export function setActiveNoteInList(noteId) {
  document.querySelectorAll('.note-item').forEach(el =>
    el.classList.toggle('active', el.dataset.noteId === noteId)
  );
}

// ── Tags List ─────────────────────────────────
export function renderTagsList(tags, activeTag, onSelect) {
  const list = document.getElementById('tags-list');
  const section = document.getElementById('tags-section');
  if (!list) return;
  if (!tags.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';
  tags.forEach(({ tag, count }) => {
    const item = document.createElement('div');
    item.className = `tag-item${tag === activeTag ? ' active' : ''}`;
    item.innerHTML = `<div class="tag-dot"></div><span>${esc(tag)}</span><span class="tag-count">${count}</span>`;
    item.addEventListener('click', () => onSelect(tag === activeTag ? null : tag));
    list.appendChild(item);
  });
}

// ── Note icon picker ──────────────────────────
export function initNoteIconPicker(onPick) {
  const btn = document.getElementById('note-icon-btn');
  const picker = document.getElementById('emoji-picker');
  if (!btn || !picker) return;
  const ICONS = ['📄','📝','📌','🎯','💡','🚀','🔥','✅','🧪','📊','🎨','🔑','💎','🌟','📚','🗂️','🧠','⚙️'];
  btn.addEventListener('click', () => {
    picker.innerHTML = `<div class="emoji-grid">${ICONS.map(e => `<button class="emoji-btn" data-emoji="${e}">${e}</button>`).join('')}</div>`;
    positionBelow(picker, btn, 280, 220);
    picker.classList.remove('hidden');
    picker.querySelectorAll('.emoji-btn').forEach(b => {
      b.addEventListener('click', () => { onPick(b.dataset.emoji); picker.classList.add('hidden'); });
    });
    closePicker(picker, btn);
  });
}

// ── Note tags UI ──────────────────────────────
export function renderNoteTags(tags, onRemove, onAdd) {
  const row = document.getElementById('note-tags-row');
  if (!row) return;
  row.innerHTML = '';
  tags.forEach(tag => {
    const badge = document.createElement('div');
    badge.className = 'note-tag-badge';
    badge.innerHTML = `${esc(tag)} <span class="remove-tag">×</span>`;
    badge.querySelector('.remove-tag').addEventListener('click', () => onRemove(tag));
    row.appendChild(badge);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'add-tag-btn';
  addBtn.innerHTML = `<svg width="10" height="10"><use href="#icon-plus"/></svg> Tag`;
  addBtn.addEventListener('click', e => onAdd(e));
  row.appendChild(addBtn);
}

// ── Tag input popup ───────────────────────────
export function showTagPopup(anchorEl, allTags, currentTags, onTagSelect) {
  const popup = document.getElementById('tag-popup');
  const input = document.getElementById('tag-input');
  const suggestions = document.getElementById('tag-suggestions');
  if (!popup) return;

  // Smart positioning: prefer below, flip if no room
  positionBelow(popup, anchorEl, 200, 260);
  popup.classList.remove('hidden');
  input.value = '';
  input.focus();

  function renderSuggestions(query) {
    const available = allTags.filter(t =>
      !currentTags.includes(t.tag) &&
      t.tag.toLowerCase().includes(query.toLowerCase())
    );
    suggestions.innerHTML = '';
    if (query && !available.find(t => t.tag === query)) {
      const ci = document.createElement('div');
      ci.className = 'tag-suggestion-item';
      ci.innerHTML = `<svg width="12" height="12"><use href="#icon-plus"/></svg> Create "${esc(query)}"`;
      ci.addEventListener('click', () => { onTagSelect(query); hideTagPopup(); });
      suggestions.appendChild(ci);
    }
    available.slice(0, 8).forEach(({ tag }) => {
      const item = document.createElement('div');
      item.className = 'tag-suggestion-item';
      item.innerHTML = `<div class="tag-dot"></div> ${esc(tag)}`;
      item.addEventListener('click', () => { onTagSelect(tag); hideTagPopup(); });
      suggestions.appendChild(item);
    });
  }

  renderSuggestions('');
  const onInput = () => renderSuggestions(input.value);
  const onKeydown = e => {
    if (e.key === 'Enter' && input.value.trim()) { onTagSelect(input.value.trim()); hideTagPopup(); }
    if (e.key === 'Escape') hideTagPopup();
  };
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);

  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!popup.contains(e.target) && e.target !== anchorEl) hideTagPopup();
      document.removeEventListener('click', close);
    });
  }, 50);
}

export function hideTagPopup() {
  document.getElementById('tag-popup')?.classList.add('hidden');
}

// ── Block Type Menu ───────────────────────────
let _btmCallback = null;

export function showBlockTypeMenu(onSelect, anchorEl = null, event = null) {
  const menu = document.getElementById('block-type-menu');
  const input = document.getElementById('btm-input');
  if (!menu) return;
  _btmCallback = onSelect;

  if (event) {
    positionAt(menu, event.clientX, event.clientY, 240, 380);
  } else if (anchorEl) {
    positionBelow(menu, anchorEl, 240, 380);
  } else {
    menu.style.cssText = 'left:50%;top:30%;transform:translateX(-50%)';
  }

  menu.classList.remove('hidden');
  input.value = '';
  renderBTMItems('');
  input.focus();

  // re-add listener (cloneNode trick to clear old ones)
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  newInput.focus();
  newInput.addEventListener('input', () => renderBTMItems(newInput.value));
  newInput.addEventListener('keydown', handleBTMKeys);

  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!menu.contains(e.target)) hideBlockTypeMenu();
      document.removeEventListener('click', close);
    });
  }, 50);
}

function renderBTMItems(query) {
  const list = document.getElementById('btm-list');
  if (!list) return;
  const filtered = BLOCK_TYPES.filter(b =>
    !query ||
    b.label.toLowerCase().includes(query.toLowerCase()) ||
    b.desc.toLowerCase().includes(query.toLowerCase())
  );
  const groups = {};
  filtered.forEach(b => { if (!groups[b.group]) groups[b.group] = []; groups[b.group].push(b); });
  list.innerHTML = '';
  let firstItem = null;
  Object.entries(groups).forEach(([group, items]) => {
    const lbl = document.createElement('div');
    lbl.className = 'btm-group-label';
    lbl.textContent = group;
    list.appendChild(lbl);
    items.forEach(b => {
      const item = document.createElement('div');
      item.className = 'btm-item';
      item.dataset.type = b.type;
      item.innerHTML = `
        <div class="btm-item-icon">${b.icon}</div>
        <div class="btm-item-info">
          <div class="btm-item-label">${b.label}</div>
          <div class="btm-item-desc">${b.desc}</div>
        </div>`;
      item.addEventListener('click', () => { _btmCallback?.(b.type); hideBlockTypeMenu(); });
      list.appendChild(item);
      if (!firstItem) { firstItem = item; item.classList.add('selected'); }
    });
  });
}

function handleBTMKeys(e) {
  const list = document.getElementById('btm-list');
  const items = list.querySelectorAll('.btm-item');
  const sel = list.querySelector('.btm-item.selected');
  const idx = sel ? Array.from(items).indexOf(sel) : -1;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    sel?.classList.remove('selected');
    const next = items[Math.min(idx + 1, items.length - 1)];
    next?.classList.add('selected');
    next?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    sel?.classList.remove('selected');
    const prev = items[Math.max(idx - 1, 0)];
    prev?.classList.add('selected');
    prev?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const active = list.querySelector('.btm-item.selected');
    if (active) { _btmCallback?.(active.dataset.type); hideBlockTypeMenu(); }
  } else if (e.key === 'Escape') {
    hideBlockTypeMenu();
  }
}

export function hideBlockTypeMenu() {
  document.getElementById('block-type-menu')?.classList.add('hidden');
  _btmCallback = null;
}

// ── Command Palette ───────────────────────────
export function initCommandPalette(onNoteSelect, onCommand) {
  const palette = document.getElementById('command-palette');
  const input = document.getElementById('cp-input');
  if (!palette || !input) return;

  const open = () => { palette.classList.remove('hidden'); input.value = ''; input.focus(); renderCP(''); };
  const close = () => palette.classList.add('hidden');

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); palette.classList.contains('hidden') ? open() : close(); }
    if (e.key === 'Escape' && !palette.classList.contains('hidden')) close();
  });

  document.getElementById('search-trigger')?.addEventListener('click', open);
  palette.querySelector('.cp-backdrop')?.addEventListener('click', close);
  input.addEventListener('input', () => renderCP(input.value));
  input.addEventListener('keydown', e => {
    const results = document.getElementById('cp-results');
    const items = results.querySelectorAll('.cp-result-item');
    const sel = results.querySelector('.selected');
    const idx = sel ? Array.from(items).indexOf(sel) : -1;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel?.classList.remove('selected'); items[Math.min(idx + 1, items.length - 1)]?.classList.add('selected'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel?.classList.remove('selected'); items[Math.max(idx - 1, 0)]?.classList.add('selected'); }
    else if (e.key === 'Enter') { e.preventDefault(); sel?.click(); }
    else if (e.key === 'Escape') close();
  });

  async function renderCP(query) {
    const results = document.getElementById('cp-results');
    results.innerHTML = '';
    if (!query) {
      addGroup(results, 'Recent Notes');
      getState().notes.slice(0, 8).forEach(n =>
        results.appendChild(cpItem(n.icon || '📄', n.title || 'Untitled', fmtDate(n.updated_at), () => { onNoteSelect(n.id); close(); }))
      );
      addGroup(results, 'Commands');
      [
        { icon: '#icon-new', label: 'New Note', action: () => { onCommand('new'); close(); } },
        { icon: '#icon-settings', label: 'Settings', action: () => { onCommand('settings'); close(); } },
        { icon: '#icon-moon', label: 'Toggle Theme', action: () => { onCommand('theme'); close(); } },
      ].forEach(({ icon, label, action }) => results.appendChild(cpItem(null, label, '', action, icon)));
    } else {
      try {
        const found = await db.searchNotes(query);
        if (found.length) {
          addGroup(results, 'Notes');
          found.forEach(n => results.appendChild(cpItem(n.icon || '📄', n.title || 'Untitled', fmtDate(n.updated_at), () => { onNoteSelect(n.id); close(); })));
        } else {
          results.innerHTML = `<div class="cp-group-label">No results for "${esc(query)}"</div>`;
        }
      } catch {}
    }
    results.querySelector('.cp-result-item')?.classList.add('selected');
  }
}

function addGroup(container, label) {
  const d = document.createElement('div');
  d.className = 'cp-group-label';
  d.textContent = label;
  container.appendChild(d);
}

function cpItem(emoji, title, subtitle, onClick, svgIcon = null) {
  const item = document.createElement('div');
  item.className = 'cp-result-item';
  const icon = document.createElement('div');
  icon.className = 'cp-result-icon';
  icon.innerHTML = svgIcon ? `<svg width="16" height="16"><use href="${svgIcon}"/></svg>` : (emoji || '📄');
  const text = document.createElement('div');
  text.className = 'cp-result-text';
  text.innerHTML = `<div class="cp-result-title">${esc(title)}</div>${subtitle ? `<div class="cp-result-subtitle">${esc(subtitle)}</div>` : ''}`;
  item.append(icon, text);
  item.addEventListener('click', onClick);
  return item;
}

// ── Context Menu ──────────────────────────────
export function initContextMenu() {
  document.addEventListener('click', () =>
    document.getElementById('context-menu')?.classList.add('hidden')
  );
}

export function showContextMenu(e, items) {
  const menu = document.getElementById('context-menu');
  if (!menu) return;
  menu.innerHTML = '';
  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div'); sep.className = 'ctx-separator'; menu.appendChild(sep); return;
    }
    const el = document.createElement('div');
    el.className = `ctx-item${item.danger ? ' danger' : ''}`;
    el.innerHTML = `${item.icon ? `<svg width="14" height="14"><use href="${item.icon}"/></svg>` : ''}${esc(item.label)}`;
    el.addEventListener('click', ev => { ev.stopPropagation(); item.action?.(); menu.classList.add('hidden'); });
    menu.appendChild(el);
  });
  positionAt(menu, e.clientX, e.clientY, 180, items.length * 36 + 12);
  menu.classList.remove('hidden');
  e.stopPropagation();
}

// ── Settings Modal ────────────────────────────
export function initSettings(onTokenChange) {
  const modal = document.getElementById('settings-modal');
  const body = document.getElementById('settings-body');
  if (!modal) return;
  const open = () => { body.innerHTML = buildSettings(); modal.classList.remove('hidden'); attachSettingsEvents(onTokenChange); };
  const close = () => modal.classList.add('hidden');
  document.getElementById('settings-btn')?.addEventListener('click', open);
  document.getElementById('settings-close')?.addEventListener('click', close);
  modal.querySelector('.modal-backdrop')?.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
}

function buildSettings() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  return `
    <div class="settings-row">
      <div class="settings-row-label"><span>Theme</span><small>Current: ${theme}</small></div>
      <label class="toggle-switch">
        <input type="checkbox" id="theme-toggle-settings" ${theme === 'light' ? 'checked' : ''}>
        <div class="toggle-track"></div>
      </label>
    </div>
    <div class="settings-row"><div class="settings-row-label"><span>Auth Token</span><small>Turso database token</small></div></div>
    <div class="settings-token-field">
      <input type="password" id="settings-token-input" value="${esc(localStorage.getItem('cobalt_token') || '')}" placeholder="Paste new token…"/>
      <button id="settings-token-save">Save</button>
    </div>
    <div class="settings-row" style="margin-top:16px">
      <div class="settings-row-label"><span>Database URL</span><small>libsql://cobalt-ojaskul26.aws-ap-south-1.turso.io</small></div>
    </div>
    <div class="settings-row" style="margin-top:8px;flex-direction:column;align-items:flex-start;gap:8px">
      <div class="settings-row-label"><span>Shortcuts</span></div>
      <div style="font-size:13px;color:var(--text-secondary);font-family:var(--font-ui);line-height:2.2">
        <kbd>⌘K</kbd> Command palette &nbsp;
        <kbd>/</kbd> Block menu &nbsp;
        <kbd>Enter</kbd> New block &nbsp;
        <kbd>Backspace</kbd> Delete empty block &nbsp;
        <kbd>**bold**</kbd> <kbd>*italic*</kbd> <kbd>\`code\`</kbd> <kbd>==highlight==</kbd> <kbd>~~strike~~</kbd>
      </div>
    </div>`;
}

function attachSettingsEvents(onTokenChange) {
  document.getElementById('theme-toggle-settings')?.addEventListener('change', e => {
    applyTheme(e.target.checked ? 'light' : 'dark');
  });
  document.getElementById('settings-token-save')?.addEventListener('click', () => {
    const val = document.getElementById('settings-token-input')?.value?.trim();
    if (val) {
      localStorage.setItem('cobalt_token', val);
      onTokenChange?.(val);
      showToast('Token updated — reloading…', 'success');
      setTimeout(() => location.reload(), 800);
    }
  });
}

// ── Sidebar controls ──────────────────────────
export function initSidebarControls() {
  const sidebar = document.getElementById('sidebar');
  const closeBtn = document.getElementById('sidebar-close-btn');
  const fab = document.getElementById('sidebar-open-fab');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');

  // Desktop collapse/expand
  closeBtn?.addEventListener('click', () => {
    const collapsed = sidebar?.classList.toggle('collapsed');
    fab?.classList.toggle('hidden', !collapsed);
  });

  fab?.addEventListener('click', () => {
    sidebar?.classList.remove('collapsed');
    fab.classList.add('hidden');
  });

  // Mobile slide-in
  mobileMenuBtn?.addEventListener('click', () => {
    const isOpen = sidebar?.classList.toggle('mobile-open');
    let overlay = document.getElementById('sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebar-overlay';
      overlay.className = 'sidebar-overlay';
      document.body.appendChild(overlay);
    }
    overlay.classList.toggle('visible', isOpen);
    overlay.addEventListener('click', () => {
      sidebar?.classList.remove('mobile-open');
      overlay.classList.remove('visible');
    }, { once: true });
  });
}

// ── Theme ─────────────────────────────────────
export function initThemeToggle() {
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });
  const saved = localStorage.getItem('cobalt_theme');
  applyTheme(saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('cobalt_theme', theme);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.setAttribute('href', theme === 'dark' ? '#icon-moon' : '#icon-sun');
  const dark = document.getElementById('hljs-theme-dark');
  const light = document.getElementById('hljs-theme-light');
  if (dark) dark.disabled = theme === 'light';
  if (light) light.disabled = theme === 'dark';
}

// ── Position helpers (viewport-aware) ─────────
function positionBelow(el, anchor, width, height) {
  const r = anchor.getBoundingClientRect();
  let top = r.bottom + 4;
  let left = r.left;
  if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 4);
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
  if (left < 8) left = 8;
  el.style.cssText = `left:${left}px;top:${top}px;transform:none`;
}

function positionAt(el, x, y, width, height) {
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - height - 8);
  el.style.cssText = `left:${Math.max(8, left)}px;top:${Math.max(8, top)}px;transform:none`;
}

function closePicker(picker, anchor) {
  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!picker.contains(e.target) && e.target !== anchor) picker.classList.add('hidden');
      document.removeEventListener('click', close);
    });
  }, 50);
}

// ── Helpers ───────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date(), diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  return d.toLocaleDateString();
}