/**
 * LongCat LLM parser for Morpheus dream journal.
 * Sends dream text to LLM, returns structured JSON draft.
 * Falls back to mockParse on failure.
 */

const DEFAULT_MODEL = 'LongCat-Flash-Chat';
// Use Vite proxy in dev to avoid CORS, direct URL in production
const LONGCAT_API_URL = import.meta.env.DEV
  ? '/api/longcat/openai/v1/chat/completions'
  : 'https://api.longcat.chat/openai/v1/chat/completions';

const SYSTEM_PROMPT = `你是 Morpheus，一个梦境记录应用的 AI 助手。请将用户口述的梦境内容转换为结构化数据，返回严格合法的 JSON 格式。

要求：
1. 输出纯 JSON，不要包含 markdown 代码块或其他任何文字
2. 摘要要精炼、有故事感，1-2 句话
3. 情绪从以下选项中选一个：奇幻、温暖、焦虑、恐怖/惊悚、悲伤、平静、困惑
4. 主题和元素各不超过 4 个，用中文短语

输出格式：
{
  "mood": "情绪",
  "themes": ["主题1", "主题2"],
  "elements": ["元素1", "元素2"],
  "summary": "精炼摘要"
}`;

async function callLongCat(text, apiKey, model) {
  const res = await fetch(LONGCAT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      max_tokens: 512,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LongCat HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from LLM');

  // Strip markdown code blocks if present
  const cleaned = content.replace(/```(?:json)?\n?/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Parse dream text via LongCat LLM. Falls back to mock on any error.
 * @param {string} text - Raw dream text
 * @param {string} apiKey - LongCat API key
 * @param {string} model - Optional model override
 * @returns {Promise<{mood: string, themes: string[], elements: string[], summary: string}>}
 */
export async function parseDream(text, apiKey, model) {
  try {
    return await callLongCat(text, apiKey, model);
  } catch (err) {
    console.error('[LLM] Parse failed, falling back to mock:', err.message);
    return null;
  }
}
