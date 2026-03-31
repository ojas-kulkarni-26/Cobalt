// ============================================
// COBALT — app.js
// Boot, routing, orchestration
// ============================================

import * as db from './db.js';
import { getState, setState, upsertNote, removeNote } from './store.js';
import { renderBlocks, insertBlock } from './editor.js';
import {
  showToast, setSyncStatus,
  renderNotesList, renderTagsList, setActiveNoteInList,
  initNoteIconPicker, renderNoteTags,
  showTagPopup, hideTagPopup,
  showBlockTypeMenu,
  initCommandPalette, initContextMenu,
  initSettings, initSidebarControls, initThemeToggle,
} from './ui.js';
import { generateId, formatDate } from './utils.js';

async function boot() {
  initThemeToggle();
  initSidebarControls();
  initContextMenu();

  const token = localStorage.getItem('cobalt_token');
  if (!token) { showSetup(); return; }

  try {
    db.initDB(token);
    await db.ensureSchema();
    await launchApp();
  } catch (err) {
    console.error('Boot failed:', err);
    showToast('Connection failed. Check your token.', 'error');
    showSetup();
  }
}

// ── Setup screen ──────────────────────────────
function showSetup() {
  document.getElementById('setup-screen')?.classList.remove('hidden');
  document.getElementById('main-layout')?.classList.add('hidden');

  const btn = document.getElementById('setup-connect');
  const tokenInput = document.getElementById('setup-token');

  const connect = async () => {
    const token = tokenInput?.value?.trim();
    if (!token) { showToast('Please enter your auth token', 'error'); return; }
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    try {
      db.initDB(token);
      await db.ensureSchema();
      localStorage.setItem('cobalt_token', token);
      await launchApp();
    } catch (err) {
      showToast(`Connection failed: ${err.message}`, 'error');
      btn.textContent = 'Connect & Launch';
      btn.disabled = false;
    }
  };

  btn?.addEventListener('click', connect);
  tokenInput?.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
}

// ── Launch ────────────────────────────────────
async function launchApp() {
  document.getElementById('setup-screen')?.classList.add('hidden');
  document.getElementById('main-layout')?.classList.remove('hidden');

  initSettings(() => {});
  initCommandPalette(id => openNote(id), cmd => handleCommand(cmd));
  initNoteIconPicker(async emoji => {
    const noteId = getState().activeNoteId;
    if (!noteId) return;
    document.getElementById('note-icon-display').textContent = emoji;
    upsertNote({ id: noteId, icon: emoji });
    await db.updateNote(noteId, { icon: emoji });
    await loadNotesAndTags();
  });

  document.getElementById('new-note-btn')?.addEventListener('click', createNewNote);
  document.getElementById('empty-new-btn')?.addEventListener('click', createNewNote);
  document.getElementById('mobile-new-btn')?.addEventListener('click', createNewNote);

  document.getElementById('bottom-add-btn')?.addEventListener('click', e => {
    if (!getState().activeNoteId) return;
    showBlockTypeMenu(type => insertBlock(type), null, e);
  });

  document.getElementById('note-more-btn')?.addEventListener('click', async e => {
    const noteId = getState().activeNoteId;
    if (!noteId) return;
    const { showContextMenu } = await import('./ui.js');
    showContextMenu(e, [{
      label: 'Delete note', icon: '#icon-trash', danger: true,
      action: () => {
        const note = getState().notes.find(n => n.id === noteId);
        confirmDeleteNote(noteId, note?.title);
      },
    }]);
  });

  // Title editing
  const titleEl = document.getElementById('note-title');
  let titleTimer;
  titleEl?.addEventListener('input', () => {
    clearTimeout(titleTimer);
    const text = titleEl.textContent.trim() || 'Untitled';
    document.getElementById('mobile-note-title').textContent = text;
    titleTimer = setTimeout(async () => {
      const noteId = getState().activeNoteId;
      if (!noteId) return;
      upsertNote({ id: noteId, title: text });
      setSyncStatus('syncing');
      try {
        await db.updateNote(noteId, { title: text });
        await loadNotesAndTags();
        setSyncStatus('ok');
      } catch { setSyncStatus('error'); }
    }, 600);
  });

  titleEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.querySelector('.blocks-container [contenteditable]')?.focus();
    }
  });

  await loadNotesAndTags();
}

// ── Load notes + tags ─────────────────────────
async function loadNotesAndTags() {
  try {
    const [notes, tags] = await Promise.all([db.fetchAllNotes(), db.fetchAllTags()]);
    setState({ notes, allTags: tags });
    const { activeNoteId, filterTag } = getState();

    if (filterTag) {
      applyTagFilter(filterTag);
    } else {
      renderNotesList(notes, activeNoteId, openNote, confirmDeleteNote);
    }
    renderTagsList(tags, filterTag, tag => {
      setState({ filterTag: tag });
      tag ? applyTagFilter(tag) : renderNotesList(getState().notes, getState().activeNoteId, openNote, confirmDeleteNote);
    });
  } catch (err) {
    console.error('Load failed:', err);
    setSyncStatus('error');
  }
}

