// TTS 엔진 레지스트리. 새 엔진은 synthesize(text) → { data: Buffer, mime } 만 구현해서 여기에 등록하면 된다.
const { EdgeTts } = require('./edge');
const { Sbv2Tts } = require('./sbv2');

const PROVIDERS = {
  edge: (c) => new EdgeTts(c.edge),
  sbv2: (c) => new Sbv2Tts(c.sbv2),
};

function createTts(ttsConfig) {
  if (!ttsConfig.enabled) return null;
  const make = PROVIDERS[ttsConfig.provider];
  if (!make) throw new Error(`알 수 없는 TTS 엔진: ${ttsConfig.provider}`);
  return make(ttsConfig);
}

module.exports = { createTts, PROVIDERS };
