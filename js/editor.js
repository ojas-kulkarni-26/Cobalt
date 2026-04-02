// ============================================
// COBALT — editor.js
// Block engine: local-first, single JSON save
// ============================================

import { getState, setState, upsertBlock, removeBlock } from './store.js';
import { buildBlockDOM, createBlockData, BLOCK_TYPES } from './blocks.js';
import { parsePastedContent } from './parser.js';
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
  onTouchStart(e, blockId)  { handleTouchStart(e, blockId); },
  onTouchMove(e)            { handleTouchMove(e); },
  onTouchEnd(e)             { handleTouchEnd(e); },
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

  // Container-level touch listeners for reliable move/end tracking
  if (!c._touchDragBound) {
    c.addEventListener('touchmove', e => handleTouchMove(e), { passive: false });
    c.addEventListener('touchend', e => handleTouchEnd(e));
    c.addEventListener('touchcancel', e => handleTouchEnd(e));
    c._touchDragBound = true;
  }

  // Container-level paste handler for smart block insertion
  if (!c._pasteHandlerBound) {
    c.addEventListener('paste', handlePaste);
    c._pasteHandlerBound = true;
  }
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

// ── Touch drag and drop (mobile) ───────────────
let _touchSrcId = null;

function handleTouchStart(e, blockId) {
  if (e.touches.length !== 1) return;
  const handle = e.currentTarget.querySelector('.block-drag-handle');
  if (!handle || !handle.contains(e.target)) return;
  e.preventDefault();
  _touchSrcId = blockId;
  e.currentTarget.classList.add('dragging');
}

