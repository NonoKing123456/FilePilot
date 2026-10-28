const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { app, BrowserWindow, ipcMain } = require('electron');
const sharp = require('sharp');
const { previewImage } = require('../electron/operations');

ipcMain.handle('output:default', () => 'C:\\Users\\User\\Documents\\FilePilot Output');
ipcMain.handle('app:capabilities', () => ({ image: true, pdf: true, archive: true, media: true, docx: true, spreadsheet: true, officePdf: false }));
ipcMain.handle('preview:image', (_event, payload) => previewImage(payload.filePath, payload.options || {}, payload.original === true));

async function samplePhoto(directory) {
  const width = 1600;
  const height = 1067;
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index += 3) {
    const pixel = index / 3;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const sky = 90 + 120 * Math.sin(x / 420) * Math.cos(y / 520);
    const hill = y > height * 0.55 ? 60 + 30 * Math.sin(x / 120) : 0;
    raw[index] = Math.max(0, Math.min(255, 40 + sky * 0.5 + hill));
    raw[index + 1] = Math.max(0, Math.min(255, 70 + sky * 0.8 + hill * 0.8));
    raw[index + 2] = Math.max(0, Math.min(255, 120 + sky * 0.4 + hill * 0.5));
  }
  const filePath = path.join(directory, '示例照片.jpg');
  await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toFile(filePath);
  return filePath;
}

app.whenReady().then(async () => {
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
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index-v2.html'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const outputDirectory = path.join(__dirname, '..', 'artifacts');
  await fs.mkdir(outputDirectory, { recursive: true });
  const shot = async (name) => {
    const filePath = path.join(outputDirectory, name);
    await fs.writeFile(filePath, (await window.webContents.capturePage()).toPNG());
    console.log(filePath);
  };

  await shot('shot-1-empty.png');

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'filepilot-shot-'));
  const samplePath = await samplePhoto(tempDirectory);
  const sampleStat = await fs.stat(samplePath);
  await window.webContents.executeJavaScript(`addFiles(${JSON.stringify([{ path: samplePath, name: '示例照片.jpg', size: sampleStat.size, ext: '.jpg' }])})`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await shot('shot-2-compress.png');

  await window.webContents.executeJavaScript(`(() => { state.optimize.targetEnabled = true; state.optimize.targetMb = 0.35; renderSettings(); scheduleProcessedPreview(); return true; })()`);
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await shot('shot-3-target.png');

  await window.webContents.executeJavaScript(`(() => { state.operation = 'image-adjust'; state.compare = false; state.cropArea = { left: 0.18, top: 0.12, width: 0.5, height: 0.5 }; state.cropRatio = '1:1'; state.adjustScale = 1; renderActionChoices(); renderSettings(); renderImagePreview(); return true; })()`);
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await shot('shot-4-adjust.png');

  await window.webContents.executeJavaScript(`(() => { state.operation = 'image-optimize'; state.compare = true; renderActionChoices(); renderSettings(); renderImagePreview(); return true; })()`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await shot('shot-5-compare.png');

  await fs.rm(tempDirectory, { recursive: true, force: true });
  window.destroy();
  app.quit();
});
