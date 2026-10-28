# FilePilot

FilePilot 是一个本地优先的 Windows 文件处理桌面客户端。文件在电脑本机完成转换、压缩、裁剪、合并和打包，不需要上传到服务器。界面会根据当前文件自动收起无关工具，只保留可执行的操作。

## 已实现

- 图片压缩：三档压缩强度、可选「压到指定大小以内」（自动挑最清晰的设置）、只在本机体积对比
- 图片调整：「调整画面」把裁剪和尺寸合成一步——拖动方框选区，宽度决定最终清晰度，可按 1:1 / 4:3 / 16:9 等比例取景
- 图片格式转换：JPG / PNG / WebP / AVIF
- 图片预览：默认单栏实时预览，需要时再切「并排对比原图」；调整画面时方框即最终画面
- PDF：合并、逐页拆分、旋转、图片合成 PDF
- 音视频：MP4 / WebM / MKV / GIF 与常见音频格式转换、压缩、按时间裁剪
- 文档：DOCX 转 TXT / HTML，Excel / CSV / JSON 互转
- 压缩：任意文件批量创建 ZIP
- Office 转 PDF：检测到本机 LibreOffice 后自动启用

## 开发

```powershell
pnpm install
pnpm start
pnpm test
pnpm dist
```

安装包与便携版输出到 `release/`，文件名分别包含 `Setup` 和 `Portable`。

界面自检脚本（截图与交互冒烟）：

```powershell
node_modules\electron\dist\electron.exe scripts\capture-ui.js
node_modules\electron\dist\electron.exe scripts\smoke-ui.js
```
