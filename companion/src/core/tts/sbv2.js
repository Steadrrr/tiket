// Style-Bert-VITS2 로컬 서버 클라이언트 (server_fastapi.py 의 /voice 엔드포인트).
// 주의: 아직 실제 서버로 검증하지 못했다. 모델 학습 후 엔드포인트/파라미터를 확인할 것.
// 한국어는 SBV2 공식 지원 언어가 아니므로 language 와 모델이 맞는지 먼저 확인해야 한다.
class Sbv2Tts {
  constructor(opts) {
    this.url = String(opts.url || 'http://127.0.0.1:5000').replace(/\/+$/, '');
    this.modelId = opts.modelId ?? 0;
    this.speakerId = opts.speakerId ?? 0;
    this.language = opts.language || 'JP';
  }
  async synthesize(text) {
    const q = new URLSearchParams({
      text,
      model_id: String(this.modelId),
      speaker_id: String(this.speakerId),
      language: this.language,
    });
    const res = await fetch(`${this.url}/voice?${q}`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`SBV2 서버 오류 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { data: Buffer.from(await res.arrayBuffer()), mime: 'audio/wav' };
  }
}

module.exports = { Sbv2Tts };
