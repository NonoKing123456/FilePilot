const path = require('path');
const fs = require('fs/promises');
const { app, BrowserWindow, ipcMain } = require('electron');
const { previewImage } = require('../electron/operations');

ipcMain.handle('output:default', () => 'C:\\Users\\User\\Documents\\FilePilot Output');
ipcMain.handle('app:capabilities', () => ({ image: true, pdf: true, archive: true, media: true, docx: true, spreadsheet: true, officePdf: false }));
ipcMain.handle('preview:image', (_event, payload) => previewImage(payload.filePath, payload.options || {}, payload.original === true));

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
  await new Promise((resolve) => setTimeout(resolve, 350));
  const outputDirectory = path.join(__dirname, '..', 'artifacts');
  await fs.mkdir(outputDirectory, { recursive: true });
  const emptyPath = path.join(outputDirectory, 'ui-v2-empty.png');
  await fs.writeFile(emptyPath, (await window.webContents.capturePage()).toPNG());
  const samplePath = path.join(__dirname, '..', 'build', 'icon.png');
  const sampleStat = await fs.stat(samplePath);
  await window.webContents.executeJavaScript(`addFiles(${JSON.stringify([{ path: samplePath, name: 'brand-assets.png', size: sampleStat.size, ext: '.png' }])})`);
  await new Promise((resolve) => setTimeout(resolve, 850));
  const workspacePath = path.join(outputDirectory, 'ui-v3-compress.png');
  await fs.writeFile(workspacePath, (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`state.operation = 'image-crop'; state.cropRatio = '1:1'; renderActionChoices(); renderSettings(); renderImagePreview(); applyCropRatio('1:1')`);
  await new Promise((resolve) => setTimeout(resolve, 450));
  const cropPath = path.join(outputDirectory, 'ui-v3-crop.png');
  await fs.writeFile(cropPath, (await window.webContents.capturePage()).toPNG());
  console.log(emptyPath);
  console.log(workspacePath);
  console.log(cropPath);
  window.destroy();
  app.quit();
});
