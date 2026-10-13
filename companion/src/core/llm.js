// Claude 대화 루프 (스트리밍 + 도구 사용 + 롤링 요약). 모델은 설정값이라 코드 수정 없이 바꿀 수 있다.
const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = AnthropicModule.default ?? AnthropicModule;
const { stablePrompt, volatilePrompt, EmotionFilter } = require('./persona');
const { toolDefinitions, runTool } = require('./tools');

const MAX_TOOL_ROUNDS = 6;

function createClient(apiKey) {
  return new Anthropic({ apiKey });
}

// DB 의 최근 메시지 → API messages. 첫 메시지는 user 여야 하고 같은 role 이 연속되면 합친다.
function buildMessages(rows) {
  const out = [];
  for (const r of rows) {
    const last = out.at(-1);
    if (last && last.role === r.role) last.content += `\n${r.text}`;
    else out.push({ role: r.role, content: r.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않아요. 설정에서 키를 확인해 주세요.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'API 키에 이 모델을 쓸 권한이 없어요.';
  if (e instanceof Anthropic.NotFoundError) return '설정한 모델 이름을 찾을 수 없어요. 설정의 모델명을 확인해 주세요.';
  if (e instanceof Anthropic.RateLimitError) return '요청이 너무 많아요. 잠시 후 다시 말을 걸어 주세요.';
  if (e instanceof Anthropic.APIConnectionError) return '인터넷 연결에 문제가 있어요.';
  if (e instanceof Anthropic.APIError) return `API 오류(${e.status ?? '?'}): ${e.message}`;
  return `오류: ${e.message}`;
}

/**
 * handlers: { onText(delta), onEmotion(name), onToolUse(name) }
 * 반환: { text, usage }
 */
async function runTurn({ client, config, memory, ctx, userText, handlers = {}, signal }) {
  const cfg = config.get();
  memory.addMessage('user', userText);

  const memories = memory.listMemories();
  const summary = memory.getSummary();
  const system = [
    { type: 'text', text: stablePrompt(cfg, memories, summary), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: volatilePrompt() },
  ];
  const messages = buildMessages(memory.recent(cfg.historyWindow));
  const tools = toolDefinitions(cfg);

  const filter = new EmotionFilter();
  let fullText = '';
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  const emit = (raw) => {
    const { out: filtered, emotions } = filter.push(raw);
    for (const e of emotions) handlers.onEmotion?.(e);
    // 태그를 떼고 남은 앞쪽 공백이나 라운드 사이의 이중 공백 정리
    const out = !fullText || /\s$/.test(fullText) ? filtered.trimStart() : filtered;
    if (out) {
      fullText += out;
      handlers.onText?.(out);
    }
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = client.messages.stream(
      {
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        system,
        messages,
        ...(tools.length ? { tools } : {}),
        output_config: { effort: cfg.effort },
      },
      { signal },
    );
    stream.on('text', (delta) => emit(delta));
    const msg = await stream.finalMessage();

    usage.input += msg.usage.input_tokens;
    usage.output += msg.usage.output_tokens;
    usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0;

    if (msg.stop_reason === 'refusal') {
      emit('[sad] 그 요청은 제가 도와드릴 수 없어요.');
      break;
    }
    if (msg.stop_reason === 'max_tokens') {
      emit(' …(답변이 길어서 여기까지만 할게요.)');
      break;
    }
    if (msg.stop_reason !== 'tool_use') break;

    // 도구 실행: 한 응답의 tool_use 는 모두 모아 한 user 메시지로 돌려준다
    messages.push({ role: 'assistant', content: msg.content });
    const results = [];
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;
      handlers.onToolUse?.(block.name);
      const r = await runTool(block.name, block.input, cfg, ctx);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }

  const tail = filter.flush();
  if (tail) {
    fullText += tail;
    handlers.onText?.(tail);
  }

  fullText = fullText.trim();
  if (fullText) memory.addMessage('assistant', fullText);
  return { text: fullText, usage };
}

// 윈도우 밖으로 밀려난 메시지를 요약으로 접는다. 실패해도 대화에는 영향 없음(다음 턴에 재시도).
async function maybeSummarize({ client, config, memory }) {
  const cfg = config.get();
  const pending = memory.unsummarized();
  const overflow = pending.length - cfg.historyWindow;
  if (overflow < cfg.summarizeBatch) return false;

  const chunk = pending.slice(0, overflow);
  const prev = memory.getSummary();
  const transcript = chunk.map((m) => `${m.role === 'user' ? '사용자' : '비서'}: ${m.text}`).join('\n');
  const res = await client.messages.create({
    model: cfg.model,
    max_tokens: 1200,
    output_config: { effort: 'low' },
    system:
      '당신은 대화 요약기입니다. 기존 요약과 새 대화를 합쳐 한국어 요약 하나로 갱신하세요. 사실(선호, 결정, 진행 중인 일, 약속)을 우선 보존하고, 인사말·잡담은 버리세요. 600자 이내, 줄글 또는 짧은 항목으로.',
    messages: [{ role: 'user', content: `# 기존 요약\n${prev ? prev.text : '(없음)'}\n\n# 새 대화\n${transcript}` }],
  });
  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) return false;
  memory.setSummary(text, chunk.at(-1).id);
  return true;
}

module.exports = { createClient, runTurn, maybeSummarize, buildMessages, friendlyError };
