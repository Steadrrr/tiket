// 스트리밍 텍스트 → 문장 단위로 끊어 TTS 합성 → 순서대로 onAudio 로 전달.
const SENTENCE_END = /([.!?。！？…]+["')\]]*\s+|\n+)/;

// TTS 가 읽기 곤란한 요소 제거
function cleanForSpeech(s) {
  return s
    .replace(/\[[a-z]+\]/gi, '')
    .replace(/[*_`#>~]/g, '')
    .replace(/\([^)]*\)/g, '') // (웃음) 같은 괄호 속 묘사
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class SpeechPipeline {
  constructor({ getTts, onAudio, onError }) {
    this.getTts = getTts; // () => tts | null  (설정 변경을 즉시 반영)
    this.onAudio = onAudio; // ({ data, mime, text }) => void
    this.onError = onError || (() => {});
    this.buffer = '';
    this.chain = Promise.resolve();
    this.generation = 0;
  }
  push(delta) {
    this.buffer += delta;
    for (;;) {
      const m = SENTENCE_END.exec(this.buffer);
      if (!m) break;
      const end = m.index + m[0].length;
      this.enqueue(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end);
    }
  }
  flush() {
    if (this.buffer.trim()) this.enqueue(this.buffer);
    this.buffer = '';
  }
  cancel() {
    this.generation++;
    this.buffer = '';
  }
  enqueue(raw) {
    const text = cleanForSpeech(raw);
    if (!text) return;
    const gen = this.generation;
    this.chain = this.chain.then(async () => {
      if (gen !== this.generation) return;
      const tts = this.getTts();
      if (!tts) return;
      try {
        const audio = await tts.synthesize(text);
        if (gen === this.generation) this.onAudio({ ...audio, text });
      } catch (e) {
        this.onError(e);
      }
    });
  }
  idle() {
    return this.chain;
  }
}

module.exports = { SpeechPipeline, cleanForSpeech };
