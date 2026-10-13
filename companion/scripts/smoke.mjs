// 외부 네트워크/API 키 없이 두뇌(core) 로직을 검증하는 스모크 테스트: npm test
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
process.removeAllListeners('warning');

const { Memory } = require('../src/core/memory');
const backup = require('../src/core/backup');
const { Config } = require('../src/core/config');
const { EmotionFilter } = require('../src/core/persona');
const { SpeechPipeline, cleanForSpeech } = require('../src/core/speech');
const { runTurn, maybeSummarize, buildMessages } = require('../src/core/llm');
const { runTool, toolDefinitions } = require('../src/core/tools');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-test-'));
let n = 0;
const t = (name, fn) => Promise.resolve(fn()).then(() => console.log(`ok ${++n} - ${name}`));

await t('memory: 메시지/기억/요약/내보내기', () => {
  const m = new Memory(':memory:');
  m.addMessage('user', '안녕');
  m.addMessage('assistant', '[joy] 안녕하세요');
  const id = m.saveMemory('커피보다 차를 좋아함', 'preference');
  assert.equal(m.saveMemory('커피보다 차를 좋아함'), id, '중복 저장 방지');
  assert.equal(m.recent(10).length, 2);
  m.setSummary('요약1', 1);
  assert.equal(m.unsummarized().length, 1);
  assert.match(m.exportMarkdown(), /차를 좋아함/);
  assert.ok(m.forgetMemory(id));
});

await t('backup: VACUUM INTO 스냅샷 + 보관 개수 정리 + 복원 가능', async () => {
  const file = path.join(tmp, 'a.sqlite');
  const m = new Memory(file);
  m.saveMemory('백업 테스트');
  const dir = path.join(tmp, 'bk');
  for (let i = 0; i < 4; i++) {
    backup.snapshot(m, dir, 3);
    await new Promise((r) => setTimeout(r, 1100)); // 파일명(초 단위) 충돌 방지
  }
  assert.equal(backup.list(dir).length, 3);
  const restored = new Memory(backup.list(dir).at(-1));
  assert.equal(restored.listMemories()[0].content, '백업 테스트');
  assert.equal(backup.snapshotIfStale(m, dir, 3), null, '24시간 이내면 새로 만들지 않음');
  restored.close();
  m.close();
});

await t('config: 기본값 병합 + 저장', () => {
  const c = new Config(path.join(tmp, 'cfg'));
  assert.equal(c.get().model, 'claude-haiku-5-5');
  c.update({ model: 'claude-sonnet-5-5', tts: { edge: { voice: 'x' } } });
  const c2 = new Config(path.join(tmp, 'cfg'));
  assert.equal(c2.get().model, 'claude-sonnet-5-5');
  assert.equal(c2.get().tts.edge.voice, 'x');
  assert.equal(c2.get().tts.provider, 'edge', '다른 기본값 유지');
});

await t('EmotionFilter: 청크 경계에 걸린 태그', () => {
  const f = new EmotionFilter();
  let out = '';
  const emo = [];
  for (const piece of ['[jo', 'y] 안녕 [없는태그] ', '반가워', ' [sad', ']']) {
    const r = f.push(piece);
    out += r.out;
    emo.push(...r.emotions);
  }
  out += f.flush();
  assert.deepEqual(emo, ['joy', 'sad']);
  assert.equal(out, ' 안녕 [없는태그] 반가워 ');
});

await t('SpeechPipeline: 문장 분할/순서/취소 + 정리', async () => {
  const got = [];
  const p = new SpeechPipeline({
    getTts: () => ({ synthesize: async (s) => ({ data: Buffer.from(s), mime: 'x' }) }),
    onAudio: (a) => got.push(a.text),
  });
  for (const d of ['안녕하세요. 오늘 ', '날씨 좋네요! (웃음) 산책 ', '갈까요?']) p.push(d);
  p.flush();
  await p.idle();
  assert.deepEqual(got, ['안녕하세요.', '오늘 날씨 좋네요!', '산책 갈까요?']);
  assert.equal(cleanForSpeech('**굵게** 😀 [joy] 끝'), '굵게 끝');
});

await t('buildMessages: 연속 role 병합, 첫 메시지는 user', () => {
  const r = buildMessages([
    { role: 'assistant', text: 'a0' },
    { role: 'user', text: 'u1' },
    { role: 'user', text: 'u2' },
    { role: 'assistant', text: 'a1' },
  ]);
  assert.deepEqual(r, [
    { role: 'user', content: 'u1\nu2' },
    { role: 'assistant', content: 'a1' },
  ]);
});

