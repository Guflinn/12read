import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

let failed = 0;
function check(name, fn) {
  try { const d = fn(); console.log('  ok    ' + name + (d ? '  (' + d + ')' : '')); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  -> ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

check('HTML 基本结构', function () {
  assert(/^<!DOCTYPE html>/i.test(html.trim()), '缺少 doctype');
  assert(html.indexOf('lang="zh-CN"') > -1, '缺少 lang 属性');
  assert(html.indexOf('charset="utf-8"') > -1, '缺少 charset');
});

const IDS = ['view-shelf','view-reader','shelf-grid','shelf-empty','shelf-count','dropzone','storage-note',
  'reader-scroll','reader-content','reader-book','reader-chapter-label','chapter-pos','reader-progress-fill',
  'btn-prev','btn-next','toc-drawer','toc-list','toc-count','settings-sheet','fs-minus','fs-plus','fs-value',
  'btn-back','btn-toc','btn-settings','btn-import','btn-reset','btn-scope','scrim','modal-root','toast','errbar'];
check('必需元素 id 齐全', function () {
  const missing = IDS.filter(function (id) { return html.indexOf('id="' + id + '"') === -1; });
  assert(missing.length === 0, '缺少: ' + missing.join(', '));
  return IDS.length + ' 个';
});

check('内联脚本语法可解析', function () {
  assert(script.length > 0, '未找到内联脚本');
  new Function(script);
  return script.split('\n').length + ' 行';
});

check('脚本不含模板字符串占位', function () {
  assert(script.indexOf('$' + '{') === -1, '脚本中出现模板字符串插值');
});

const FEATURES = {
  '编码识别（导入提示）': /识别编码/,
  '章节切分': /function chaptersOf/,
  '书架按最近阅读排序': /lastOpenedAt \|\| 0/,
  '进度锚点（章内字符偏移）': /chapterOffsets/,
  '改字号保持阅读位置': /function changeFontSize/,
  '日夜主题切换': /data-theme/,
  '目录高亮当前章': /function highlightToc/,
  '删除与重命名': /function deleteBook[\s\S]*function renameBook/,
  '拖拽导入': /addEventListener\('drop'/,
  '键盘翻章': /ArrowRight/,
};
check('P0 功能锚点存在', function () {
  const miss = Object.keys(FEATURES).filter(function (k) { return !FEATURES[k].test(html); });
  assert(miss.length === 0, '缺少: ' + miss.join(', '));
  return Object.keys(FEATURES).length + ' 项';
});

check('本地存储访问有降级保护', function () {
  assert(html.indexOf('try { localStorage.setItem') > -1, 'save() 未包裹 try');
  assert(html.indexOf('var raw = localStorage.getItem(KEY);') > -1, 'load() 未读取原始值');
  assert(html.indexOf('storageOK = false') > -1, '缺少 storageOK 降级标记');
});

check('脚本错误可见化', function () {
  assert(/window\.onerror\s*=/.test(script), '未挂载 onerror');
  assert(html.indexOf('id="errbar"') > -1, '缺少 errbar 容器');
});

console.log(failed ? '\n' + failed + ' 项失败' : '\n全部通过 (' + IDS.length + ' 个元素 id / ' + Object.keys(FEATURES).length + ' 项功能锚点)');
process.exit(failed ? 1 : 0);
