/**
 * Morpheus LLM Worker
 *
 * 单一端点 POST /parse
 * 接收 { text: string }，调 LongCat，返回 { mood, themes, elements, summary }
 * API Key 存在 Worker Secret，不暴露给前端。
 */

const LONGCAT_API_URL = 'https://api.longcat.chat/openai/v1/chat/completions';

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

// 允许的 Origin 白名单（开发时加 localhost）
const ALLOWED_ORIGINS = [
  'https://chuehjen.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:8080',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Morpheus-Client',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      ...corsHeaders(origin),
    },
  });
}

async function handleParse(request, env) {
  const origin = request.headers.get('Origin') || '';

  // 简单 client token 校验（防裸接口扫描）
  const clientToken = request.headers.get('X-Morpheus-Client');
  if (clientToken !== 'morpheus-web') {
    return json({ error: 'forbidden' }, 403, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return json({ error: 'text_required' }, 400, origin);
  }
  if (text.length > 3000) {
    return json({ error: 'text_too_long', max: 3000 }, 400, origin);
  }

  // 调 LongCat
  let llmRes;
  try {
    llmRes = await fetch(LONGCAT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.LONGCAT_KEY}`,
      },
      body: JSON.stringify({
        model: env.LONGCAT_MODEL || 'LongCat-Flash-Chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    });
  } catch (e) {
    console.error('[Worker] LongCat fetch failed:', e.message);
    return json({ error: 'upstream_unavailable' }, 502, origin);
  }

  if (!llmRes.ok) {
    const errText = await llmRes.text().catch(() => '');
    console.error(`[Worker] LongCat HTTP ${llmRes.status}:`, errText.slice(0, 200));
    return json({ error: 'upstream_error', status: llmRes.status }, 502, origin);
  }

  let parsed;
  try {
    const data = await llmRes.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty response');
    const cleaned = content.replace(/```(?:json)?\n?/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('[Worker] Failed to parse LLM response:', e.message);
    return json({ error: 'parse_failed' }, 502, origin);
  }

  // 规范化输出
  const result = {
    mood: typeof parsed.mood === 'string' ? parsed.mood : '奇幻',
    themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 4) : [],
    elements: Array.isArray(parsed.elements) ? parsed.elements.slice(0, 4) : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  };

  return json(result, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/parse' && request.method === 'POST') {
      return handleParse(request, env);
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response('ok', { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  },
};
