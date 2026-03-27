// ============================================
// COBALT — store.js
// In-memory app state, reactive subscriptions
// ============================================

const _state = {
  notes: [],          // [{id, title, icon, updated_at, tags:[]}]
  allTags: [],        // [{tag, count}]
  activeNoteId: null,
  activeBlocks: [],   // blocks for open note
  activeTags: [],     // tags for open note
  filterTag: null,    // sidebar tag filter
  theme: 'dark',
  sidebarOpen: true,
  syncing: false,
  syncError: false,
};

const _listeners = new Map();

export function getState() {
  return _state;
}

export function setState(patch) {
  Object.assign(_state, patch);
  const keys = Object.keys(patch);
  keys.forEach(key => {
    const cbs = _listeners.get(key) || [];
    cbs.forEach(cb => cb(_state[key], _state));
  });
  // always fire '*'
  (_listeners.get('*') || []).forEach(cb => cb(_state));
}

export function subscribe(key, cb) {
  if (!_listeners.has(key)) _listeners.set(key, []);
  _listeners.get(key).push(cb);
  return () => {
    const arr = _listeners.get(key) || [];
    const idx = arr.indexOf(cb);
    if (idx > -1) arr.splice(idx, 1);
  };
}

// ── Note helpers ────────────────────────────
export function getNoteById(id) {
  return _state.notes.find(n => n.id === id) || null;
}

export function upsertNote(note) {
  const idx = _state.notes.findIndex(n => n.id === note.id);
  const notes = [..._state.notes];
  if (idx > -1) {
    notes[idx] = { ...notes[idx], ...note };
  } else {
    notes.unshift(note);
  }
  setState({ notes });
}

export function removeNote(id) {
  setState({ notes: _state.notes.filter(n => n.id !== id) });
}

// ── Block helpers ────────────────────────────
export function upsertBlock(block) {
  const blocks = [..._state.activeBlocks];
  const idx = blocks.findIndex(b => b.id === block.id);
  if (idx > -1) {
    blocks[idx] = { ...blocks[idx], ...block };
  } else {
    blocks.push(block);
  }
  blocks.sort((a, b) => a.position - b.position);
  setState({ activeBlocks: blocks });
}

export function removeBlock(id) {
  setState({ activeBlocks: _state.activeBlocks.filter(b => b.id !== id) });
}

export function reorderBlocksInState(orderedBlocks) {
  setState({ activeBlocks: orderedBlocks });
}