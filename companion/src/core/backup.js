const fs = require('node:fs');
const path = require('node:path');

const PREFIX = 'companion-';

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function list(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.sqlite'))
    .sort()
    .map((f) => path.join(dir, f));
}

// 스냅샷 1개 생성 + 오래된 것 정리. 반환: 새 파일 경로
function snapshot(memory, dir, keep = 14) {
  if (!dir) throw new Error('백업 폴더가 설정되지 않았습니다.');
  const dest = path.join(dir, `${PREFIX}${stamp()}.sqlite`);
  memory.snapshotTo(dest);
  const all = list(dir);
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.unlinkSync(old);
  return dest;
}

// 마지막 백업이 maxAgeHours 보다 오래됐으면 새로 만든다. 만들었으면 경로, 아니면 null
function snapshotIfStale(memory, dir, keep, maxAgeHours = 24) {
  if (!dir) return null;
  const last = list(dir).at(-1);
  if (last && Date.now() - fs.statSync(last).mtimeMs < maxAgeHours * 3600_000) return null;
  return snapshot(memory, dir, keep);
}

module.exports = { snapshot, snapshotIfStale, list };
