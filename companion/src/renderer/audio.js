// TTS 오디오를 순서대로 재생하고, 재생 중 음량(0~1)을 립싱크용으로 제공한다.
export class AudioQueue {
  constructor({ onStart, onIdle }) {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(this.ctx.destination);
    this.samples = new Uint8Array(this.analyser.fftSize);
    this.queue = [];
    this.playing = null;
    this.onStart = onStart;
    this.onIdle = onIdle;
    this.pending = 0; // 디코딩 중인 개수
    this.smooth = 0;
  }
  resume() { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }

  async enqueue(bytes) {
    this.resume();
    this.pending++;
    try {
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      this.queue.push(await this.ctx.decodeAudioData(copy));
    } catch (e) {
      console.warn('오디오 디코딩 실패', e);
    } finally {
      this.pending--;
    }
    this.next();
  }

  next() {
    if (this.playing) return;
    const buf = this.queue.shift();
    if (!buf) { if (!this.pending) this.onIdle?.(); return; }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    this.playing = src;
    src.onended = () => { this.playing = null; this.next(); };
    this.onStart?.();
    src.start();
  }

  stop() {
    this.queue = [];
    try { this.playing?.stop(); } catch {}
    this.playing = null;
  }

  isActive() { return !!this.playing || this.queue.length > 0 || this.pending > 0; }

  // 현재 입 벌림 정도 (0~1), 프레임마다 호출
  level() {
    let target = 0;
    if (this.playing) {
      this.analyser.getByteTimeDomainData(this.samples);
      let sum = 0;
      for (const s of this.samples) { const v = (s - 128) / 128; sum += v * v; }
      target = Math.min(1, Math.sqrt(sum / this.samples.length) * 5);
    }
    this.smooth += (target - this.smooth) * 0.45;
    return this.smooth;
  }
}
