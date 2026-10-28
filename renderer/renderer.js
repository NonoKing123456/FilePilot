const state = {
  files: [],
  operation: null,
  pendingTool: null,
  outputDirectory: '',
  capabilities: {},
  results: [],
  running: false
};

const operations = [
  { group: '智能', id: 'smart', label: '智能处理（自动识别）' },
  { group: '图片', id: 'image-optimize', label: '图片压缩与优化' },
  { group: '图片', id: 'image-convert', label: '图片格式转换' },
  { group: '图片', id: 'image-resize', label: '图片缩放' },
  { group: '图片', id: 'image-crop', label: '图片裁剪' },
  { group: '图片', id: 'images-to-pdf', label: '图片合成 PDF' },
  { group: 'PDF', id: 'pdf-merge', label: '合并 PDF' },
  { group: 'PDF', id: 'pdf-split', label: '拆分 PDF' },
  { group: 'PDF', id: 'pdf-rotate', label: '旋转 PDF' },
  { group: '音视频', id: 'media-convert', label: '音视频转换与压缩' },
  { group: '音视频', id: 'media-trim', label: '音视频裁剪' },
  { group: '文档', id: 'document-convert', label: '文档与表格转换' },
  { group: '压缩', id: 'archive-create', label: '创建 ZIP 压缩包' }
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const refs = {
  dropZone: $('#dropZone'),
  chooseFilesButton: $('#chooseFilesButton'),
  quickSection: $('#quickSection'),
  workspace: $('#workspace'),
  fileList: $('#fileList'),
  fileCount: $('#fileCountBadge'),
  operationSelect: $('#operationSelect'),
  settingsPanel: $('#settingsPanel'),
  recommendationText: $('#recommendationText'),
  estimateText: $('#estimateText'),
  runButton: $('#runButton'),
  runButtonLabel: $('#runButtonLabel'),
  resultPanel: $('#resultPanel'),
  resultList: $('#resultList'),
  resultSummary: $('#resultSummary'),
  outputPathLabel: $('#outputPathLabel'),
  progressOverlay: $('#progressOverlay'),
  progressPercent: $('#progressPercent'),
  progressTitle: $('#progressTitle'),
  progressDetail: $('#progressDetail'),
  progressBar: $('#progressBar'),
  toast: $('#toast')
};

function extOf(file) {
  return file.ext || `.${String(file.name).split('.').pop().toLowerCase()}`;
}

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

function typeLabel(file) {
  const ext = extOf(file).replace('.', '').toUpperCase();
  return ext.length <= 5 ? ext : fileType(file).slice(0, 4).toUpperCase();
}

function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes))) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function showToast(message, kind = 'info') {
  refs.toast.textContent = message;
  refs.toast.className = `toast show ${kind === 'error' ? 'error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { refs.toast.className = 'toast'; }, 3000);
}

function recommendOperation(files) {
  if (!files.length) return 'smart';
  const types = files.map(fileType);
  if (files.length > 1 && types.every((type) => type === 'pdf')) return 'pdf-merge';
  if (types.every((type) => type === 'image')) return 'image-optimize';
  if (types.every((type) => ['video', 'audio'].includes(type))) return 'media-convert';
  if (types.every((type) => ['document', 'text'].includes(type))) return 'document-convert';
  if (types.length === 1 && types[0] === 'pdf') return 'pdf-split';
  return 'archive-create';
}

function operationLabel(id) {
  return operations.find((operation) => operation.id === id)?.label || '智能处理';
}

function populateOperationSelect() {
  const groups = [...new Set(operations.map((operation) => operation.group))];
  refs.operationSelect.innerHTML = groups.map((group) => {
    const options = operations.filter((operation) => operation.group === group)
      .map((operation) => `<option value="${operation.id}">${escapeHtml(operation.label)}</option>`).join('');
    return `<optgroup label="${group}">${options}</optgroup>`;
  }).join('');
}

function addFiles(files) {
  const incoming = files.filter((file) => file?.path && file?.name).map((file) => ({
    ...file,
    id: `${file.path}-${file.size}-${Date.now()}-${Math.random()}`,
    ext: extOf(file)
  }));
  const known = new Set(state.files.map((file) => file.path.toLowerCase()));
  const unique = incoming.filter((file) => !known.has(file.path.toLowerCase()));
  if (!unique.length) {
    if (incoming.length) showToast('这些文件已经在队列里了');
    return;
  }
  state.files.push(...unique);
  state.results = [];
  state.operation = state.pendingTool || recommendOperation(state.files);
  state.pendingTool = null;
  renderWorkspace();
  showToast(`已添加 ${unique.length} 个文件`);
}

function renderWorkspace() {
  const hasFiles = state.files.length > 0;
  refs.dropZone.hidden = hasFiles;
  refs.quickSection.hidden = hasFiles;
  refs.workspace.hidden = !hasFiles;
  refs.resultPanel.hidden = !state.results.length;
  if (!hasFiles) return;

  refs.fileCount.textContent = state.files.length;
  refs.fileList.innerHTML = state.files.map((file, index) => `
    <div class="file-row" draggable="true" data-index="${index}" data-file-id="${escapeHtml(file.id)}">
      <div class="file-type-icon ${fileType(file)}">${escapeHtml(typeLabel(file))}</div>
      <div class="file-info"><strong title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</strong><span>${escapeHtml(fileType(file).toUpperCase())} · 可本地处理</span></div>
      <div class="file-size">${formatBytes(file.size)}</div>
      <button class="remove-file" data-remove="${escapeHtml(file.id)}" title="移除">×</button>
    </div>
  `).join('');

  refs.operationSelect.value = state.operation || recommendOperation(state.files);
  if (!refs.operationSelect.value) refs.operationSelect.value = 'smart';
  state.operation = refs.operationSelect.value;
  renderSettings();
  renderResults();
  bindFileRows();
}

function bindFileRows() {
  $$('.remove-file').forEach((button) => button.addEventListener('click', () => {
    state.files = state.files.filter((file) => file.id !== button.dataset.remove);
    state.results = [];
    state.operation = recommendOperation(state.files);
    renderWorkspace();
  }));

  let draggedIndex = null;
  $$('.file-row').forEach((row) => {
    row.addEventListener('dragstart', () => { draggedIndex = Number(row.dataset.index); row.style.opacity = '.45'; });
    row.addEventListener('dragend', () => { draggedIndex = null; row.style.opacity = ''; });
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      const targetIndex = Number(row.dataset.index);
      if (draggedIndex === null || draggedIndex === targetIndex) return;
      const [moved] = state.files.splice(draggedIndex, 1);
      state.files.splice(targetIndex, 0, moved);
      renderWorkspace();
    });
  });
}

function choiceGroup(name, values, selected) {
  return `<div class="choice-row">${values.map(([value, label]) => `
    <input type="radio" name="${name}" id="${name}-${value}" value="${value}" ${String(value) === String(selected) ? 'checked' : ''}>
    <label for="${name}-${value}">${label}</label>
  `).join('')}</div>`;
}

function selectField(id, label, options, value) {
  return `<div class="setting-group"><label for="${id}">${label}</label><select class="select-control" id="${id}">${options.map(([optionValue, text, disabled = false]) => `<option value="${optionValue}" ${String(optionValue) === String(value) ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${text}</option>`).join('')}</select></div>`;
}

function textField(id, label, value, type = 'text', placeholder = '') {
  return `<div class="setting-group"><label for="${id}">${label}</label><input class="text-control" id="${id}" type="${type}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}"></div>`;
}

function renderSettings() {
  const op = state.operation;
  const recommended = recommendOperation(state.files);
  refs.recommendationText.textContent = op === recommended
    ? `已根据当前文件选择「${operationLabel(recommended)}」`
    : `智能建议：${operationLabel(recommended)}`;

  if (['image-optimize', 'image-convert', 'image-resize', 'image-crop'].includes(op)) {
    const defaultFormat = op === 'image-convert' ? 'webp' : 'original';
    refs.settingsPanel.innerHTML = `
      ${selectField('imageFormat', '输出格式', [['original', '保持原格式'], ['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF']], defaultFormat)}
      <div class="setting-group"><label for="imageQuality">图片质量 <output id="qualityOutput">82%</output></label><input class="range-control" id="imageQuality" type="range" min="35" max="100" value="82"></div>
      <div class="setting-row">${textField('imageWidth', '最大宽度（px）', op === 'image-resize' ? '1920' : '', 'number', '自动')}${textField('imageHeight', '最大高度（px）', '', 'number', '自动')}</div>
      ${selectField('cropRatio', '居中裁剪比例', [['original', '不裁剪'], ['1:1', '1:1 方形'], ['4:3', '4:3'], ['16:9', '16:9'], ['3:4', '3:4 竖图']], op === 'image-crop' ? '1:1' : 'original')}
    `;
    $('#imageQuality').addEventListener('input', (event) => { $('#qualityOutput').textContent = `${event.target.value}%`; updateEstimate(); });
  } else if (op === 'pdf-merge') {
    refs.settingsPanel.innerHTML = `${textField('outputName', '输出文件名', '合并文档')}<p class="run-hint">可拖动左侧文件调整合并顺序</p>`;
  } else if (op === 'pdf-split') {
    refs.settingsPanel.innerHTML = `<div class="recommendation"><span>↳</span><p><strong>逐页拆分</strong><small>每一页都会保存为独立 PDF，原文件保持不变</small></p></div>`;
  } else if (op === 'pdf-rotate') {
    refs.settingsPanel.innerHTML = `<div class="setting-group"><label>顺时针旋转</label>${choiceGroup('rotation', [['90', '90°'], ['180', '180°'], ['270', '270°']], '90')}</div>`;
  } else if (op === 'images-to-pdf') {
    refs.settingsPanel.innerHTML = `${textField('outputName', '输出文件名', '图片合集')}<p class="run-hint">图片将按左侧顺序排入 A4 页面</p>`;
  } else if (['media-convert', 'media-trim'].includes(op)) {
    const hasVideo = state.files.some((file) => fileType(file) === 'video');
    const formats = hasVideo
      ? [['mp4', 'MP4（兼容性最好）'], ['webm', 'WebM'], ['mkv', 'MKV'], ['gif', 'GIF 动图']]
      : [['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV 无损'], ['flac', 'FLAC'], ['ogg', 'OGG']];
    refs.settingsPanel.innerHTML = `
      ${selectField('mediaFormat', '输出格式', formats, hasVideo ? 'mp4' : 'mp3')}
      ${hasVideo ? `<div class="setting-group"><label>输出质量</label>${choiceGroup('mediaQuality', [['small', '更小'], ['balanced', '均衡'], ['high', '高清']], 'balanced')}</div>` : selectField('audioBitrate', '音频码率', [['128k', '128 kbps'], ['192k', '192 kbps'], ['256k', '256 kbps'], ['320k', '320 kbps']], '192k')}
      ${op === 'media-trim' ? `<div class="setting-row">${textField('startTime', '开始时间（秒）', '0', 'number')}${textField('duration', '保留时长（秒）', '', 'number', '到结尾')}</div>` : ''}
    `;
  } else if (op === 'document-convert') {
    const ext = extOf(state.files[0] || { name: 'file.txt' });
    let formats = [['txt', '纯文本 TXT'], ['html', '网页 HTML']];
    if (['.xlsx', '.xls', '.csv', '.json'].includes(ext)) formats = [['csv', 'CSV 表格'], ['json', 'JSON 数据'], ['html', 'HTML 表格']];
    if (state.capabilities.officePdf && ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp'].includes(ext)) formats.push(['pdf', 'PDF 文档']);
    refs.settingsPanel.innerHTML = `${selectField('documentFormat', '输出格式', formats, formats[0][0])}${!state.capabilities.officePdf && ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext) ? '<p class="run-hint">安装 LibreOffice 后可额外启用 Office → PDF</p>' : ''}`;
  } else if (op === 'archive-create') {
    refs.settingsPanel.innerHTML = `${textField('outputName', '压缩包名称', 'FilePilot-文件包')}<div class="setting-group"><label for="archiveLevel">压缩强度 <output id="levelOutput">7 / 9</output></label><input class="range-control" id="archiveLevel" type="range" min="0" max="9" value="7"></div>`;
    $('#archiveLevel').addEventListener('input', (event) => { $('#levelOutput').textContent = `${event.target.value} / 9`; });
  } else {
    refs.settingsPanel.innerHTML = `<div class="recommendation"><span>✦</span><p><strong>自动识别</strong><small>FilePilot 会根据文件组合选择图片优化、PDF 合并、文档转换或 ZIP 打包</small></p></div>`;
  }
  refs.settingsPanel.querySelectorAll('input, select').forEach((control) => control.addEventListener('change', updateEstimate));
  refs.runButtonLabel.textContent = op === 'archive-create' ? '开始打包' : op?.startsWith('pdf-') ? '开始处理 PDF' : '开始处理';
  updateEstimate();
}

function collectOptions() {
  const value = (id) => document.getElementById(id)?.value;
  const checked = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
  return {
    format: value('imageFormat') || value('mediaFormat') || value('documentFormat'),
    quality: value('imageQuality') || checked('mediaQuality'),
    width: value('imageWidth'),
    height: value('imageHeight'),
    cropRatio: value('cropRatio'),
    outputName: value('outputName'),
    rotation: checked('rotation'),
    startTime: value('startTime'),
    duration: value('duration'),
    audioBitrate: value('audioBitrate'),
    level: value('archiveLevel')
  };
}

function updateEstimate() {
  const total = state.files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  const op = state.operation;
  let suffix = `${state.files.length} 个输出`;
  if (op === 'pdf-merge' || op === 'images-to-pdf' || op === 'archive-create') suffix = '1 个输出文件';
  if (op === 'pdf-split') suffix = '按 PDF 页数输出';
  refs.estimateText.textContent = `${suffix} · 输入 ${formatBytes(total)}`;
}

function renderResults() {
  refs.resultPanel.hidden = !state.results.length;
  if (!state.results.length) return;
  const total = state.results.reduce((sum, file) => sum + Number(file.size || 0), 0);
  refs.resultSummary.textContent = `已生成 ${state.results.length} 个文件，共 ${formatBytes(total)}`;
  refs.resultList.innerHTML = state.results.map((file, index) => `
    <div class="result-item"><strong title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span><button data-result="${index}">打开</button></div>
  `).join('');
  refs.resultList.querySelectorAll('[data-result]').forEach((button) => button.addEventListener('click', () => window.filepilot.openFile(state.results[Number(button.dataset.result)].path)));
}

function setProgress(percent, message, detail) {
  const rounded = Math.max(0, Math.min(100, Math.round(percent || 0)));
  refs.progressPercent.textContent = `${rounded}%`;
  refs.progressTitle.textContent = message || '正在处理文件';
  refs.progressDetail.textContent = detail || '请稍候…';
  refs.progressBar.style.width = `${rounded}%`;
  $('.progress-orbit').style.setProperty('--progress', `${rounded}%`);
}

async function runCurrentOperation() {
  if (state.running || !state.files.length) return;
  state.running = true;
  state.results = [];
  refs.resultPanel.hidden = true;
  refs.runButton.disabled = true;
  refs.progressOverlay.hidden = false;
  setProgress(0, '正在准备处理', operationLabel(state.operation));
  try {
    const result = await window.filepilot.runOperation({
      operation: state.operation,
      files: state.files.map(({ path, name, size, ext }) => ({ path, name, size, ext })),
      options: collectOptions(),
      outputDirectory: state.outputDirectory
    });
    state.results = result.outputs || [];
    state.outputDirectory = result.outputDirectory || state.outputDirectory;
    setProgress(100, '处理完成', `已生成 ${state.results.length} 个文件`);
    await new Promise((resolve) => setTimeout(resolve, 450));
    renderResults();
    showToast('处理完成，结果已保存到输出文件夹');
  } catch (error) {
    showToast(error?.message || '处理失败，请检查文件后重试', 'error');
  } finally {
    state.running = false;
    refs.runButton.disabled = false;
    refs.progressOverlay.hidden = true;
  }
}

async function chooseFiles(tool = null) {
  if (tool) state.pendingTool = tool;
  const files = await window.filepilot.chooseFiles();
  if (files?.length) addFiles(files);
  else if (tool) state.pendingTool = null;
}

async function handleDrop(event) {
  event.preventDefault();
  refs.dropZone.classList.remove('dragging');
  const items = [...event.dataTransfer.files];
  const files = items.map((file) => ({
    path: window.filepilot.getPathForFile(file),
    name: file.name,
    size: file.size,
    ext: `.${file.name.split('.').pop().toLowerCase()}`
  }));
  addFiles(files);
}

function bindEvents() {
  refs.chooseFilesButton.addEventListener('click', () => chooseFiles());
  refs.dropZone.addEventListener('click', () => chooseFiles());
  refs.dropZone.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) chooseFiles(); });
  refs.dropZone.addEventListener('dragover', (event) => { event.preventDefault(); refs.dropZone.classList.add('dragging'); });
  refs.dropZone.addEventListener('dragleave', () => refs.dropZone.classList.remove('dragging'));
  refs.dropZone.addEventListener('drop', handleDrop);
  $('#addMoreButton').addEventListener('click', () => chooseFiles());
  $('#clearAllButton').addEventListener('click', () => {
    state.files = []; state.results = []; state.operation = null; renderWorkspace(); showToast('工作台已清空');
  });
  refs.operationSelect.addEventListener('change', () => { state.operation = refs.operationSelect.value; state.results = []; renderSettings(); renderResults(); });
  refs.runButton.addEventListener('click', runCurrentOperation);
  $('#outputPathButton').addEventListener('click', async () => {
    const directory = await window.filepilot.chooseOutputDirectory();
    if (directory) { state.outputDirectory = directory; refs.outputPathLabel.textContent = directory.split(/[\\/]/).pop(); refs.outputPathLabel.title = directory; }
  });
  $('#openOutputButton').addEventListener('click', () => {
    const first = state.results[0];
    if (first) window.filepilot.revealFile(first.path);
  });
  $$('.tool-card, .tool-nav').forEach((button) => button.addEventListener('click', () => chooseFiles(button.dataset.tool)));
  $('#showAllToolsButton').addEventListener('click', () => chooseFiles('smart'));
  $('#aboutButton').addEventListener('click', () => showToast('FilePilot 0.1 · 本地优先的文件万能助手'));
  $$('.main-nav .nav-item').forEach((button) => button.addEventListener('click', () => {
    $$('.main-nav .nav-item').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    if (button.dataset.view === 'history') showToast('处理结果保存在你选择的输出文件夹中');
  }));
  window.filepilot.onProgress((progress) => setProgress(progress.percent, progress.message, progress.currentFile));
}

async function init() {
  populateOperationSelect();
  bindEvents();
  state.outputDirectory = await window.filepilot.getDefaultOutputDirectory();
  refs.outputPathLabel.textContent = state.outputDirectory.split(/[\\/]/).pop();
  refs.outputPathLabel.title = state.outputDirectory;
  state.capabilities = await window.filepilot.getCapabilities();
  const missing = [];
  if (!state.capabilities.media) missing.push('音视频');
  if (!state.capabilities.officePdf) missing.push('Office→PDF');
  $('#engineStatus').textContent = missing.length ? `核心引擎就绪 · ${missing.join('、')}受限` : '全部处理引擎已就绪';
  $('.engine-dot').classList.add('ready');
}

init().catch((error) => showToast(error.message || '应用初始化失败', 'error'));