async function applyTagFilter(tag) {
  if (!tag) return;
  try {
    const filtered = await db.fetchNotesByTag(tag);
    renderNotesList(filtered, getState().activeNoteId, openNote, confirmDeleteNote);
  } catch {}
}

// ── Open note (1 read) ────────────────────────
async function openNote(noteId) {
  if (getState().activeNoteId === noteId) return;
  setState({ activeNoteId: noteId, activeBlocks: [], activeTags: [] });

  document.getElementById('empty-state')?.classList.add('hidden');
  document.getElementById('note-editor')?.classList.remove('hidden');
  setActiveNoteInList(noteId);
  document.getElementById('sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebar-overlay')?.classList.remove('visible');

  setSyncStatus('syncing');

  try {
    // 1 read for note (with embedded blocks) + 1 read for tags = 2 total
    const [note, tags] = await Promise.all([
      db.fetchNoteById(noteId),
      db.fetchNoteTags(noteId),
    ]);

    if (!note) { showToast('Note not found', 'error'); return; }

    const blocks = note.blocks || [];
    setState({ activeBlocks: blocks, activeTags: tags });

    // Title
    const titleEl = document.getElementById('note-title');
    if (titleEl) titleEl.innerHTML = note.title === 'Untitled' ? '' : esc(note.title);

    // Icon
    document.getElementById('note-icon-display').textContent = note.icon || '📄';

    // Meta
    document.getElementById('note-title-meta').textContent =
      `Last edited ${formatDate(note.updated_at)}`;

    // Tags
    renderNoteTags(
      tags,
      tag => removeTagFromNote(noteId, tag),
      e => showTagPopup(e.target, getState().allTags, tags, tag => addTagToNote(noteId, tag))
    );

    // Render blocks
    renderBlocks(noteId, blocks);
    document.getElementById('mobile-note-title').textContent = note.title || 'Untitled';

    setSyncStatus('ok');

    // Add default paragraph if empty
    if (!blocks.length) {
      await insertBlock('paragraph');
      setTimeout(() => document.querySelector('.block-paragraph')?.focus(), 50);
    } else {
      setTimeout(() => {
        document.querySelector('.block-paragraph,.block-h1,.block-h2,.block-h3')?.focus();
      }, 80);
    }
  } catch (err) {
    console.error('Open note failed:', err);
    setSyncStatus('error');
    showToast('Failed to open note', 'error');
  }
}

// ── Create note ───────────────────────────────
async function createNewNote() {
  const id = generateId();
  const note = { id, title: 'Untitled', icon: '📄' };
  setSyncStatus('syncing');
  try {
    await db.createNote(note);
    upsertNote({ ...note, updated_at: Date.now(), created_at: Date.now() });
    await loadNotesAndTags();
    await openNote(id);
    setTimeout(() => document.getElementById('note-title')?.focus(), 150);
    setSyncStatus('ok');
  } catch (err) {
    showToast('Failed to create note', 'error');
    setSyncStatus('error');
  }
}

// ── Delete note ───────────────────────────────
async function confirmDeleteNote(noteId, title) {
  if (!confirm(`Delete "${title || 'Untitled'}"?`)) return;
  try {
    await db.deleteNote(noteId);
    removeNote(noteId);
    if (getState().activeNoteId === noteId) {
      setState({ activeNoteId: null, activeBlocks: [], activeTags: [] });
      document.getElementById('note-editor')?.classList.add('hidden');
      document.getElementById('empty-state')?.classList.remove('hidden');
      document.getElementById('mobile-note-title').textContent = 'cobalt';
    }
    await loadNotesAndTags();
    showToast('Note deleted');
  } catch { showToast('Failed to delete note', 'error'); }
}

// ── Tags ──────────────────────────────────────
async function addTagToNote(noteId, tag) {
  const tags = [...getState().activeTags, tag].filter((t, i, a) => a.indexOf(t) === i);
  setState({ activeTags: tags });
  renderNoteTags(tags, t => removeTagFromNote(noteId, t),
    e => showTagPopup(e.target, getState().allTags, tags, t => addTagToNote(noteId, t)));
  try { await db.updateNoteTags(noteId, tags); await loadNotesAndTags(); } catch {}
}

async function removeTagFromNote(noteId, tag) {
  const tags = getState().activeTags.filter(t => t !== tag);
  setState({ activeTags: tags });
  renderNoteTags(tags, t => removeTagFromNote(noteId, t),
    e => showTagPopup(e.target, getState().allTags, tags, t => addTagToNote(noteId, t)));
  try { await db.updateNoteTags(noteId, tags); await loadNotesAndTags(); } catch {}
}

// ── Commands ──────────────────────────────────
function handleCommand(cmd) {
  if (cmd === 'new') createNewNote();
  if (cmd === 'settings') document.getElementById('settings-btn')?.click();
  if (cmd === 'theme') document.getElementById('theme-toggle')?.click();
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/Cobalt/sw.js').catch(() => {});
  });
}

boot();