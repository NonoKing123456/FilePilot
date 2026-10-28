# FilePilot

FilePilot 是一个本地优先的 Windows 文件处理桌面客户端。文件在电脑本机完成转换、压缩、裁剪、合并和打包，不需要上传到服务器。界面会根据当前文件自动收起无关工具，只保留可执行的操作。

## 已实现

- 图片：JPG / PNG / WebP / AVIF / TIFF 转换、质量压缩、缩放、居中比例裁剪
- 图片预览：处理前后双栏对比、压缩体积预估、可拖动与缩放的裁剪框、实时裁剪结果
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
