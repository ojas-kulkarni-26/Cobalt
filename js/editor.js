// ============================================
// COBALT — editor.js
// Block engine: local-first, single JSON save
// ============================================

import { getState, setState, upsertBlock, removeBlock } from './store.js';
import { buildBlockDOM, createBlockData, BLOCK_TYPES } from './blocks.js';
import * as db from './db.js';
import { generateId } from './utils.js';
import { showBlockTypeMenu, hideBlockTypeMenu, setSyncStatus, showContextMenu } from './ui.js';

const container = () => document.getElementById('blocks-container');
let _activeNoteId = null;
let _dragSrcId = null;

// ── Debounced save (single JSON write) ────────
let _saveTimer = null;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (!_activeNoteId) return;
    setSyncStatus('syncing');
    try {
      const blocks = getState().activeBlocks;
      await db.saveNoteBlocks(_activeNoteId, blocks);
      setSyncStatus('ok');
    } catch (err) {
      console.error('Save failed:', err);
      setSyncStatus('error');
    }
  }, 800);
}

// ── Block callbacks (no individual DB calls) ──
const blockCallbacks = {
  onBlockChange(blockId, contentPatch) {
    const block = getState().activeBlocks.find(b => b.id === blockId);
    if (!block) return;
    const newContent = { ...block.content, ...contentPatch };
    upsertBlock({ ...block, content: newContent });
    scheduleSave();
  },

  onKeyDown(e, blockId, el) { handleBlockKeyDown(e, blockId, el); },
  onDragStart(e, blockId)   { handleDragStart(e, blockId); },
  onDragOver(e, blockId)    { handleDragOver(e, blockId); },
  onDragLeave(e)            { handleDragLeave(e); },
  onDrop(e, blockId)        { handleDrop(e, blockId); },
  onDragEnd(e)              { handleDragEnd(e); },
  onContextMenu(e, blockId) { showBlockCtxMenu(e, blockId); },
  onSlashCommand(blockId, el) { showBlockTypeMenu(type => changeBlockType(blockId, type), el); },
  onSlashClose() { hideBlockTypeMenu(); },
  onAddBelow(blockId, e)    { showBlockTypeMenu(type => insertBlock(type, blockId), null, e); },
  onCalloutIconClick(blockId, iconEl) { showCalloutIconPicker(blockId, iconEl); },
  onBlockFocus(blockId)     { /* future: could highlight active block in sidebar */ },
};

// ── Render all blocks ─────────────────────────
export function renderBlocks(noteId, blocks) {
  _activeNoteId = noteId;
  const c = container();
  if (!c) return;
  c.innerHTML = '';
  blocks.forEach(block => c.appendChild(buildBlockDOM(block, blockCallbacks)));
}

// ── Insert block ──────────────────────────────
export async function insertBlock(type, afterBlockId = null, overrides = {}) {
  const blocks = getState().activeBlocks;
  let position;
  let number = 1;

  if (afterBlockId) {
    const idx = blocks.findIndex(b => b.id === afterBlockId);
    const after = blocks[idx];
    const next = blocks[idx + 1];
    position = next ? (after.position + next.position) / 2 : after.position + 1;
    // For numbered lists, auto-increment
    if (type === 'numbered' && after.type === 'numbered') {
      number = (after.content.number || 1) + 1;
    }
  } else {
    position = blocks.length > 0 ? blocks[blocks.length - 1].position + 1 : 1;
  }

  if (type === 'numbered' && !('number' in overrides)) overrides.number = number;

  const block = createBlockData(type, _activeNoteId, position, overrides);
  const wrap = buildBlockDOM(block, blockCallbacks);
  const c = container();

  if (afterBlockId) {
    const afterEl = c.querySelector(`.block-wrap[data-block-id="${afterBlockId}"]`);
    afterEl ? afterEl.insertAdjacentElement('afterend', wrap) : c.appendChild(wrap);
  } else {
    c.appendChild(wrap);
  }

  upsertBlock(block);
  setTimeout(() => focusBlock(wrap), 30);
  scheduleSave();
  return block;
}