function handleTouchMove(e) {
  if (!_touchSrcId) return;
  e.preventDefault();
  const touch = e.touches[0];
  const c = container();
  c.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(x =>
    x.classList.remove('drag-over-top', 'drag-over-bottom')
  );
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const wrap = el?.closest('.block-wrap');
  if (wrap && wrap.dataset.blockId !== _touchSrcId) {
    const mid = wrap.getBoundingClientRect().top + wrap.getBoundingClientRect().height / 2;
    wrap.classList.add(touch.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
  }
}

function handleTouchEnd(e) {
  if (!_touchSrcId) return;
  const c = container();
  const srcId = _touchSrcId;
  _touchSrcId = null;

  const overEl = c.querySelector('.drag-over-top, .drag-over-bottom');
  const srcWrap = c.querySelector(`.block-wrap[data-block-id="${srcId}"]`);
  c.querySelectorAll('.dragging,.drag-over-top,.drag-over-bottom').forEach(x =>
    x.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom')
  );

  if (overEl && srcWrap) {
    const isTop = overEl.classList.contains('drag-over-top');
    overEl.classList.remove('drag-over-top', 'drag-over-bottom');
    isTop
      ? overEl.insertAdjacentElement('beforebegin', srcWrap)
      : overEl.insertAdjacentElement('afterend', srcWrap);

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

// ── Smart Paste Handler ───────────────────────
async function handlePaste(e) {
  const activeEl = document.activeElement;
  if (!activeEl || !activeEl.closest('.block-wrap')) return;
  
  const blockWrap = activeEl.closest('.block-wrap');
  const blockId = blockWrap?.dataset.blockId;
  const block = blockId ? getState().activeBlocks.find(b => b.id === blockId) : null;
  
  const text = e.clipboardData?.getData('text/plain') || '';
  const html = e.clipboardData?.getData('text/html') || '';
  
  console.log('Smart Paste Debug:', { text: text.substring(0, 100), hasHtml: !!html });
  
  if (!text.trim()) return;
  
  e.preventDefault();
  e.stopPropagation();
  
  const parsedBlocks = parsePastedContent(text, html);
  
  console.log('Parsed blocks:', parsedBlocks);
  
  if (parsedBlocks.length === 0) return;
  
  if (parsedBlocks.length === 1 && parsedBlocks[0].type === 'paragraph') {
    document.execCommand('insertText', false, text);
    
    // Trigger inline markdown and latex rendering after paste
    const activeEl2 = document.activeElement;
    if (activeEl2?.closest('.block-wrap')) {
      const editable = activeEl2.closest('.block-wrap').querySelector('[contenteditable]');
      if (editable) {
        if (window.katex) applyInlineLatexOnElement(editable);
        applyInlineMarkdownOnElement(editable);
      }
    }
    return;
  }
  
  const c = container();
  const activeBlockId = blockId;
  let insertAfterId = activeBlockId;
  
  if (activeBlockId && activeEl.textContent.trim() === '') {
    const firstBlock = parsedBlocks[0];
    await changeBlockType(activeBlockId, firstBlock.type);
    const updatedBlock = getState().activeBlocks.find(b => b.id === activeBlockId);
    if (updatedBlock) {
      const defContent = BLOCK_TYPES.find(t => t.type === firstBlock.type)?.defaultContent || {};
      const newContent = { ...defContent, ...firstBlock.content };
      upsertBlock({ ...updatedBlock, content: newContent });
      
      const newWrap = c.querySelector(`.block-wrap[data-block-id="${activeBlockId}"]`);
      if (newWrap) {
        const editable = newWrap.querySelector('[contenteditable], textarea');
        if (editable) {
          if (editable.tagName === 'TEXTAREA') {
            editable.value = newContent.code || newContent.latex || '';
          } else {
            editable.innerHTML = newContent.text || newContent.title || '';
          }
        }
      }
      scheduleSave();
    }
    insertAfterId = activeBlockId;
    parsedBlocks.shift();
  } else if (activeBlockId) {
    const newBlock = await insertBlock('paragraph', activeBlockId);
    insertAfterId = newBlock.id;
  }
  
  if (parsedBlocks.length === 0) return;
  
  let lastInsertedId = insertAfterId;
  
  if (!lastInsertedId) {
    const blocks = getState().activeBlocks;
    if (blocks.length > 0) {
      lastInsertedId = blocks[blocks.length - 1].id;
    } else {
      lastInsertedId = (await insertBlock('paragraph', null)).id;
    }
  }
  
  for (const pb of parsedBlocks) {
    const type = pb.type;
    
    if (type === 'bullet' && pb.items) {
      for (const item of pb.items) {
        lastInsertedId = (await insertBlock('bullet', lastInsertedId, { text: item.text })).id;
      }
    } else if (type === 'numbered' && pb.items) {
      for (const item of pb.items) {
        lastInsertedId = (await insertBlock('numbered', lastInsertedId, { text: item.text, number: item.number })).id;
      }
    } else if (type === 'bullet') {
      lastInsertedId = (await insertBlock('bullet', lastInsertedId, { text: pb.content.text })).id;
    } else if (type === 'numbered') {
      lastInsertedId = (await insertBlock('numbered', lastInsertedId, { text: pb.content.text, number: pb.content.number })).id;
    } else {
      lastInsertedId = (await insertBlock(type, lastInsertedId, pb.content)).id;
    }
  }
  
  const lastWrap = c.querySelector(`.block-wrap[data-block-id="${lastInsertedId}"]`);
  if (lastWrap) {
    // Trigger inline latex and markdown rendering on the inserted content
    const editable = lastWrap.querySelector('[contenteditable]');
    if (editable) {
      if (window.katex) applyInlineLatexOnElement(editable);
      applyInlineMarkdownOnElement(editable);
    }
    setTimeout(() => focusBlock(lastWrap, true), 50);
  }
  
  scheduleSave();
}

function applyInlineLatexOnElement(el) {
  if (!window.katex) return;
  
  let html = el.innerHTML;
  const LATEX_DELIMITERS = [
    { start: '$$', end: '$$', display: true },
    { start: '$', end: '$', display: false },
    { start: '\\(', end: '\\)', display: false },
    { start: '\\[', end: '\\]', display: true },
  ];
  
  for (const { start, end, display } of LATEX_DELIMITERS) {
    try {
      const escapedStart = start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, 'g');
      
      html = html.replace(re, (match, latex) => {
        try {
          return katex.renderToString(latex.trim(), { 
            displayMode: display,
            throwOnError: false 
          });
        } catch (e) {
          return match;
        }
      });
    } catch (e) {}
  }
  
  el.innerHTML = html;
}

function applyInlineMarkdownOnElement(el) {
  const patterns = [
    { open: '**', close: '**', tag: 'strong' },
    { open: '*', close: '*', tag: 'em' },
    { open: '`', close: '`', tag: 'code' },
    { open: '==', close: '==', tag: 'mark' },
    { open: '~~', close: '~~', tag: 's' },
  ];
  
  let html = el.innerHTML;
  
  // Apply bold first (longer pattern)
  for (const { open, close, tag } of patterns) {
    const escapedOpen = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedClose = close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escapedOpen}([^${escapedClose[0]}]*?)${escapedClose}`, 'g');
    html = html.replace(re, (match, inner) => {
      if (match.includes(`<${tag}>`)) return match;
      return `<${tag}>${inner}</${tag}>`;
    });
  }
  
  // Apply link pattern
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  html = html.replace(linkRegex, (match, text, url) => {
    if (match.includes('<a ')) return match;
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  
  el.innerHTML = html;
}
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