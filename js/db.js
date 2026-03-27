// ============================================
// COBALT — db.js
// TursoDB HTTP REST API — JSON block storage
// Blocks stored as JSON array in notes.content
// 1 read to open a note, 1 debounced write to save
// ============================================

const TURSO_URL = 'https://cobalt-ojaskul26.aws-ap-south-1.turso.io';
let _client = null;

export function initDB(token) {
  _client = { url: TURSO_URL, token };
}
export function isConnected() { return _client !== null; }

async function execute(sql, args = []) {
  if (!_client) throw new Error('DB not initialized');
  const res = await fetch(`${_client.url}/v2/pipeline`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${_client.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql, args: args.map(norm) } },
        { type: 'close' },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DB ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const r = data.results?.[0];
  if (r?.type === 'error') throw new Error(r.error?.message || 'DB error');
  return parse(r?.response?.result);
}

async function executeBatch(stmts) {
  if (!_client) throw new Error('DB not initialized');
  const requests = stmts.map(({ sql, args }) => ({
    type: 'execute', stmt: { sql, args: (args || []).map(norm) },
  }));
  requests.push({ type: 'close' });
  const res = await fetch(`${_client.url}/v2/pipeline`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${_client.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) throw new Error(`DB batch ${res.status}`);
  const data = await res.json();
  return data.results?.map(r => parse(r?.response?.result)) || [];
}

function norm(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') return Number.isInteger(v)
    ? { type: 'integer', value: String(v) }
    : { type: 'float', value: v };
  return { type: 'text', value: String(v) };
}

function parse(result) {
  if (!result) return { rows: [], columns: [] };
  const cols = result.cols?.map(c => c.name) || [];
  const rows = (result.rows || []).map(row =>
    Object.fromEntries(cols.map((col, i) => [col, pv(row[i])]))
  );
  return { rows, columns: cols };
}

function pv(v) {
  if (!v || v.type === 'null') return null;
  if (v.type === 'integer') return parseInt(v.value, 10);
  if (v.type === 'float') return parseFloat(v.value);
  return v.value;
}

function tryJSON(s, fb) { try { return JSON.parse(s); } catch { return fb; } }

// ── Schema check ──────────────────────────────
export async function ensureSchema() {
  await execute('SELECT 1');
}

// ── Notes ─────────────────────────────────────
export async function fetchAllNotes() {
  const { rows } = await execute(
    `SELECT id, title, icon, created_at, updated_at, is_deleted, position
     FROM notes WHERE is_deleted = 0 ORDER BY updated_at DESC`
  );
  return rows;
}

export async function fetchNoteById(id) {
  const { rows } = await execute(
    'SELECT * FROM notes WHERE id = ? AND is_deleted = 0', [id]
  );
  if (!rows[0]) return null;
  const note = rows[0];
  note.blocks = tryJSON(note.content, []);
  return note;
}

export async function createNote(note) {
  const now = Date.now();
  await execute(
    `INSERT INTO notes (id, title, icon, content, created_at, updated_at, is_deleted, position)
     VALUES (?, ?, ?, '[]', ?, ?, 0, ?)`,
    [note.id, note.title || 'Untitled', note.icon || '📄', now, now, now]
  );
  return { ...note, created_at: now, updated_at: now, blocks: [] };
}

export async function updateNote(id, fields) {
  const now = Date.now();
  const sets = [];
  const args = [];
  if ('title'   in fields) { sets.push('title = ?');   args.push(fields.title); }
  if ('icon'    in fields) { sets.push('icon = ?');    args.push(fields.icon); }
  if ('content' in fields) { sets.push('content = ?'); args.push(fields.content); }
  sets.push('updated_at = ?');
  args.push(now, id);
  await execute(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`, args);
  return now;
}

// THE key function — saves ALL blocks in one write
export async function saveNoteBlocks(noteId, blocks) {
  return updateNote(noteId, { content: JSON.stringify(blocks) });
}

export async function deleteNote(id) {
  await execute(
    'UPDATE notes SET is_deleted = 1, updated_at = ? WHERE id = ?', [Date.now(), id]
  );
}

export async function searchNotes(query) {
  const { rows } = await execute(
    `SELECT id, title, icon, updated_at FROM notes
     WHERE is_deleted = 0 AND title LIKE ?
     ORDER BY updated_at DESC LIMIT 20`,
    [`%${query}%`]
  );
  return rows;
}

// ── Tags ──────────────────────────────────────
export async function fetchNoteTags(noteId) {
  const { rows } = await execute(
    'SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag', [noteId]
  );
  return rows.map(r => r.tag);
}

export async function fetchAllTags() {
  const { rows } = await execute(
    `SELECT nt.tag, COUNT(*) as count FROM note_tags nt
     INNER JOIN notes n ON nt.note_id = n.id
     WHERE n.is_deleted = 0
     GROUP BY nt.tag ORDER BY count DESC, nt.tag ASC`
  );
  return rows;
}

export async function fetchNotesByTag(tag) {
  const { rows } = await execute(
    `SELECT n.id, n.title, n.icon, n.updated_at FROM notes n
     INNER JOIN note_tags nt ON n.id = nt.note_id
     WHERE nt.tag = ? AND n.is_deleted = 0 ORDER BY n.updated_at DESC`,
    [tag]
  );
  return rows;
}

export async function updateNoteTags(noteId, tags) {
  await executeBatch([
    { sql: 'DELETE FROM note_tags WHERE note_id = ?', args: [noteId] },
    ...tags.map(tag => ({
      sql: 'INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)',
      args: [noteId, tag],
    })),
    { sql: 'UPDATE notes SET updated_at = ? WHERE id = ?', args: [Date.now(), noteId] },
  ]);
}

// ── Settings ──────────────────────────────────
export async function getSetting(key) {
  const { rows } = await execute('SELECT value FROM settings WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}
export async function setSetting(key, value) {
  await execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]
  );
}