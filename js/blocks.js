// ============================================
// COBALT — blocks.js
// Block definitions, DOM builders, inline markdown
// ============================================

import { generateId } from './utils.js';

// ── Block type registry ──────────────────────
export const BLOCK_TYPES = [
  { type: 'paragraph', label: 'Paragraph',     desc: 'Plain text',              icon: '¶',   group: 'Basic',    defaultContent: { text: '' } },
  { type: 'h1',        label: 'Heading 1',     desc: 'Large heading',           icon: 'H1',  group: 'Basic',    defaultContent: { text: '' } },
  { type: 'h2',        label: 'Heading 2',     desc: 'Medium heading',          icon: 'H2',  group: 'Basic',    defaultContent: { text: '' } },
  { type: 'h3',        label: 'Heading 3',     desc: 'Small heading',           icon: 'H3',  group: 'Basic',    defaultContent: { text: '' } },
  { type: 'bullet',    label: 'Bullet List',   desc: 'Unordered list item',     icon: '•',   group: 'Lists',    defaultContent: { text: '' } },
  { type: 'numbered',  label: 'Numbered List', desc: 'Ordered list item',       icon: '1.',  group: 'Lists',    defaultContent: { text: '', number: 1 } },
  { type: 'quote',     label: 'Quote',         desc: 'Blockquote',              icon: '"',   group: 'Basic',    defaultContent: { text: '' } },
  { type: 'callout',   label: 'Callout',       desc: 'Highlighted note',        icon: '💡',  group: 'Basic',    defaultContent: { text: '', icon: '💡' } },
  { type: 'code',      label: 'Code',          desc: 'Code with highlighting',  icon: '</>',  group: 'Advanced', defaultContent: { code: '', language: 'javascript' } },
  { type: 'math',      label: 'Math / LaTeX',  desc: 'KaTeX equation block',    icon: '∑',   group: 'Advanced', defaultContent: { latex: '' } },
  { type: 'image',     label: 'Image',         desc: 'Image from URL',          icon: '🖼',  group: 'Media',    defaultContent: { url: '', caption: '' } },
  { type: 'table',     label: 'Table',         desc: 'Structured table',        icon: '⊞',   group: 'Advanced', defaultContent: { headers: ['Column 1', 'Column 2', 'Column 3'], rows: [['', '', ''], ['', '', '']] } },
  { type: 'divider',   label: 'Divider',       desc: 'Horizontal rule',         icon: '—',   group: 'Basic',    defaultContent: {} },
  { type: 'toggle',    label: 'Toggle',        desc: 'Collapsible section',     icon: '▶',   group: 'Advanced', defaultContent: { title: '', body: '', open: false } },
];

export function getBlockDef(type) {
  return BLOCK_TYPES.find(b => b.type === type) || BLOCK_TYPES[0];
}

export function createBlockData(type, noteId, position, overrides = {}) {
  const def = getBlockDef(type);
  return {
    id: generateId(),
    note_id: noteId,
    type,
    content: { ...def.defaultContent, ...overrides },
    position,
  };
}

// ── Build block DOM ──────────────────────────
export function buildBlockDOM(block, callbacks) {
  const wrap = document.createElement('div');
  wrap.className = 'block-wrap';
  wrap.dataset.blockId = block.id;
  wrap.dataset.blockType = block.type;
  wrap.draggable = true;

  const controls = document.createElement('div');
  controls.className = 'block-controls';

  const addBtn = document.createElement('button');
  addBtn.className = 'block-add-btn';
  addBtn.title = 'Add block below';
  addBtn.innerHTML = `<svg width="14" height="14"><use href="#icon-plus"/></svg>`;
  addBtn.addEventListener('click', e => { e.stopPropagation(); callbacks.onAddBelow(block.id, e); });

  const dragHandle = document.createElement('div');
  dragHandle.className = 'block-drag-handle';
  dragHandle.title = 'Drag to reorder';
  dragHandle.innerHTML = `<svg width="14" height="14"><use href="#icon-drag"/></svg>`;

  controls.appendChild(addBtn);
  controls.appendChild(dragHandle);

  const content = document.createElement('div');
  content.className = 'block-content';
  content.appendChild(buildBlockInner(block, callbacks));

  wrap.appendChild(controls);
  wrap.appendChild(content);

  wrap.addEventListener('dragstart', e => callbacks.onDragStart(e, block.id));
  wrap.addEventListener('dragover',  e => callbacks.onDragOver(e, block.id));
  wrap.addEventListener('dragleave', e => callbacks.onDragLeave(e));
  wrap.addEventListener('drop',      e => callbacks.onDrop(e, block.id));
  wrap.addEventListener('dragend',   e => callbacks.onDragEnd(e));
  wrap.addEventListener('touchstart', e => callbacks.onTouchStart(e, block.id), { passive: false });
  wrap.addEventListener('touchmove', e => callbacks.onTouchMove(e), { passive: false });
  wrap.addEventListener('touchend',  e => callbacks.onTouchEnd(e));
  wrap.addEventListener('contextmenu', e => { e.preventDefault(); callbacks.onContextMenu(e, block.id); });

  return wrap;
}

