const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const archiver = require('archiver');
const sharp = require('sharp');
const { PDFDocument, degrees } = require('pdf-lib');
const ffmpegStatic = require('ffmpeg-static');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.tif', '.tiff', '.heic']);
const PDF_EXTS = new Set(['.pdf']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus']);
const OFFICE_EXTS = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp']);

function extensionOf(file) {
  return (file.ext || path.extname(file.path || file.name || '')).toLowerCase();
}

function typeOf(file) {
  const ext = extensionOf(file);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (OFFICE_EXTS.has(ext)) return 'document';
  if (['.txt', '.md', '.html', '.htm', '.csv', '.json'].includes(ext)) return 'text';
  return 'other';
}

function sanitizeBaseName(value) {
  return String(value || 'filepilot-result')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120) || 'filepilot-result';
}

async function uniqueOutputPath(directory, baseName, extension) {
  const safeBase = sanitizeBaseName(baseName);
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  let candidate = path.join(directory, `${safeBase}${ext}`);
  let index = 2;
  while (true) {
    try {
      await fsp.access(candidate);
      candidate = path.join(directory, `${safeBase} (${index})${ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

function findSoffice() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  const candidates = roots.flatMap((root) => [
    path.join(root, 'LibreOffice', 'program', 'soffice.exe'),
    path.join(root, 'LibreOffice 7', 'program', 'soffice.exe')
  ]);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function resolveFfmpegPath() {
  if (!ffmpegStatic) return null;
  const unpacked = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  return fs.existsSync(unpacked) ? unpacked : ffmpegStatic;
}

function getCapabilities() {
  return {
    image: true,
    pdf: true,
    archive: true,
    media: Boolean(resolveFfmpegPath()),
    docx: true,
    spreadsheet: true,
    officePdf: Boolean(findSoffice()),
    privacy: 'local-only'
  };
}

function report(onProgress, completed, total, message, currentFile = '') {
  onProgress?.({
    percent: Math.max(0, Math.min(100, Math.round((completed / Math.max(1, total)) * 100))),
    message,
    currentFile
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function resolveImageFormat(filePath, requestedFormat) {
  if (requestedFormat && requestedFormat !== 'original') return requestedFormat.replace('jpg', 'jpeg').replace('tif', 'tiff');
  const original = path.extname(filePath).slice(1).toLowerCase().replace('jpg', 'jpeg').replace('tif', 'tiff');
  return ['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif'].includes(original) ? original : 'png';
}

async function prepareImage(filePath, options = {}) {
  const metadata = await sharp(filePath, { animated: false }).metadata();
  const swapsAxes = [5, 6, 7, 8].includes(metadata.orientation);
  const sourceWidth = swapsAxes ? metadata.height : metadata.width;
  const sourceHeight = swapsAxes ? metadata.width : metadata.height;
  if (!sourceWidth || !sourceHeight) throw new Error('无法读取图片尺寸。');
  let image = sharp(filePath, { animated: false }).rotate();
  let workingWidth = sourceWidth;
  let workingHeight = sourceHeight;

  if (options.cropArea && Number(options.cropArea.width) > 0 && Number(options.cropArea.height) > 0) {
    const leftPct = clamp(options.cropArea.left, 0, 0.99);
    const topPct = clamp(options.cropArea.top, 0, 0.99);
    const widthPct = clamp(options.cropArea.width, 0.01, 1 - leftPct);
    const heightPct = clamp(options.cropArea.height, 0.01, 1 - topPct);
    const left = Math.min(sourceWidth - 1, Math.round(sourceWidth * leftPct));
    const top = Math.min(sourceHeight - 1, Math.round(sourceHeight * topPct));
    const width = Math.max(1, Math.min(sourceWidth - left, Math.round(sourceWidth * widthPct)));
    const height = Math.max(1, Math.min(sourceHeight - top, Math.round(sourceHeight * heightPct)));
    image = image.extract({ left, top, width, height });
    workingWidth = width;
    workingHeight = height;
  } else if (options.cropRatio && !['original', 'free'].includes(options.cropRatio)) {
    const [rw, rh] = String(options.cropRatio).split(':').map(Number);
    if (rw > 0 && rh > 0) {
      const targetRatio = rw / rh;
      const sourceRatio = sourceWidth / sourceHeight;
      if (sourceRatio > targetRatio) {
        const width = Math.round(sourceHeight * targetRatio);
        image = image.extract({ left: Math.round((sourceWidth - width) / 2), top: 0, width, height: sourceHeight });
        workingWidth = width;
      } else {
        const height = Math.round(sourceWidth / targetRatio);
        image = image.extract({ left: 0, top: Math.round((sourceHeight - height) / 2), width: sourceWidth, height });
        workingHeight = height;
      }
    }
  }

  const width = Number(options.width || 0) || undefined;
  const height = Number(options.height || 0) || undefined;
  if (width || height) {
    image = image.resize({ width, height, fit: options.fit || 'inside', withoutEnlargement: options.allowUpscale !== true });
  }
  return { image, sourceWidth, sourceHeight, workingWidth, workingHeight };
}

function applyImageFormat(image, format, quality) {
  if (format === 'jpeg') return image.jpeg({ quality, mozjpeg: true });
  if (format === 'png') return image.png({ quality, compressionLevel: 9, palette: quality < 100 });
  if (format === 'webp') return image.webp({ quality });
  if (format === 'avif') return image.avif({ quality, effort: 4 });
  if (format === 'tiff') return image.tiff({ quality });
  if (format === 'gif') return image.gif();
  throw new Error(`暂不支持输出 ${format.toUpperCase()} 图片。`);
}

async function previewImage(filePath, options = {}, original = false) {
  const stat = await fsp.stat(filePath);
  const prepared = await prepareImage(filePath, original ? {} : options);
  if (original) {
    const previewBuffer = await prepared.image.resize({ width: 1100, height: 820, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    return {
      dataUrl: `data:image/jpeg;base64,${previewBuffer.toString('base64')}`,
      width: prepared.sourceWidth,
      height: prepared.sourceHeight,
      originalSize: stat.size,
      estimatedSize: stat.size
    };
  }
  const format = resolveImageFormat(filePath, options.format);
  const quality = Number(options.quality || 82);
  const encoded = await applyImageFormat(prepared.image.clone(), format, quality).toBuffer({ resolveWithObject: true });
  const previewBuffer = await sharp(encoded.data).resize({ width: 1100, height: 820, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return {
    dataUrl: `data:image/jpeg;base64,${previewBuffer.toString('base64')}`,
    width: encoded.info.width,
    height: encoded.info.height,
    originalSize: stat.size,
    estimatedSize: encoded.data.length,
    format
  };
}

async function processImages(files, options, outputDirectory, onProgress) {
  const imageFiles = files.filter((file) => typeOf(file) === 'image');
  if (!imageFiles.length) throw new Error('请选择至少一个图片文件。');
  const outputs = [];
  const quality = Number(options.quality || 82);

  for (let index = 0; index < imageFiles.length; index += 1) {
    const file = imageFiles[index];
    report(onProgress, index, imageFiles.length, '正在处理图片', file.name);
    const prepared = await prepareImage(file.path, options);
    const format = resolveImageFormat(file.path, options.format);
    const image = applyImageFormat(prepared.image, format, quality);
    const outputExt = format === 'jpeg' ? '.jpg' : format === 'tiff' ? '.tif' : `.${format}`;
    const base = `${path.basename(file.name, path.extname(file.name))}-${options.nameSuffix || 'processed'}`;
    const outputPath = await uniqueOutputPath(outputDirectory, base, outputExt);
    await image.toFile(outputPath);
    const stat = await fsp.stat(outputPath);
    outputs.push({ path: outputPath, name: path.basename(outputPath), size: stat.size, sourceSize: file.size });
  }
  report(onProgress, imageFiles.length, imageFiles.length, '图片处理完成');
  return outputs;
}

async function mergePdfs(files, options, outputDirectory, onProgress) {
  const pdfFiles = files.filter((file) => typeOf(file) === 'pdf');
  if (pdfFiles.length < 2) throw new Error('合并 PDF 至少需要两个 PDF 文件。');
  const merged = await PDFDocument.create();
  for (let index = 0; index < pdfFiles.length; index += 1) {
    const file = pdfFiles[index];
    report(onProgress, index, pdfFiles.length, '正在合并 PDF', file.name);
    const source = await PDFDocument.load(await fsp.readFile(file.path), { ignoreEncryption: false });
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  const outputPath = await uniqueOutputPath(outputDirectory, options.outputName || '合并文档', '.pdf');
  await fsp.writeFile(outputPath, await merged.save({ useObjectStreams: true }));
  report(onProgress, pdfFiles.length, pdfFiles.length, 'PDF 合并完成');
  return [{ path: outputPath, name: path.basename(outputPath), size: (await fsp.stat(outputPath)).size }];
}

async function splitPdfs(files, options, outputDirectory, onProgress) {
  const pdfFiles = files.filter((file) => typeOf(file) === 'pdf');
  if (!pdfFiles.length) throw new Error('请选择 PDF 文件。');
  const outputs = [];
  let completed = 0;
  for (const file of pdfFiles) {
    const source = await PDFDocument.load(await fsp.readFile(file.path));
    const indices = source.getPageIndices();
    for (const pageIndex of indices) {
      report(onProgress, completed, indices.length * pdfFiles.length, '正在拆分 PDF', `${file.name} · 第 ${pageIndex + 1} 页`);
      const target = await PDFDocument.create();
      const [page] = await target.copyPages(source, [pageIndex]);
      target.addPage(page);
      const base = `${path.basename(file.name, path.extname(file.name))}-第${pageIndex + 1}页`;
      const outputPath = await uniqueOutputPath(outputDirectory, base, '.pdf');
      await fsp.writeFile(outputPath, await target.save({ useObjectStreams: true }));
      outputs.push({ path: outputPath, name: path.basename(outputPath), size: (await fsp.stat(outputPath)).size });
      completed += 1;
    }
  }
  report(onProgress, 1, 1, 'PDF 拆分完成');
  return outputs;
}

async function rotatePdfs(files, options, outputDirectory, onProgress) {
  const pdfFiles = files.filter((file) => typeOf(file) === 'pdf');
  if (!pdfFiles.length) throw new Error('请选择 PDF 文件。');
  const outputs = [];
  const angle = Number(options.rotation || 90);
  for (let index = 0; index < pdfFiles.length; index += 1) {
    const file = pdfFiles[index];
    report(onProgress, index, pdfFiles.length, '正在旋转 PDF', file.name);
    const document = await PDFDocument.load(await fsp.readFile(file.path));
    document.getPages().forEach((page) => {
      const current = page.getRotation().angle || 0;
      page.setRotation(degrees((current + angle) % 360));
    });
    const base = `${path.basename(file.name, path.extname(file.name))}-已旋转`;
    const outputPath = await uniqueOutputPath(outputDirectory, base, '.pdf');
    await fsp.writeFile(outputPath, await document.save({ useObjectStreams: true }));
    outputs.push({ path: outputPath, name: path.basename(outputPath), size: (await fsp.stat(outputPath)).size });
  }
  report(onProgress, pdfFiles.length, pdfFiles.length, 'PDF 旋转完成');
  return outputs;
}

async function imagesToPdf(files, options, outputDirectory, onProgress) {
  const imageFiles = files.filter((file) => typeOf(file) === 'image');
  if (!imageFiles.length) throw new Error('请选择图片文件。');
  const document = await PDFDocument.create();
  for (let index = 0; index < imageFiles.length; index += 1) {
    const file = imageFiles[index];
    report(onProgress, index, imageFiles.length, '正在生成 PDF', file.name);
    const png = await sharp(file.path).rotate().png().toBuffer();
    const embedded = await document.embedPng(png);
    const margin = 28;
    const maxWidth = 595.28 - margin * 2;
    const maxHeight = 841.89 - margin * 2;
    const scale = Math.min(maxWidth / embedded.width, maxHeight / embedded.height, 1);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    const page = document.addPage([595.28, 841.89]);
    page.drawImage(embedded, { x: (595.28 - width) / 2, y: (841.89 - height) / 2, width, height });
  }
  const outputPath = await uniqueOutputPath(outputDirectory, options.outputName || '图片合集', '.pdf');
  await fsp.writeFile(outputPath, await document.save({ useObjectStreams: true }));
  report(onProgress, imageFiles.length, imageFiles.length, 'PDF 生成完成');
  return [{ path: outputPath, name: path.basename(outputPath), size: (await fsp.stat(outputPath)).size }];
}

async function createArchive(files, options, outputDirectory, onProgress) {
  if (!files.length) throw new Error('请添加要打包的文件。');
  const outputPath = await uniqueOutputPath(outputDirectory, options.outputName || 'FilePilot-文件包', '.zip');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: Number(options.level ?? 7) } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('progress', (progress) => report(onProgress, progress.entries.processed, files.length, '正在创建 ZIP', `${progress.entries.processed}/${files.length} 个文件`));
    archive.pipe(output);
    files.forEach((file) => archive.file(file.path, { name: file.name }));
    archive.finalize();
  });
  report(onProgress, 1, 1, 'ZIP 创建完成');
  return [{ path: outputPath, name: path.basename(outputPath), size: (await fsp.stat(outputPath)).size }];
}

function runProcess(command, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    child.stdout.on('data', (chunk) => onLine?.(chunk.toString()));
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.split('\n').filter(Boolean).slice(-4).join(' ') || `处理进程退出，代码 ${code}`));
    });
  });
}

async function processMedia(files, options, outputDirectory, onProgress) {
  const mediaFiles = files.filter((file) => ['video', 'audio'].includes(typeOf(file)));
  if (!mediaFiles.length) throw new Error('请选择音频或视频文件。');
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new Error('FFmpeg 处理引擎不可用，请重新安装 FilePilot。');
  const outputs = [];

  for (let index = 0; index < mediaFiles.length; index += 1) {
    const file = mediaFiles[index];
    const kind = typeOf(file);
    const targetFormat = options.format || (kind === 'video' ? 'mp4' : 'mp3');
    const outputPath = await uniqueOutputPath(outputDirectory, `${path.basename(file.name, path.extname(file.name))}-${options.nameSuffix || 'converted'}`, `.${targetFormat}`);
    const args = ['-hide_banner', '-y', '-i', file.path];
    if (options.startTime) args.push('-ss', String(options.startTime));
    if (options.duration) args.push('-t', String(options.duration));

    if (kind === 'video' && targetFormat !== 'gif') {
      const quality = options.quality || 'balanced';
      const crf = quality === 'small' ? '30' : quality === 'high' ? '19' : '24';
      args.push('-c:v', targetFormat === 'webm' ? 'libvpx-vp9' : 'libx264', '-crf', crf, '-preset', 'medium');
      if (targetFormat === 'mp4') args.push('-movflags', '+faststart', '-pix_fmt', 'yuv420p');
      args.push('-c:a', targetFormat === 'webm' ? 'libopus' : 'aac', '-b:a', options.audioBitrate || '160k');
    } else if (kind === 'video' && targetFormat === 'gif') {
      args.push('-vf', `fps=${Number(options.fps || 12)},scale=${Number(options.width || 720)}:-1:flags=lanczos`);
    } else {
      const codecMap = { mp3: 'libmp3lame', m4a: 'aac', aac: 'aac', ogg: 'libvorbis', opus: 'libopus', flac: 'flac', wav: 'pcm_s16le' };
      args.push('-vn', '-c:a', codecMap[targetFormat] || 'copy');
      if (!['wav', 'flac'].includes(targetFormat)) args.push('-b:a', options.audioBitrate || '192k');
    }
    args.push('-progress', 'pipe:1', '-nostats', outputPath);
    report(onProgress, index, mediaFiles.length, '正在处理音视频', file.name);
    await runProcess(ffmpegPath, args, (line) => {
      if (line.includes('progress=')) report(onProgress, index + 0.5, mediaFiles.length, '正在编码', file.name);
    });
    outputs.push({ path: outputPath, name: path.basename(outputPath), size: (await fsp.stat(outputPath)).size, sourceSize: file.size });
  }
  report(onProgress, mediaFiles.length, mediaFiles.length, '音视频处理完成');
  return outputs;
}

function markdownToHtml(markdown) {
  const escaped = String(markdown)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/h[1-6]>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function convertDocuments(files, options, outputDirectory, onProgress) {
  if (!files.length) throw new Error('请选择要转换的文档。');
  const outputs = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const ext = extensionOf(file);
    const format = String(options.format || 'txt').toLowerCase();
    report(onProgress, index, files.length, '正在转换文档', file.name);
    const base = `${path.basename(file.name, path.extname(file.name))}-converted`;

    if (format === 'pdf' && OFFICE_EXTS.has(ext)) {
      const soffice = findSoffice();
      if (!soffice) throw new Error('Office 转 PDF 需要 LibreOffice。安装后重启 FilePilot 即可自动启用。');
      await runProcess(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outputDirectory, file.path]);
      const produced = path.join(outputDirectory, `${path.basename(file.name, path.extname(file.name))}.pdf`);
      outputs.push({ path: produced, name: path.basename(produced), size: (await fsp.stat(produced)).size });
      continue;
    }

    let data;
    if (ext === '.docx') {
      const result = format === 'html'
        ? await mammoth.convertToHtml({ path: file.path })
        : await mammoth.extractRawText({ path: file.path });
      data = result.value;
    } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      const workbook = XLSX.readFile(file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (format === 'json') data = JSON.stringify(XLSX.utils.sheet_to_json(sheet, { defval: '' }), null, 2);
      else if (format === 'html') data = XLSX.utils.sheet_to_html(sheet);
      else data = XLSX.utils.sheet_to_csv(sheet);
    } else if (ext === '.json') {
      const json = JSON.parse(await fsp.readFile(file.path, 'utf8'));
      const rows = Array.isArray(json) ? json : [json];
      const sheet = XLSX.utils.json_to_sheet(rows);
      data = format === 'html' ? XLSX.utils.sheet_to_html(sheet) : format === 'json' ? JSON.stringify(json, null, 2) : XLSX.utils.sheet_to_csv(sheet);
    } else {
      const source = await fsp.readFile(file.path, 'utf8');
      if (format === 'html' && ext === '.md') data = `<!doctype html><meta charset="utf-8"><article><p>${markdownToHtml(source)}</p></article>`;
      else if (format === 'txt' && ['.html', '.htm'].includes(ext)) data = htmlToText(source);
      else data = source;
    }

    const outputExt = format === 'markdown' ? '.md' : `.${format}`;
    const outputPath = await uniqueOutputPath(outputDirectory, base, outputExt);
    await fsp.writeFile(outputPath, data, 'utf8');
    outputs.push({ path: outputPath, name: path.basename(outputPath), size: (await fsp.stat(outputPath)).size, sourceSize: file.size });
  }
  report(onProgress, files.length, files.length, '文档转换完成');
  return outputs;
}

function chooseSmartOperation(files) {
  const types = files.map(typeOf);
  if (types.length > 1 && types.every((type) => type === 'pdf')) return 'pdf-merge';
  if (types.every((type) => type === 'image')) return 'image-optimize';
  if (types.every((type) => ['audio', 'video'].includes(type))) return 'media-convert';
  if (types.every((type) => ['document', 'text'].includes(type))) return 'document-convert';
  return 'archive-create';
}

async function runOperation({ operation, files = [], options = {}, outputDirectory, onProgress }) {
  if (!files.length) throw new Error('请先添加文件。');
  const selected = operation === 'smart' ? chooseSmartOperation(files) : operation;
  let outputs;
  if (['image-optimize', 'image-convert', 'image-resize', 'image-crop'].includes(selected)) {
    outputs = await processImages(files, options, outputDirectory, onProgress);
  } else if (selected === 'pdf-merge') outputs = await mergePdfs(files, options, outputDirectory, onProgress);
  else if (selected === 'pdf-split') outputs = await splitPdfs(files, options, outputDirectory, onProgress);
  else if (selected === 'pdf-rotate') outputs = await rotatePdfs(files, options, outputDirectory, onProgress);
  else if (selected === 'images-to-pdf') outputs = await imagesToPdf(files, options, outputDirectory, onProgress);
  else if (selected === 'archive-create') outputs = await createArchive(files, options, outputDirectory, onProgress);
  else if (['media-convert', 'media-trim'].includes(selected)) outputs = await processMedia(files, options, outputDirectory, onProgress);
  else if (selected === 'document-convert') outputs = await convertDocuments(files, options, outputDirectory, onProgress);
  else throw new Error('请选择一个可用的处理工具。');

  return {
    operation: selected,
    outputDirectory,
    outputs,
    completedAt: new Date().toISOString()
  };
}

module.exports = {
  getCapabilities,
  previewImage,
  runOperation,
  typeOf,
  sanitizeBaseName,
  markdownToHtml,
  htmlToText,
  chooseSmartOperation
};
