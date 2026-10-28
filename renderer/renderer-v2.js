const state = {
  files: [],
  operation: null,
  pendingTool: null,
  outputDirectory: '',
  capabilities: {},
  results: [],
  running: false,
  selectedFileId: null,
  originalPreview: null,
  processedPreview: null,
  compare: false,
  cropRatio: 'free',
  cropArea: { left: 0, top: 0, width: 1, height: 1 },
  adjustScale: 1,
  optimize: { quality: 82, format: 'original', targetEnabled: false, targetMb: 1 },
  convertFormat: 'webp',
  previewRequestId: 0
};

const toolMeta = {
  'image-optimize': { label: '压缩体积', detail: '变小，可指定大小', icon: '⇣', group: 'edit' },
  'image-adjust': { label: '调整画面', detail: '裁剪和尺寸一起改', icon: '⌗', group: 'edit' },
  'image-convert': { label: '转换格式', detail: 'JPG / PNG / WebP', icon: '⇄', group: 'edit' },
  'images-to-pdf': { label: '合成 PDF', detail: '多张图拼成文档', icon: '▤', group: 'output' },
  'pdf-merge': { label: '合并', detail: '组合多个 PDF', icon: '⊕', group: 'edit' },
  'pdf-split': { label: '拆分', detail: '逐页保存', icon: '↗', group: 'edit' },
  'pdf-rotate': { label: '旋转', detail: '调整页面方向', icon: '↻', group: 'edit' },
  'media-convert': { label: '转换与压缩', detail: '调整格式和体积', icon: '⇄', group: 'edit' },
  'media-trim': { label: '裁剪片段', detail: '按时间截取', icon: '✂', group: 'edit' },
  'document-convert': { label: '转换文档', detail: '文本和表格互转', icon: 'Aa', group: 'edit' },
  'archive-create': { label: '打包 ZIP', detail: '整理成压缩包', icon: '⌑', group: 'output' }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const refs = {
  emptyView: $('#emptyView'), workspace: $('#workspace'), dropZone: $('#dropZone'), fileList: $('#fileList'), fileCount: $('#fileCountBadge'),
  workspaceSubtitle: $('#workspaceSubtitle'), actionChoices: $('#actionChoices'), settingsPanel: $('#settingsPanel'), recommendationText: $('#recommendationText'),
  toolTitle: $('#toolTitle'),
  estimateText: $('#estimateText'), runButton: $('#runButton'), runButtonLabel: $('#runButtonLabel'), resultPanel: $('#resultPanel'), resultList: $('#resultList'),
  resultSummary: $('#resultSummary'), outputPathLabel: $('#outputPathLabel'), taskProgress: $('#taskProgress'), progressPercent: $('#progressPercent'),
  progressTitle: $('#progressTitle'), progressDetail: $('#progressDetail'), progressBar: $('#progressBar'), toast: $('#toast'),
  imagePreviewPanel: $('#imagePreviewPanel'), previewFileName: $('#previewFileName'), previewHint: $('#previewHint'),
  previewStage: $('#previewStage'), originalPane: $('#originalPane'), resultPane: $('#resultPane'), compareToggle: $('#compareToggle'), previewLive: $('#previewLive'),
  originalPreviewImage: $('#originalPreviewImage'), processedPreviewImage: $('#processedPreviewImage'),
  originalPreviewMeta: $('#originalPreviewMeta'), processedPreviewMeta: $('#processedPreviewMeta'), previewSummary: $('#previewSummary'),
  originalPreviewLabel: $('#originalPreviewLabel'), processedPreviewLabel: $('#processedPreviewLabel'),
  originalPreviewLoading: $('#originalPreviewLoading'), processedPreviewLoading: $('#processedPreviewLoading'),
  cropOverlay: $('#cropOverlay'), cropMedia: $('#cropMedia'), cropBadge: $('#cropBadge'),
  sizeCompare: $('#sizeCompare'), sizeOriginalValue: $('#sizeOriginalValue'), sizeResultValue: $('#sizeResultValue'),
  sizeResultBar: $('#sizeResultBar'), sizeVerdict: $('#sizeVerdict')
};

function extOf(file) { return file.ext || `.${String(file.name).split('.').pop().toLowerCase()}`; }
function fileType(file) {
  const ext = extOf(file);
  if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.tif', '.tiff', '.heic'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'].includes(ext)) return 'audio';
  if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp'].includes(ext)) return 'document';
  if (['.txt', '.md', '.html', '.htm', '.csv', '.json'].includes(ext)) return 'text';
  return 'other';
}
function typeLabel(file) { const value = extOf(file).slice(1).toUpperCase(); return value.length <= 5 ? value : fileType(file).slice(0, 4).toUpperCase(); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes))) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB']; let value = bytes / 1024; let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) { value /= 1024; unit = units[index]; }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function showToast(message, kind = 'info') {
  refs.toast.textContent = message; refs.toast.className = `toast show ${kind === 'error' ? 'error' : ''}`;
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { refs.toast.className = 'toast'; }, 3000);
}

function validOperations(files) {
  const types = files.map(fileType);
  if (!types.length) return [];
  if (types.every((type) => type === 'image')) return ['image-optimize', 'image-adjust', 'image-convert', 'images-to-pdf', 'archive-create'];
  if (types.every((type) => type === 'pdf')) return [...(files.length > 1 ? ['pdf-merge'] : []), 'pdf-split', 'pdf-rotate', 'archive-create'];
  if (types.every((type) => ['video', 'audio'].includes(type))) return ['media-convert', 'media-trim', 'archive-create'];
  if (types.every((type) => ['document', 'text'].includes(type))) return ['document-convert', 'archive-create'];
  return ['archive-create'];
}
function recommendedOperation(files) { return validOperations(files)[0] || 'archive-create'; }
function selectedFile() { return state.files.find((file) => file.id === state.selectedFileId) || state.files[0] || null; }
function isImagePreviewTask() { return state.files.length > 0 && state.files.every((file) => fileType(file) === 'image') && state.operation !== 'archive-create'; }
function isGeometryTask() { return state.operation === 'image-adjust'; }
function isSizeCompareTask() { return state.operation === 'image-optimize' || state.operation === 'image-convert' || state.operation === 'image-adjust'; }

