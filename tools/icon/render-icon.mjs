// 图标渲染：用 Chromium 把 build/icon.svg 以 1024px 位图输出
// 用法：node tools/icon/render-icon.mjs
// 注意：必须先落盘成 file:// 页面再加载，about:blank 源下 file:// 字体会被 Chromium 拦截
import { chromium } from '@playwright/test';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const FONT = path.join(ROOT, 'src', 'renderer', 'src', 'assets', 'fonts', 'NotoSerifSC-VF.ttf');
const OUT = path.join(ROOT, 'build', 'icon-master-1024.png');
const HTML = path.join(ROOT, 'build', '_icon-render.html');
const svg = readFileSync(path.join(ROOT, 'build', 'icon.svg'), 'utf8');

writeFileSync(HTML, `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face {
  font-family: 'Noto Serif SC VF';
  src: url('${pathToFileURL(FONT).href}') format('truetype-variations');
  font-weight: 200 900;
}
html, body { margin: 0; padding: 0; }
/* 注意：这里绝不能写 background —— 截图靠 omitBackground 保留透明四角 */
</style></head><body>${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
await page.goto(pathToFileURL(HTML).href);
await page.evaluate(() => document.fonts.ready);
const loaded = await page.evaluate(() => document.fonts.check("600 190px 'Noto Serif SC VF'", '十二'));
if (!loaded) throw new Error('Noto Serif SC VF 未加载，图标会回落到系统字体');
await page.locator('svg').screenshot({ path: OUT, type: 'png', omitBackground: true });
await browser.close();
console.log('rendered:', OUT, '| font loaded:', loaded);