await t('tools: 권한/검증 (끔 모드에서는 제어 도구 비노출)', async () => {
  const off = { computerControl: 'off', screenCapture: false, apps: { 메모장: 'notepad.exe' } };
  assert.deepEqual(toolDefinitions(off).map((d) => d.name), ['save_memory', 'forget_memory']);
  const lim = { ...off, computerControl: 'limited', screenCapture: true };
  assert.deepEqual(toolDefinitions(lim).map((d) => d.name), ['save_memory', 'forget_memory', 'open_url', 'open_app', 'look_at_screen']);

  const calls = [];
  const ctx = { memory: new Memory(':memory:'), config: lim, confirm: async () => true, platform: { openUrl: async (u) => calls.push(u), launchApp: async (c) => calls.push(c) } };
  assert.ok((await runTool('open_url', { url: 'javascript:alert(1)' }, lim, ctx)).isError);
  assert.ok((await runTool('open_url', { url: 'file:///C:/Windows' }, lim, ctx)).isError);
  assert.ok(!(await runTool('open_url', { url: 'https://www.youtube.com' }, lim, ctx)).isError);
  assert.match((await runTool('open_app', { name: 'cmd' }, lim, ctx)).content, /허용되지 않은/);
  assert.ok(!(await runTool('open_app', { name: '메모장' }, lim, ctx)).isError);
  assert.deepEqual(calls, ['https://www.youtube.com/', 'notepad.exe']);
  const denied = { ...ctx, confirm: async () => false };
  assert.match((await runTool('open_url', { url: 'https://a.com' }, lim, denied)).content, /거절/);
  assert.ok((await runTool('open_url', { url: 'https://a.com' }, off, ctx)).isError, 'off 모드에서는 실행 불가');
});

// 가짜 Claude 클라이언트: 각 호출이 미리 정한 응답을 스트리밍한다
function fakeClient(script) {
  const seen = [];
  return {
    seen,
    messages: {
      stream(params) {
        seen.push(structuredClone(params));
        const step = script.shift();
        const handlers = [];
        return {
          on: (ev, fn) => ev === 'text' && handlers.push(fn),
          async finalMessage() {
            for (const piece of step.texts ?? []) handlers.forEach((h) => h(piece));
            return { content: step.content, stop_reason: step.stop, usage: { input_tokens: 10, output_tokens: 5 } };
          },
        };
      },
      async create() {
        return { content: [{ type: 'text', text: '갱신된 요약' }] };
      },
    },
  };
}

await t('runTurn: 도구 호출 루프 + 감정 태그 + 기록 저장', async () => {
  const dir = path.join(tmp, 'turn');
  const config = new Config(dir);
  const memory = new Memory(':memory:');
  const client = fakeClient([
    {
      texts: ['[relaxed] 기억해 둘게요.'],
      content: [
        { type: 'text', text: '[relaxed] 기억해 둘게요.' },
        { type: 'tool_use', id: 'tu_1', name: 'save_memory', input: { content: '사용자는 아이폰을 쓴다', category: 'general' } },
      ],
      stop: 'tool_use',
    },
    { texts: ['[joy]', ' 저장했어요!'], content: [{ type: 'text', text: '[joy] 저장했어요!' }], stop: 'end_turn' },
  ]);
  const emotions = [];
  const tools = [];
  const res = await runTurn({
    client, config, memory,
    ctx: { memory, config: config.get(), confirm: async () => true, platform: {} },
    userText: '나 아이폰 써',
    handlers: { onEmotion: (e) => emotions.push(e), onToolUse: (n) => tools.push(n) },
  });
  assert.deepEqual(emotions, ['relaxed', 'joy']);
  assert.deepEqual(tools, ['save_memory']);
  assert.equal(res.text, '기억해 둘게요. 저장했어요!', '태그 제거 후 공백 정리');
  assert.equal(memory.listMemories()[0].content, '사용자는 아이폰을 쓴다');
  assert.equal(memory.recent(10).length, 2);
  // 요청 형태 검증
  const first = client.seen[0];
  assert.equal(first.model, 'claude-haiku-5-5');
  assert.deepEqual(first.output_config, { effort: 'low' });
  assert.equal(first.system[0].cache_control.type, 'ephemeral');
  assert.ok(!('temperature' in first) && !('thinking' in first));
  // 두 번째 요청: 도구 결과가 단일 user 메시지로 돌아감
  const second = client.seen[1].messages;
  assert.equal(second.at(-1).role, 'user');
  assert.equal(second.at(-1).content[0].type, 'tool_result');
  assert.equal(second.at(-2).role, 'assistant');
});

await t('maybeSummarize: 윈도우 밖 메시지를 요약으로 접음', async () => {
  const config = new Config(path.join(tmp, 'sum'));
  config.update({ historyWindow: 4, summarizeBatch: 3 });
  const memory = new Memory(':memory:');
  for (let i = 0; i < 10; i++) memory.addMessage(i % 2 ? 'assistant' : 'user', `m${i}`);
  assert.equal(await maybeSummarize({ client: fakeClient([]), config, memory }), true);
  const s = memory.getSummary();
  assert.equal(s.text, '갱신된 요약');
  assert.equal(s.upto_message_id, 6); // 10개 중 최근 4개를 제외한 6개를 접음
  assert.equal(await maybeSummarize({ client: fakeClient([]), config, memory }), false);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} tests passed`);