function cropNaturalSize() {
  if (!state.originalPreview) return null;
  const area = state.cropArea;
  return {
    width: Math.max(1, Math.round(state.originalPreview.width * area.width)),
    height: Math.max(1, Math.round(state.originalPreview.height * area.height))
  };
}
function adjustOutputSize() {
  const natural = cropNaturalSize();
  if (!natural) return null;
  return {
    width: Math.max(1, Math.round(natural.width * state.adjustScale)),
    height: Math.max(1, Math.round(natural.height * state.adjustScale)),
    natural
  };
}

function updateCropOverlayCss() {
  if (!refs.cropOverlay) return;
  const area = state.cropArea;
  refs.cropOverlay.style.left = `${area.left * 100}%`;
  refs.cropOverlay.style.top = `${area.top * 100}%`;
  refs.cropOverlay.style.width = `${area.width * 100}%`;
  refs.cropOverlay.style.height = `${area.height * 100}%`;
  const output = adjustOutputSize();
  if (output) {
    refs.cropBadge.textContent = `${output.width} × ${output.height}`;
    refs.originalPreviewMeta.textContent = `原图 ${state.originalPreview.width} × ${state.originalPreview.height}`;
  }
  if (state.operation === 'image-adjust') {
    const widthInput = $('#adjustWidth');
    if (widthInput && document.activeElement !== widthInput && output) widthInput.value = output.width;
    const heightNote = $('#adjustHeightHint');
    if (heightNote && output) heightNote.textContent = `输出 ${output.width} × ${output.height}，高度按比例自动`;
  }
}

function applyCropRatio(ratio) {
  state.cropRatio = ratio;
  if (!state.originalPreview) return;
  if (ratio === 'free') { updateCropOverlayCss(); scheduleProcessedPreview(); return; }
  if (ratio === 'original') {
    state.cropArea = { left: 0, top: 0, width: 1, height: 1 };
    updateCropOverlayCss(); scheduleProcessedPreview(); return;
  }
  const [rw, rh] = ratio.split(':').map(Number);
  const targetRatio = rw / rh;
  const sourceRatio = state.originalPreview.width / state.originalPreview.height;
  let width = 0.86;
  let height = width * sourceRatio / targetRatio;
  if (height > 0.86) { height = 0.86; width = height * targetRatio / sourceRatio; }
  state.cropArea = { left: (1 - width) / 2, top: (1 - height) / 2, width, height };
  updateCropOverlayCss(); scheduleProcessedPreview();
}

function contextualImageOptions() {
  const value = (id) => document.getElementById(id)?.value;
  if (state.operation === 'image-optimize') {
    const optimize = state.optimize;
    return {
      format: optimize.format || 'original',
      quality: optimize.quality,
      targetBytes: optimize.targetEnabled ? Math.round(optimize.targetMb * 1024 * 1024) : 0
    };
  }
  if (state.operation === 'image-convert') return { format: state.convertFormat || 'webp', quality: 88 };
  if (state.operation === 'image-adjust') {
    const output = adjustOutputSize();
    return {
      format: 'original',
      quality: 100,
      cropArea: state.cropArea,
      width: output ? output.width : undefined,
      allowUpscale: output ? output.width > output.natural.width : false
    };
  }
  if (state.operation === 'image-resize') return { format: 'original', quality: 100, width: value('imageWidth'), height: value('imageHeight'), fit: $('#lockDimensions')?.checked ? 'inside' : 'fill' };
  if (state.operation === 'image-crop') return { format: 'original', quality: 100, cropArea: state.cropArea };
  return { format: 'original' };
}

function updatePreviewLayout() {
  const op = state.operation;
  const geometry = isGeometryTask();
  const onlyOriginal = op === 'images-to-pdf';
  const canCompare = op === 'image-optimize' || op === 'image-convert';
  if (!canCompare) state.compare = false;
  refs.compareToggle.hidden = !canCompare;
  refs.compareToggle.classList.toggle('active', canCompare && state.compare);
  refs.compareToggle.textContent = state.compare ? '只看结果' : '并排对比原图';
  refs.previewStage.classList.toggle('compare', canCompare && state.compare);
  refs.originalPane.hidden = !(geometry || onlyOriginal || (canCompare && state.compare));
  refs.resultPane.hidden = geometry || onlyOriginal;
  refs.cropOverlay.hidden = !geometry;
  refs.originalPreviewLabel.textContent = onlyOriginal ? '图片' : geometry ? '编辑画面' : '原图';
  refs.sizeCompare.hidden = !(canCompare && state.processedPreview);
  refs.originalPreviewMeta.textContent = state.originalPreview
    ? (geometry ? `原图 ${state.originalPreview.width} × ${state.originalPreview.height}` : `${state.originalPreview.width} × ${state.originalPreview.height} · ${formatBytes(state.originalPreview.originalSize)}`)
    : '—';
  if (geometry) updateCropOverlayCss();
}

