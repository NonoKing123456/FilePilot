const state = {
  files: [], operation: null, pendingTool: null, outputDirectory: '', capabilities: {}, results: [], running: false,
  selectedFileId: null,
  originalPreview: null,
  processedPreview: null,
  cropArea: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
  cropRatio: 'free',
  previewRequestId: 0
};

const toolMeta = {
  'image-optimize': { label: '压缩', detail: '减小文件体积', icon: '⇣' },
  'image-convert': { label: '转换格式', detail: 'JPG、PNG、WebP', icon: '⇄' },
  'image-resize': { label: '调整尺寸', detail: '按宽高缩放', icon: '↔' },
  'image-crop': { label: '裁剪', detail: '常用画面比例', icon: '⌗' },
  'images-to-pdf': { label: '转为 PDF', detail: '多图合成文档', icon: '▤' },
  'pdf-merge': { label: '合并', detail: '组合多个 PDF', icon: '⊕' },
  'pdf-split': { label: '拆分', detail: '逐页保存', icon: '↗' },
  'pdf-rotate': { label: '旋转', detail: '调整页面方向', icon: '↻' },
  'media-convert': { label: '转换与压缩', detail: '调整格式和体积', icon: '⇄' },
  'media-trim': { label: '裁剪片段', detail: '按时间截取', icon: '✂' },
  'document-convert': { label: '转换文档', detail: '文本和表格互转', icon: 'Aa' },
  'archive-create': { label: '打包成 ZIP', detail: '整理多个文件', icon: '⌑' }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const refs = {
  emptyView: $('#emptyView'), workspace: $('#workspace'), dropZone: $('#dropZone'), fileList: $('#fileList'), fileCount: $('#fileCountBadge'),
  workspaceSubtitle: $('#workspaceSubtitle'), actionChoices: $('#actionChoices'), settingsPanel: $('#settingsPanel'), recommendationText: $('#recommendationText'),
  estimateText: $('#estimateText'), runButton: $('#runButton'), runButtonLabel: $('#runButtonLabel'), resultPanel: $('#resultPanel'), resultList: $('#resultList'),
  resultSummary: $('#resultSummary'), outputPathLabel: $('#outputPathLabel'), taskProgress: $('#taskProgress'), progressPercent: $('#progressPercent'),
  progressTitle: $('#progressTitle'), progressDetail: $('#progressDetail'), progressBar: $('#progressBar'), toast: $('#toast'),
  imagePreviewPanel: $('#imagePreviewPanel'), previewFileName: $('#previewFileName'), previewHint: $('#previewHint'),
  originalPreviewImage: $('#originalPreviewImage'), processedPreviewImage: $('#processedPreviewImage'),
  originalPreviewMeta: $('#originalPreviewMeta'), processedPreviewMeta: $('#processedPreviewMeta'), previewSummary: $('#previewSummary'),
  originalPreviewLoading: $('#originalPreviewLoading'), processedPreviewLoading: $('#processedPreviewLoading'),
  processedPreviewLabel: $('#processedPreviewLabel'), cropOverlay: $('#cropOverlay'), cropMedia: $('#cropMedia')
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
  if (types.every((type) => type === 'image')) return ['image-optimize', 'image-convert', 'image-resize', 'image-crop', 'images-to-pdf', 'archive-create'];
  if (types.every((type) => type === 'pdf')) return [...(files.length > 1 ? ['pdf-merge'] : []), 'pdf-split', 'pdf-rotate', 'archive-create'];
  if (types.every((type) => ['video', 'audio'].includes(type))) return ['media-convert', 'media-trim', 'archive-create'];
  if (types.every((type) => ['document', 'text'].includes(type))) return ['document-convert', 'archive-create'];
  return ['archive-create'];
}
function recommendedOperation(files) { return validOperations(files)[0] || 'archive-create'; }

function selectedFile() {
  return state.files.find((file) => file.id === state.selectedFileId) || state.files[0] || null;
}

function isImagePreviewTask() {
  return state.files.length > 0 && state.files.every((file) => fileType(file) === 'image') && state.operation !== 'archive-create';
}

function imagePreviewLabel() {
  return {
    'image-optimize': '压缩预览',
    'image-convert': '转换预览',
    'image-resize': '尺寸预览',
    'image-crop': '裁剪结果',
    'images-to-pdf': 'PDF 页面预览'
  }[state.operation] || '处理后';
}

function updateCropOverlayCss() {
  if (!refs.cropOverlay) return;
  const area = state.cropArea;
  refs.cropOverlay.style.left = `${area.left * 100}%`;
  refs.cropOverlay.style.top = `${area.top * 100}%`;
  refs.cropOverlay.style.width = `${area.width * 100}%`;
  refs.cropOverlay.style.height = `${area.height * 100}%`;
  if (state.originalPreview) {
    const width = Math.max(1, Math.round(state.originalPreview.width * area.width));
    const height = Math.max(1, Math.round(state.originalPreview.height * area.height));
    refs.originalPreviewMeta.textContent = `选区 ${width} × ${height}`;
  }
}

function applyCropRatio(ratio, shouldPreview = true) {
  state.cropRatio = ratio;
  if (!state.originalPreview) return;
  if (ratio === 'free') {
    updateCropOverlayCss();
    if (shouldPreview) scheduleProcessedPreview();
    return;
  }
  const [rw, rh] = ratio.split(':').map(Number);
  const targetRatio = rw / rh;
  const sourceRatio = state.originalPreview.width / state.originalPreview.height;
  let width = 0.82;
  let height = width * sourceRatio / targetRatio;
  if (height > 0.82) {
    height = 0.82;
    width = height * targetRatio / sourceRatio;
  }
  state.cropArea = { left: (1 - width) / 2, top: (1 - height) / 2, width, height };
  updateCropOverlayCss();
  if (shouldPreview) scheduleProcessedPreview();
}

function contextualImageOptions() {
  const value = (id) => document.getElementById(id)?.value;
  if (state.operation === 'image-optimize') return { format: value('optimizeFormat') || 'original', quality: value('imageQuality') || 82 };
  if (state.operation === 'image-convert') return { format: value('convertFormat') || 'webp', quality: 86 };
  if (state.operation === 'image-resize') return { format: 'original', quality: 100, width: value('imageWidth'), height: value('imageHeight'), fit: $('#lockDimensions')?.checked ? 'inside' : 'fill' };
  if (state.operation === 'image-crop') return { format: 'original', quality: 100, cropArea: state.cropArea };
  return { format: 'original' };
}

function renderPreviewSummary() {
  if (!state.originalPreview || !state.processedPreview) return;
  const original = state.originalPreview;
  const processed = state.processedPreview;
  const delta = original.originalSize > 0 ? Math.round((1 - processed.estimatedSize / original.originalSize) * 100) : 0;
  let message = `<span>输出尺寸 <strong>${processed.width} × ${processed.height}</strong></span><span>预计大小 <strong>${formatBytes(processed.estimatedSize)}</strong></span>`;
  if (state.operation === 'image-optimize') {
    message += delta > 0 ? `<span><em>约减少 ${delta}%</em></span>` : '<span>当前设置不会明显减小体积</span>';
  } else if (state.operation === 'image-crop') {
    message += '<span>蓝框内就是最终保留的画面</span>';
  }
  refs.previewSummary.innerHTML = message;
  if (state.files.length === 1) refs.estimateText.textContent = `1 个输出文件 · 约 ${formatBytes(processed.estimatedSize)}`;
  else refs.estimateText.textContent = `${state.files.length} 个输出文件 · 逐个实时预估`;
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
    if (state.operation === 'image-resize') {
      if ($('#imageWidth') && !$('#imageWidth').value) $('#imageWidth').value = preview.width;
      if ($('#imageHeight') && !$('#imageHeight').value) $('#imageHeight').value = preview.height;
      scheduleProcessedPreview();
    }
    refs.originalPreviewImage.onload = () => {
      refs.originalPreviewImage.style.opacity = '1';
      refs.originalPreviewLoading.hidden = true;
      if (state.operation === 'image-crop') {
        applyCropRatio(state.cropRatio === 'free' ? 'free' : state.cropRatio, false);
        updateCropOverlayCss();
      }
    };
  } catch (error) {
    refs.originalPreviewLoading.textContent = '无法生成图片预览';
  }
}