function buildBlockInner(block, callbacks) {
  const { type, content, id } = block;
  switch (type) {
    case 'paragraph': return buildParagraph(id, content, callbacks);
    case 'h1':        return buildHeading(id, content, 'h1', callbacks);
    case 'h2':        return buildHeading(id, content, 'h2', callbacks);
    case 'h3':        return buildHeading(id, content, 'h3', callbacks);
    case 'bullet':    return buildBullet(id, content, callbacks);
    case 'numbered':  return buildNumbered(id, content, callbacks);
    case 'quote':     return buildQuote(id, content, callbacks);
    case 'callout':   return buildCallout(id, content, callbacks);
    case 'code':      return buildCode(id, content, callbacks);
    case 'math':      return buildMath(id, content, callbacks);
    case 'image':     return buildImage(id, content, callbacks);
    case 'table':     return buildTable(id, content, callbacks);
    case 'divider':   return buildDivider();
    case 'toggle':    return buildToggle(id, content, callbacks);
    default:          return buildParagraph(id, content, callbacks);
  }
}

// ── Inline Markdown ───────────────────────────
// Applies **bold**, *italic*, `code`, ==highlight==, ~~strike~~ on trigger chars
const MD_PATTERNS = [
  [/\*\*([^*\n<]+?)\*\*/g,   '<strong>$1</strong>'],
  [/(?<!\*)\*([^*\n<]+?)\*(?!\*)/g, '<em>$1</em>'],
  [/`([^`\n<]+?)`/g,          '<code>$1</code>'],
  [/==([^=\n<]+?)==/g,        '<mark>$1</mark>'],
  [/~~([^~\n<]+?)~~/g,        '<s>$1</s>'],
];

const TRIGGER_CHARS = new Set(['*', '`', '=', '~', ' ', '$', '\\']);

function applyInlineMarkdown(el) {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;

  // Measure how many chars are AFTER the cursor (so we can restore it)
  const range = sel.getRangeAt(0);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(el);
  try { afterRange.setStart(range.endContainer, range.endOffset); }
  catch { return; }
  const charsFromEnd = afterRange.toString().length;

  const oldHtml = el.innerHTML;
  let html = oldHtml;
  MD_PATTERNS.forEach(([re, repl]) => { html = html.replace(re, repl); });
  if (html === oldHtml) return;

  el.innerHTML = html;

  // Restore cursor by walking to (totalLen - charsFromEnd)
  const totalLen = el.textContent.length;
  const target = Math.max(0, totalLen - charsFromEnd);
  const pos = findTextNode(el, target);
  if (!pos) return;
  try {
    const r = document.createRange();
    r.setStart(pos.node, pos.offset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {}
}

function findTextNode(root, offset) {
  let cur = 0;
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent.length;
      if (cur + len >= offset) return { node, offset: offset - cur };
      cur += len;
      return null;
    }
    for (const child of node.childNodes) {
      const r = walk(child); if (r) return r;
    }
    return null;
  }
  return walk(root) || { node: root, offset: 0 };
}

// ── Inline LaTeX Rendering ──────────────────────
const LATEX_DELIMITERS = [
  { start: '$$', end: '$$', display: true },
  { start: '$', end: '$', display: false },
  { start: '\\(', end: '\\)', display: false },
  { start: '\\[', end: '\\]', display: true },
];