function renderSizeCompare() {
  const processed = state.processedPreview;
  if (!processed || !(state.operation === 'image-optimize' || state.operation === 'image-convert')) return;
  const original = processed.originalSize;
  const result = processed.estimatedSize;
  const saved = original > 0 ? Math.round((1 - result / original) * 100) : 0;
  refs.sizeOriginalValue.textContent = formatBytes(original);
  refs.sizeResultValue.textContent = formatBytes(result);
  refs.sizeResultBar.style.width = `${clamp((result / Math.max(1, original)) * 100, 2, 100)}%`;
  const reached = processed.reachedTarget !== false;
  let text = '';
  let tone = 'ok';
  if (processed.targeted && !reached) {
    text = `已经用最低清晰度，仍没压到目标大小。换成 WebP 通常还能再小一截。`;
    tone = 'bad';
  } else if (saved >= 5) {
    text = `完成：体积比原图小 ${saved}%`;
    tone = 'ok';
  } else if (saved > 0) {
    text = `只小了 ${saved}%，几乎感觉不到。想更明显就换个更小的格式或降低清晰度。`;
    tone = 'warn';
  } else {
    text = `处理后反而大了 ${Math.abs(saved)}%。这个格式不适合压缩，建议转成 WebP。`;
    tone = 'bad';
  }
  if (processed.targeted && reached && state.operation === 'image-optimize') {
    text += `（自动用 ${processed.quality}% 清晰度）`;
  }
  refs.sizeVerdict.className = `size-verdict ${tone}`;
  refs.sizeVerdict.textContent = text;
}

function renderPreviewSummary() {
  if (!state.originalPreview || !state.processedPreview) return;
  const processed = state.processedPreview;
  let message = `<span>输出 <strong>${processed.width} × ${processed.height}</strong></span><span>预计 <strong>${formatBytes(processed.estimatedSize)}</strong></span>`;
  if (state.operation === 'image-adjust') {
    message += '<span>方框内是最终保留的画面</span>';
  } else if (state.operation === 'image-convert') {
    message += `<span>格式 <strong>${String(processed.format || '').toUpperCase()}</strong></span>`;
  } else if (state.operation === 'image-optimize') {
    message += '<span>压缩基本不改变画面，肉眼看不出差别是正常的，主要看上面的体积对比</span>';
  }
  refs.previewSummary.innerHTML = message;
  if (state.files.length === 1) refs.estimateText.textContent = `1 个输出文件 · 约 ${formatBytes(processed.estimatedSize)}`;
  else refs.estimateText.textContent = `${state.files.length} 个输出文件 · 单个约 ${formatBytes(processed.estimatedSize)}`;
}

async function loadOriginalPreview() {
  const file = selectedFile();
  if (!file || fileType(file) !== 'image') return;
  const fileId = file.id;
  refs.originalPreviewLoading.hidden = false;
  refs.originalPreviewImage.style.opacity = '.35';
  try {
    const preview = await window.filepilot.getImagePreview({ filePath: file.path, original: true });
    if (selectedFile()?.id !== fileId) return;
    state.originalPreview = preview;
    refs.originalPreviewImage.src = preview.dataUrl;
    refs.originalPreviewMeta.textContent = `${preview.width} × ${preview.height} · ${formatBytes(preview.originalSize)}`;
    refs.originalPreviewImage.onload = () => {
      refs.originalPreviewImage.style.opacity = '1';
      refs.originalPreviewLoading.hidden = true;
      updateCropOverlayCss();
    };
    updateCropOverlayCss();
    scheduleProcessedPreview();
  } catch (error) {
    refs.originalPreviewLoading.textContent = '无法生成图片预览';
  }
}

async function loadProcessedPreview() {
  const file = selectedFile();
  if (!file || !isImagePreviewTask()) return;
  if (!isSizeCompareTask()) { state.processedPreview = null; updatePreviewLayout(); return; }
  const requestId = ++state.previewRequestId;
  refs.processedPreviewLoading.hidden = false;
  refs.processedPreviewLoading.textContent = '正在生成预览…';
  refs.processedPreviewImage.style.opacity = '.3';
  refs.previewLive.classList.add('busy');
  try {
    const preview = await window.filepilot.getImagePreview({ filePath: file.path, options: contextualImageOptions(), original: false });
    if (requestId !== state.previewRequestId || selectedFile()?.id !== file.id) return;
    state.processedPreview = preview;
    refs.processedPreviewImage.src = preview.dataUrl;
    refs.processedPreviewMeta.textContent = `${preview.width} × ${preview.height} · ${formatBytes(preview.estimatedSize)}`;
    refs.previewLive.classList.remove('busy');
    refs.processedPreviewImage.onload = () => {
      refs.processedPreviewImage.style.opacity = '1';
      refs.processedPreviewLoading.hidden = true;
    };
    refs.processedPreviewLoading.hidden = true;
    renderSizeCompare();
    renderPreviewSummary();
    updatePreviewLayout();
  } catch (error) {
    if (requestId !== state.previewRequestId) return;
    refs.previewLive.classList.remove('busy');
    refs.processedPreviewLoading.textContent = '当前设置无法预览';
  }
}

function scheduleProcessedPreview() {
  clearTimeout(scheduleProcessedPreview.timer);
  scheduleProcessedPreview.timer = setTimeout(loadProcessedPreview, 170);
}

async function renderImagePreview(forceOriginal = false) {
  if (!isImagePreviewTask()) {
    refs.imagePreviewPanel.hidden = true;
    return;
  }
  const file = selectedFile();
  if (!file) return;
  refs.imagePreviewPanel.hidden = false;
  refs.previewFileName.textContent = file.name;
  refs.processedPreviewLabel.textContent = {
    'image-optimize': '压缩结果',
    'image-convert': '转换结果',
    'image-adjust': '最终画面',
    'images-to-pdf': 'PDF 页面'
  }[state.operation] || '结果';
  refs.previewHint.textContent = state.files.length > 1
    ? `正在预览所选文件（共 ${state.files.length} 个），点击左侧文件可切换`
    : {
      'image-optimize': '压缩只改变文件体积，画面内容基本不变',
      'image-convert': '只改变文件格式，画面不变',
      'image-adjust': '拖动方框选择要保留的画面，宽度决定最终尺寸',
      'images-to-pdf': '图片会按左侧顺序排入页面'
    }[state.operation] || '这里是处理后的样子';
  updatePreviewLayout();
  if (forceOriginal || !state.originalPreview) await loadOriginalPreview();
  else scheduleProcessedPreview();
  updatePreviewLayout();
}