async function loadProcessedPreview() {
  const file = selectedFile();
  if (!file || !isImagePreviewTask()) return;
  const requestId = ++state.previewRequestId;
  refs.processedPreviewLoading.hidden = false;
  refs.processedPreviewLoading.textContent = '正在生成预览…';
  refs.processedPreviewImage.style.opacity = '.3';
  try {
    const preview = await window.filepilot.getImagePreview({ filePath: file.path, options: contextualImageOptions(), original: false });
    if (requestId !== state.previewRequestId || selectedFile()?.id !== file.id) return;
    state.processedPreview = preview;
    refs.processedPreviewImage.src = preview.dataUrl;
    refs.processedPreviewMeta.textContent = `${preview.width} × ${preview.height} · ${formatBytes(preview.estimatedSize)}`;
    refs.processedPreviewImage.onload = () => {
      refs.processedPreviewImage.style.opacity = '1';
      refs.processedPreviewLoading.hidden = true;
      renderPreviewSummary();
    };
  } catch (error) {
    if (requestId !== state.previewRequestId) return;
    refs.processedPreviewLoading.textContent = '当前设置无法预览';
  }
}

function scheduleProcessedPreview() {
  clearTimeout(scheduleProcessedPreview.timer);
  scheduleProcessedPreview.timer = setTimeout(loadProcessedPreview, 180);
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
  refs.previewHint.textContent = state.files.length > 1 ? `正在预览所选文件，共 ${state.files.length} 个；点击文件可切换` : '左边是原图，右边是实际处理结果';
  refs.processedPreviewLabel.textContent = imagePreviewLabel();
  refs.cropOverlay.hidden = state.operation !== 'image-crop';
  if (forceOriginal || !state.originalPreview) await loadOriginalPreview();
  scheduleProcessedPreview();
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
    if (state.files.length) state.operation = recommendedOperation(state.files); renderWorkspace();
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
  refs.actionChoices.innerHTML = allowed.map((id) => {
    const tool = toolMeta[id];
    return `<button class="action-choice ${state.operation === id ? 'active' : ''}" data-operation="${id}"><i>${tool.icon}</i><span><strong>${tool.label}</strong><small>${tool.detail}</small></span></button>`;
  }).join('');
  refs.actionChoices.querySelectorAll('[data-operation]').forEach((button) => button.addEventListener('click', () => {
    state.operation = button.dataset.operation; state.results = [];
    if (state.operation === 'image-crop') {
      state.cropRatio = 'free';
      state.cropArea = { left: 0.1, top: 0.1, width: 0.8, height: 0.8 };
    }
    renderActionChoices(); renderSettings(); renderResults(); renderImagePreview();
  }));
  const recommended = recommendedOperation(state.files);
  refs.recommendationText.textContent = state.operation === recommended ? `根据这些文件，推荐先使用「${toolMeta[recommended].label}」` : `当前选择：${toolMeta[state.operation].label}`;
}

