const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const {
  runOperation,
  previewImage,
  typeOf,
  sanitizeBaseName,
  markdownToHtml,
  htmlToText,
  chooseSmartOperation
} = require('../electron/operations');

test('recognizes common file families', () => {
  assert.equal(typeOf({ name: 'photo.webp' }), 'image');
  assert.equal(typeOf({ name: 'report.pdf' }), 'pdf');
  assert.equal(typeOf({ name: 'clip.mp4' }), 'video');
  assert.equal(typeOf({ name: 'book.xlsx' }), 'document');
});

test('sanitizes unsafe Windows filename characters', () => {
  assert.equal(sanitizeBaseName('a:b/c*?'), 'a-b-c--');
});

test('converts lightweight Markdown and HTML text', () => {
  assert.match(markdownToHtml('# 标题\n\n**内容**'), /<h1>标题<\/h1>/);
  assert.equal(htmlToText('<p>Hello<br>World</p>'), 'Hello\nWorld');
});

test('chooses a useful smart operation', () => {
  assert.equal(chooseSmartOperation([{ name: 'a.pdf' }, { name: 'b.pdf' }]), 'pdf-merge');
  assert.equal(chooseSmartOperation([{ name: 'a.png' }]), 'image-optimize');
  assert.equal(chooseSmartOperation([{ name: 'a.txt' }, { name: 'b.png' }]), 'archive-create');
});

test('processes a real image and writes WebP output', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'filepilot-image-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.png');
  await sharp({ create: { width: 80, height: 60, channels: 4, background: '#e97152' } }).png().toFile(input);
  const source = await fsp.stat(input);
  const result = await runOperation({
    operation: 'image-convert',
    files: [{ path: input, name: 'input.png', size: source.size, ext: '.png' }],
    options: { format: 'webp', quality: 75 },
    outputDirectory: directory
  });
  assert.equal(result.outputs.length, 1);
  assert.equal(path.extname(result.outputs[0].path), '.webp');
  assert.ok(fs.existsSync(result.outputs[0].path));
});

test('uses the visible crop rectangle for preview and final image', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'filepilot-crop-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'crop-source.png');
  await sharp({ create: { width: 200, height: 120, channels: 4, background: '#3478f6' } }).png().toFile(input);
  const cropArea = { left: 0.25, top: 0.25, width: 0.5, height: 0.5 };
  const preview = await previewImage(input, { format: 'png', cropArea }, false);
  assert.equal(preview.width, 100);
  assert.equal(preview.height, 60);
  const result = await runOperation({
    operation: 'image-crop',
    files: [{ path: input, name: 'crop-source.png', size: (await fsp.stat(input)).size, ext: '.png' }],
    options: { format: 'png', cropArea, nameSuffix: 'cropped' },
    outputDirectory: directory
  });
  const metadata = await sharp(result.outputs[0].path).metadata();
  assert.equal(metadata.width, 100);
  assert.equal(metadata.height, 60);
});

test('merges two real PDF documents', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'filepilot-pdf-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const files = [];
  for (let index = 0; index < 2; index += 1) {
    const document = await PDFDocument.create();
    document.addPage([300, 200]);
    const filePath = path.join(directory, `page-${index + 1}.pdf`);
    await fsp.writeFile(filePath, await document.save());
    files.push({ path: filePath, name: path.basename(filePath), size: (await fsp.stat(filePath)).size, ext: '.pdf' });
  }
  const result = await runOperation({ operation: 'pdf-merge', files, options: { outputName: 'merged' }, outputDirectory: directory });
  const merged = await PDFDocument.load(await fsp.readFile(result.outputs[0].path));
  assert.equal(merged.getPageCount(), 2);
});

test('creates a real ZIP archive', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'filepilot-zip-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'note.txt');
  await fsp.writeFile(input, 'FilePilot integration test', 'utf8');
  const result = await runOperation({
    operation: 'archive-create',
    files: [{ path: input, name: 'note.txt', size: 26, ext: '.txt' }],
    options: { outputName: 'bundle', level: 6 },
    outputDirectory: directory
  });
  assert.ok(result.outputs[0].size > 0);
  assert.equal(path.extname(result.outputs[0].path), '.zip');
});

test('transcodes a real WAV file to MP3 with bundled FFmpeg', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'filepilot-media-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const sampleRate = 8000;
  const sampleCount = 2000;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + sampleCount * 2, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    wav.writeInt16LE(Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 8000), 44 + index * 2);
  }
  const input = path.join(directory, 'tone.wav');
  await fsp.writeFile(input, wav);
  const result = await runOperation({
    operation: 'media-convert',
    files: [{ path: input, name: 'tone.wav', size: wav.length, ext: '.wav' }],
    options: { format: 'mp3', audioBitrate: '128k' },
    outputDirectory: directory
  });
  assert.equal(path.extname(result.outputs[0].path), '.mp3');
  assert.ok(result.outputs[0].size > 0);
});