function addFiles(files) {
  const incoming = files.filter((file) => file?.path && file?.name).map((file) => ({ ...file, id: `${file.path}-${file.size}-${Date.now()}-${Math.random()}`, ext: extOf(file) }));
  const known = new Set(state.files.map((file) => file.path.toLowerCase()));
  const unique = incoming.filter((file) => !known.has(file.path.toLowerCase()));
  if (!unique.length) { if (incoming.length) showToast('这些文件已经在任务里了'); return; }
  state.files.push(...unique); state.results = [];
  if (!state.selectedFileId) state.selectedFileId = unique[0].id;
  const allowed = validOperations(state.files);
  state.operation = state.pendingTool && allowed.includes(state.pendingTool) ? state.pendingTool : recommendedOperation(state.files);
  state.pendingTool = null; renderWorkspace(); showToast(`已添加 ${unique.length} 个文件`);
}

function resetTask() {
  if (state.running) return;
  state.files = []; state.results = []; state.operation = null; state.pendingTool = null; state.selectedFileId = null;
  state.originalPreview = null; state.processedPreview = null; state.previewRequestId += 1;
  state.compare = false; state.cropRatio = 'free'; state.cropArea = { left: 0, top: 0, width: 1, height: 1 }; state.adjustScale = 1;
  refs.emptyView.hidden = false; refs.workspace.hidden = true; refs.taskProgress.hidden = true; refs.resultPanel.hidden = true;
  $('.page-shell').scrollTop = 0;
}

function renderWorkspace() {
  if (!state.files.length) { resetTask(); return; }
  refs.emptyView.hidden = true; refs.workspace.hidden = false; refs.fileCount.textContent = state.files.length;
  refs.workspaceSubtitle.textContent = `已准备好 ${state.files.length} 个文件，可在右侧选择处理方式`;
  refs.fileList.innerHTML = state.files.map((file, index) => `
    <div class="file-row ${selectedFile()?.id === file.id ? 'selected' : ''}" draggable="true" data-index="${index}" data-file-id="${escapeHtml(file.id)}">
      <div class="file-type-icon ${fileType(file)}">${escapeHtml(typeLabel(file))}</div>
      <div class="file-info"><strong title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</strong><span>${fileType(file) === 'other' ? '通用文件' : fileType(file).toUpperCase()} · 原文件会保留</span></div>
      <div class="file-meta"><span>${formatBytes(file.size)}</span><span class="ready-badge">已就绪</span></div>
      <button class="remove-file" data-remove="${escapeHtml(file.id)}" title="移除">×</button>
    </div>`).join('');
  renderActionChoices(); renderSettings(); renderResults(); bindFileRows(); renderImagePreview();
}

function bindFileRows() {
  $$('.remove-file').forEach((button) => button.addEventListener('click', () => {
    const wasSelected = state.selectedFileId === button.dataset.remove;
    state.files = state.files.filter((file) => file.id !== button.dataset.remove); state.results = [];
    if (wasSelected) { state.selectedFileId = state.files[0]?.id || null; state.originalPreview = null; state.processedPreview = null; }
    if (state.files.length) state.operation = validOperations(state.files).includes(state.operation) ? state.operation : recommendedOperation(state.files);
    renderWorkspace();
  }));
  let draggedIndex = null;
  $$('.file-row').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      if (state.selectedFileId !== row.dataset.fileId) {
        state.selectedFileId = row.dataset.fileId; state.originalPreview = null; state.processedPreview = null; renderWorkspace();
      }
    });
    row.addEventListener('dragstart', () => { draggedIndex = Number(row.dataset.index); row.style.opacity = '.45'; });
    row.addEventListener('dragend', () => { draggedIndex = null; row.style.opacity = ''; });
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', (event) => {
      event.preventDefault(); const targetIndex = Number(row.dataset.index);
      if (draggedIndex === null || draggedIndex === targetIndex) return;
      const [moved] = state.files.splice(draggedIndex, 1); state.files.splice(targetIndex, 0, moved); renderWorkspace();
    });
  });
}

function renderActionChoices() {
  const allowed = validOperations(state.files);
  if (!allowed.includes(state.operation)) state.operation = allowed[0];
  const editIds = allowed.filter((id) => toolMeta[id].group === 'edit');
  const outputIds = allowed.filter((id) => toolMeta[id].group === 'output');
  const tab = (id) => `<button class="tool-tab ${state.operation === id ? 'active' : ''}" data-operation="${id}" title="${escapeHtml(toolMeta[id].detail)}"><i>${toolMeta[id].icon}</i>${escapeHtml(toolMeta[id].label)}</button>`;
  refs.actionChoices.innerHTML = [
    ...editIds.map(tab),
    outputIds.length && editIds.length ? '<span class="tool-tab-sep" aria-hidden="true"></span>' : '',
    ...outputIds.map(tab)
  ].join('');
  refs.actionChoices.querySelectorAll('[data-operation]').forEach((button) => button.addEventListener('click', () => {
    if (state.operation === button.dataset.operation) return;
    state.operation = button.dataset.operation; state.results = []; state.compare = false;
    renderActionChoices(); renderSettings(); renderResults(); renderImagePreview();
  }));
  const recommended = recommendedOperation(state.files);
  refs.toolTitle.textContent = toolMeta[state.operation].label;
  refs.recommendationText.textContent = state.operation === recommended
    ? `推荐先这样做：${toolMeta[recommended].detail}`
    : `当前：${toolMeta[state.operation].detail}`;
}

