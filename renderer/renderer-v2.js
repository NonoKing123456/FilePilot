'use strict';

const QUALITY = { auto: 88, high: 94, small: 72 };
const MIN_CROP = 0.04;

const toolMeta = {
  'image-optimize': { label: '压缩体积', short: '压缩', group: 'edit', desc: '只改体积，画面和尺寸不变' },
  'image-adjust': { label: '裁剪与尺寸', short: '裁剪', group: 'edit', desc: '取景和输出尺寸一次调好' },
  'image-convert': { label: '转换格式', short: '转换', group: 'edit', desc: '只换格式，画面和尺寸不变' },
  'pdf-merge': { label: '合并 PDF', short: '合并', group: 'edit', desc: '按当前顺序合成一个文档' },
  'pdf-split': { label: '拆分 PDF', short: '拆分', group: 'edit', desc: '每一页存成单独的 PDF' },
  'pdf-rotate': { label: '旋转 PDF', short: '旋转', group: 'edit', desc: '把全部页面顺时针旋转' },
  'media-convert': { label: '转换与压缩', short: '转换', group: 'edit', desc: '换格式、调体积' },
  'media-trim': { label: '裁剪片段', short: '截取', group: 'edit', desc: '按时间截取一段' },
  'document-convert': { label: '转换文档', short: '转换', group: 'edit', desc: '文本和表格互转' },
  'images-to-pdf': { label: '合成 PDF', short: '合成 PDF', group: 'output', desc: '把图片按顺序排成 A4 文档' },
  'archive-create': { label: '打包 ZIP', short: '打包 ZIP', group: 'output', desc: '把当前文件整理成一个压缩包' }
};

const state = {
  files: [],
  selectedId: null,
  operation: null,
  pendingTool: null,
  edits: {},
  sharedCrop: false,
  cropRatio: 'free',
  zoom: 1,
  compare: false,
  original: null,
  processed: null,
  running: false,
  results: [],
  capabilities: {},
  outputDirectory: '',
  settings: {
    optimize: { mode: 'fit', quality: 80, format: 'original', targetMb: 1 },
    adjust: { quality: 'high' },
    convert: { format: 'webp', quality: 'high' },
    pdf: { rotation: 90, outputName: '' },
    media: { format: '', quality: 'balanced', bitrate: '192k', start: '', duration: '' },
    document: { format: 'txt' },
    archive: { name: '', level: 6 }
  }
};

const $ = (selector) => document.querySelector(selector);
const refs = {};
const IDS = [
  'emptyView', 'workspace', 'dropZone', 'chooseButton', 'outputButton', 'outputLabel', 'newTaskButton',
  'stripTitle', 'fileCount', 'thumbs', 'sharedCropButton', 'sharedCropLabel', 'addButton',
  'previewCard', 'pvName', 'pvSub', 'compareButton', 'zoomBox', 'zoomLabel', 'stage', 'frame',
  'previewImage', 'splitLayer', 'splitImage', 'tagA', 'tagB', 'splitLine', 'splitKnob',
  'cropOverlay', 'cropLock', 'cropBadge', 'stageNote', 'stageBusy', 'pvHint', 'pvOut',
  'sizesCard', 'sizeOriginal', 'sizeResult', 'barResult', 'barOriginal', 'verdict',
  'resultCard', 'resultSummary', 'resultList', 'openFolderButton',
  'opTitle', 'opDesc', 'opTabs', 'settings',
  'progressMini', 'progressFill', 'progressText', 'estimateText', 'runButton', 'runLabel', 'cancelButton',
  'engineStatus', 'toast'
];
IDS.forEach((id) => { refs[id] = document.getElementById(id); });

/* ── 基础工具 ── */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

function extOf(file) { return (file.ext || `.${String(file.name).split('.').pop()}`).toLowerCase(); }
function fileType(file) {
  const ext = extOf(file);
  if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.tif', '.tiff'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'].includes(ext)) return 'audio';
  if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp'].includes(ext)) return 'document';
  if (['.txt', '.md', '.html', '.htm', '.csv', '.json'].includes(ext)) return 'text';
  return 'other';
}
function typeLabel(file) { return extOf(file).slice(1).toUpperCase().slice(0, 5); }
function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024, unit = units[0];
  for (let i = 1; value >= 1024 && i < units.length; i += 1) { value /= 1024; unit = units[i]; }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}
