(() => {
  "use strict";

  const els = {
    sidebar: document.getElementById("sidebar"),
    sidebarResizer: document.getElementById("sidebar-resizer"),
    tree: document.getElementById("tree"),
    notesDirLabel: document.getElementById("notes-dir-label"),
    btnCollapse: document.getElementById("btn-collapse"),
    btnReopen: document.getElementById("btn-reopen"),
    btnNewDir: document.getElementById("btn-new-dir"),
    btnNewFile: document.getElementById("btn-new-file"),
    btnDelete: document.getElementById("btn-delete"),
    btnUpload: document.getElementById("btn-upload"),
    btnDownload: document.getElementById("btn-download"),
    fileUploadInput: document.getElementById("file-upload-input"),
    btnExt: document.getElementById("btn-ext"),
    extMenu: document.getElementById("ext-menu"),
    extChevron: document.getElementById("ext-chevron"),
    btnGitSync: document.getElementById("btn-git-sync"),
    currentPath: document.getElementById("current-path"),
    saveStatus: document.getElementById("save-status"),
    modeTabs: document.getElementById("mode-tabs"),
    tabPreview: document.getElementById("tab-preview"),
    tabEdit: document.getElementById("tab-edit"),
    placeholder: document.getElementById("placeholder"),
    preview: document.getElementById("preview"),
    pdfViewer: document.getElementById("pdf-viewer"),
    editor: document.getElementById("editor"),
    statusBar: document.getElementById("status-bar"),
    statusText: document.getElementById("status-text"),
    statusClose: document.getElementById("status-close"),
  };

  const TREE_COLLAPSED_KEY = "notes-browser-tree-collapsed";

  const state = {
    currentPath: null,
    selectedPath: null,
    selectedType: null,
    isMarkdown: false,
    isPdf: false,
    mode: "preview",
    dirty: false,
    saveTimer: null,
    statusTimer: null,
    lastContent: "",
    renaming: false,
    collapsed: new Set(),
    dragPath: null,
    dragType: null,
    treeDragActive: false,
    suppressTreeClick: false,
  };

  function loadCollapsedFromStorage() {
    try {
      const raw = localStorage.getItem(TREE_COLLAPSED_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      state.collapsed = new Set(arr.filter((p) => typeof p === "string"));
    } catch {
      /* ignore corrupt / unavailable storage */
    }
  }

  function persistCollapsed() {
    try {
      localStorage.setItem(TREE_COLLAPSED_KEY, JSON.stringify(Array.from(state.collapsed)));
    } catch {
      /* ignore quota / private mode */
    }
  }

  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text };
    }
    if (!res.ok) {
      const detail = data?.detail || res.statusText || "request failed";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return data;
  }

  function setSaveStatus(text, cls = "") {
    els.saveStatus.textContent = text;
    els.saveStatus.className = `save-status ${cls}`.trim();
  }

  function showStatus(message, kind = "ok", persistMs = 6000) {
    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }
    els.statusText.textContent = message;
    els.statusBar.className = `status-bar is-visible ${kind}`.trim();
    els.statusBar.hidden = false;
    els.statusBar.removeAttribute("hidden");
    if (persistMs > 0) {
      state.statusTimer = setTimeout(() => {
        hideStatus();
      }, persistMs);
    }
  }

  function hideStatus() {
    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }
    els.statusBar.classList.remove("is-visible", "ok", "error");
    els.statusBar.hidden = true;
    els.statusBar.setAttribute("hidden", "");
    els.statusText.textContent = "";
  }

  function renderMarkdown(src) {
    const html = window.marked ? marked.parse(src || "") : `<pre>${escapeHtml(src || "")}</pre>`;
    els.preview.innerHTML = window.DOMPurify ? DOMPurify.sanitize(html) : html;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function escapeAttr(s) {
    return String(s).replaceAll('"', "&quot;");
  }

  function parentOf(path) {
    if (!path) return "";
    const i = path.lastIndexOf("/");
    return i < 0 ? "" : path.slice(0, i);
  }

  function baseName(path) {
    if (!path) return "";
    const i = path.lastIndexOf("/");
    return i < 0 ? path : path.slice(i + 1);
  }

  function targetParent() {
    if (!state.selectedPath) return "";
    if (state.selectedType === "dir") return state.selectedPath;
    return parentOf(state.selectedPath);
  }

  function clearPdfViewer() {
    if (!els.pdfViewer) return;
    els.pdfViewer.removeAttribute("src");
  }

  function showPdfViewer(path) {
    if (!els.pdfViewer) return;
    // Unhide first so the browser actually fetches/renders the PDF.
    els.pdfViewer.hidden = false;
    els.pdfViewer.setAttribute("src", `/api/preview?path=${encodeURIComponent(path)}`);
  }

  function clearEditor() {
    state.currentPath = null;
    state.isMarkdown = false;
    state.isPdf = false;
    state.dirty = false;
    state.lastContent = "";
    els.editor.value = "";
    clearPdfViewer();
    els.currentPath.textContent = "未选择文件";
    setSaveStatus("");
    updateView();
  }

  function updateView() {
    const hasFile = Boolean(state.currentPath);
    const showMarkdownTabs = hasFile && state.isMarkdown && !state.isPdf;
    els.placeholder.hidden = hasFile;
    els.modeTabs.hidden = !showMarkdownTabs;
    if (!showMarkdownTabs) {
      els.modeTabs.setAttribute("hidden", "");
    } else {
      els.modeTabs.removeAttribute("hidden");
    }
    els.tabEdit.disabled = state.isPdf || !showMarkdownTabs;
    els.tabPreview.disabled = state.isPdf || !showMarkdownTabs;

    if (!hasFile) {
      els.preview.hidden = true;
      els.editor.hidden = true;
      if (els.pdfViewer) els.pdfViewer.hidden = true;
      return;
    }

    if (state.isPdf) {
      els.preview.hidden = true;
      els.editor.hidden = true;
      if (els.pdfViewer) els.pdfViewer.hidden = false;
      return;
    }

    if (els.pdfViewer) {
      els.pdfViewer.hidden = true;
      clearPdfViewer();
    }

    if (state.isMarkdown && state.mode === "preview") {
      renderMarkdown(els.editor.value);
      els.preview.hidden = false;
      els.editor.hidden = true;
    } else {
      els.preview.hidden = true;
      els.editor.hidden = false;
    }

    els.tabPreview.classList.toggle("active", state.mode === "preview");
    els.tabEdit.classList.toggle("active", state.mode === "edit");
  }

  function setMode(mode) {
    if (state.isPdf) return;
    state.mode = mode;
    updateView();
  }

  function treeItemHtml(node) {
    const selected = state.selectedPath === node.path ? " selected" : "";
    const active = state.currentPath === node.path ? " active" : "";
    if (node.type === "dir") {
      const collapsed = state.collapsed.has(node.path);
      const kids = (node.children || []).map((c) => treeItemHtml(c)).join("");
      return `
        <li class="tree-item" data-path="${escapeAttr(node.path)}" data-type="dir">
          <button type="button" class="tree-row dir-row${selected}${active}" data-path="${escapeAttr(node.path)}" draggable="true">
            <span class="tree-toggle">${collapsed ? "▸" : "▾"}</span>
            <span class="tree-icon dir">D</span>
            <span class="tree-name">${escapeHtml(node.name)}</span>
          </button>
          <ul class="tree-children"${collapsed ? " hidden" : ""}>${kids}</ul>
        </li>`;
    }
    const isPdf = Boolean(node.is_pdf) || /\.pdf$/i.test(node.name || "");
    const iconClass = isPdf ? "pdf" : "file";
    const iconLabel = isPdf ? "P" : "F";
    return `
      <li class="tree-item" data-path="${escapeAttr(node.path)}" data-type="file">
        <button type="button" class="tree-row file-row${selected}${active}" data-path="${escapeAttr(node.path)}" draggable="true">
          <span class="tree-toggle"></span>
          <span class="tree-icon ${iconClass}">${iconLabel}</span>
          <span class="tree-name">${escapeHtml(node.name)}</span>
        </button>
      </li>`;
  }

  function rememberCollapsed() {
    const dirs = els.tree.querySelectorAll(".tree-item[data-type='dir']");
    // Empty tree (first paint): keep in-memory state loaded from storage.
    if (!dirs.length) return;
    state.collapsed.clear();
    dirs.forEach((li) => {
      const kids = li.querySelector(":scope > .tree-children");
      if (kids && kids.hidden) state.collapsed.add(li.dataset.path);
    });
    persistCollapsed();
  }

  function renderTree(tree) {
    if (!tree?.length) {
      els.tree.innerHTML = `<li class="tree-item"><span class="tree-row">（空目录）</span></li>`;
      return;
    }
    els.tree.innerHTML = tree.map((n) => treeItemHtml(n)).join("");
  }

  function markSelection() {
    els.tree.querySelectorAll(".tree-row.selected, .tree-row.active").forEach((el) => {
      el.classList.remove("selected", "active");
    });
    if (state.selectedPath) {
      const sel = els.tree.querySelector(`.tree-row[data-path="${CSS.escape(state.selectedPath)}"]`);
      if (sel) sel.classList.add("selected");
    }
    if (state.currentPath) {
      const cur = els.tree.querySelector(`.file-row[data-path="${CSS.escape(state.currentPath)}"]`);
      if (cur) cur.classList.add("active");
    }
  }

  async function loadTree(afterRemember) {
    rememberCollapsed();
    if (typeof afterRemember === "function") {
      afterRemember(state.collapsed);
      persistCollapsed();
    }
    const data = await api("/api/tree");
    renderTree(data.tree || []);
    markSelection();
  }

  async function openFile(path) {
    if (state.dirty && state.currentPath) {
      await flushSave();
    }
    const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
    state.currentPath = data.path;
    state.selectedPath = data.path;
    state.selectedType = "file";
    state.isPdf = Boolean(data.is_pdf);
    state.isMarkdown = Boolean(data.is_markdown) && !state.isPdf;
    state.mode = state.isMarkdown ? "preview" : "edit";
    state.dirty = false;
    els.currentPath.textContent = data.path;
    setSaveStatus("");

    if (state.isPdf) {
      state.mode = "preview";
      state.lastContent = "";
      els.editor.value = "";
      markSelection();
      updateView();
      showPdfViewer(data.path);
    } else {
      clearPdfViewer();
      state.lastContent = data.content ?? "";
      els.editor.value = state.lastContent;
      markSelection();
      updateView();
    }
  }

  async function saveCurrent() {
    if (!state.currentPath || state.isPdf) return;
    const content = els.editor.value;
    if (content === state.lastContent && !state.dirty) {
      setSaveStatus("已保存", "saved");
      return;
    }
    setSaveStatus("保存中…", "saving");
    try {
      await api("/api/file", {
        method: "PUT",
        body: JSON.stringify({ path: state.currentPath, content }),
      });
      state.lastContent = content;
      state.dirty = false;
      setSaveStatus("已保存", "saved");
    } catch (err) {
      setSaveStatus("保存失败", "error");
      showStatus(`保存失败: ${err.message}`, "error", 10000);
      throw err;
    }
  }

  function scheduleSave() {
    if (state.isPdf) return;
    state.dirty = true;
    setSaveStatus("未保存", "");
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      saveCurrent().catch(() => {});
    }, 500);
  }

  async function flushSave() {
    if (state.saveTimer) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
    if (state.dirty) {
      await saveCurrent();
    }
  }

  function formatGitResult(data) {
    const lines = [data.message || (data.ok ? "ok" : "failed")];
    for (const step of data.steps || []) {
      const tag = step.skipped ? "skip" : step.returncode === 0 ? "ok" : "err";
      lines.push(`[${tag}] $ ${step.cmd}`);
      if (step.stdout) lines.push(step.stdout);
      if (step.stderr) lines.push(step.stderr);
      if (step.note) lines.push(`(${step.note})`);
    }
    return lines.join("\n");
  }

  async function gitSync() {
    els.btnGitSync.disabled = true;
    showStatus("同步中…", "ok", 0);
    try {
      await flushSave();
      const data = await api("/api/git/sync", { method: "POST", body: "{}" });
      const text = formatGitResult(data);
      showStatus(text, data.ok ? "ok" : "error", data.ok ? 8000 : 0);
      if (data.ok) await loadTree();
    } catch (err) {
      showStatus(`同步失败: ${err.message}`, "error", 0);
    } finally {
      els.btnGitSync.disabled = false;
    }
  }

  async function createDir() {
    const name = window.prompt("新建目录名称：");
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const data = await api("/api/mkdir", {
        method: "POST",
        body: JSON.stringify({ parent: targetParent(), name: trimmed }),
      });
      state.selectedPath = data.path;
      state.selectedType = "dir";
      const parent = targetParent();
      await loadTree((collapsed) => {
        collapsed.delete(parent);
      });
    } catch (err) {
      showStatus(`新建目录失败: ${err.message}`, "error", 8000);
    }
  }

  async function createFile() {
    const name = window.prompt("新建文件名称（可省略 .md）：");
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const data = await api("/api/create-file", {
        method: "POST",
        body: JSON.stringify({ parent: targetParent(), name: trimmed }),
      });
      await loadTree();
      await openFile(data.path);
    } catch (err) {
      showStatus(`新建文件失败: ${err.message}`, "error", 8000);
    }
  }

  async function deleteSelected() {
    if (!state.selectedPath) {
      showStatus("请先选中要删除的文件或目录", "error", 5000);
      return;
    }
    const label = state.selectedType === "dir" ? "目录" : "文件";
    if (!window.confirm(`确认删除${label}：\n${state.selectedPath}\n此操作不可恢复。`)) {
      return;
    }
    const deleted = state.selectedPath;
    try {
      await flushSave();
      await api("/api/delete", {
        method: "POST",
        body: JSON.stringify({ path: deleted }),
      });
      if (
        state.currentPath === deleted ||
        (state.currentPath && state.currentPath.startsWith(deleted + "/"))
      ) {
        clearEditor();
      }
      state.selectedPath = null;
      state.selectedType = null;
      await loadTree();
    } catch (err) {
      showStatus(`删除失败: ${err.message}`, "error", 8000);
    }
  }

  async function postUpload(file, parent, overwrite) {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("parent", parent || "");
    form.append("overwrite", overwrite ? "true" : "false");
    const res = await fetch("/api/upload", { method: "POST", body: form });
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text };
    }
    if (!res.ok) {
      const detail = data?.detail || res.statusText || "request failed";
      const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function triggerUpload() {
    els.fileUploadInput.value = "";
    els.fileUploadInput.click();
  }

  async function handleUploadSelected() {
    const file = els.fileUploadInput.files && els.fileUploadInput.files[0];
    els.fileUploadInput.value = "";
    if (!file) return;
    const parent = targetParent();
    try {
      let data;
      try {
        data = await postUpload(file, parent, false);
      } catch (err) {
        if (err.status === 409) {
          const rel = parent ? `${parent}/${file.name}` : file.name;
          if (!window.confirm(`文件已存在：\n${rel}\n是否覆盖？`)) return;
          data = await postUpload(file, parent, true);
        } else {
          throw err;
        }
      }
      await loadTree((collapsed) => {
        collapsed.delete(parent);
      });
      await openFile(data.path);
      showStatus(`已上传: ${data.path}`, "ok", 4000);
    } catch (err) {
      showStatus(`上传失败: ${err.message}`, "error", 8000);
    }
  }

  async function downloadSelected() {
    if (!state.selectedPath || state.selectedType !== "file") {
      showStatus("请先选中要下载的文件", "error", 5000);
      return;
    }
    try {
      await flushSave();
      const path = state.selectedPath;
      const res = await fetch(`/api/download?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        let detail = res.statusText || "request failed";
        try {
          const data = await res.json();
          if (data?.detail) {
            detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
          }
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = baseName(path);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showStatus(`下载失败: ${err.message}`, "error", 8000);
    }
  }

  function clearDropHighlights() {
    els.tree.querySelectorAll(".tree-row.drag-over").forEach((el) => {
      el.classList.remove("drag-over");
    });
    const wrap = els.tree.closest(".tree-wrap");
    if (wrap) wrap.classList.remove("drag-over-root");
  }

  function clearDragState() {
    clearDropHighlights();
    els.tree.querySelectorAll(".tree-item.is-dragging").forEach((el) => {
      el.classList.remove("is-dragging");
    });
    state.dragPath = null;
    state.dragType = null;
  }

  function isInvalidDropTarget(srcPath, destParent) {
    if (!srcPath) return true;
    if (destParent === srcPath) return true;
    if (destParent && destParent.startsWith(srcPath + "/")) return true;
    if (parentOf(srcPath) === (destParent || "")) return true;
    return false;
  }

  function resolveDropParent(ev) {
    const wrap = els.tree.closest(".tree-wrap");
    if (!wrap || !wrap.contains(ev.target)) return null;

    const row = ev.target.closest(".tree-row");
    if (row && row.dataset.path) {
      const li = row.closest(".tree-item");
      if (!li) return null;
      if (li.dataset.type === "dir") return li.dataset.path;
      return parentOf(li.dataset.path);
    }

    const childUl = ev.target.closest(".tree-children");
    if (childUl) {
      const parentLi = childUl.parentElement?.closest(".tree-item[data-type='dir']");
      if (parentLi?.dataset.path) return parentLi.dataset.path;
    }

    return "";
  }

  async function moveEntry(srcPath, destParent) {
    if (isInvalidDropTarget(srcPath, destParent)) return;
    try {
      await flushSave();
      const data = await api("/api/move", {
        method: "POST",
        body: JSON.stringify({ path: srcPath, dest_parent: destParent || "" }),
      });
      if (data.unchanged) return;

      if (state.selectedPath === srcPath) {
        state.selectedPath = data.path;
        state.selectedType = data.type || state.selectedType;
      } else if (state.selectedPath && state.selectedPath.startsWith(srcPath + "/")) {
        state.selectedPath = data.path + state.selectedPath.slice(srcPath.length);
      }

      if (state.currentPath === srcPath) {
        state.currentPath = data.path;
        els.currentPath.textContent = data.path;
        if (state.isPdf) showPdfViewer(data.path);
      } else if (state.currentPath && state.currentPath.startsWith(srcPath + "/")) {
        state.currentPath = data.path + state.currentPath.slice(srcPath.length);
        els.currentPath.textContent = state.currentPath;
        if (state.isPdf) showPdfViewer(state.currentPath);
      }

      await loadTree((collapsed) => {
        if (collapsed.has(srcPath)) {
          collapsed.delete(srcPath);
          collapsed.add(data.path);
        }
        if (destParent) collapsed.delete(destParent);
      });
      showStatus(`已移动到: ${data.path}`, "ok", 3000);
    } catch (err) {
      showStatus(`移动失败: ${err.message}`, "error", 8000);
    }
  }

  function beginRename(li) {
    if (state.renaming || !li) return;
    const path = li.dataset.path;
    const type = li.dataset.type;
    const row = li.querySelector(":scope > .tree-row");
    const nameEl = row?.querySelector(".tree-name");
    if (!row || !nameEl) return;

    state.renaming = true;
    const oldName = baseName(path);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tree-rename-input";
    input.value = oldName;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = async (commit) => {
      if (finished) return;
      finished = true;
      state.renaming = false;
      const newName = input.value.trim();
      if (!commit || !newName || newName === oldName) {
        await loadTree();
        return;
      }
      try {
        await flushSave();
        const data = await api("/api/rename", {
          method: "POST",
          body: JSON.stringify({ path, new_name: newName }),
        });
        if (state.selectedPath === path) {
          state.selectedPath = data.path;
          state.selectedType = type;
        }
        if (state.currentPath === path) {
          state.currentPath = data.path;
          els.currentPath.textContent = data.path;
          if (state.isPdf) {
            state.isPdf = /\.pdf$/i.test(data.path);
            if (state.isPdf) showPdfViewer(data.path);
            else clearEditor();
          }
        } else if (state.currentPath && state.currentPath.startsWith(path + "/")) {
          state.currentPath = data.path + state.currentPath.slice(path.length);
          els.currentPath.textContent = state.currentPath;
        }
        await loadTree((collapsed) => {
          if (collapsed.has(path)) {
            collapsed.delete(path);
            collapsed.add(data.path);
          }
        });
      } catch (err) {
        showStatus(`重命名失败: ${err.message}`, "error", 8000);
        await loadTree();
      }
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  els.tree.addEventListener("click", (ev) => {
    if (state.suppressTreeClick) {
      state.suppressTreeClick = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (state.renaming) return;
    if (ev.target.closest(".tree-rename-input")) return;
    const btn = ev.target.closest(".tree-row");
    if (!btn || !btn.dataset.path) return;
    const li = btn.closest(".tree-item");
    if (!li) return;
    const type = li.dataset.type;
    const path = btn.dataset.path;

    state.selectedPath = path;
    state.selectedType = type;
    markSelection();

    if (type === "dir") {
      const kids = li.querySelector(":scope > .tree-children");
      const toggle = btn.querySelector(".tree-toggle");
      if (!kids) return;
      const willCollapse = !kids.hidden;
      kids.hidden = willCollapse;
      if (willCollapse) state.collapsed.add(path);
      else state.collapsed.delete(path);
      persistCollapsed();
      if (toggle) toggle.textContent = kids.hidden ? "▸" : "▾";
      return;
    }
    openFile(path).catch((err) => {
      showStatus(`打开失败: ${err.message}`, "error", 8000);
    });
  });

  els.tree.addEventListener("dblclick", (ev) => {
    const nameEl = ev.target.closest(".tree-name");
    if (!nameEl) return;
    ev.preventDefault();
    ev.stopPropagation();
    const li = nameEl.closest(".tree-item");
    beginRename(li);
  });

  els.tree.addEventListener("dragstart", (ev) => {
    if (state.renaming) {
      ev.preventDefault();
      return;
    }
    const row = ev.target.closest(".tree-row");
    const li = row?.closest(".tree-item");
    if (!li || !li.dataset.path) {
      ev.preventDefault();
      return;
    }
    ev.stopPropagation();
    state.dragPath = li.dataset.path;
    state.dragType = li.dataset.type;
    state.treeDragActive = true;
    li.classList.add("is-dragging");
    ev.dataTransfer.effectAllowed = "move";
    try {
      ev.dataTransfer.setData("text/plain", li.dataset.path);
    } catch {
      /* some browsers restrict setData outside dragstart */
    }
  });

  els.tree.addEventListener("dragend", () => {
    const wasDragging = state.treeDragActive;
    state.treeDragActive = false;
    clearDragState();
    // Consume the synthetic click that some browsers fire after drag.
    if (wasDragging) {
      state.suppressTreeClick = true;
      setTimeout(() => {
        state.suppressTreeClick = false;
      }, 50);
    }
  });

  function onTreeDragOver(ev) {
    if (!state.dragPath) return;
    const destParent = resolveDropParent(ev);
    if (destParent === null) return;
    if (isInvalidDropTarget(state.dragPath, destParent)) {
      clearDropHighlights();
      return;
    }
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    clearDropHighlights();
    const wrap = els.tree.closest(".tree-wrap");
    if (destParent === "") {
      if (wrap) wrap.classList.add("drag-over-root");
      return;
    }
    const row = els.tree.querySelector(
      `.tree-item[data-type="dir"][data-path="${CSS.escape(destParent)}"] > .tree-row`
    );
    if (row) row.classList.add("drag-over");
  }

  function onTreeDrop(ev) {
    if (!state.dragPath) return;
    const srcPath = state.dragPath;
    const destParent = resolveDropParent(ev);
    if (destParent === null || isInvalidDropTarget(srcPath, destParent)) {
      clearDragState();
      return;
    }
    ev.preventDefault();
    clearDragState();
    moveEntry(srcPath, destParent);
  }

  els.tree.addEventListener("dragover", onTreeDragOver);
  els.tree.addEventListener("drop", onTreeDrop);

  const treeWrap = els.tree.closest(".tree-wrap");
  if (treeWrap) {
    treeWrap.addEventListener("dragover", onTreeDragOver);
    treeWrap.addEventListener("drop", onTreeDrop);
    treeWrap.addEventListener("dragleave", (ev) => {
      if (!treeWrap.contains(ev.relatedTarget)) clearDropHighlights();
    });
  }

  els.editor.addEventListener("input", () => {
    scheduleSave();
    if (state.isMarkdown && state.mode === "preview") {
      renderMarkdown(els.editor.value);
    }
  });

  els.tabPreview.addEventListener("click", () => setMode("preview"));
  els.tabEdit.addEventListener("click", () => setMode("edit"));

  const SIDEBAR_W_KEY = "notes-browser-sidebar-w";
  const SIDEBAR_MIN = 180;
  const SIDEBAR_MAX_RATIO = 0.6;

  function clampSidebarWidth(px) {
    const max = Math.max(SIDEBAR_MIN, Math.floor(window.innerWidth * SIDEBAR_MAX_RATIO));
    return Math.min(max, Math.max(SIDEBAR_MIN, Math.round(px)));
  }

  function applySidebarWidth(px) {
    const w = clampSidebarWidth(px);
    document.documentElement.style.setProperty("--sidebar-w", `${w}px`);
    els.sidebar.style.width = `${w}px`;
    return w;
  }

  function initSidebarResize() {
    const saved = Number(localStorage.getItem(SIDEBAR_W_KEY));
    if (Number.isFinite(saved) && saved > 0) {
      applySidebarWidth(saved);
    }

    let dragging = false;

    const onMove = (ev) => {
      if (!dragging) return;
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const w = applySidebarWidth(x);
      localStorage.setItem(SIDEBAR_W_KEY, String(w));
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("is-resizing-sidebar");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    els.sidebarResizer.addEventListener("pointerdown", (ev) => {
      if (els.sidebar.classList.contains("collapsed")) return;
      ev.preventDefault();
      dragging = true;
      document.body.classList.add("is-resizing-sidebar");
      try {
        els.sidebarResizer.setPointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    window.addEventListener("resize", () => {
      const current = els.sidebar.getBoundingClientRect().width;
      if (current > 0) applySidebarWidth(current);
    });
  }

  els.btnCollapse.addEventListener("click", () => {
    els.sidebar.classList.add("collapsed");
    els.btnReopen.hidden = false;
  });
  els.btnReopen.addEventListener("click", () => {
    els.sidebar.classList.remove("collapsed");
    els.btnReopen.hidden = true;
  });

  els.btnNewDir.addEventListener("click", () => {
    createDir();
  });
  els.btnNewFile.addEventListener("click", () => {
    createFile();
  });
  els.btnDelete.addEventListener("click", () => {
    deleteSelected();
  });
  els.btnUpload.addEventListener("click", () => {
    triggerUpload();
  });
  els.fileUploadInput.addEventListener("change", () => {
    handleUploadSelected();
  });
  els.btnDownload.addEventListener("click", () => {
    downloadSelected();
  });

  function setExtMenuOpen(open) {
    if (open) {
      els.extMenu.hidden = false;
      els.extMenu.removeAttribute("hidden");
    } else {
      els.extMenu.hidden = true;
      els.extMenu.setAttribute("hidden", "");
    }
    els.btnExt.setAttribute("aria-expanded", String(open));
    els.extChevron.textContent = open ? "<<" : ">>";
  }

  els.btnExt.addEventListener("click", () => {
    const willOpen = els.extMenu.hasAttribute("hidden") || els.extMenu.hidden;
    setExtMenuOpen(willOpen);
  });

  els.btnGitSync.addEventListener("click", () => {
    gitSync();
  });
  els.statusClose.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    hideStatus();
  });

  window.addEventListener("keydown", (ev) => {
    if (state.renaming) return;
    if (ev.key === "F2" && state.selectedPath) {
      ev.preventDefault();
      const li = els.tree.querySelector(`.tree-item[data-path="${CSS.escape(state.selectedPath)}"]`);
      beginRename(li);
    }
  });

  window.addEventListener("beforeunload", (ev) => {
    if (state.dirty) {
      ev.preventDefault();
      ev.returnValue = "";
    }
  });

  async function init() {
    hideStatus();
    setExtMenuOpen(false);
    initSidebarResize();
    loadCollapsedFromStorage();
    try {
      const cfg = await api("/api/config");
      els.notesDirLabel.textContent = cfg.notes_dir || "";
      await loadTree();
    } catch (err) {
      showStatus(`初始化失败: ${err.message}`, "error", 0);
    }
  }

  init();
})();