function choiceGroup(name, values, selected) {
  return `<div class="chip-row">${values.map(([value, label]) => `<button type="button" class="chip ${String(value) === String(selected) ? 'active' : ''}" data-choice="${name}:${value}">${label}</button>`).join('')}</div>`;
}
function selectField(id, label, options, value) {
  return `<div class="setting-group"><label for="${id}">${label}</label><select class="select-control" id="${id}">${options.map(([optionValue, text]) => `<option value="${optionValue}" ${String(optionValue) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}</select></div>`;
}
function textField(id, label, value, type = 'text', placeholder = '') {
  return `<div class="setting-group"><label for="${id}">${label}</label><input class="text-control" id="${id}" type="${type}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}"></div>`;
}

function syncOptimizeUi() {
  const optimize = state.optimize;
  $$('#optimizePresets .chip').forEach((chip) => {
    chip.classList.toggle('active', !optimize.targetEnabled && Number(chip.dataset.quality) === Number(optimize.quality));
    chip.disabled = optimize.targetEnabled;
  });
  $$('#optimizeFormats .chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.format === optimize.format));
  const slider = $('#imageQuality');
  if (slider) { slider.value = optimize.quality; slider.disabled = optimize.targetEnabled; }
  const output = $('#qualityOutput');
  if (output) output.textContent = optimize.targetEnabled ? '自动' : `${optimize.quality}%`;
  const targetToggle = $('#targetToggle');
  if (targetToggle) targetToggle.checked = optimize.targetEnabled;
  const targetRow = $('#targetRow');
  if (targetRow) targetRow.hidden = !optimize.targetEnabled;
  const targetInput = $('#targetMb');
  if (targetInput && document.activeElement !== targetInput) targetInput.value = optimize.targetMb;
}

function defaultTargetMb() {
  const file = selectedFile();
  const megabytes = file?.size ? file.size / 1024 / 1024 : 1;
  return Math.max(0.05, Math.round(megabytes * 0.5 * 10) / 10);
}

function renderOptimizeSettings() {
  const optimize = state.optimize;
  refs.settingsPanel.innerHTML = `
    <div class="setting-group"><label>压缩强度</label>
      <div class="chip-row" id="optimizePresets">
        <button type="button" class="chip chip-tall" data-quality="60"><strong>更小</strong><small>体积优先</small></button>
        <button type="button" class="chip chip-tall" data-quality="82"><strong>均衡</strong><small>推荐</small></button>
        <button type="button" class="chip chip-tall" data-quality="92"><strong>高画质</strong><small>细节优先</small></button>
      </div>
    </div>
    <label class="toggle-row"><input id="targetToggle" type="checkbox"><span></span><strong>压到指定大小以内</strong></label>
    <div class="target-row" id="targetRow" hidden>不超过 <input id="targetMb" type="number" min="0.01" step="0.1" value="${optimize.targetMb}"> MB，自动挑最清晰的设置</div>
    <details class="advanced"><summary>更多选项</summary>
      <div class="advanced-body">
        <div class="setting-group"><label for="imageQuality">清晰度 <output id="qualityOutput">${optimize.quality}%</output></label><input class="range-control" id="imageQuality" type="range" min="35" max="100" value="${optimize.quality}"></div>
        <div class="setting-group"><label>输出格式</label>
          <div class="chip-row" id="optimizeFormats">
            <button type="button" class="chip" data-format="original">保持原格式</button>
            <button type="button" class="chip" data-format="webp">WebP</button>
            <button type="button" class="chip" data-format="avif">AVIF</button>
          </div>
          <p class="field-hint">照片转 WebP 通常还能再小 20–35%，画质几乎一样。</p>
        </div>
      </div>
    </details>
    <p class="inline-note">只改体积和清晰度，画面尺寸不变。要改尺寸请用「调整画面」。</p>`;
  $$('#optimizePresets .chip').forEach((chip) => chip.addEventListener('click', () => {
    const quality = Number(chip.dataset.quality);
    state.optimize = { ...state.optimize, quality, targetEnabled: false };
    syncOptimizeUi(); scheduleProcessedPreview();
  }));
  const toggle = $('#targetToggle');
  toggle.addEventListener('change', () => {
    const targetEnabled = toggle.checked;
    state.optimize = { ...state.optimize, targetEnabled, targetMb: targetEnabled ? defaultTargetMb() : state.optimize.targetMb };
    syncOptimizeUi(); scheduleProcessedPreview();
  });
  const targetInput = $('#targetMb');
  targetInput.addEventListener('input', () => {
    const value = Number(targetInput.value);
    if (Number.isFinite(value) && value > 0) { state.optimize.targetMb = value; scheduleProcessedPreview(); }
  });
  const slider = $('#imageQuality');
  slider.addEventListener('input', () => {
    state.optimize = { ...state.optimize, quality: Number(slider.value), targetEnabled: false };
    syncOptimizeUi(); scheduleProcessedPreview();
  });
  $$('#optimizeFormats .chip').forEach((chip) => chip.addEventListener('click', () => {
    state.optimize = { ...state.optimize, format: chip.dataset.format };
    syncOptimizeUi(); scheduleProcessedPreview();
  }));
  if (optimize.targetEnabled && !optimize.targetMb) state.optimize.targetMb = defaultTargetMb();
  syncOptimizeUi();
}

function syncAdjustUi() {
  $$('#ratioRow .chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.ratio === state.cropRatio));
  $$('#scaleRow .chip').forEach((chip) => chip.classList.toggle('active', Math.abs(Number(chip.dataset.scale) - state.adjustScale) < 0.001));
  updateCropOverlayCss();
}

function renderAdjustSettings() {
  refs.settingsPanel.innerHTML = `
    <div class="setting-group"><label>画面比例</label>
      <div class="chip-row" id="ratioRow">
        <button type="button" class="chip" data-ratio="free">自由</button>
        <button type="button" class="chip" data-ratio="original">原始</button>
        <button type="button" class="chip" data-ratio="1:1">1:1</button>
        <button type="button" class="chip" data-ratio="4:3">4:3</button>
        <button type="button" class="chip" data-ratio="3:4">3:4</button>
        <button type="button" class="chip" data-ratio="16:9">16:9</button>
      </div>
    </div>
    <div class="setting-group"><label for="adjustWidth">最终宽度（像素）</label>
      <input class="text-control" id="adjustWidth" type="number" min="16" step="1" placeholder="自动">
      <p class="field-hint" id="adjustHeightHint">高度会按原始比例自动计算</p>
    </div>
    <div class="setting-group"><label>缩放</label>
      <div class="chip-row" id="scaleRow">
        <button type="button" class="chip" data-scale="1">100%</button>
        <button type="button" class="chip" data-scale="0.75">75%</button>
        <button type="button" class="chip" data-scale="0.5">50%</button>
        <button type="button" class="chip" data-scale="0.25">25%</button>
      </div>
    </div>
    <button class="secondary-button" id="resetAdjustButton">重置为整张图</button>
    <p class="inline-note">拖动画面上的方框选择要保留的部分；宽度越大越清晰，文件也越大。</p>`;
  $$('#ratioRow .chip').forEach((chip) => chip.addEventListener('click', () => {
    applyCropRatio(chip.dataset.ratio); syncAdjustUi();
  }));
  $$('#scaleRow .chip').forEach((chip) => chip.addEventListener('click', () => {
    state.adjustScale = Number(chip.dataset.scale);
    syncAdjustUi(); scheduleProcessedPreview();
  }));
  const widthInput = $('#adjustWidth');
  widthInput.addEventListener('input', () => {
    const natural = cropNaturalSize();
    const value = Number(widthInput.value);
    if (!natural || !Number.isFinite(value) || value < 16) return;
    state.adjustScale = clamp(value / natural.width, 0.02, 4);
    updateCropOverlayCss();
    $$('#scaleRow .chip').forEach((chip) => chip.classList.toggle('active', Math.abs(Number(chip.dataset.scale) - state.adjustScale) < 0.001));
    scheduleProcessedPreview();
  });
  $('#resetAdjustButton').addEventListener('click', () => {
    state.cropRatio = 'free'; state.cropArea = { left: 0, top: 0, width: 1, height: 1 }; state.adjustScale = 1;
    syncAdjustUi(); scheduleProcessedPreview();
  });
  syncAdjustUi();
}

function renderConvertSettings() {
  refs.settingsPanel.innerHTML = `
    <div class="setting-group"><label>转换为</label>
      <div class="chip-row" id="convertRow">
        <button type="button" class="chip" data-format="jpeg">JPG</button>
        <button type="button" class="chip" data-format="png">PNG</button>
        <button type="button" class="chip" data-format="webp">WebP</button>
        <button type="button" class="chip" data-format="avif">AVIF</button>
      </div>
      <p class="field-hint">照片选 JPG 或 WebP；需要透明背景选 PNG。</p>
    </div>
    <p class="inline-note">只改变文件格式，画面和尺寸都不变。</p>`;
  const sync = () => $$('#convertRow .chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.format === state.convertFormat));
  $$('#convertRow .chip').forEach((chip) => chip.addEventListener('click', () => {
    state.convertFormat = chip.dataset.format; sync(); scheduleProcessedPreview();
  }));
  sync();
}

function renderSettings() {
  const op = state.operation;
  if (op === 'image-optimize') renderOptimizeSettings();
  else if (op === 'image-adjust') renderAdjustSettings();
  else if (op === 'image-convert') renderConvertSettings();
  else if (op === 'pdf-merge') refs.settingsPanel.innerHTML = `${textField('outputName', '输出文件名', '合并文档')}<p class="inline-note">拖动左侧文件可以调整合并顺序。</p>`;
  else if (op === 'pdf-split') refs.settingsPanel.innerHTML = '<p class="inline-note">每一页会保存成单独的 PDF，原文件不会改变。</p>';
  else if (op === 'pdf-rotate') refs.settingsPanel.innerHTML = `<div class="setting-group"><label>顺时针旋转</label>${choiceGroup('rotation', [['90', '90°'], ['180', '180°'], ['270', '270°']], '90')}</div>`;
  else if (op === 'images-to-pdf') refs.settingsPanel.innerHTML = `${textField('outputName', '输出文件名', '图片合集')}<p class="inline-note">图片会按左侧顺序排入 A4 页面。</p>`;
  else if (['media-convert', 'media-trim'].includes(op)) {
    const hasVideo = state.files.some((file) => fileType(file) === 'video');
    const formats = hasVideo ? [['mp4', 'MP4（兼容性最好）'], ['webm', 'WebM'], ['mkv', 'MKV'], ['gif', 'GIF 动图']] : [['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV 无损'], ['flac', 'FLAC'], ['ogg', 'OGG']];
    refs.settingsPanel.innerHTML = `${selectField('mediaFormat', '输出格式', formats, hasVideo ? 'mp4' : 'mp3')}${hasVideo ? `<div class="setting-group"><label>输出质量</label>${choiceGroup('mediaQuality', [['small', '更小'], ['balanced', '均衡'], ['high', '高清']], 'balanced')}</div>` : selectField('audioBitrate', '音频码率', [['128k', '128 kbps'], ['192k', '192 kbps'], ['256k', '256 kbps'], ['320k', '320 kbps']], '192k')}${op === 'media-trim' ? `<div class="setting-row">${textField('startTime', '开始时间（秒）', '0', 'number')}${textField('duration', '保留时长（秒）', '', 'number', '到结尾')}</div>` : ''}`;
  } else if (op === 'document-convert') {
    const ext = extOf(state.files[0] || { name: 'file.txt' });
    let formats = [['txt', '纯文本 TXT'], ['html', '网页 HTML']];
    if (['.xlsx', '.xls', '.csv', '.json'].includes(ext)) formats = [['csv', 'CSV 表格'], ['json', 'JSON 数据'], ['html', 'HTML 表格']];
    if (state.capabilities.officePdf && ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext)) formats.push(['pdf', 'PDF 文档']);
    refs.settingsPanel.innerHTML = `${selectField('documentFormat', '输出格式', formats, formats[0][0])}${!state.capabilities.officePdf && ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext) ? '<p class="inline-note">安装 LibreOffice 后会自动增加“转为 PDF”选项。</p>' : ''}`;
  } else if (op === 'archive-create') {
    refs.settingsPanel.innerHTML = `${textField('outputName', '压缩包名称', 'FilePilot-文件包')}<div class="setting-group"><label for="archiveLevel">压缩强度 <output id="levelOutput">7 / 9</output></label><input class="range-control" id="archiveLevel" type="range" min="0" max="9" value="7"></div>`;
    $('#archiveLevel').addEventListener('input', (event) => { $('#levelOutput').textContent = `${event.target.value} / 9`; });
  }
  refs.settingsPanel.querySelectorAll('[data-choice]').forEach((button) => button.addEventListener('click', () => {
    const [name, value] = button.dataset.choice.split(':');
    const input = document.querySelector(`input[name="${name}"]`);
    if (!input) {
      const holder = document.createElement('input');
      holder.type = 'hidden'; holder.name = name; holder.value = value; holder.id = `hidden-${name}`;
      refs.settingsPanel.appendChild(holder);
    } else {
      input.value = value;
    }
    $$(`[data-choice^="${name}:"]`).forEach((item) => item.classList.toggle('active', item === button));
  }));
  refs.runButtonLabel.textContent = {
    'image-optimize': '压缩并保存',
    'image-adjust': '按当前画面保存',
    'image-convert': '转换并保存',
    'images-to-pdf': '生成 PDF',
    'archive-create': '开始打包'
  }[op] || (op?.startsWith('pdf-') ? '处理 PDF' : '开始处理');
  updateEstimate();
}

function collectOptions() {
  const value = (id) => document.getElementById(id)?.value;
  const checked = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || document.getElementById(`hidden-${name}`)?.value;
  const base = { format: value('mediaFormat') || value('documentFormat'), quality: checked('mediaQuality'), outputName: value('outputName'), rotation: checked('rotation'), startTime: value('startTime'), duration: value('duration'), audioBitrate: value('audioBitrate'), level: value('archiveLevel') };
  if (state.operation === 'image-optimize') {
    const optimize = state.optimize;
    return {
      ...base,
      format: optimize.format || 'original',
      quality: optimize.quality,
      targetBytes: optimize.targetEnabled ? Math.round(optimize.targetMb * 1024 * 1024) : 0,
      nameSuffix: 'compressed'
    };
  }
  if (state.operation === 'image-convert') return { ...base, format: state.convertFormat || 'webp', quality: 88, nameSuffix: 'converted' };
  if (state.operation === 'image-adjust') {
    const output = adjustOutputSize();
    return {
      ...base,
      format: 'original',
      quality: 100,
      cropArea: state.cropArea,
      width: output?.width,
      allowUpscale: output ? output.width > output.natural.width : false,
      nameSuffix: 'cropped'
    };
  }
  return base;
}
function updateEstimate() {
  const total = state.files.reduce((sum, file) => sum + Number(file.size || 0), 0); let description = `${state.files.length} 个输出文件`;
  if (['pdf-merge', 'images-to-pdf', 'archive-create'].includes(state.operation)) description = '1 个输出文件';
  if (state.operation === 'pdf-split') description = '按页数生成文件';
  if (state.processedPreview && isSizeCompareTask()) {
    refs.estimateText.textContent = state.files.length === 1
      ? `${description} · 约 ${formatBytes(state.processedPreview.estimatedSize)}`
      : `${description} · 单个约 ${formatBytes(state.processedPreview.estimatedSize)}`;
    return;
  }
  refs.estimateText.textContent = `${description} · ${formatBytes(total)}`;
}
function renderResults() {
  refs.resultPanel.hidden = !state.results.length; if (!state.results.length) return;
  const total = state.results.reduce((sum, file) => sum + Number(file.size || 0), 0);
  refs.resultSummary.textContent = `已生成 ${state.results.length} 个文件，共 ${formatBytes(total)}`;
  refs.resultList.innerHTML = state.results.map((file, index) => `<div class="result-item"><strong title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span><button data-result="${index}">打开</button></div>`).join('');
  refs.resultList.querySelectorAll('[data-result]').forEach((button) => button.addEventListener('click', () => window.filepilot.openFile(state.results[Number(button.dataset.result)].path)));
}
function setProgress(percent, message, detail) {
  const rounded = Math.max(0, Math.min(100, Math.round(percent || 0))); refs.progressPercent.textContent = `${rounded}%`; refs.progressTitle.textContent = message || '正在处理'; refs.progressDetail.textContent = detail || '请稍候…'; refs.progressBar.style.width = `${rounded}%`;
}
async function runCurrentOperation() {
  if (state.running || !state.files.length) return;
  state.running = true; state.results = []; refs.resultPanel.hidden = true; refs.taskProgress.hidden = false; refs.runButton.disabled = true; setProgress(0, '正在准备', toolMeta[state.operation].label);
  try {
    const result = await window.filepilot.runOperation({ operation: state.operation, files: state.files.map(({ path, name, size, ext }) => ({ path, name, size, ext })), options: collectOptions(), outputDirectory: state.outputDirectory });
    state.results = result.outputs || []; state.outputDirectory = result.outputDirectory || state.outputDirectory; setProgress(100, '处理完成', `已生成 ${state.results.length} 个文件`);
    await new Promise((resolve) => setTimeout(resolve, 350)); refs.taskProgress.hidden = true; renderResults(); showToast('处理完成，结果已保存');
  } catch (error) { refs.taskProgress.hidden = true; showToast(error?.message || '处理失败，请检查文件后重试', 'error'); }
  finally { state.running = false; refs.runButton.disabled = false; }
}
async function chooseFiles(tool = null) { if (tool) state.pendingTool = tool; const files = await window.filepilot.chooseFiles(); if (files?.length) addFiles(files); else if (tool) state.pendingTool = null; }
function handleDrop(event) {
  event.preventDefault(); refs.dropZone.classList.remove('dragging');
  const files = [...event.dataTransfer.files].map((file) => ({ path: window.filepilot.getPathForFile(file), name: file.name, size: file.size, ext: `.${file.name.split('.').pop().toLowerCase()}` })); addFiles(files);
}

function setupCropInteractions() {
  let drag = null;
  refs.cropOverlay.addEventListener('pointerdown', (event) => {
    if (!isGeometryTask()) return;
    event.preventDefault();
    const rect = refs.cropMedia.getBoundingClientRect();
    drag = {
      handle: event.target.dataset.handle || 'move',
      startX: event.clientX,
      startY: event.clientY,
      rect,
      area: { ...state.cropArea }
    };
    refs.cropOverlay.setPointerCapture?.(event.pointerId);
  });
  window.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / Math.max(1, drag.rect.width);
    const dy = (event.clientY - drag.startY) / Math.max(1, drag.rect.height);
    const start = drag.area;
    const minimum = 0.06;
    let left = start.left;
    let top = start.top;
    let right = start.left + start.width;
    let bottom = start.top + start.height;
    if (drag.handle === 'move') {
      left = clamp(start.left + dx, 0, 1 - start.width);
      top = clamp(start.top + dy, 0, 1 - start.height);
      right = left + start.width;
      bottom = top + start.height;
    } else {
      if (drag.handle.includes('w')) left = clamp(start.left + dx, 0, right - minimum);
      if (drag.handle.includes('e')) right = clamp(start.left + start.width + dx, left + minimum, 1);
      if (drag.handle.includes('n')) top = clamp(start.top + dy, 0, bottom - minimum);
      if (drag.handle.includes('s')) bottom = clamp(start.top + start.height + dy, top + minimum, 1);
      state.cropRatio = 'free';
      $$('#ratioRow .chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.ratio === 'free'));
    }
    state.cropArea = { left, top, width: right - left, height: bottom - top };
    updateCropOverlayCss();
    scheduleProcessedPreview();
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    scheduleProcessedPreview();
  });
  window.addEventListener('resize', updateCropOverlayCss);
}
function bindEvents() {
  $('#chooseFilesButton').addEventListener('click', (event) => { event.stopPropagation(); chooseFiles(); });
  refs.dropZone.addEventListener('click', () => chooseFiles()); refs.dropZone.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) chooseFiles(); });
  refs.dropZone.addEventListener('dragover', (event) => { event.preventDefault(); refs.dropZone.classList.add('dragging'); }); refs.dropZone.addEventListener('dragleave', () => refs.dropZone.classList.remove('dragging')); refs.dropZone.addEventListener('drop', handleDrop);
  $('#addMoreButton').addEventListener('click', () => chooseFiles()); $('#addMoreDropButton').addEventListener('click', () => chooseFiles()); $('#backButton').addEventListener('click', resetTask); $('#clearAllButton').addEventListener('click', resetTask);
  $$('.quick-card').forEach((button) => button.addEventListener('click', () => chooseFiles(button.dataset.tool))); refs.runButton.addEventListener('click', runCurrentOperation);
  refs.compareToggle.addEventListener('click', () => {
    state.compare = !state.compare;
    updatePreviewLayout();
    if (state.compare && !state.originalPreview) loadOriginalPreview();
  });
  $('#outputPathButton').addEventListener('click', async () => { const directory = await window.filepilot.chooseOutputDirectory(); if (directory) { state.outputDirectory = directory; refs.outputPathLabel.textContent = directory.split(/[\\/]/).pop(); refs.outputPathLabel.title = directory; } });
  $('#openOutputButton').addEventListener('click', () => { if (state.results[0]) window.filepilot.revealFile(state.results[0].path); });
  window.filepilot.onProgress((progress) => setProgress(progress.percent, progress.message, progress.currentFile));
  setupCropInteractions();
}
async function init() {
  bindEvents(); state.outputDirectory = await window.filepilot.getDefaultOutputDirectory(); refs.outputPathLabel.textContent = state.outputDirectory.split(/[\\/]/).pop(); refs.outputPathLabel.title = state.outputDirectory;
  state.capabilities = await window.filepilot.getCapabilities(); $('#engineStatus').textContent = state.capabilities.officePdf ? '所有处理引擎已就绪' : '核心引擎已就绪 · Office 转 PDF 需 LibreOffice';
}
init().catch((error) => showToast(error.message || '应用初始化失败', 'error'));