// ── Delete block ──────────────────────────────
export async function deleteBlock(blockId) {
  const blocks = getState().activeBlocks;
  const idx = blocks.findIndex(b => b.id === blockId);

  const c = container();
  c.querySelector(`.block-wrap[data-block-id="${blockId}"]`)?.remove();
  removeBlock(blockId);

  const prevBlock = blocks[idx - 1];
  if (prevBlock) {
    const prevWrap = c.querySelector(`.block-wrap[data-block-id="${prevBlock.id}"]`);
    if (prevWrap) focusBlock(prevWrap, true);
  }

  scheduleSave();
}

// ── Change block type ─────────────────────────
export async function changeBlockType(blockId, newType) {
  const block = getState().activeBlocks.find(b => b.id === blockId);
  if (!block) return;

  const def = BLOCK_TYPES.find(t => t.type === newType);
  const oldText = block.content.text || block.content.title || block.content.code || '';
  const newContent = { ...def.defaultContent, text: oldText };
  if (newType === 'h1' || newType === 'h2' || newType === 'h3') delete newContent.text, newContent.text = oldText;

  const c = container();
  const oldWrap = c.querySelector(`.block-wrap[data-block-id="${blockId}"]`);
  const newBlock = { ...block, type: newType, content: newContent };
  const newWrap = buildBlockDOM(newBlock, blockCallbacks);
  if (oldWrap) oldWrap.replaceWith(newWrap);

  upsertBlock(newBlock);
  setTimeout(() => focusBlock(newWrap), 30);
  scheduleSave();
}

// ── Duplicate block ───────────────────────────
export async function duplicateBlock(blockId) {
  const block = getState().activeBlocks.find(b => b.id === blockId);
  if (!block) return;
  await insertBlock(block.type, blockId, { ...block.content });
}

// ── Keyboard navigation ───────────────────────
function handleBlockKeyDown(e, blockId, el) {
  const blocks = getState().activeBlocks;
  const idx = blocks.findIndex(b => b.id === blockId);
  const block = blocks[idx];
  const c = container();

  // Enter → create next block (same type for lists, paragraph otherwise)
  if (e.key === 'Enter' && !e.shiftKey) {
    if (['code', 'table', 'math'].includes(block?.type)) return;
    e.preventDefault();
    hideBlockTypeMenu();

    let newType = 'paragraph';
    if (block?.type === 'bullet') newType = 'bullet';
    if (block?.type === 'numbered') newType = 'numbered';
    // Empty list item → escape list and create paragraph
    if ((newType === 'bullet' || newType === 'numbered') && el && el.textContent.trim() === '') {
      changeBlockType(blockId, 'paragraph');
      return;
    }
    insertBlock(newType, blockId);
    return;
  }

  // Backspace on empty → delete or convert
  if (e.key === 'Backspace' && el && el.textContent === '') {
    if (block && block.type !== 'paragraph') {
      e.preventDefault();
      changeBlockType(blockId, 'paragraph');
    } else if (blocks.length > 1) {
      e.preventDefault();
      deleteBlock(blockId);
    }
    hideBlockTypeMenu();
    return;
  }

  // Arrow up → focus previous block
  if (e.key === 'ArrowUp' && isAtStart(el)) {
    const prev = blocks[idx - 1];
    if (prev) {
      e.preventDefault();
      const pw = c.querySelector(`.block-wrap[data-block-id="${prev.id}"]`);
      if (pw) focusBlock(pw, true);
    }
    return;
  }

  // Arrow down → focus next block
  if (e.key === 'ArrowDown' && isAtEnd(el)) {
    const next = blocks[idx + 1];
    if (next) {
      e.preventDefault();
      const nw = c.querySelector(`.block-wrap[data-block-id="${next.id}"]`);
      if (nw) focusBlock(nw);
    }
    return;
  }

  // Slash on empty → block type menu
  if (e.key === '/' && el && el.textContent === '') {
    e.preventDefault();
    showBlockTypeMenu(type => {
      el.textContent = '';
      changeBlockType(blockId, type);
      hideBlockTypeMenu();
    }, el);
  }
}

function isAtStart(el) {
  if (!el) return false;
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;
  const range = sel.getRangeAt(0);
  return range.collapsed && range.startOffset === 0 &&
    (range.startContainer === el || !range.startContainer.previousSibling);
}

function isAtEnd(el) {
  if (!el) return false;
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;
  const preRange = document.createRange();
  preRange.selectNodeContents(el);
  preRange.setStart(range.endContainer, range.endOffset);
  return preRange.toString().length === 0;
}