function applyInlineLatex(el) {
  if (!window.katex) return false;
  
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;

  const range = sel.getRangeAt(0);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(el);
  try { afterRange.setStart(range.endContainer, range.endOffset); }
  catch { return false; }
  const charsFromEnd = afterRange.toString().length;

  let html = el.innerHTML;
  let changed = false;

  for (const { start, end, display } of LATEX_DELIMITERS) {
    const escapedStart = start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escapedStart}([^${escapedStart === escapedEnd ? start : ''}\\n]+?)${escapedEnd}`, 'g');
    
    html = html.replace(re, (match, latex) => {
      try {
        changed = true;
        return katex.renderToString(latex.trim(), { 
          displayMode: display,
          throwOnError: false 
        });
      } catch (e) {
        return match;
      }
    });
  }

  if (!changed) return false;

  el.innerHTML = html;

  const totalLen = el.textContent.length;
  const target = Math.max(0, totalLen - charsFromEnd);
  const pos = findTextNode(el, target);
  if (!pos) return true;
  try {
    const r = document.createRange();
    r.setStart(pos.node, pos.offset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {}
  return true;
}

// ── Paragraph ─────────────────────────────────
function buildParagraph(id, content, callbacks) {
  const el = makeEditable('div', 'block-paragraph', id, content.text || '');
  el.dataset.placeholder = "Type '/' for commands…";
  setupTextCallbacks(el, id, callbacks);
  return el;
}

// ── Headings ──────────────────────────────────
function buildHeading(id, content, level, callbacks) {
  const el = makeEditable('div', `block-${level}`, id, content.text || '');
  el.dataset.placeholder = level.toUpperCase();
  setupTextCallbacks(el, id, callbacks);
  return el;
}

// ── Bullet ────────────────────────────────────
function buildBullet(id, content, callbacks) {
  const wrap = el('div', 'block-bullet-wrap');
  const marker = el('div', 'block-bullet-marker');
  const text = makeEditable('div', 'block-bullet-text', id, content.text || '');
  text.dataset.placeholder = 'List item…';
  setupTextCallbacks(text, id, callbacks);
  wrap.append(marker, text);
  return wrap;
}

// ── Numbered ──────────────────────────────────
function buildNumbered(id, content, callbacks) {
  const wrap = el('div', 'block-numbered-wrap');
  const marker = el('div', 'block-numbered-marker');
  marker.textContent = `${content.number || 1}.`;
  const text = makeEditable('div', 'block-numbered-text', id, content.text || '');
  text.dataset.placeholder = 'List item…';
  setupTextCallbacks(text, id, callbacks);
  wrap.append(marker, text);
  return wrap;
}

// ── Quote ─────────────────────────────────────
function buildQuote(id, content, callbacks) {
  const wrap = el('div', 'block-quote-wrap');
  const bar = el('div', 'block-quote-bar');
  const text = makeEditable('div', 'block-quote-text', id, content.text || '');
  text.dataset.placeholder = 'Quote…';
  setupTextCallbacks(text, id, callbacks);
  wrap.append(bar, text);
  return wrap;
}

// ── Callout ───────────────────────────────────
function buildCallout(id, content, callbacks) {
  const wrap = el('div', 'block-callout-wrap');
  const icon = el('div', 'block-callout-icon');
  icon.textContent = content.icon || '💡';
  icon.addEventListener('click', () => callbacks.onCalloutIconClick?.(id, icon));
  const text = makeEditable('div', 'block-callout-text', id, content.text || '');
  text.dataset.placeholder = 'Callout note…';
  setupTextCallbacks(text, id, callbacks);
  wrap.append(icon, text);
  return wrap;
}

// ── Code ──────────────────────────────────────
const CODE_LANGUAGES = [
  'javascript','typescript','python','rust','go','java','c','cpp','csharp',
  'html','css','json','bash','sql','markdown','yaml','ruby','php','swift','kotlin','jsx','tsx',
];

function buildCode(id, content, callbacks) {
  const wrap = el('div', 'block-code-wrap');
  let isEditing = !content.code; // start in edit mode if empty

  // Header
  const header = el('div', 'block-code-header');

  // Language select
  const langSelect = document.createElement('select');
  langSelect.className = 'block-code-lang';
  CODE_LANGUAGES.forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = lang;
    if (lang === (content.language || 'javascript')) opt.selected = true;
    langSelect.appendChild(opt);
  });
  langSelect.addEventListener('change', () => {
    content.language = langSelect.value;
    callbacks.onBlockChange(id, { ...content });
    renderHighlight();
  });

  // Copy btn
  const copyBtn = el('button', 'block-code-copy');
  copyBtn.innerHTML = `<svg width="12" height="12"><use href="#icon-copy"/></svg> Copy`;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(textarea.value).then(() => {
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => {
        copyBtn.innerHTML = `<svg width="12" height="12"><use href="#icon-copy"/></svg> Copy`;
      }, 1500);
    });
  });

  header.append(langSelect, copyBtn);

  // Textarea (edit mode)
  const textarea = document.createElement('textarea');
  textarea.className = 'block-code-input';
  textarea.value = content.code || '';
  textarea.placeholder = '// write code here…';
  textarea.spellcheck = false;
  autoResize(textarea);

  textarea.addEventListener('input', () => {
    autoResize(textarea);
    content.code = textarea.value;
    callbacks.onBlockChange(id, { ...content });
  });

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = textarea.selectionStart, end = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(end);
      textarea.selectionStart = textarea.selectionEnd = s + 2;
    }
    // Escape → switch to view
    if (e.key === 'Escape') { switchToView(); }
  });

  textarea.addEventListener('blur', () => {
    if (textarea.value.trim()) switchToView();
  });

  // Rendered (view mode)
  const rendered = el('div', 'block-code-rendered');

  function renderHighlight() {
    const code = textarea.value || content.code || '';
    if (!code.trim()) { rendered.innerHTML = ''; return; }
    if (window.hljs) {
      try {
        const lang = content.language || 'javascript';
        const supported = hljs.getLanguage(lang) ? lang : 'plaintext';
        const result = hljs.highlight(code, { language: supported });
        rendered.innerHTML = `<pre><code class="hljs language-${supported}">${result.value}</code></pre>`;
      } catch {
        rendered.innerHTML = `<pre><code class="hljs">${escHtml(textarea.value)}</code></pre>`;
      }
    } else {
      rendered.innerHTML = `<pre><code>${escHtml(textarea.value)}</code></pre>`;
    }
  }

  function switchToEdit() {
    isEditing = true;
    textarea.style.display = 'block';
    rendered.style.display = 'none';
    textarea.focus();
    autoResize(textarea);
  }

  function switchToView() {
    isEditing = false;
    renderHighlight();
    textarea.style.display = 'none';
    rendered.style.display = 'block';
  }

  rendered.addEventListener('click', switchToEdit);
  rendered.addEventListener('dblclick', switchToEdit);

  // Initial state
  if (content.code?.trim()) {
    textarea.style.display = 'none';
    rendered.style.display = 'block';
    setTimeout(renderHighlight, 150); // wait for hljs to load
  } else {
    rendered.style.display = 'none';
  }

  wrap.append(header, textarea, rendered);
  return wrap;
}

// ── Math / LaTeX ──────────────────────────────
function buildMath(id, content, callbacks) {
  const wrap = el('div', 'block-math-wrap');
  const input = document.createElement('textarea');
  input.className = 'block-math-input';
  input.value = content.latex || '';
  input.placeholder = '\\sum_{i=1}^{n} x_i';
  input.spellcheck = false;
  autoResize(input);

  const rendered = el('div', 'block-math-rendered');
  const errEl = el('div', 'block-math-error');

  function render() {
    const latex = input.value.trim();
    rendered.innerHTML = '';
    if (!latex) return;
    if (window.katex) {
      try {
        katex.render(latex, rendered, { displayMode: true, throwOnError: true });
        errEl.textContent = '';
      } catch (err) {
        errEl.textContent = err.message;
      }
    }
  }

  let deb;
  input.addEventListener('input', () => {
    autoResize(input);
    clearTimeout(deb);
    deb = setTimeout(() => {
      content.latex = input.value;
      callbacks.onBlockChange(id, { ...content });
      render();
    }, 300);
  });
  setTimeout(render, 200);

  wrap.append(input, rendered, errEl);
  return wrap;
}

// ── Image ─────────────────────────────────────
function buildImage(id, content, callbacks) {
  const wrap = el('div', 'block-image-wrap');

  function showInput() {
    wrap.innerHTML = '';
    const row = el('div', 'block-image-url-input');
    row.innerHTML = `<svg width="16" height="16"><use href="#icon-image"/></svg>`;
    const inp = document.createElement('input');
    inp.type = 'url';
    inp.placeholder = 'Paste image URL and press Enter…';
    inp.value = content.url || '';
    function tryLoad() {
      const url = inp.value.trim();
      if (url) { content.url = url; callbacks.onBlockChange(id, { ...content }); showImage(); }
    }
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') tryLoad(); });
    inp.addEventListener('blur', tryLoad);
    row.appendChild(inp);
    wrap.appendChild(row);
    inp.focus();
  }

  function showImage() {
    wrap.innerHTML = '';
    const display = el('div', 'block-image-display');
    const img = document.createElement('img');
    img.src = content.url;
    img.alt = content.caption || '';
    img.addEventListener('error', () => { content.url = ''; showInput(); });
    img.addEventListener('dblclick', () => { content.url = ''; showInput(); });
    const caption = makeEditable('div', 'block-image-caption', null, content.caption || '');
    caption.dataset.placeholder = 'Add caption…';
    caption.addEventListener('input', () => {
      content.caption = caption.textContent;
      callbacks.onBlockChange(id, { ...content });
    });
    display.appendChild(img);
    wrap.append(display, caption);
  }

  content.url ? showImage() : showInput();
  return wrap;
}

// ── Table ─────────────────────────────────────
function buildTable(id, content, callbacks) {
  const container = el('div', '');

  const tableWrap = el('div', 'block-table-wrap');
  const table = document.createElement('table');
  table.className = 'block-table';

  function save() { callbacks.onBlockChange(id, JSON.parse(JSON.stringify(content))); }

  function rebuild() {
    table.innerHTML = '';

    // Header row
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');

    // Row-delete header cell (empty corner)
    const cornerTh = document.createElement('th');
    cornerTh.className = 'table-ctrl-cell';
    hRow.appendChild(cornerTh);

    content.headers.forEach((h, ci) => {
      const th = document.createElement('th');
      const cellEl = document.createElement('div');
      cellEl.contentEditable = 'true';
      cellEl.textContent = h;
      cellEl.addEventListener('input', () => { content.headers[ci] = cellEl.textContent; save(); });
      cellEl.addEventListener('keydown', tableKeyNav);

      // Delete column button
      const delCol = document.createElement('button');
      delCol.className = 'table-del-col';
      delCol.title = 'Delete column';
      delCol.innerHTML = '×';
      delCol.addEventListener('click', () => {
        if (content.headers.length <= 1) return;
        content.headers.splice(ci, 1);
        content.rows.forEach(r => r.splice(ci, 1));
        save(); rebuild();
      });

      th.append(cellEl, delCol);
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    // Body rows
    const tbody = document.createElement('tbody');
    content.rows.forEach((row, ri) => {
      const tr = document.createElement('tr');

      // Row delete button cell
      const ctrlTd = document.createElement('td');
      ctrlTd.className = 'table-ctrl-cell';
      const delRow = document.createElement('button');
      delRow.className = 'table-del-row';
      delRow.title = 'Delete row';
      delRow.innerHTML = '×';
      delRow.addEventListener('click', () => {
        if (content.rows.length <= 1) return;
        content.rows.splice(ri, 1);
        save(); rebuild();
      });
      ctrlTd.appendChild(delRow);
      tr.appendChild(ctrlTd);

      row.forEach((cellText, ci) => {
        const td = document.createElement('td');
        const cellEl = document.createElement('div');
        cellEl.contentEditable = 'true';
        cellEl.textContent = cellText;
        cellEl.addEventListener('input', () => { content.rows[ri][ci] = cellEl.textContent; save(); });
        cellEl.addEventListener('keydown', tableKeyNav);
        td.appendChild(cellEl);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function tableKeyNav(e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const all = Array.from(table.querySelectorAll('[contenteditable]'));
    const idx = all.indexOf(e.target);
    if (e.shiftKey) all[idx - 1]?.focus();
    else all[idx + 1]?.focus();
  }

  rebuild();
  tableWrap.appendChild(table);

  const actions = el('div', 'table-actions');
  const addRowBtn = el('button', 'table-action-btn');
  addRowBtn.innerHTML = `<svg width="12" height="12"><use href="#icon-plus"/></svg> Add row`;
  addRowBtn.addEventListener('click', () => {
    content.rows.push(new Array(content.headers.length).fill(''));
    save(); rebuild();
  });
  const addColBtn = el('button', 'table-action-btn');
  addColBtn.innerHTML = `<svg width="12" height="12"><use href="#icon-plus"/></svg> Add column`;
  addColBtn.addEventListener('click', () => {
    content.headers.push(`Column ${content.headers.length + 1}`);
    content.rows.forEach(r => r.push(''));
    save(); rebuild();
  });

  actions.append(addRowBtn, addColBtn);
  container.append(tableWrap, actions);
  return container;
}

// ── Divider ───────────────────────────────────
function buildDivider() {
  const hr = document.createElement('hr');
  hr.className = 'block-divider';
  return hr;
}

// ── Toggle ────────────────────────────────────
function buildToggle(id, content, callbacks) {
  const wrap = el('div', 'block-toggle-wrap');
  const header = el('div', 'block-toggle-header');

  const arrow = el('div', `block-toggle-arrow${content.open ? ' open' : ''}`);
  arrow.innerHTML = `<svg width="12" height="12"><use href="#icon-chevron-right"/></svg>`;

  const title = makeEditable('div', 'block-toggle-title', id, content.title || '');
  title.dataset.placeholder = 'Toggle title…';
  setupTextCallbacks(title, id, callbacks);

  const body = el('div', `block-toggle-body${content.open ? ' open' : ''}`);
  const bodyContent = makeEditable('div', 'block-toggle-content', null, content.body || '');
  bodyContent.dataset.placeholder = 'Toggle content…';
  bodyContent.addEventListener('input', () => {
    content.body = bodyContent.innerHTML;
    callbacks.onBlockChange(id, { ...content });
  });
  setupInlineMarkdown(bodyContent, id, callbacks, () => content.body = bodyContent.innerHTML);

  header.addEventListener('click', e => {
    if (title.contains(e.target)) return;
    content.open = !content.open;
    arrow.classList.toggle('open', content.open);
    body.classList.toggle('open', content.open);
    callbacks.onBlockChange(id, { ...content });
  });

  body.appendChild(bodyContent);
  header.append(arrow, title);
  wrap.append(header, body);
  return wrap;
}

// ── Shared text block setup ───────────────────
function setupTextCallbacks(el, id, callbacks) {
  let saveTimer;

  el.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      callbacks.onBlockChange(id, { text: el.innerHTML });
    }, 400);

    // Process inline latex on input
    if (applyInlineLatex(el)) {
      callbacks.onBlockChange(id, { text: el.innerHTML });
    }

    // Slash command detection on empty element
    if (el.textContent === '/') {
      callbacks.onSlashCommand?.(id, el);
    } else if (!el.textContent.includes('/')) {
      callbacks.onSlashClose?.();
    }
  });

  el.addEventListener('keydown', e => callbacks.onKeyDown?.(e, id, el));
  el.addEventListener('focus', () => callbacks.onBlockFocus?.(id));

  setupInlineMarkdown(el, id, callbacks, () => callbacks.onBlockChange(id, { text: el.innerHTML }));
}

function setupInlineMarkdown(el, id, callbacks, onApply) {
  el.addEventListener('keyup', e => {
    if (TRIGGER_CHARS.has(e.key) || e.key === 'Enter' || e.key === '$' || e.key === '\\') {
      if (applyInlineMarkdown(el) || applyInlineLatex(el)) {
        onApply?.();
      }
    }
  });
}

// ── DOM helpers ───────────────────────────────
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function makeEditable(tag, cls, blockId, html) {
  const e = el(tag, cls);
  e.contentEditable = 'true';
  if (blockId) e.dataset.blockId = blockId;
  e.innerHTML = html;
  return e;
}

function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function updateBlockNumberMarker(wrap, number) {
  const marker = wrap.querySelector('.block-numbered-marker');
  if (marker) marker.textContent = `${number}.`;
}