# Notes Browser

本地 Markdown / 文本 / PDF 笔记 Web 浏览服务。笔记目录默认 `~/workdir/workboard/notes`，服务默认端口 `8766`。

## 快速使用

```bash
cd ~/workdir/workboard/notes_browser
./service.sh start     # 后台启动（推荐）
./service.sh stop
./service.sh restart
./service.sh status
```

- 访问：`http://127.0.0.1:8766`（局域网 / Tailscale 也可，见启动日志）
- 日志：`service.log`；PID：`.service.pid`
- 前台调试：`./run.sh`（首次会建 `.venv` 并装依赖）
- 改 `config.json` 后需重启

## 配置

`config.json`：

```json
{
  "host": "0.0.0.0",
  "port": 8766,
  "notes_dir": "~/workdir/workboard/notes"
}
```

- `notes_dir` 支持 `~`；必须已存在目录
- `host=0.0.0.0` 时本机 / 局域网 / Tailscale 均可访问

## 行为摘要（给 AI）

- 左侧目录树（跳过 `.git` 等隐藏项）；右侧预览 / 编辑
- `*.md` 可 Markdown 预览或源码编辑；其它文本直接编辑
- `*.pdf` 仅在线只读预览（iframe），不支持编辑；可上传 / 下载 / 重命名 / 删除
- 上传支持常见文本与 `.pdf`；单文件上限 **50MB**
- 停止输入约 500ms 后自动保存到 `notes_dir`（PDF 不参与保存）
- UI「扩展菜单 >>」→「git同步」：在 `notes_dir` 执行 `git pull` → `git add .` → `git commit -m"update"` → `git push`
- 技术栈：FastAPI + uvicorn；入口 `app.main:app`；静态页 `static/`

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 公开配置 |
| GET | `/api/tree` | 目录树（PDF 节点含 `is_pdf`） |
| GET | `/api/file?path=` | 读文件；PDF 只返回元数据 `{path, is_pdf, is_markdown}` |
| PUT | `/api/file` | 写文件 `{path, content}`（文本；拒绝 PDF） |
| POST | `/api/mkdir` | 建目录 `{parent, name}` |
| POST | `/api/create-file` | 建文件 `{parent, name}` |
| POST | `/api/rename` | 重命名 `{path, new_name}` |
| POST | `/api/delete` | 删除 `{path}` |
| POST | `/api/upload` | 上传文件（multipart：`file` + `parent` + 可选 `overwrite`；PDF 按二进制；超限 413） |
| GET | `/api/preview?path=` | PDF 在线预览（`Content-Type: application/pdf`，inline） |
| GET | `/api/download?path=` | 下载文件 |
| POST | `/api/git/sync` | git 同步 |