function toast(message, kind = 'info') {
  refs.toast.textContent = message;
  refs.toast.className = `toast show${kind === 'error' ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { refs.toast.className = 'toast'; }, 2800);
}
function validOperations(files) {
  const types = files.map(fileType);
  if (!types.length) return [];
  if (types.every((t) => t === 'image')) return ['image-optimize', 'image-adjust', 'image-convert', 'images-to-pdf', 'archive-create'];
  if (types.every((t) => t === 'pdf')) return [...(files.length > 1 ? ['pdf-merge'] : []), 'pdf-split', 'pdf-rotate', 'archive-create'];
  if (types.every((t) => ['video', 'audio'].includes(t))) return ['media-convert', 'media-trim', 'archive-create'];
  if (types.every((t) => ['document', 'text'].includes(t))) return ['document-convert', 'archive-create'];
  return ['archive-create'];
}
const selectedFile = () => state.files.find((f) => f.id === state.selectedId) || state.files[0] || null;
const isImageMode = () => state.files.length > 0 && state.files.every((f) => fileType(f) === 'image');
const imagePreviewable = () => isImageMode() && ['image-optimize', 'image-adjust', 'image-convert'].includes(state.operation);
const isAdjust = () => state.operation === 'image-adjust';

/* ── 每张图的编辑状态 ── */
function editFor(id) {
  if (!state.edits[id]) state.edits[id] = { crop: { left: 0, top: 0, width: 1, height: 1 }, scale: 1, ratio: 'free' };
  return state.edits[id];
}
function currentEdit() {
  const file = selectedFile();
  return editFor(file ? file.id : '__none');
}
function cropPixels(file, edit) {
  const o = state.original;
  if (!o) return { width: 1, height: 1 };
  return { width: Math.max(1, Math.round(o.width * edit.crop.width)), height: Math.max(1, Math.round(o.height * edit.crop.height)) };
}

/* ── 渲染：文件条 ── */
function thumbVisual(file) {
  if (fileType(file) === 'image' && file.thumb) return `<img src="${file.thumb}" alt="">`;
  const color = { image: '#e77a5f', pdf: '#d45d5d', video: '#7769b4', audio: '#5286bb', document: '#4d9478', text: '#4d9478' }[fileType(file)] || '#6e7885';
  return `<span class="ext" style="background:${color};display:grid;place-items:center;width:100%;height:100%">${escapeHtml(typeLabel(file))}</span>`;
}

function renderStrip() {
  refs.fileCount.textContent = state.files.length;
  refs.stripTitle.textContent = isImageMode() ? '图片' : '文件';
  refs.sharedCropButton.hidden = !isAdjust() || state.files.length < 2;
  refs.sharedCropButton.classList.toggle('on', state.sharedCrop);
  refs.sharedCropLabel.textContent = `统一裁切：${state.sharedCrop ? '开' : '关'}`;
  refs.thumbs.innerHTML = state.files.map((file) => `
    <button class="thumb ${file.id === state.selectedId ? 'sel' : ''}" data-id="${escapeHtml(file.id)}" title="${escapeHtml(file.path)}">
      <span class="ph">${thumbVisual(file)}</span>
      <span class="nm">${escapeHtml(file.name)}</span>
      <span class="sz">${formatBytes(file.size)}</span>
      <span class="rm" data-remove="${escapeHtml(file.id)}" title="移除">×</span>
    </button>`).join('') + '<button class="add-tile" data-add="1"><b>＋</b>添加</button>';

  refs.thumbs.querySelectorAll('.thumb').forEach((node) => {
    node.addEventListener('click', (event) => {
      const removeId = event.target.closest('[data-remove]')?.dataset.remove;
      if (removeId) { event.stopPropagation(); removeFile(removeId); return; }
      if (node.dataset.id !== state.selectedId) selectFile(node.dataset.id);
    });
  });
  refs.thumbs.querySelector('[data-add]').addEventListener('click', () => pickFiles());

  // 拖动缩略图调整顺序（PDF 合并、图片转 PDF 依赖这个顺序）
  let draggedId = null;
  refs.thumbs.querySelectorAll('.thumb').forEach((node) => {
    node.draggable = true;
    node.addEventListener('dragstart', (event) => {
      draggedId = node.dataset.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.dataset.id);
    });
    node.addEventListener('dragend', () => { draggedId = null; });
    node.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
    node.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const from = draggedId || event.dataTransfer.getData('text/plain');
      if (from && from !== node.dataset.id) reorderFiles(from, node.dataset.id);
    });
  });
}

function reorderFiles(fromId, toId) {
  const from = state.files.findIndex((f) => f.id === fromId);
  const to = state.files.findIndex((f) => f.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = state.files.splice(from, 1);
  state.files.splice(to, 0, moved);
  state.results = [];
  renderStrip();
  renderResults();
}

/* ── 渲染：标签与设置 ── */
function renderTabs() {
  const allowed = validOperations(state.files);
  const ordered = [
    ...allowed.filter((id) => toolMeta[id].group === 'edit'),
    ...allowed.filter((id) => toolMeta[id].group === 'output')
  ];
  refs.opTabs.innerHTML = ordered.map((id) => `<button data-op="${id}" class="${state.operation === id ? 'on' : ''}"
    title="${escapeHtml(toolMeta[id].label)}">${escapeHtml(toolMeta[id].short)}</button>`).join('');
  refs.opTabs.querySelectorAll('[data-op]').forEach((btn) => {
    btn.addEventListener('click', () => { if (btn.dataset.op !== state.operation) setOperation(btn.dataset.op); });
  });
  refs.opTitle.textContent = toolMeta[state.operation]?.label || '处理';
  refs.opDesc.textContent = toolMeta[state.operation]?.desc || '';
}

function setOperation(op) {
  state.operation = op;
  state.compare = false;
  state.results = [];
  renderTabs();
  renderSettings();
  renderStrip();
  renderPreview();
  renderResults();
  renderFooter();
}

function renderSettings() {
  const op = state.operation;
  if (!op) return;
  if (op === 'image-optimize') refs.settings.innerHTML = optimizeTemplate();
  else if (op === 'image-adjust') refs.settings.innerHTML = adjustTemplate();
  else if (op === 'image-convert') refs.settings.innerHTML = convertTemplate();
  else if (op === 'pdf-merge') refs.settings.innerHTML = `${textField('outputName', '输出文件名', state.settings.pdf.outputName || '合并文档')}<p class="hint">拖动顶部缩略图可以调整合并顺序。</p>`;
  else if (op === 'pdf-split') refs.settings.innerHTML = '<p class="hint">每一页会保存成单独的 PDF，原文件不会改变。</p>';
  else if (op === 'pdf-rotate') refs.settings.innerHTML = `<div class="group"><div class="glabel"><span>顺时针旋转</span></div><div class="seg" id="rotateSeg">
      ${[90, 180, 270].map((deg) => `<button data-deg="${deg}" class="${Number(state.settings.pdf.rotation) === deg ? 'on' : ''}">${deg}°</button>`).join('')}
    </div></div>`;
  else if (op === 'images-to-pdf') refs.settings.innerHTML = `${textField('outputName', '输出文件名', state.settings.pdf.outputName || '图片合集')}<p class="hint">图片按顶部顺序排入 A4 页面，每页一张。</p>`;
  else if (op === 'media-convert' || op === 'media-trim') refs.settings.innerHTML = mediaTemplate(op);
  else if (op === 'document-convert') refs.settings.innerHTML = documentTemplate();
  else if (op === 'archive-create') refs.settings.innerHTML = archiveTemplate();

  bindSettings();
  appendOutputBlock();
  appendNote();
  syncDynamicValues();
}

function outputShortName() {
  const parts = String(state.outputDirectory || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || 'FilePilot Output';
}

function appendOutputBlock() {
  const wrap = document.createElement('div');
  wrap.className = 'group';
  wrap.innerHTML = `<div class="glabel"><span>输出到</span></div>
    <button class="out-pick" id="outputPick" title="${escapeHtml(state.outputDirectory)}">
      <span>${escapeHtml(outputShortName())}</span><b>更改</b>
    </button>
    <p class="hint">同名文件会自动加序号，不会覆盖已有文件。</p>`;
  refs.settings.appendChild(wrap);
  wrap.querySelector('#outputPick').addEventListener('click', pickOutputDirectory);
}

async function pickOutputDirectory() {
  const directory = await window.filepilot.chooseOutputDirectory();
  if (!directory) return;
  state.outputDirectory = directory;
  refs.outputLabel.textContent = outputShortName();
  refs.outputLabel.title = directory;
  renderSettings();
}

function appendNote() {
  const note = document.createElement('div');
  note.className = 'note';
  const count = state.files.length;
  if (isAdjust() && count > 1) {
    note.innerHTML = state.sharedCrop
      ? `<span>◎</span><span>统一裁切已开启：当前裁框会应用到全部 <b>${count}</b> 个文件。</span>`
      : `<span>◎</span><span>裁切只作用于当前这张。打开上方「统一裁切」可以一次应用到全部 <b>${count}</b> 个文件。</span>`;
  } else if (imagePreviewable() && count > 1) {
    note.innerHTML = `<span>◎</span><span>本次设置会应用到 <b>${count}</b> 个文件。</span>`;
  } else {
    note.innerHTML = `<span>◎</span><span>处理结果会保存到「${escapeHtml(state.outputDirectory.split(/[\\/]/).pop() || 'FilePilot Output')}」，原文件不会被修改。</span>`;
  }
  refs.settings.appendChild(note);
}

function textField(id, label, value) {
  return `<div class="group"><div class="glabel"><span>${label}</span></div>
    <div class="field"><input id="${id}" value="${escapeHtml(value || '')}" spellcheck="false"></div></div>`;
}

function optimizeTemplate() {
  const s = state.settings.optimize;
  return `
  <div class="group">
    <div class="glabel"><span>压缩目标</span></div>
    <div class="seg" data-key="mode">
      <button data-value="small" class="${s.mode === 'small' ? 'on' : ''}">小而清楚</button>
      <button data-value="fit" class="${s.mode === 'fit' ? 'on' : ''}">明显变小</button>
      <button data-value="size" class="${s.mode === 'size' ? 'on' : ''}">指定体积</button>
    </div>
  </div>
  ${s.mode === 'size' ? `<div class="group">
    <div class="glabel"><span>不超过</span></div>
    <div class="field"><input id="targetMb" type="number" min="0.02" step="0.05" value="${s.targetMb}"><span class="unit">MB</span></div>
    <div class="chips" id="targetPresets">
      <button class="chip" data-mb="0.3">300 KB</button>
      <button class="chip" data-mb="1">1 MB</button>
      <button class="chip" data-mb="2">2 MB</button>
      <button class="chip" data-mb="5">5 MB</button>
    </div>
    <p class="hint">自动挑最清晰的设置；实在压不到会先降像素，不会硬塞模糊图。</p>
  </div>` : ''}
  <div class="group">
    <div class="glabel"><span>输出格式</span></div>
    <div class="chips" data-key="format">
      <button class="chip ${s.format === 'original' ? 'on' : ''}" data-value="original">保持原格式</button>
      <button class="chip ${s.format === 'webp' ? 'on' : ''}" data-value="webp">WebP<span class="k">小 20–35%</span></button>
      <button class="chip ${s.format === 'avif' ? 'on' : ''}" data-value="avif">AVIF<span class="k">更小更慢</span></button>
    </div>
  </div>
  <details class="adv"><summary>高级</summary>
    <div class="adv-body">
      <div class="glabel"><span>清晰度</span><output id="qualityOut">${s.quality}%</output></div>
      <input class="range" id="qualityRange" type="range" min="35" max="100" value="${s.quality}" ${s.mode === 'size' ? 'disabled' : ''}>
    </div>
  </details>`;
}

function adjustTemplate() {
  const s = state.settings.adjust;
  const e = currentEdit();
  return `
  <div class="group">
    <div class="glabel"><span>画面比例</span><span id="ratioHint" style="color:var(--primary)">${e.ratio === 'free' ? '自由' : '已锁定'}</span></div>
    <div class="chips" data-key="ratio">
      ${[['free', '自由'], ['original', '原始'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:4', '3:4'], ['16:9', '16:9']].map(([v, label]) => `<button class="chip ${e.ratio === v ? 'on' : ''}" data-value="${v}">${label}</button>`).join('')}
    </div>
    <p class="hint">拖动方框时始终保持所选比例，不会被悄悄改成自由。</p>
  </div>
  <div class="group">
    <div class="glabel"><span>输出尺寸</span></div>
    <div class="row2">
      <div class="field"><input id="adjustWidth" type="number" min="16" step="1"><span class="unit">宽</span></div>
      <div class="field locked"><input id="adjustHeight" readonly><span class="unit">高</span></div>
    </div>
  </div>
  <div class="group">
    <div class="glabel"><span>缩放</span></div>
    <div class="chips" data-key="scale">
      ${[[1, '100%'], [0.75, '75%'], [0.5, '50%'], [0.25, '25%']].map(([v, label]) => `<button class="chip ${Math.abs(e.scale - v) < 0.001 ? 'on' : ''}" data-value="${v}">${label}</button>`).join('')}
    </div>
  </div>
  <div class="group">
    <div class="glabel"><span>输出质量</span><span class="good" id="qualityVerdict"></span></div>
    <div class="seg" data-key="quality">
      <button data-value="auto" class="${s.quality === 'auto' ? 'on' : ''}">自动</button>
      <button data-value="high" class="${s.quality === 'high' ? 'on' : ''}">高画质</button>
      <button data-value="small" class="${s.quality === 'small' ? 'on' : ''}">更小</button>
    </div>
  </div>
  <button class="plain-btn" id="resetCrop">重置为整张图</button>`;
}

function convertTemplate() {
  const s = state.settings.convert;
  return `
  <div class="group">
    <div class="glabel"><span>转换为</span></div>
    <div class="chips" data-key="format">
      ${[['jpeg', 'JPG'], ['png', 'PNG<span class="k">支持透明</span>'], ['webp', 'WebP'], ['avif', 'AVIF']].map(([v, label]) => `<button class="chip ${s.format === v ? 'on' : ''}" data-value="${v}">${label}</button>`).join('')}
    </div>
    ${s.format === 'jpeg' ? '<p class="hint">透明区域会变成白色背景。</p>' : ''}
  </div>
  <div class="group">
    <div class="glabel"><span>质量</span></div>
    <div class="seg" data-key="quality">
      <button data-value="auto" class="${s.quality === 'auto' ? 'on' : ''}">自动</button>
      <button data-value="high" class="${s.quality === 'high' ? 'on' : ''}">高画质</button>
      <button data-value="small" class="${s.quality === 'small' ? 'on' : ''}">更小</button>
    </div>
  </div>`;
}

function mediaTemplate(op) {
  const s = state.settings.media;
  const hasVideo = state.files.some((f) => fileType(f) === 'video');
  const formats = hasVideo
    ? [['mp4', 'MP4'], ['webm', 'WebM'], ['mkv', 'MKV'], ['gif', 'GIF']]
    : [['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['flac', 'FLAC'], ['ogg', 'OGG']];
  const current = s.format || (hasVideo ? 'mp4' : 'mp3');
  return `
  <div class="group">
    <div class="glabel"><span>输出格式</span></div>
    <div class="chips" data-key="mediaFormat">
      ${formats.map(([v, label]) => `<button class="chip ${current === v ? 'on' : ''}" data-value="${v}">${label}</button>`).join('')}
    </div>
  </div>
  ${hasVideo ? `<div class="group"><div class="glabel"><span>输出质量</span></div>
    <div class="seg" data-key="mediaQuality">
      ${[['small', '更小'], ['balanced', '均衡'], ['high', '高清']].map(([v, label]) => `<button data-value="${v}" class="${s.quality === v ? 'on' : ''}">${label}</button>`).join('')}
    </div></div>` : `<div class="group"><div class="glabel"><span>音频码率</span></div>
    <div class="seg" data-key="bitrate">
      ${[['128k', '128k'], ['192k', '192k'], ['256k', '256k'], ['320k', '320k']].map(([v, label]) => `<button data-value="${v}" class="${s.bitrate === v ? 'on' : ''}">${label}</button>`).join('')}
    </div></div>`}
  ${op === 'media-trim' ? `<div class="group"><div class="glabel"><span>截取范围（秒）</span></div>
    <div class="row2">
      <div class="field"><input id="startTime" type="number" min="0" step="0.1" placeholder="0" value="${escapeHtml(s.start)}"><span class="unit">开始</span></div>
      <div class="field"><input id="duration" type="number" min="0.1" step="0.1" placeholder="到结尾" value="${escapeHtml(s.duration)}"><span class="unit">时长</span></div>
    </div></div>` : ''}`;
}

function documentTemplate() {
  const ext = extOf(state.files[0] || { name: 'a.txt' });
  let formats = [['txt', '纯文本 TXT'], ['html', '网页 HTML']];
  if (['.xlsx', '.xls', '.csv', '.json'].includes(ext)) formats = [['csv', 'CSV 表格'], ['json', 'JSON 数据'], ['html', 'HTML 表格']];
  if (state.capabilities.officePdf && ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) formats.push(['pdf', 'PDF 文档']);
  const current = state.settings.document.format || formats[0][0];
  return `<div class="group"><div class="glabel"><span>输出格式</span></div>
    <div class="chips" data-key="docFormat">
      ${formats.map(([v, label]) => `<button class="chip ${current === v ? 'on' : ''}" data-value="${v}">${label}</button>`).join('')}
    </div>
    ${!state.capabilities.officePdf && ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext) ? '<p class="hint">安装 LibreOffice 后会自动增加「转为 PDF」。</p>' : ''}
  </div>`;
}

function archiveTemplate() {
  const s = state.settings.archive;
  return `${textField('archiveName', '压缩包名称', s.name || 'FilePilot-文件包')}
  <div class="group"><div class="glabel"><span>压缩强度</span><output id="levelOut">${s.level} / 9</output></div>
    <input class="range" id="levelRange" type="range" min="0" max="9" value="${s.level}"></div>`;
}

function bindSettings() {
  const s = state.settings;
  refs.settings.querySelectorAll('[data-key]').forEach((box) => {
    const key = box.dataset.key;
    box.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.value;
        box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
        applySetting(key, value);
      });
    });
  });
  const range = $('#qualityRange');
  if (range) range.addEventListener('input', () => {
    s.optimize.quality = Number(range.value);
    $('#qualityOut').textContent = `${range.value}%`;
    schedulePreview();
  });
  const targetMb = $('#targetMb');
  if (targetMb) targetMb.addEventListener('input', () => {
    const value = Number(targetMb.value);
    if (Number.isFinite(value) && value > 0) { s.optimize.targetMb = value; schedulePreview(); }
  });
  refs.settings.querySelectorAll('[data-mb]').forEach((btn) => btn.addEventListener('click', () => {
    s.optimize.targetMb = Number(btn.dataset.mb);
    $('#targetMb').value = btn.dataset.mb;
    schedulePreview();
  }));
  const width = $('#adjustWidth');
  if (width) width.addEventListener('input', () => {
    const o = state.original;
    if (!o) return;
    const e = currentEdit();
    const value = Number(width.value);
    const cropW = o.width * e.crop.width;
    if (!Number.isFinite(value) || value < 8 || cropW < 1) return;
    setEdit({ scale: clamp(value / cropW, 0.02, 4) }, false);
    syncDynamicValues();
    schedulePreview();
  });
  const height = $('#adjustHeight');
  if (height) height.readOnly = true;
  const reset = $('#resetCrop');
  if (reset) reset.addEventListener('click', () => {
    setCrop({ left: 0, top: 0, width: 1, height: 1 }, 'free');
    state.cropRatio = 'free';
    renderSettings();
    schedulePreview();
  });
  const rotate = $('#rotateSeg');
  if (rotate) rotate.querySelectorAll('[data-deg]').forEach((btn) => btn.addEventListener('click', () => {
    s.pdf.rotation = Number(btn.dataset.deg);
    rotate.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
  }));
  const name = $('#outputName');
  if (name) name.addEventListener('input', () => { s.pdf.outputName = name.value; });
  const archiveName = $('#archiveName');
  if (archiveName) archiveName.addEventListener('input', () => { s.archive.name = archiveName.value; });
  const level = $('#levelRange');
  if (level) level.addEventListener('input', () => {
    s.archive.level = Number(level.value);
    $('#levelOut').textContent = `${level.value} / 9`;
  });
  const start = $('#startTime');
  if (start) start.addEventListener('input', () => { s.media.start = start.value; });
  const duration = $('#duration');
  if (duration) duration.addEventListener('input', () => { s.media.duration = duration.value; });
}

function applySetting(key, value) {
  const s = state.settings;
  if (key === 'mode') {
    s.optimize.mode = value;
    if (value === 'small') s.optimize.quality = 90;
    if (value === 'fit') s.optimize.quality = 80;
    renderSettings(); schedulePreview(); return;
  }
  if (key === 'format') { s.optimize.format = value; schedulePreview(); return; }
  if (key === 'ratio') { applyRatio(value); return; }
  if (key === 'scale') { setEdit({ scale: Number(value) }, true); syncDynamicValues(); schedulePreview(); return; }
  if (key === 'quality') { s.adjust.quality = value; schedulePreview(); return; }
  if (key === 'mediaFormat' || key === 'mediaQuality' || key === 'bitrate') {
    if (key === 'mediaFormat') s.media.format = value;
    if (key === 'mediaQuality') s.media.quality = value;
    if (key === 'bitrate') s.media.bitrate = value;
    renderFooter(); return;
  }
  if (key === 'docFormat') { s.document.format = value; return; }
  renderFooter();
}

/* ── 编辑状态写入 ── */
function setCrop(crop, ratio) {
  const targets = state.sharedCrop && state.files.length > 1 ? state.files : [selectedFile()];
  targets.filter(Boolean).forEach((file) => {
    const edit = editFor(file.id);
    edit.crop = { ...crop };
    if (ratio !== undefined) edit.ratio = ratio;
  });
  state.cropRatio = ratio !== undefined ? ratio : state.cropRatio;
}
function setEdit(patch, applyAll) {
  const file = selectedFile();
  if (!file) return;
  const targets = (applyAll || state.sharedCrop) && state.files.length > 1 ? state.files : [file];
  targets.forEach((f) => Object.assign(editFor(f.id), patch));
}
function applyRatio(ratio) {
  const o = state.original;
  const e = currentEdit();
  state.cropRatio = ratio;
  if (!o) { e.ratio = ratio; return; }
  if (ratio === 'free') {
    setCrop(e.crop, 'free');
    syncDynamicValues(); schedulePreview(); return;
  }
  if (ratio === 'original') {
    setCrop({ left: 0, top: 0, width: 1, height: 1 }, 'original');
    syncDynamicValues(); schedulePreview(); return;
  }
  const [rw, rh] = ratio.split(':').map(Number);
  const target = rw / rh;
  const sourceRatio = o.width / o.height;
  let width = 0.86;
  let height = width * sourceRatio / target;
  if (height > 0.86) { height = 0.86; width = height * target / sourceRatio; }
  const crop = { left: (1 - width) / 2, top: (1 - height) / 2, width, height };
  setCrop(crop, ratio);
  syncDynamicValues();
  schedulePreview();
}

/* ── 预览 ── */
let previewTimer = null;
let previewToken = 0;

function showBusy(on) { refs.stageBusy.hidden = !on; }

function schedulePreview(delay = 180) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { refreshProcessed({ fast: false }); }, delay);
}
function scheduleQuickPreview() {
  clearTimeout(previewTimer);
  refreshProcessed({ fast: true });
}

async function loadOriginal() {
  const file = selectedFile();
  if (!file || !isImageMode()) { state.original = null; return; }
  try {
    const res = await window.filepilot.getImagePreview({ filePath: file.path, options: {}, original: true });
    if (selectedFile()?.id !== file.id) return;
    state.original = res;
    if (!file.thumb) { file.thumb = res.thumb || res.dataUrl; }
    renderStrip();
  } catch (error) {
    state.original = null;
    toast('无法读取这张图片的预览', 'error');
  }
}

function imageOptions(file, fast) {
  const op = state.operation;
  if (op === 'image-optimize') {
    const s = state.settings.optimize;
    return {
      format: s.format,
      quality: s.quality,
      targetBytes: s.mode === 'size' ? Math.round(s.targetMb * 1024 * 1024) : 0
    };
  }
  if (op === 'image-convert') {
    return { format: state.settings.convert.format, quality: QUALITY[state.settings.convert.quality] || 88 };
  }
  if (op === 'image-adjust') {
    const edit = editFor(file.id);
    return {
      format: 'original',
      quality: QUALITY[state.settings.adjust.quality] || 88,
      cropArea: edit.crop,
      scale: edit.scale,
      allowUpscale: edit.scale > 1
    };
  }
  return { format: 'original' };
}

async function refreshProcessed({ fast = false } = {}) {
  const file = selectedFile();
  if (!file || !imagePreviewable()) return;
  const token = ++previewToken;
  if (!fast) showBusy(true);
  try {
    const res = await window.filepilot.getImagePreview({
      filePath: file.path,
      options: imageOptions(file, fast),
      original: false,
      fast
    });
    if (token !== previewToken) return;
    state.processed = res;
  } catch (error) {
    if (token !== previewToken) return;
    state.processed = null;
    toast(error?.message || '无法生成预览', 'error');
  } finally {
    if (token === previewToken) { showBusy(false); }
  }
  if (token !== previewToken) return;
  paintPreview();
  renderSizes();
  renderFooter();
}

function paintPreview() {
  const file = selectedFile();
  if (!file || !imagePreviewable()) return;
  const original = state.original;
  if (!original) return;
  const showOriginalOnly = isAdjust();
  const source = showOriginalOnly ? original.dataUrl : (state.processed?.dataUrl || original.dataUrl);
  refs.previewImage.src = source;
  refs.frame.hidden = false;
  refs.stageNote.hidden = true;
  refs.stage.classList.remove('plain');
  refs.pvName.textContent = file.name;
  const dims = showOriginalOnly
    ? (() => {
      const edit = currentEdit();
      return `${Math.round(original.width * edit.crop.width * edit.scale)} × ${Math.round(original.height * edit.crop.height * edit.scale)}`;
    })()
    : `${state.processed?.width || original.width} × ${state.processed?.height || original.height}`;
  refs.pvSub.textContent = `原图 ${original.width} × ${original.height} · ${formatBytes(file.size)}${original.pages > 1 ? ' · 动图（仅首帧）' : ''}`;
  refs.pvOut.innerHTML = `输出 <strong>${dims}</strong>`;
  refs.pvHint.textContent = state.compare
    ? '按住中间圆点左右拖动，直接看差异'
    : isAdjust()
      ? '拖动方框选择要保留的画面；方向键可微调，Shift 加速'
      : state.operation === 'image-optimize'
        ? '压缩只改体积，画面基本不变；点「对比原图」可以直接看差异'
        : '只换格式，画面和尺寸都不变';
  refs.zoomBox.hidden = false;
  refs.compareButton.hidden = !(state.operation === 'image-optimize' || state.operation === 'image-convert');
  refs.compareButton.textContent = state.compare ? '退出对比' : '对比原图';
  refs.compareButton.classList.toggle('on', state.compare);
  refs.tagA.hidden = !state.compare;
  refs.tagB.hidden = !state.compare;
  refs.splitLayer.hidden = !state.compare;
  refs.splitLine.hidden = !state.compare;
  refs.splitKnob.hidden = !state.compare;
  if (state.compare) {
    refs.splitImage.src = original.dataUrl;
    refs.tagA.textContent = `原图 ${formatBytes(file.size)}`;
    refs.tagB.textContent = `处理后 ${state.processed ? formatBytes(state.processed.estimatedSize) : '—'}`;
  }
  refs.cropOverlay.hidden = !isAdjust() || state.compare;
  updateCropOverlay();
  fitFrame();
}

function fitFrame() {
  const original = state.original;
  if (!original || !imagePreviewable()) return;
  const stage = refs.stage;
  const availW = Math.max(80, stage.clientWidth - 32);
  const availH = Math.max(80, stage.clientHeight - 32);
  const ratio = original.width / original.height;
  let width = availW;
  let height = width / ratio;
  if (height > availH) { height = availH; width = height * ratio; }
  width *= state.zoom;
  height *= state.zoom;
  refs.frame.style.width = `${Math.round(width)}px`;
  refs.frame.style.height = `${Math.round(height)}px`;
  refs.zoomLabel.textContent = state.zoom === 1 ? '适应' : `${Math.round(state.zoom * 100)}%`;
}

function updateCropOverlay() {
  if (refs.cropOverlay.hidden) return;
  const edit = currentEdit();
  const crop = edit.crop;
  refs.cropOverlay.style.left = `${crop.left * 100}%`;
  refs.cropOverlay.style.top = `${crop.top * 100}%`;
  refs.cropOverlay.style.width = `${crop.width * 100}%`;
  refs.cropOverlay.style.height = `${crop.height * 100}%`;
  const toPixels = (w, h) => {
    const o = state.original;
    return { width: Math.round((o ? o.width : w) * crop.width * edit.scale), height: Math.round((o ? o.height : h) * crop.height * edit.scale) };
  };
  const px = toPixels();
  refs.cropBadge.textContent = `${px.width} × ${px.height}`;
  const locked = edit.ratio && edit.ratio !== 'free';
  refs.cropLock.hidden = !locked;
  if (locked) refs.cropLock.textContent = `锁定 ${edit.ratio === 'original' ? '原始比例' : edit.ratio}`;
}

function renderSizes() {
  if (!imagePreviewable() || !state.original) { refs.sizesCard.hidden = true; return; }
  refs.sizesCard.hidden = false;
  const file = selectedFile();
  const originalSize = file?.size || state.original.originalSize || 0;
  const processed = state.processed;
  refs.sizeOriginal.textContent = formatBytes(originalSize);
  if (!processed) {
    refs.sizeResult.textContent = '估算中…';
    refs.barResult.style.width = '0%';
    refs.verdict.className = 'verdict';
    refs.verdict.textContent = '正在估算体积…';
    return;
  }
  const result = processed.estimatedSize;
  refs.sizeResult.textContent = `${processed.approximate ? '≈ ' : ''}${formatBytes(result)}`;
  refs.barResult.style.width = `${clamp((result / Math.max(1, originalSize)) * 100, 2, 100)}%`;
  const saved = originalSize ? Math.round((1 - result / originalSize) * 100) : 0;
  if (processed.targeted && processed.reachedTarget === false) {
    refs.verdict.className = 'verdict bad';
    refs.verdict.textContent = '压到极限仍超过目标，建议换 WebP';
  } else if (saved > 0) {
    refs.verdict.className = 'verdict';
    refs.verdict.textContent = `${processed.approximate ? '约 ' : ''}小了 ${saved}%${processed.quality && processed.targeted ? ` · ${processed.quality}% 清晰度` : ''}`;
  } else {
    refs.verdict.className = 'verdict warn';
    refs.verdict.textContent = `比原图大了 ${Math.abs(saved)}%，建议换 WebP 或降低质量`;
  }
}

/* ── 预览区（非图片） ── */
function renderStageNote() {
  const files = state.files;
  const first = files[0];
  refs.stage.classList.add('plain');
  const kind = { pdf: 'PDF 文档', video: '视频', audio: '音频', document: '文档', text: '文本', other: '文件' }[fileType(first)] || '文件';
  const op = toolMeta[state.operation];
  refs.frame.hidden = true;
  refs.sizesCard.hidden = true;
  refs.zoomBox.hidden = true;
  refs.compareButton.hidden = true;
  refs.cropOverlay.hidden = true;
  refs.stageNote.hidden = false;
  refs.pvName.textContent = files.length > 1 ? `${files.length} 个${kind}` : first.name;
  refs.pvSub.textContent = `${kind} · ${files.reduce((sum, f) => sum + Number(f.size || 0), 0) ? formatBytes(files.reduce((sum, f) => sum + Number(f.size || 0), 0)) : '—'}`;
  refs.pvOut.innerHTML = '';
  refs.pvHint.textContent = op ? op.desc : '';
  refs.stageNote.innerHTML = `
    <div class="sn-icon">${escapeHtml(typeLabel(first))}</div>
    <h3>${files.length > 1 ? `${files.length} 个${kind} · ${formatBytes(files.reduce((sum, f) => sum + Number(f.size || 0), 0))}` : escapeHtml(first.name)}</h3>
    <p>${escapeHtml(op ? `${op.label}：${op.desc}` : '')}</p>
    <div class="sn-files">${files.slice(0, 4).map((f) => `<span>${escapeHtml(f.name)}</span>`).join('')}${files.length > 4 ? `<span>+${files.length - 4}</span>` : ''}</div>
    ${files.length > 1 ? '<p class="sn-tip">拖动顶部缩略图可以调整顺序</p>' : ''}`;
}

function renderPreview() {
  if (!state.files.length) return;
  if (!imagePreviewable()) { renderStageNote(); return; }
  const file = selectedFile();
  refs.pvName.textContent = file.name;
  if (!state.original) {
    refs.frame.hidden = true;
    refs.stageNote.hidden = true;
    showBusy(true);
    return;
  }
  paintPreview();
  renderSizes();
}

/* ── 底部 ── */
function renderFooter() {
  const op = state.operation;
  const labels = {
    'image-optimize': '压缩并保存',
    'image-adjust': '按当前画面保存',
    'image-convert': '转换并保存',
    'pdf-merge': '合并 PDF',
    'pdf-split': '拆分 PDF',
    'pdf-rotate': '旋转并保存',
    'media-convert': '转换并保存',
    'media-trim': '截取并保存',
    'document-convert': '转换并保存',
    'images-to-pdf': '生成 PDF',
    'archive-create': '开始打包'
  };
  refs.runLabel.textContent = state.running ? '正在处理…' : (labels[op] || '开始处理');
  refs.runButton.disabled = state.running || !state.files.length;
  refs.cancelButton.hidden = !state.running;

  const count = state.files.length;
  let text = `${count} 个输出文件`;
  if (['pdf-merge', 'images-to-pdf', 'archive-create'].includes(op)) text = '1 个输出文件';
  if (op === 'pdf-split') text = '按页数生成';
  if (state.processed && imagePreviewable()) {
    const size = state.processed.estimatedSize;
    text = count === 1 ? `1 个文件 · 约 ${formatBytes(size)}` : `${count} 个文件 · 单个约 ${formatBytes(size)}`;
  }
  refs.estimateText.textContent = text;
}

/* ── 结果 ── */
function renderResults() {
  refs.resultCard.hidden = !state.results.length;
  if (!state.results.length) return;
  const total = state.results.reduce((sum, r) => sum + Number(r.size || 0), 0);
  refs.resultSummary.textContent = `已生成 ${state.results.length} 个文件，共 ${formatBytes(total)}`;
  refs.resultList.innerHTML = state.results.map((file, index) => `
    <div class="result-item"><strong title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span>
    <button data-open="${index}">打开</button><button data-reveal="${index}">定位</button></div>`).join('');
  refs.resultList.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => {
    window.filepilot.openFile(state.results[Number(btn.dataset.open)].path);
  }));
  refs.resultList.querySelectorAll('[data-reveal]').forEach((btn) => btn.addEventListener('click', () => {
    window.filepilot.revealFile(state.results[Number(btn.dataset.reveal)].path);
  }));
}

/* ── 文件操作 ── */
async function pickFiles(tool = null) {
  if (tool) state.pendingTool = tool;
  const files = await window.filepilot.chooseFiles();
  if (files?.length) addFiles(files);
  else state.pendingTool = null;
}

function setThumb(fileId, url) {
  const node = refs.thumbs.querySelector(`.thumb[data-id="${CSS.escape(fileId)}"] .ph`);
  if (node) node.innerHTML = `<img src="${url}" alt="">`;
}

async function fillThumbs() {
  const pending = state.files.filter((file) => fileType(file) === 'image' && !file.thumb);
  for (const file of pending) {
    try {
      file.thumb = await window.filepilot.getThumb(file.path);
      setThumb(file.id, file.thumb);
    } catch {
      /* 单张缩略图失败不影响任务 */
    }
  }
}

function addFiles(incoming) {
  const clean = incoming.filter((f) => f?.path && f?.name).map((f) => ({
    ...f, id: `${f.path}|${f.size}`, ext: extOf(f)
  }));
  const known = new Set(state.files.map((f) => f.path.toLowerCase()));
  const unique = clean.filter((f) => !known.has(f.path.toLowerCase()));
  if (!unique.length) { if (clean.length) toast('这些文件已经在任务里了'); return; }
  state.files.push(...unique);
  state.results = [];
  if (!state.selectedId) state.selectedId = unique[0].id;
  const allowed = validOperations(state.files);
  const wanted = state.pendingTool && allowed.includes(state.pendingTool) ? state.pendingTool : state.operation;
  state.pendingTool = null;
  state.operation = allowed.includes(wanted) ? wanted : allowed[0];
  state.original = null;
  state.processed = null;
  renderAll();
  toast(`已添加 ${unique.length} 个文件`);
  prepareSelected();
  fillThumbs();
}

function removeFile(id) {
  const wasSelected = state.selectedId === id;
  state.files = state.files.filter((f) => f.id !== id);
  delete state.edits[id];
  state.results = [];
  if (!state.files.length) { resetTask(); return; }
  if (wasSelected) state.selectedId = state.files[0].id;
  const allowed = validOperations(state.files);
  if (!allowed.includes(state.operation)) state.operation = allowed[0];
  state.original = null;
  state.processed = null;
  renderAll();
  prepareSelected();
}

function selectFile(id) {
  state.selectedId = id;
  state.original = null;
  state.processed = null;
  state.compare = false;
  state.cropRatio = editFor(id).ratio || 'free';
  state.zoom = 1;
  renderStrip();
  if (imagePreviewable()) {
    refs.frame.hidden = true;
    showBusy(true);
    prepareSelected();
    if (isAdjust()) syncDynamicValues();
    renderFooter();
  }
}

function resetTask() {
  if (state.running) return;
  state.files = [];
  state.results = [];
  state.selectedId = null;
  state.operation = null;
  state.pendingTool = null;
  state.edits = {};
  state.original = null;
  state.processed = null;
  state.compare = false;
  state.zoom = 1;
  refs.workspace.hidden = true;
  refs.emptyView.hidden = false;
  refs.emptyView.scrollTop = 0;
}

function renderAll() {
  refs.emptyView.hidden = true;
  refs.workspace.hidden = false;
  renderStrip();
  renderTabs();
  renderSettings();
  renderPreview();
  renderResults();
  renderFooter();
}

async function prepareSelected() {
  if (!imagePreviewable()) { renderPreview(); return; }
  await loadOriginal();
  paintPreview();
  renderSizes();
  refreshProcessed({ fast: false });
}

/* ── 拖拽与裁剪 ── */
let cropDrag = null;

function bindCrop() {
  refs.cropOverlay.addEventListener('pointerdown', (event) => {
    if (!isAdjust() || !state.original) return;
    const handle = event.target.dataset?.handle || 'move';
    event.preventDefault();
    cropDrag = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rect: refs.frame.getBoundingClientRect(),
      area: { ...currentEdit().crop },
      natural: { width: state.original.width, height: state.original.height }
    };
    refs.cropOverlay.setPointerCapture?.(event.pointerId);
    refs.cropOverlay.focus({ preventScroll: true });
    clearTimeout(previewTimer);
  });

  window.addEventListener('pointermove', (event) => {
    if (!cropDrag) return;
    const dx = (event.clientX - cropDrag.startX) / Math.max(1, cropDrag.rect.width);
    const dy = (event.clientY - cropDrag.startY) / Math.max(1, cropDrag.rect.height);
    const next = dragCrop(cropDrag, dx, dy);
    setCrop(next, cropDrag.handle === 'move' ? undefined : currentEdit().ratio);
    updateCropOverlay();
    syncDynamicValues();
  });

  window.addEventListener('pointerup', () => {
    if (!cropDrag) return;
    cropDrag = null;
    schedulePreview(60);
  });

  refs.cropOverlay.addEventListener('keydown', (event) => {
    if (!isAdjust()) return;
    const step = event.shiftKey ? 10 : 1;
    const o = state.original;
    if (!o) return;
    const dx = (['ArrowLeft', 'ArrowRight'].includes(event.key) ? (event.key === 'ArrowLeft' ? -1 : 1) * step / o.width : 0);
    const dy = (['ArrowUp', 'ArrowDown'].includes(event.key) ? (event.key === 'ArrowUp' ? -1 : 1) * step / o.height : 0);
    if (dx || dy) {
      event.preventDefault();
      const area = { ...currentEdit().crop };
      const left = clamp(area.left + dx, 0, 1 - area.width);
      const top = clamp(area.top + dy, 0, 1 - area.height);
      setCrop({ ...area, left, top }, currentEdit().ratio);
      updateCropOverlay();
      schedulePreview(120);
    }
  });
}

function ratioValue(ratio, natural) {
  if (!ratio || ratio === 'free') return null;
  if (ratio === 'original') return natural.width / natural.height;
  const [w, h] = ratio.split(':').map(Number);
  return w / h;
}

function dragCrop(drag, dx, dy) {
  const { handle, area, natural } = drag;
  const minX = MIN_CROP, minY = MIN_CROP;
  let left = area.left, top = area.top;
  let right = area.left + area.width, bottom = area.top + area.height;

  if (handle === 'move') {
    left = clamp(area.left + dx, 0, 1 - area.width);
    top = clamp(area.top + dy, 0, 1 - area.height);
    return { left, top, width: area.width, height: area.height };
  }

  if (handle.includes('w')) left = clamp(area.left + dx, 0, right - minX);
  if (handle.includes('e')) right = clamp(area.left + area.width + dx, left + minX, 1);
  if (handle.includes('n')) top = clamp(area.top + dy, 0, bottom - minY);
  if (handle.includes('s')) bottom = clamp(area.top + area.height + dy, top + minY, 1);

  let width = right - left;
  let height = bottom - top;
  const ratio = ratioValue(currentEdit().ratio, natural);

  if (ratio) {
    const normalizedRatio = ratio * natural.height / natural.width; // wN / hN
    const horizontal = handle === 'w' || handle === 'e';
    const vertical = handle === 'n' || handle === 's';
    if (horizontal) height = width / normalizedRatio;
    else if (vertical) width = height * normalizedRatio;
    else {
      const dw = Math.abs(width - area.width) * natural.width;
      const dh = Math.abs(height - area.height) * natural.height;
      if (dw >= dh) height = width / normalizedRatio;
      else width = height * normalizedRatio;
    }
    width = clamp(width, minX, 1);
    height = clamp(height, minY, 1);
    if (height > 1) { height = 1; width = height * normalizedRatio; }
    if (width > 1) { width = 1; height = width / normalizedRatio; }
    if (handle.includes('w')) left = right - width; else right = left + width;
    if (handle.includes('n')) top = bottom - height; else bottom = top + height;
    if (left < 0) { left = 0; right = width; }
    if (top < 0) { top = 0; bottom = height; }
    if (right > 1) { right = 1; left = 1 - width; }
    if (bottom > 1) { bottom = 1; top = 1 - height; }
  }

  width = clamp(right - left, minX, 1);
  height = clamp(bottom - top, minY, 1);
  left = clamp(left, 0, 1 - width);
  top = clamp(top, 0, 1 - height);
  return { left, top, width, height };
}

function bindCompare() {
  let dragging = false;
  refs.splitKnob.addEventListener('pointerdown', (event) => { dragging = true; event.preventDefault(); });
  window.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = refs.frame.getBoundingClientRect();
    const pct = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100, 3, 97);
    document.documentElement.style.setProperty('--split', `${pct}%`);
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  refs.compareButton.addEventListener('click', () => {
    state.compare = !state.compare;
    paintPreview();
  });
  refs.zoomBox.querySelectorAll('[data-zoom]').forEach((btn) => btn.addEventListener('click', () => {
    const dir = btn.dataset.zoom;
    if (dir === 'in') state.zoom = Math.min(3, state.zoom + 0.5);
    else state.zoom = Math.max(1, state.zoom - 0.5);
    fitFrame();
  }));
}

/* ── 动态值同步（不重建 DOM） ── */
function syncDynamicValues() {
  if (!isAdjust()) return;
  const widthInput = $('#adjustWidth');
  const heightInput = $('#adjustHeight');
  const hint = $('#ratioHint');
  if (!widthInput) return;
  const edit = currentEdit();
  const px = cropPixels(selectedFile(), edit);
  const width = Math.max(1, Math.round(px.width * edit.scale));
  const height = Math.max(1, Math.round(px.height * edit.scale));
  if (document.activeElement !== widthInput) widthInput.value = width;
  if (heightInput) heightInput.value = height;
  if (hint) { hint.textContent = edit.ratio === 'free' ? '自由' : '已锁定'; }
  refs.settings.querySelectorAll('[data-key="ratio"] .chip').forEach((chip) => {
    chip.classList.toggle('on', chip.dataset.value === edit.ratio);
  });
  refs.settings.querySelectorAll('[data-key="scale"] .chip').forEach((chip) => {
    chip.classList.toggle('on', Math.abs(Number(chip.dataset.value) - edit.scale) < 0.001);
  });
  const verdict = $('#qualityVerdict');
  if (verdict && state.processed) {
    const saved = state.original ? Math.round((1 - state.processed.estimatedSize / Math.max(1, selectedFile().size)) * 100) : 0;
    verdict.textContent = saved > 0 ? `比原图小 ${saved}%` : '';
  }
}

/* ── 运行 ── */
function collectOptions() {
  const s = state.settings;
  const op = state.operation;
  const base = { nameSuffix: '' };
  if (op === 'image-optimize') {
    return { ...base, format: s.optimize.format, quality: s.optimize.quality, targetBytes: s.optimize.mode === 'size' ? Math.round(s.optimize.targetMb * 1024 * 1024) : 0, nameSuffix: 'compressed' };
  }
  if (op === 'image-convert') return { ...base, format: s.convert.format, quality: QUALITY[s.convert.quality] || 88, nameSuffix: 'converted' };
  if (op === 'image-adjust') {
    const perFile = {};
    state.files.forEach((file) => {
      const edit = editFor(file.id);
      perFile[file.path] = { cropArea: edit.crop, scale: edit.scale, allowUpscale: edit.scale > 1 };
    });
    return { ...base, format: 'original', quality: QUALITY[s.adjust.quality] || 88, perFile, nameSuffix: 'cropped' };
  }
  if (op === 'pdf-merge' || op === 'images-to-pdf') return { outputName: s.pdf.outputName };
  if (op === 'pdf-rotate') return { rotation: s.pdf.rotation };
  if (op === 'media-convert' || op === 'media-trim') {
    return { format: s.media.format, quality: s.media.quality, audioBitrate: s.media.bitrate, startTime: s.media.start, duration: s.media.duration, nameSuffix: 'converted' };
  }
  if (op === 'document-convert') return { format: s.document.format };
  if (op === 'archive-create') return { outputName: s.archive.name || 'FilePilot-文件包', level: s.archive.level };
  return base;
}

function setProgress(percent, text) {
  refs.progressMini.hidden = false;
  refs.progressFill.style.width = `${clamp(percent || 0, 0, 100)}%`;
  refs.progressText.textContent = text || `${Math.round(percent || 0)}%`;
}

async function run() {
  if (state.running || !state.files.length) return;
  state.running = true;
  state.results = [];
  refs.resultCard.hidden = true;
  renderFooter();
  setProgress(0, '0%');
  try {
    const result = await window.filepilot.runOperation({
      operation: state.operation,
      files: state.files.map(({ path, name, size, ext }) => ({ path, name, size, ext })),
      options: collectOptions(),
      outputDirectory: state.outputDirectory
    });
    state.results = result.outputs || [];
    if (result.outputDirectory) state.outputDirectory = result.outputDirectory;
    setProgress(100, '完成');
    await new Promise((resolve) => setTimeout(resolve, 240));
    renderResults();
    toast('处理完成，结果已保存');
  } catch (error) {
    const message = error?.message || '处理失败';
    toast(message.includes('取消') ? '已取消' : message, message.includes('取消') ? 'info' : 'error');
  } finally {
    state.running = false;
    refs.progressMini.hidden = true;
    renderFooter();
  }
}

/* ── 事件绑定 ── */
function bindEvents() {
  refs.chooseButton.addEventListener('click', (event) => { event.stopPropagation(); pickFiles(); });
  refs.dropZone.addEventListener('click', () => pickFiles());
  refs.dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') pickFiles(); });
  refs.addButton.addEventListener('click', () => pickFiles());
  refs.newTaskButton.addEventListener('click', resetTask);
  refs.runButton.addEventListener('click', run);
  refs.cancelButton.addEventListener('click', () => window.filepilot.cancelOperation());
  refs.sharedCropButton.addEventListener('click', () => {
    state.sharedCrop = !state.sharedCrop;
    if (state.sharedCrop) {
      const edit = currentEdit();
      state.files.forEach((file) => {
        const target = editFor(file.id);
        target.crop = { ...edit.crop };
        target.scale = edit.scale;
        target.ratio = edit.ratio;
      });
    }
    renderStrip();
    renderSettings();
    schedulePreview();
  });
  refs.outputButton.addEventListener('click', pickOutputDirectory);
  refs.openFolderButton.addEventListener('click', () => { if (state.results[0]) window.filepilot.revealFile(state.results[0].path); });

  document.querySelectorAll('.quick-card').forEach((card) => {
    card.addEventListener('click', () => pickFiles(card.dataset.tool));
  });

  // 整个窗口都能拖入
  ['dragenter', 'dragover'].forEach((type) => window.addEventListener(type, (event) => {
    event.preventDefault();
    if (!refs.workspace.hidden) refs.previewCard.classList.add('dragging');
    refs.dropZone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((type) => window.addEventListener(type, (event) => {
    if (type === 'dragleave' && event.relatedTarget) return;
    refs.previewCard.classList.remove('dragging');
    refs.dropZone.classList.remove('dragging');
  }));
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])].map((file) => ({
      path: window.filepilot.getPathForFile(file), name: file.name, size: file.size, ext: `.${file.name.split('.').pop().toLowerCase()}`
    })).filter((f) => f.path);
    if (files.length) addFiles(files);
  });

  window.filepilot.onProgress((payload) => {
    setProgress(payload.percent, payload.percent >= 100 ? '完成' : `${Math.round(payload.percent || 0)}%`);
  });

  window.addEventListener('resize', () => fitFrame());

  // 快捷键
  window.addEventListener('keydown', (event) => {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === 'o') { event.preventDefault(); pickFiles(); return; }
    if (meta && event.key === 'Enter') { event.preventDefault(); run(); return; }
    if (event.key === 'Escape') {
      if (state.running) window.filepilot.cancelOperation();
      else if (state.compare) { state.compare = false; paintPreview(); }
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      removeFile(state.selectedId);
    }
  });
}

/* ── 启动 ── */
async function init() {
  bindEvents();
  bindCrop();
  bindCompare();
  state.outputDirectory = await window.filepilot.getDefaultOutputDirectory();
  refs.outputLabel.textContent = (state.outputDirectory.split(/[\\/]/).pop() || 'FilePilot Output');
  refs.outputLabel.title = state.outputDirectory;
  state.capabilities = await window.filepilot.getCapabilities();
  refs.engineStatus.textContent = state.capabilities.officePdf ? '所有处理引擎已就绪' : '核心引擎已就绪 · Office 转 PDF 需 LibreOffice';
}

init().catch((error) => toast(error?.message || '应用初始化失败', 'error'));
