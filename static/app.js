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
    editor: document.getElementById("editor"),
    statusBar: document.getElementById("status-bar"),
    statusText: document.getElementById("status-text"),
    statusClose: document.getElementById("status-close"),
  };

  const state = {
    currentPath: null,
    selectedPath: null,
    selectedType: null,
    isMarkdown: false,
    mode: "preview",
    dirty: false,
    saveTimer: null,
    statusTimer: null,
    lastContent: "",
    renaming: false,
    collapsed: new Set(),
  };

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

  function clearEditor() {
    state.currentPath = null;
    state.isMarkdown = false;
    state.dirty = false;
    state.lastContent = "";
    els.editor.value = "";
    els.currentPath.textContent = "未选择文件";
    setSaveStatus("");
    updateView();
  }

  function updateView() {
    const hasFile = Boolean(state.currentPath);
    els.placeholder.hidden = hasFile;
    els.modeTabs.hidden = !hasFile || !state.isMarkdown;

    if (!hasFile) {
      els.preview.hidden = true;
      els.editor.hidden = true;
      return;
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
          <button type="button" class="tree-row dir-row${selected}${active}" data-path="${escapeAttr(node.path)}">
            <span class="tree-toggle">${collapsed ? "▸" : "▾"}</span>
            <span class="tree-icon dir">D</span>
            <span class="tree-name">${escapeHtml(node.name)}</span>
          </button>
          <ul class="tree-children"${collapsed ? " hidden" : ""}>${kids}</ul>
        </li>`;
    }
    return `
      <li class="tree-item" data-path="${escapeAttr(node.path)}" data-type="file">
        <button type="button" class="tree-row file-row${selected}${active}" data-path="${escapeAttr(node.path)}">
          <span class="tree-toggle"></span>
          <span class="tree-icon file">F</span>
          <span class="tree-name">${escapeHtml(node.name)}</span>
        </button>
      </li>`;
  }

  function rememberCollapsed() {
    state.collapsed.clear();
    els.tree.querySelectorAll(".tree-item[data-type='dir']").forEach((li) => {
      const kids = li.querySelector(":scope > .tree-children");
      if (kids && kids.hidden) state.collapsed.add(li.dataset.path);
    });
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

  async function loadTree() {
    rememberCollapsed();
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
    state.isMarkdown = Boolean(data.is_markdown);
    state.mode = state.isMarkdown ? "preview" : "edit";
    state.lastContent = data.content ?? "";
    state.dirty = false;
    els.editor.value = state.lastContent;
    els.currentPath.textContent = data.path;
    setSaveStatus("");
    markSelection();
    updateView();
  }

  async function saveCurrent() {
    if (!state.currentPath) return;
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
      state.collapsed.delete(targetParent());
      await loadTree();
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
        } else if (state.currentPath && state.currentPath.startsWith(path + "/")) {
          state.currentPath = data.path + state.currentPath.slice(path.length);
          els.currentPath.textContent = state.currentPath;
        }
        if (state.collapsed.has(path)) {
          state.collapsed.delete(path);
          state.collapsed.add(data.path);
        }
        await loadTree();
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
