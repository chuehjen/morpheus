/**
 * Morpheus LLM client — calls the Cloudflare Worker proxy.
 * API Key 存在 Worker Secret 里，前端不持有任何凭证。
 */

// dev 时走 Vite proxy（/api/parse → localhost:8787/parse）
// production 走已部署的 Worker URL
const PARSE_URL = import.meta.env.DEV
  ? '/api/parse'
  : 'https://morpheus-llm.YOUR_SUBDOMAIN.workers.dev/parse';

/**
 * 通过 Worker 解析梦境文本，返回结构化草稿字段。
 * 失败时返回 null，调用方自行降级到 mockParse。
 *
 * @param {string} text - 原始梦境文本
 * @returns {Promise<{mood: string, themes: string[], elements: string[], summary: string} | null>}
 */
export async function parseDream(text) {
  try {
    const res = await fetch(PARSE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Morpheus-Client': 'morpheus-web',
      },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[LLM] Worker returned error:', res.status, err);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error('[LLM] Parse failed, falling back to mock:', err.message);
    return null;
  }
}
