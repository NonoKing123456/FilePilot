const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { app, BrowserWindow, ipcMain } = require('electron');
const sharp = require('sharp');
const { previewImage, runOperation } = require('../electron/operations');

const errors = [];
const outputRoot = path.join(os.tmpdir(), 'filepilot-smoke-output');
const logPath = path.join(os.tmpdir(), 'filepilot-smoke.log');
const lines = [];
function log(...parts) {
  lines.push(parts.map((part) => (typeof part === 'string' ? part : String(part))).join(' '));
  require('fs').writeFileSync(logPath, lines.join('\n'), 'utf8');
}
process.on('uncaughtException', (error) => { log('UNCAUGHT', String((error && error.stack) || error)); app.exit(1); });
setTimeout(() => { log('WATCHDOG TIMEOUT'); app.exit(2); }, 120000).unref();

ipcMain.handle('output:default', () => outputRoot);
ipcMain.handle('app:capabilities', () => ({ image: true, pdf: true, archive: true, media: true, docx: true, spreadsheet: true, officePdf: false }));
ipcMain.handle('preview:image', (_event, payload) => previewImage(payload.filePath, payload.options || {}, payload.original === true));
ipcMain.handle('operation:run', async (_event, payload) => runOperation({
  ...payload,
  outputDirectory: payload.outputDirectory || outputRoot,
  onProgress: () => {}
}));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sample(directory) {
  const width = 1200;
  const height = 800;
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 3) {
    const pixel = index / 3;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    raw[index] = (x * 0.2 + y * 0.05) % 256;
    raw[index + 1] = (y * 0.25) % 256;
    raw[index + 2] = (x * 0.1 + 90) % 256;
  }
  const filePath = path.join(directory, 'smoke.jpg');
  await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toFile(filePath);
  return filePath;
}

app.whenReady().then(async () => {
  log('ready');
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: true
    }
  });
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) errors.push(message);
  });
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index-v2.html'));
  await wait(400);
  log('page loaded');

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'filepilot-smoke-'));
  const input = await sample(tempDirectory);
  const stat = await fs.stat(input);
  const script = async (code) => window.webContents.executeJavaScript(code, true);
  const check = async (label, code) => {
    const value = await script(`(() => { ${code} })()`);
    log('CHECK', String(value).padEnd(58), label);
    return value;
  };

  await script(`addFiles(${JSON.stringify([{ path: input, name: 'smoke.jpg', size: stat.size, ext: '.jpg' }])})`);
  await wait(1500);
  await check('default tab and sidebar title', `return document.querySelector('#toolTitle').textContent + '|' + document.querySelector('.tool-tab.active').textContent.trim()`);
  await check('tabs count and separator', `return document.querySelectorAll('.tool-tab').length + '/' + document.querySelectorAll('.tool-tab-sep').length`);

  await script(`document.querySelector('[data-operation="image-adjust"]').click()`);
  await wait(900);
  await check('switched to adjust, crop overlay hidden?', `return document.querySelector('#toolTitle').textContent + '|' + document.querySelector('#cropOverlay').hidden`);
  await check('crop badge initial', `return document.querySelector('#cropBadge').textContent`);

  await script(`document.querySelector('[data-ratio="1:1"]').click()`);
  await wait(1000);
  await check('ratio 1:1 gives square', `const parts = document.querySelector('#cropBadge').textContent.split('×').map(Number); return parts[0] + 'x' + parts[1] + ' square=' + (Math.abs(parts[0] - parts[1]) <= 2)`);

  await script(`document.querySelector('[data-scale="0.5"]').click()`);
  await wait(1000);
  await check('scale 50% applied', `return document.querySelector('#adjustWidth').value + ' | ' + document.querySelector('#adjustHeightHint').textContent`);

  await script(`document.querySelector('#resetAdjustButton').click()`);
  await wait(1000);
  await check('reset back to full frame', `return document.querySelector('#cropBadge').textContent + ' | ' + document.querySelector('#adjustWidth').value`);

  await script(`document.querySelector('[data-operation="image-optimize"]').click()`);
  await wait(1500);
  await script(`document.querySelectorAll('#optimizePresets .chip')[2].click()`);
  await wait(1800);
  await check('high quality preset + verdict', `return document.querySelectorAll('#optimizePresets .chip')[2].className + ' | ' + document.querySelector('#sizeVerdict').textContent`);

  await script(`document.querySelector('#targetToggle').click()`);
  await wait(3000);
  await check('target mode quality auto', `return document.querySelector('#targetRow').hidden + ' | ' + document.querySelector('#sizeVerdict').textContent + ' | ' + document.querySelector('#qualityOutput').textContent`);

  await script(`document.querySelector('[data-operation="image-convert"]').click()`);
  await wait(1500);
  await check('convert hides compare, shows size', `return document.querySelector('#compareToggle').hidden + ' | ' + document.querySelector('#sizeCompare').hidden`);

  await script(`document.querySelector('#compareToggle').click()`);
  await wait(900);
  await check('compare layout', `return document.querySelector('#previewStage').className + ' | originalPaneHidden=' + document.querySelector('#originalPane').hidden`);

  await script(`document.querySelector('[data-operation="image-optimize"]').click()`);
  await wait(1800);
  await fs.mkdir(outputRoot, { recursive: true });
  await script(`document.querySelector('#runButton').click()`);
  await wait(8000);
  await check('real export finished', `return 'panelHidden=' + document.querySelector('#resultPanel').hidden + ' | ' + (document.querySelector('#resultSummary').textContent || '')`);

  const files = await fs.readdir(outputRoot).catch(() => []);
  log('EXPORTED', files.join(', ') || '(none)');
  log('CONSOLE ERRORS', String(errors.length), JSON.stringify(errors.slice(0, 5)));
  await fs.rm(tempDirectory, { recursive: true, force: true });
  await fs.rm(outputRoot, { recursive: true, force: true }).catch(() => {});
  window.destroy();
  app.exit(0);
});
