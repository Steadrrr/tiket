// 설정 저장소. 순수 Node 코드라서 나중에 서버(두뇌)로 옮겨도 그대로 쓴다.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  userName: '',
  characterName: '미나',
  extraPrompt: '',
  model: 'claude-haiku-5-5', // 업그레이드 시 'claude-sonnet-5-5' 로 바꾸면 기억은 그대로 이어진다
  effort: 'low', // low | medium | high — 대화용은 low 권장
  maxTokens: 2048,
  historyWindow: 20, // 프롬프트에 그대로 싣는 최근 메시지 수
  summarizeBatch: 20, // 윈도우 밖 메시지가 이만큼 쌓이면 요약으로 접는다
  vrmPath: '',
  tts: {
    enabled: true,
    provider: 'edge', // edge | sbv2
    edge: { voice: 'ko-KR-SunHiNeural', rate: 1.0 },
    sbv2: { url: 'http://127.0.0.1:5000', modelId: 0, speakerId: 0, language: 'JP' },
  },
  computerControl: 'off', // off | limited | full(준비 중)
  screenCapture: false, // look_at_screen 도구 허용 여부
  captureDisplay: 0, // 캡처할 모니터 번호
  apps: { 메모장: 'notepad.exe', 계산기: 'calc.exe' }, // open_app 허용 목록
  window: { display: 0, width: 420, height: 680, alwaysOnTop: true, clickThrough: false },
  backup: { dir: '', keep: 14 },
};

function merge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') out[k] = merge(base[k], v);
    else out[k] = v;
  }
  return out;
}

class Config {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'settings.json');
    this.data = DEFAULTS;
    this.load();
  }
  load() {
    try {
      this.data = merge(DEFAULTS, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      this.data = merge(DEFAULTS, {});
    }
    return this.data;
  }
  get() {
    return this.data;
  }
  update(patch) {
    this.data = merge(this.data, patch);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.data;
  }
}

module.exports = { Config, DEFAULTS };
