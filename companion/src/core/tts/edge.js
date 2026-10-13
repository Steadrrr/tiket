// Edge TTS (무료, 임시 엔진). 인터페이스: synthesize(text) → { data: Buffer, mime }
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

class EdgeTts {
  constructor(opts) {
    this.voice = opts.voice;
    this.rate = opts.rate ?? 1.0;
    this.tts = null;
  }
  async ensure() {
    if (this.tts) return this.tts;
    const tts = new MsEdgeTTS();
    await tts.setMetadata(this.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    this.tts = tts;
    return tts;
  }
  async once(text) {
    const tts = await this.ensure();
    const { audioStream } = tts.toStream(text, { rate: this.rate });
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('error', reject);
      audioStream.on('close', resolve);
    });
    return Buffer.concat(chunks);
  }
  async synthesize(text) {
    let data;
    try {
      data = await this.once(text);
    } catch {
      this.tts = null; // 연결이 끊겼을 수 있으니 한 번 재연결 후 재시도
      data = await this.once(text);
    }
    if (!data.length) throw new Error('Edge TTS 가 빈 오디오를 반환했습니다.');
    return { data, mime: 'audio/mpeg' };
  }
}

module.exports = { EdgeTts };
