import puppeteer from 'puppeteer';
const BASE = 'http://localhost:5173';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  page.on('pageerror', err => logs.push('[ERROR] ' + err.message));

  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 500));

  // Inject simulated speech text
  await page.evaluate(() => {
    window.Native.stopListening = async () => {
      return '我梦见自己在一片大森林里迷路了，周围有很多会发光的蘑菇，天空是紫色的，远处有一座城堡';
    };
  });

  console.log('=== 1. 录音 ===');
  await page.click('#btn-start-record');
  await new Promise(r => setTimeout(r, 1500));
  console.log('屏幕:', await page.evaluate(() => [...document.querySelectorAll('.screen')].find(el => !el.hidden)?.id));

  console.log('\n=== 2. 停止录音 → AI 解析 ===');
  await page.click('#btn-stop-record');
  await new Promise(r => setTimeout(r, 10000)); // 解析步骤 + LLM 调用需要时间

  console.log('屏幕:', await page.evaluate(() => [...document.querySelectorAll('.screen')].find(el => !el.hidden)?.id));

  const data = await page.evaluate(() => ({
    summary: document.getElementById('f-summary')?.value || 'EMPTY',
    raw: document.getElementById('f-raw')?.value || 'EMPTY',
    mood: document.getElementById('f-mood')?.value || 'EMPTY',
    themes: [...document.querySelectorAll('#chips-themes .chip')].map(c => c.textContent.replace('×', '')),
    elements: [...document.querySelectorAll('#chips-elements .chip')].map(c => c.textContent.replace('×', '')),
  }));
  console.log('\n=== 解析结果 ===');
  console.log(JSON.stringify(data, null, 2));

  // Check if LLM actually worked (not mock)
  const isLLM = data.summary !== 'EMPTY' && data.summary.includes('城堡') || data.summary.includes('蘑菇') || data.summary.includes('迷路');
  const isMock = data.summary === 'EMPTY' || data.summary.length < 5;
  console.log('\nLLM 解析成功:', !isMock);

  console.log('\n=== Console 日志 ===');
  logs.forEach(l => console.log(l));

  await browser.close();
})();