function choiceGroup(name, values, selected) {
  return `<div class="choice-row">${values.map(([value, label]) => `<input type="radio" name="${name}" id="${name}-${value}" value="${value}" ${String(value) === String(selected) ? 'checked' : ''}><label for="${name}-${value}">${label}</label>`).join('')}</div>`;
}
function selectField(id, label, options, value) {
  return `<div class="setting-group"><label for="${id}">${label}</label><select class="select-control" id="${id}">${options.map(([optionValue, text]) => `<option value="${optionValue}" ${String(optionValue) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}</select></div>`;
}
function textField(id, label, value, type = 'text', placeholder = '') {
  return `<div class="setting-group"><label for="${id}">${label}</label><input class="text-control" id="${id}" type="${type}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}"></div>`;
}

function renderSettings() {
  const op = state.operation;
  if (op === 'image-optimize') {
    refs.settingsPanel.innerHTML = `
      ${selectField('optimizeFormat', '压缩方式', [['original', '保持原格式'], ['webp', '转为 WebP（通常更小）'], ['avif', '转为 AVIF（体积最小）']], 'original')}
      <div class="setting-group"><label for="imageQuality">清晰度 <output id="qualityOutput">82%</output></label><input class="range-control" id="imageQuality" type="range" min="35" max="100" value="82"><div class="range-hints"><span>体积更小</span><span>画质更高</span></div></div>
      <p class="inline-note">这里只调整压缩方式和清晰度，不会改变图片尺寸或裁剪画面。</p>`;
    $('#imageQuality').addEventListener('input', (event) => { $('#qualityOutput').textContent = `${event.target.value}%`; scheduleProcessedPreview(); });
    $('#optimizeFormat').addEventListener('change', scheduleProcessedPreview);
  } else if (op === 'image-convert') {
    refs.settingsPanel.innerHTML = `
      ${selectField('convertFormat', '转换为', [['jpeg', 'JPG · 适合照片'], ['png', 'PNG · 支持透明背景'], ['webp', 'WebP · 体积更小'], ['avif', 'AVIF · 高压缩率']], 'webp')}
      <p class="inline-note">只转换文件格式，图片尺寸和画面内容保持不变。</p>`;
    $('#convertFormat').addEventListener('change', scheduleProcessedPreview);
  } else if (op === 'image-resize') {
    const defaultWidth = state.originalPreview?.width || '';
    const defaultHeight = state.originalPreview?.height || '';
    refs.settingsPanel.innerHTML = `
      <div class="setting-row">${textField('imageWidth', '宽度（像素）', defaultWidth, 'number', '自动')}${textField('imageHeight', '高度（像素）', defaultHeight, 'number', '自动')}</div>
      <label class="toggle-row"><input id="lockDimensions" type="checkbox" checked><span></span><strong>锁定原始比例</strong></label>
      <p class="inline-note">调整尺寸不会裁掉画面。锁定比例时，修改一边会自动计算另一边。</p>`;
    const widthInput = $('#imageWidth');
    const heightInput = $('#imageHeight');
    widthInput.addEventListener('input', () => {
      if ($('#lockDimensions').checked && state.originalPreview && Number(widthInput.value) > 0) heightInput.value = Math.round(Number(widthInput.value) * state.originalPreview.height / state.originalPreview.width);
      scheduleProcessedPreview();
    });
    heightInput.addEventListener('input', () => {
      if ($('#lockDimensions').checked && state.originalPreview && Number(heightInput.value) > 0) widthInput.value = Math.round(Number(heightInput.value) * state.originalPreview.width / state.originalPreview.height);
      scheduleProcessedPreview();
    });
    $('#lockDimensions').addEventListener('change', scheduleProcessedPreview);
  } else if (op === 'image-crop') {
    refs.settingsPanel.innerHTML = `
      ${selectField('cropRatio', '裁剪比例', [['free', '自由裁剪'], ['1:1', '1:1 · 头像 / 方图'], ['4:3', '4:3 · 通用照片'], ['16:9', '16:9 · 横屏'], ['3:4', '3:4 · 竖版']], state.cropRatio)}
      <button class="secondary-button" id="resetCropButton">重置裁剪区域</button>
      <p class="inline-note">拖动蓝色选框调整位置；拖动四角改变大小。右侧会实时显示裁剪后的完整结果。</p>`;
    $('#cropRatio').addEventListener('change', (event) => applyCropRatio(event.target.value));
    $('#resetCropButton').addEventListener('click', () => {
      state.cropRatio = 'free'; state.cropArea = { left: 0.1, top: 0.1, width: 0.8, height: 0.8 };
      $('#cropRatio').value = 'free'; updateCropOverlayCss(); scheduleProcessedPreview();
    });
  } else if (op === 'pdf-merge') refs.settingsPanel.innerHTML = `${textField('outputName', '输出文件名', '合并文档')}<p class="inline-note">拖动左侧文件可以调整合并顺序。</p>`;
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
  refs.runButtonLabel.textContent = op === 'archive-create' ? '开始打包' : op?.startsWith('pdf-') ? '处理 PDF' : '开始处理';
  updateEstimate();
}

function collectOptions() {
  const value = (id) => document.getElementById(id)?.value; const checked = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
  const base = { format: value('mediaFormat') || value('documentFormat'), quality: checked('mediaQuality'), outputName: value('outputName'), rotation: checked('rotation'), startTime: value('startTime'), duration: value('duration'), audioBitrate: value('audioBitrate'), level: value('archiveLevel') };
  if (state.operation === 'image-optimize') return { ...base, format: value('optimizeFormat') || 'original', quality: value('imageQuality') || 82, nameSuffix: 'compressed' };
  if (state.operation === 'image-convert') return { ...base, format: value('convertFormat') || 'webp', quality: 86, nameSuffix: 'converted' };
  if (state.operation === 'image-resize') return { ...base, format: 'original', quality: 100, width: value('imageWidth'), height: value('imageHeight'), fit: $('#lockDimensions')?.checked ? 'inside' : 'fill', nameSuffix: 'resized' };
  if (state.operation === 'image-crop') return { ...base, format: 'original', quality: 100, cropArea: state.cropArea, nameSuffix: 'cropped' };
  return base;
}
function updateEstimate() {
  const total = state.files.reduce((sum, file) => sum + Number(file.size || 0), 0); let description = `${state.files.length} 个输出文件`;
  if (['pdf-merge', 'images-to-pdf', 'archive-create'].includes(state.operation)) description = '1 个输出文件';
  if (state.operation === 'pdf-split') description = '按页数生成文件';
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
    if (state.operation !== 'image-crop') return;
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
      if ($('#cropRatio')) $('#cropRatio').value = 'free';
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
