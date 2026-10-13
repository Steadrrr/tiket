// 로컬 SQLite 기억 저장소 (대화 기록 / 장기 기억 / 롤링 요약).
// Node 24 내장 node:sqlite 사용 → 네이티브 빌드 불필요.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

class Memory {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS summary (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        text TEXT NOT NULL,
        upto_message_id INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  addMessage(role, text) {
    const r = this.db.prepare('INSERT INTO messages (role, text) VALUES (?, ?)').run(role, text);
    return Number(r.lastInsertRowid);
  }

  // 요약에 이미 접힌 메시지를 제외한 전체
  unsummarized() {
    const s = this.getSummary();
    return this.db
      .prepare('SELECT id, role, text, created_at FROM messages WHERE id > ? ORDER BY id')
      .all(s ? s.upto_message_id : 0);
  }

  recent(limit) {
    return this.db
      .prepare('SELECT id, role, text, created_at FROM messages ORDER BY id DESC LIMIT ?')
      .all(limit)
      .reverse();
  }

  getSummary() {
    return this.db.prepare('SELECT text, upto_message_id FROM summary WHERE id = 1').get() || null;
  }
  setSummary(text, uptoId) {
    this.db
      .prepare(
        `INSERT INTO summary (id, text, upto_message_id) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text, upto_message_id = excluded.upto_message_id, updated_at = datetime('now')`,
      )
      .run(text, uptoId);
  }

  saveMemory(content, category = 'general') {
    const dup = this.db.prepare('SELECT id FROM memories WHERE content = ?').get(content);
    if (dup) return Number(dup.id);
    const r = this.db.prepare('INSERT INTO memories (content, category) VALUES (?, ?)').run(content, category);
    return Number(r.lastInsertRowid);
  }
  forgetMemory(id) {
    return Number(this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes) > 0;
  }
  listMemories() {
    return this.db.prepare('SELECT id, content, category, created_at FROM memories ORDER BY id').all();
  }

  // 사람이 읽을 수 있는 내보내기 (깃 저장소에 올리기 좋은 형태: 장기 기억만)
  exportMarkdown() {
    const lines = ['# 장기 기억', ''];
    for (const m of this.listMemories()) lines.push(`- (${m.category}) ${m.content}  <!-- id:${m.id} ${m.created_at} -->`);
    const s = this.getSummary();
    if (s) lines.push('', '# 대화 요약', '', s.text);
    return lines.join('\n') + '\n';
  }

  // 실행 중에도 일관된 스냅샷을 만든다 (파일 복사 대신 VACUUM INTO)
  snapshotTo(dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    this.db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  }

  close() {
    this.db.close();
  }
}

module.exports = { Memory };
