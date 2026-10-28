const path = require('path');
const fs = require('fs/promises');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { runOperation, getCapabilities, previewImage } = require('./operations');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f5f4ef',
    title: 'FilePilot',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index-v2.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

function defaultOutputDirectory() {
  return path.join(app.getPath('documents'), 'FilePilot Output');
}

ipcMain.handle('files:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择要处理的文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '所有支持的文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff', 'pdf', 'mp4', 'mov', 'mkv', 'avi', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'docx', 'xlsx', 'xls', 'csv', 'json', 'txt', 'md', 'html', 'zip'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (result.canceled) return [];
  return Promise.all(result.filePaths.map(async (filePath) => {
    const stat = await fs.stat(filePath);
    return { path: filePath, name: path.basename(filePath), size: stat.size, ext: path.extname(filePath).toLowerCase() };
  }));
});

ipcMain.handle('output:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择输出文件夹',
    defaultPath: defaultOutputDirectory(),
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('output:default', () => defaultOutputDirectory());
ipcMain.handle('app:capabilities', () => getCapabilities());
ipcMain.handle('preview:image', async (_event, payload) => {
  if (!payload?.filePath) throw new Error('缺少预览文件。');
  return previewImage(payload.filePath, payload.options || {}, payload.original === true);
});

ipcMain.handle('operation:run', async (_event, payload) => {
  const outputDirectory = payload.outputDirectory || defaultOutputDirectory();
  await fs.mkdir(outputDirectory, { recursive: true });
  return runOperation({
    ...payload,
    outputDirectory,
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('operation:progress', progress);
      }
    }
  });
});

ipcMain.handle('file:reveal', (_event, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle('file:open', (_event, filePath) => shell.openPath(filePath));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
