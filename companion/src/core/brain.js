// "두뇌" 파사드: 기억 + LLM + 도구 + 음성 합성. 화면(Electron/모바일 웹)은 이 인터페이스만 안다.
// 나중에 서버로 옮길 때는 이 클래스를 HTTP/WebSocket 서버 뒤에 두고, 클라이언트에는 같은 메서드의
// 원격 프록시를 끼우면 된다. (platform 도구는 PC 앱에서만 실행되므로 원격일 때는 WebSocket 으로 위임)
const path = require('node:path');
const { Config } = require('./config');
const { Memory } = require('./memory');
const backup = require('./backup');
const { createClient, runTurn, maybeSummarize, friendlyError } = require('./llm');
const { createTts } = require('./tts');
const { SpeechPipeline } = require('./speech');

class Brain {
  /**
   * @param {object} o
   * @param {string} o.dataDir        설정/DB 저장 폴더
   * @param {() => (string|null)} o.getApiKey
   * @param {object} o.platform       { openUrl, launchApp, captureScreen }  (PC 앱이 제공)
   * @param {(q:string)=>Promise<boolean>} o.confirm  위험 동작 확인 창
   */
  constructor({ dataDir, getApiKey, platform, confirm }) {
    this.dataDir = dataDir;
    this.config = new Config(dataDir);
    this.memory = new Memory(path.join(dataDir, 'companion.sqlite'));
    this.getApiKey = getApiKey;
    this.platform = platform;
    this.confirm = confirm;
    this.client = null;
    this.clientKey = null;
    this.tts = null;
    this.busy = false;
    this.abort = null;
    this.speech = null;
  }

  settings() {
    return this.config.get();
  }
  updateSettings(patch) {
    const next = this.config.update(patch);
    this.tts = null; // TTS 설정이 바뀌었을 수 있으니 다시 만든다
    return next;
  }

  getClient() {
    const key = this.getApiKey();
    if (!key) throw new Error('API 키가 설정되지 않았어요. 설정(⚙)에서 Anthropic API 키를 입력해 주세요.');
    if (!this.client || key !== this.clientKey) {
      this.client = createClient(key);
      this.clientKey = key;
    }
    return this.client;
  }
  getTts() {
    if (!this.tts) this.tts = createTts(this.config.get().tts);
    return this.tts;
  }

  state() {
    return { history: this.memory.recent(50), memories: this.memory.listMemories(), summary: this.memory.getSummary() };
  }

  cancel() {
    this.abort?.abort();
    this.speech?.cancel();
  }

  /**
   * handlers: { onText, onEmotion, onToolUse, onAudio, onError }
   * 반환: { text, error? }
   */
  async chat(userText, handlers = {}) {
    if (this.busy) return { text: '', error: '아직 이전 답변을 하는 중이에요.' };
    this.busy = true;
    this.abort = new AbortController();
    this.speech?.cancel(); // 이전 답변의 남은 음성이 새 답변과 섞이지 않게
    this.speech = new SpeechPipeline({
      getTts: () => {
        try {
          return this.getTts();
        } catch (e) {
          handlers.onError?.(`TTS 설정 오류: ${e.message}`);
          return null;
        }
      },
      onAudio: (a) => handlers.onAudio?.(a),
      onError: (e) => handlers.onError?.(`음성 합성 실패: ${e.message}`),
    });
    try {
      const client = this.getClient();
      const ctx = { memory: this.memory, config: this.config.get(), confirm: this.confirm, platform: this.platform };
      const result = await runTurn({
        client,
        config: this.config,
        memory: this.memory,
        ctx,
        userText,
        signal: this.abort.signal,
        handlers: {
          ...handlers,
          onText: (d) => {
            handlers.onText?.(d);
            this.speech.push(d);
          },
        },
      });
      this.speech.flush();
      // 요약/백업은 대화 흐름을 막지 않도록 뒤에서
      maybeSummarize({ client, config: this.config, memory: this.memory }).catch(() => {});
      this.autoBackup();
      return { text: result.text, usage: result.usage };
    } catch (e) {
      if (this.abort.signal.aborted) return { text: '', error: '중단했어요.' };
      return { text: '', error: friendlyError(e) };
    } finally {
      this.busy = false;
    }
  }

  autoBackup() {
    const b = this.config.get().backup;
    try {
      return backup.snapshotIfStale(this.memory, b.dir, b.keep);
    } catch {
      return null;
    }
  }
  backupNow() {
    const b = this.config.get().backup;
    return backup.snapshot(this.memory, b.dir, b.keep);
  }
  exportMarkdown() {
    return this.memory.exportMarkdown();
  }
  forgetMemory(id) {
    return this.memory.forgetMemory(id);
  }

  close() {
    this.autoBackup();
    this.memory.close();
  }
}

module.exports = { Brain };