// ── Drag and drop ─────────────────────────────
function handleDragStart(e, blockId) {
  _dragSrcId = blockId;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('dragging');
}

function handleDragOver(e, blockId) {
  if (!_dragSrcId || _dragSrcId === blockId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  container().querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(x =>
    x.classList.remove('drag-over-top', 'drag-over-bottom')
  );
  const wrap = e.currentTarget;
  const mid = wrap.getBoundingClientRect().top + wrap.getBoundingClientRect().height / 2;
  wrap.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
}

function handleDrop(e, targetBlockId) {
  e.preventDefault();
  if (!_dragSrcId || _dragSrcId === targetBlockId) return;
  const wrap = e.currentTarget;
  const isTop = wrap.classList.contains('drag-over-top');
  wrap.classList.remove('drag-over-top', 'drag-over-bottom');

  const c = container();
  const srcWrap = c.querySelector(`.block-wrap[data-block-id="${_dragSrcId}"]`);
  const tgtWrap = c.querySelector(`.block-wrap[data-block-id="${targetBlockId}"]`);
  if (!srcWrap || !tgtWrap) return;

  isTop
    ? tgtWrap.insertAdjacentElement('beforebegin', srcWrap)
    : tgtWrap.insertAdjacentElement('afterend', srcWrap);

  const newOrder = Array.from(c.querySelectorAll('.block-wrap')).map((el, i) => ({
    id: el.dataset.blockId, position: i + 1,
  }));

  const blocks = getState().activeBlocks;
  const updated = newOrder.map(({ id, position }) => {
    const b = blocks.find(x => x.id === id);
    return b ? { ...b, position } : null;
  }).filter(Boolean);

  setState({ activeBlocks: updated });
  scheduleSave();
}

function handleDragEnd() {
  _dragSrcId = null;
  container()?.querySelectorAll('.dragging,.drag-over-top,.drag-over-bottom').forEach(x =>
    x.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom')
  );
}

// ── Focus helpers ─────────────────────────────
function focusBlock(wrap, toEnd = false) {
  const el = wrap.querySelector('[contenteditable]:not([disabled]), textarea');
  if (!el) return;
  if (el.tagName === 'TEXTAREA') { el.focus(); return; }
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  try {
    if (toEnd) { range.selectNodeContents(el); range.collapse(false); }
    else { range.setStart(el, 0); range.collapse(true); }
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
}

// ── Block context menu ────────────────────────
function showBlockCtxMenu(e, blockId) {
  showContextMenu(e, [
    {
      label: 'Change type', icon: '#icon-toggle',
      action: () => showBlockTypeMenu(type => changeBlockType(blockId, type), null, e),
    },
    {
      label: 'Duplicate', icon: '#icon-copy',
      action: () => duplicateBlock(blockId),
    },
    { separator: true },
    {
      label: 'Delete block', icon: '#icon-trash', danger: true,
      action: () => deleteBlock(blockId),
    },
  ]);
}

// ── Callout icon picker ───────────────────────
function showCalloutIconPicker(blockId, iconEl) {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  const EMOJIS = ['💡','⚠️','✅','❌','📌','🔥','💬','📝','🎯','🚀','💎','🔑','📎','🧪','⚡','🌟','🛑','ℹ️'];
  picker.innerHTML = `<div class="emoji-grid">${EMOJIS.map(e => `<button class="emoji-btn" data-emoji="${e}">${e}</button>`).join('')}</div>`;
  const rect = iconEl.getBoundingClientRect();
  picker.style.cssText = `left:${rect.left}px;top:${rect.bottom + 4}px`;
  picker.classList.remove('hidden');
  picker.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      iconEl.textContent = btn.dataset.emoji;
      picker.classList.add('hidden');
      const block = getState().activeBlocks.find(b => b.id === blockId);
      if (block) {
        const nc = { ...block.content, icon: btn.dataset.emoji };
        upsertBlock({ ...block, content: nc });
        scheduleSave();
      }
    });
  });
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!picker.contains(ev.target) && ev.target !== iconEl) picker.classList.add('hidden');
      document.removeEventListener('click', close);
    });
  }, 50);
}

export { _activeNoteId };