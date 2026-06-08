(() => {
  const ownerTokenKey = window.__OWNER_TOKEN_KEY__ || "md_owner_token";
  const app = document.getElementById("app");
  const page = document.body.dataset.page;
  const noteId = document.body.dataset.noteId || "";
  const shareId = document.body.dataset.shareId || "";

  if (!app || !page) {
    return;
  }

  const isMobileDevice = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && "ontouchstart" in window && navigator.maxTouchPoints > 1);

  const themeIcon = window.__themeIcon || ((t) => t === "dark" ? "☀" : "☾");

  let mermaidIdCounter = 0;
  let mermaidCache = [];
  const svgBtn = (action, d) => `<button type="button" data-action="${action}"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg></button>`;
  const mermaidToolbarHtml = ''
    + '<span></span>' + svgBtn('up', '<path d="M4 10l4-4 4 4"/>') + svgBtn('zoom-in', '<circle cx="8" cy="8" r="5.5"/><path d="M8 5.5v5M5.5 8h5"/>')
    + svgBtn('left', '<path d="M10 4l-4 4 4 4"/>') + svgBtn('reset', '<path d="M3.5 3v4h4"/><path d="M3.5 7a5.5 5.5 0 1 1 1 3.5"/>') + svgBtn('right', '<path d="M6 4l4 4-4 4"/>')
    + '<span></span>' + svgBtn('down', '<path d="M4 6l4 4 4-4"/>') + svgBtn('zoom-out', '<circle cx="8" cy="8" r="5.5"/><path d="M5.5 8h5"/>');

  async function renderMermaid(container) {
    const m = window.__mermaid;
    if (!m || !container) return;
    const freshNodes = Array.from(container.querySelectorAll("pre.mermaid")).filter((node) => node.textContent.trim());

    // Reuse cached wrappers for unchanged diagrams, preserving pan/zoom state
    const newCache = [];
    const toRender = [];
    freshNodes.forEach((node, i) => {
      const src = node.textContent;
      if (mermaidCache[i] && mermaidCache[i].src === src) {
        node.replaceWith(mermaidCache[i].wrap);
        newCache[i] = mermaidCache[i];
      } else {
        node.setAttribute("data-original-code", src);
        node.removeAttribute("data-processed");
        node.id = "mermaid-" + (mermaidIdCounter++) + "-" + i;
        toRender.push({ node, index: i });
      }
    });

    if (toRender.length > 0) {
      const nodes = toRender.map((t) => t.node);
      try { await m.run({ nodes, suppressErrors: true }); } catch {}
      toRender.forEach(({ node, index }) => {
        const wrap = document.createElement("div");
        wrap.className = "mermaid-wrap";
        const viewport = document.createElement("div");
        viewport.className = "mermaid-viewport";
        node.replaceWith(wrap);
        viewport.appendChild(node);
        wrap.appendChild(viewport);
        const bar = document.createElement("div");
        bar.className = "mermaid-toolbar";
        bar.innerHTML = mermaidToolbarHtml;
        wrap.appendChild(bar);
        let scale = 1, tx = 0, ty = 0;
        const step = 50;
        function applyTransform() { node.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; }
        bar.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-action]");
          if (!btn) return;
          const action = btn.dataset.action;
          if (action === "zoom-in") { scale = Math.min(4, scale + 0.25); }
          else if (action === "zoom-out") { scale = Math.max(0.25, scale - 0.25); }
          else if (action === "up") { ty += step; }
          else if (action === "down") { ty -= step; }
          else if (action === "left") { tx += step; }
          else if (action === "right") { tx -= step; }
          else if (action === "reset") { scale = 1; tx = 0; ty = 0; }
          applyTransform();
        });
        newCache[index] = { src: node.getAttribute("data-original-code"), wrap };
      });
    }
    mermaidCache = newCache;
  }
  window.__renderMermaid = renderMermaid;
  window.__clearMermaidCache = () => { mermaidCache = []; };

  function setPreviewHtml(refs, html) {
    if (!refs.previewContent) return;
    refs.previewContent.innerHTML = html + (state.relatedHtml || "");
    renderMermaid(refs.previewContent);
  }

  const shareAccess = document.body.dataset.shareAccess || "";
  const ACTION_ICON_MAP = { reply: "reply", "edit-message": "edit", "delete-message": "trash", "delete-thread": "trash" };

  const state = {
    page,
    noteId,
    shareId,
    shareAccess,
    note: null,
    viewer: null,
    threads: [],
    activeThreadId: null,
    visibleMatches: new Map(),
    pendingAnchor: null,
    saveTimer: null,
    renderTimer: null,
    searchTimer: null,
    layoutFrame: 0,
    saveStatus: "Saved",
    showResolved: false,
    showComments: true,
    modalOpen: false,
  };

  if (page === "list") {
    initListPage();
    return;
  }

  if (page === "editor") {
    initNotePage(false);
    return;
  }

  if (page === "public") {
    initNotePage(true);
  }

  function initListPage() {
    app.innerHTML = `
      <div class="app-root">
        <header class="topbar">
          <div class="topbar-left">
            <div class="topbar-title">notes</div>
          </div>
          <div class="topbar-right">
            <button type="button" class="jot-btn-icon jot-btn-icon--md" id="viewToggleButton" aria-label="Switch to grid view" title="Switch to grid view"></button>
            <jot-icon-button icon="plus" label="New note" id="newNoteButton"></jot-icon-button>
            <jot-icon-button icon="settings" label="Settings" id="settingsButton"></jot-icon-button>
            <jot-icon-button icon="logout" label="Logout" id="logoutButton"></jot-icon-button>
            <button type="button" class="jot-btn-icon jot-btn-icon--md theme-toggle" aria-label="Toggle theme">${themeIcon(document.documentElement.getAttribute("data-theme") || "dark")}</button>
          </div>
        </header>
        <main class="list-page">
          <div class="list-search-wrap">
            <input class="list-search" id="searchInput" type="text" placeholder="Search notes" autocomplete="off" />
          </div>
          <div class="note-list" id="noteList"></div>
        </main>
        <div class="modal-backdrop hidden" id="listModalBackdrop"></div>
      </div>
    `;

    const searchInput = document.getElementById("searchInput");
    const noteList = document.getElementById("noteList");
    const newNoteButton = document.getElementById("newNoteButton");
    const settingsButton = document.getElementById("settingsButton");
    const logoutButton = document.getElementById("logoutButton");
    const listModalBackdrop = document.getElementById("listModalBackdrop");

    const viewToggleButton = document.getElementById("viewToggleButton");
    function applyHomeView(view) {
      const isGrid = view === "grid";
      noteList.classList.toggle("is-grid", isGrid);
      const next = isGrid ? "list" : "grid";
      viewToggleButton.innerHTML = (window.__ICONS__ && window.__ICONS__[next]) || "";
      const label = `Switch to ${next} view`;
      viewToggleButton.setAttribute("aria-label", label);
      viewToggleButton.title = label;
    }
    let homeView = localStorage.getItem("jot.home.view") === "grid" ? "grid" : "list";
    applyHomeView(homeView);
    viewToggleButton.addEventListener("click", () => {
      homeView = homeView === "grid" ? "list" : "grid";
      localStorage.setItem("jot.home.view", homeView);
      applyHomeView(homeView);
    });

    newNoteButton.addEventListener("click", async () => {
      const payload = await api("/api/notes", { method: "POST" });
      prepareFreshNoteOpen();
      window.location.href = `/notes/${payload.note.id}`;
    });

    logoutButton.addEventListener("click", logoutOwner);
    settingsButton.addEventListener("click", () => openSettingsModal());

    searchInput.addEventListener("input", () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        loadNotes(searchInput.value);
      }, 160);
    });

    noteList.addEventListener("click", async (event) => {
      const deleteBtn = event.target.closest(".note-delete-btn") || event.target.closest("jot-icon-button.note-delete-btn");
      if (deleteBtn) {
        event.stopPropagation();
        const id = deleteBtn.dataset.noteId;
        if (!id || !confirm("Delete this note?")) return;
        await api(`/api/notes/${id}`, { method: "DELETE" });
        loadNotes(searchInput.value);
        return;
      }
      const row = event.target.closest("[data-note-id]");
      if (!row) return;
      window.location.href = `/notes/${row.dataset.noteId}`;
    });

    loadNotes("");

    function openSettingsModal() {
      listModalBackdrop.classList.remove("hidden");
      listModalBackdrop.innerHTML = `
        <div class="modal settings-modal" role="dialog" aria-modal="true">
          <div class="settings-header">
            <h2 class="settings-title">Settings</h2>
            <jot-icon-button icon="close" label="Close" id="settingsClose"></jot-icon-button>
          </div>
          <div class="settings-section">
            <div class="settings-section-header">
              <h3 class="settings-section-title">Preferences</h3>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" id="autoOpenToggle" />
              <span>Auto-open new notes as they appear</span>
            </label>
          </div>
          <div class="settings-section">
            <div class="settings-section-header">
              <h3 class="settings-section-title">API Keys</h3>
              <jot-button variant="ghost" size="sm" id="createKeyButton">+ new key</jot-button>
            </div>
            <div id="apiKeysList"></div>
          </div>
        </div>
      `;

      const autoOpenToggle = document.getElementById("autoOpenToggle");
      if (autoOpenToggle) {
        autoOpenToggle.checked = localStorage.getItem("jot.autoOpenNewNotes") === "1";
        autoOpenToggle.addEventListener("change", () => {
          localStorage.setItem("jot.autoOpenNewNotes", autoOpenToggle.checked ? "1" : "0");
        });
      }

      const apiKeysList = document.getElementById("apiKeysList");
      const createKeyButton = document.getElementById("createKeyButton");

      function closeSettings() {
        listModalBackdrop.classList.add("hidden");
        listModalBackdrop.innerHTML = "";
      }

      document.getElementById("settingsClose").addEventListener("click", closeSettings);
      listModalBackdrop.addEventListener("click", (e) => { if (e.target === listModalBackdrop) closeSettings(); });

      createKeyButton.addEventListener("click", async () => {
        const label = prompt("Label for this API key:");
        if (!label) return;
        const result = await api("/api/keys", { method: "POST", body: { label } });
        await renderKeys();
        showNewKey(result.id, result.key);
      });

      apiKeysList.addEventListener("click", async (event) => {
        const copyBtn = event.target.closest("[data-copy-key]") || event.target.closest("jot-icon-button[data-copy-key]");
        if (copyBtn) {
          try {
            await navigator.clipboard.writeText(copyBtn.dataset.copyKey);
            copyBtn.classList.add("copy-success");
            setTimeout(() => copyBtn.classList.remove("copy-success"), 1200);
          } catch {}
          return;
        }
        const deleteBtn = event.target.closest("[data-delete-key]") || event.target.closest("jot-icon-button[data-delete-key]");
        if (!deleteBtn) return;
        if (!confirm("Delete this API key?")) return;
        await api(`/api/keys/${deleteBtn.dataset.deleteKey}`, { method: "DELETE" });
        renderKeys();
      });

      async function renderKeys() {
        const response = await api("/api/keys");
        apiKeysList.innerHTML = response.keys.length
          ? response.keys.map((key) => `
              <div class="api-key-row" data-key-id="${escapeHtml(key.id)}">
                <div class="api-key-info">
                  <span class="api-key-label">${escapeHtml(key.label)}</span>
                  <span class="api-key-meta">${escapeHtml(formatDate(key.createdAt))}</span>
                </div>
                <jot-icon-button icon="trash" label="Delete key" data-delete-key="${escapeHtml(key.id)}" size="sm" danger></jot-icon-button>
              </div>
            `).join("")
          : '<div class="api-keys-empty">No API keys yet.</div>';
      }

      function showNewKey(keyId, key) {
        const row = apiKeysList.querySelector(`[data-key-id="${keyId}"]`);
        if (!row) return;
        const existing = row.querySelector(".api-key-secret");
        if (existing) existing.remove();
        const secret = document.createElement("div");
        secret.className = "api-key-secret";
        secret.innerHTML = `<code>${escapeHtml(key)}</code><jot-icon-button icon="copy" label="Copy key" data-copy-key="${escapeHtml(key)}" size="sm"></jot-icon-button>`;
        const deleteBtn = row.querySelector(".icon-action[data-delete-key]");
        row.insertBefore(secret, deleteBtn);
      }

      renderKeys();
    }

    function renderNoteRowHtml(note) {
      return `
        <div class="note-row" data-note-id="${escapeHtml(note.id)}">
          <div class="note-row-content">
            <div class="note-row-title">${escapeHtml(note.title || "untitled")}</div>
            <div class="note-row-snippet">${escapeHtml(note.snippet || "Empty note")}</div>
            <div class="note-row-meta">${escapeHtml(formatDate(note.updatedAt))}</div>
          </div>
          <jot-icon-button icon="trash" label="Delete note" class="note-delete-btn" data-note-id="${escapeHtml(note.id)}" danger></jot-icon-button>
        </div>
      `;
    }

    async function loadNotes(query) {
      const response = await api(`/api/notes?q=${encodeURIComponent(query)}`);
      const hasNotes = response.notes.length > 0;
      const hasQuery = query.trim().length > 0;

      document.querySelector(".list-search-wrap").style.display = (hasNotes || hasQuery) ? "" : "none";

      if (!hasNotes && !hasQuery) {
        noteList.innerHTML = `<div class="empty-state-create"><p class="empty-state-text">No notes yet.</p><jot-button variant="primary" id="emptyCreateBtn">Create note</jot-button></div>`;
        document.getElementById("emptyCreateBtn").addEventListener("click", async () => {
          const payload = await api("/api/notes", { method: "POST" });
          prepareFreshNoteOpen();
          window.location.href = `/notes/${payload.note.id}`;
        });
        return;
      }

      noteList.innerHTML = hasNotes
        ? response.notes.map(renderNoteRowHtml).join("")
        : `<div class="empty-state">No notes match your search.</div>`;
    }

    connectGlobalWebSocket((msg) => {
      if (msg.type === "note-created" && msg.note) {
        const existing = noteList.querySelector(`[data-note-id="${CSS.escape(msg.note.id)}"]`);
        if (existing) return;
        const empty = noteList.querySelector(".empty-state, .empty-state-create");
        if (empty) {
          loadNotes(searchInput.value);
          return;
        }
        const wrap = document.createElement("div");
        wrap.innerHTML = renderNoteRowHtml(msg.note).trim();
        const row = wrap.firstElementChild;
        row.classList.add("note-row--entering");
        noteList.prepend(row);
        requestAnimationFrame(() => row.classList.remove("note-row--entering"));
        if (localStorage.getItem("jot.autoOpenNewNotes") === "1" && !isUserTyping()) {
          setTimeout(() => {
            prepareFreshNoteOpen();
            window.location.href = `/notes/${msg.note.id}`;
          }, 400);
        } else {
          queueNewNoteToast(msg.note);
        }
      } else if (msg.type === "note-meta-updated" && msg.note) {
        updatePendingNewNoteToast(msg.note);
        const row = noteList.querySelector(`[data-note-id="${CSS.escape(msg.note.id)}"]`);
        if (!row) return;
        const title = row.querySelector(".note-row-title");
        const snippet = row.querySelector(".note-row-snippet");
        const meta = row.querySelector(".note-row-meta");
        if (title) title.textContent = msg.note.title || "untitled";
        if (snippet) snippet.textContent = msg.note.snippet || "Empty note";
        if (meta) meta.textContent = formatDate(msg.note.updatedAt);
      } else if (msg.type === "note-deleted" && msg.id) {
        const row = noteList.querySelector(`[data-note-id="${CSS.escape(msg.id)}"]`);
        if (!row) return;
        row.classList.add("note-row--leaving");
        setTimeout(() => row.remove(), 280);
      } else if (msg.type === "revision-created" && msg.revision) {
        const author = msg.revision.author_name || "someone";
        const title = msg.revision.title || "untitled";
        showToast(`${author} saved a revision in '${title}'`, {
          onClick: () => { window.location.href = `/notes/${msg.noteId}`; },
          duration: 5000,
        });
      }
    });
  }

  function initNotePage(isPublic) {
    const isPublicEdit = isPublic && shareAccess === "edit";
    const isPublicView = isPublic && shareAccess === "view";
    app.innerHTML = isPublicEdit ? renderPublicEditorLayout() : isPublic ? renderPublicLayout(isPublicView) : renderEditorLayout();

    const previewScroll = document.getElementById("previewScroll");
    const previewCanvas = document.getElementById("previewCanvas");
    const previewContent = document.getElementById("previewContent");
    const threadRail = document.getElementById("threadRail");
    const highlightLayer = document.getElementById("highlightLayer");
    const selectionBubble = document.getElementById("selectionBubble");
    const modalBackdrop = document.getElementById("modalBackdrop");
    const topbarTitle = document.getElementById("topbarTitle");
    const titleInput = document.getElementById("titleInput");
    const editorTextarea = document.getElementById("editorTextarea");
    const notesButton = document.getElementById("notesButton");
    const newNoteButton = document.getElementById("newNoteButton");
    const resolvedButton = document.getElementById("resolvedButton");
    const commentsButton = document.getElementById("commentsButton");
    const logoutButton = document.getElementById("logoutButton");
    const saveStatus = document.getElementById("saveStatus");
    const commenterLabel = document.getElementById("commenterLabel");
    const commentFab = document.getElementById("commentFab");
    const previewFab = document.getElementById("previewFab");
    const previewCloseButton = document.getElementById("previewCloseButton");

    const refs = {
      previewScroll,
      previewCanvas,
      previewContent,
      threadRail,
      highlightLayer,
      selectionBubble,
      modalBackdrop,
      topbarTitle,
      titleInput,
      editorTextarea,
      notesButton,
      newNoteButton,
      resolvedButton,
      commentsButton,
      logoutButton,
      saveStatus,
      commenterLabel,
      commentFab,
      previewFab,
      previewCloseButton,
    };

    if (notesButton) {
      notesButton.addEventListener("click", () => {
        window.location.href = "/";
      });
    }

    if (newNoteButton) {
      newNoteButton.addEventListener("click", async () => {
        const payload = await api("/api/notes", { method: "POST" });
        prepareFreshNoteOpen();
        window.location.href = `/notes/${payload.note.id}`;
      });
    }

    const shareAccessSelect = document.getElementById("shareAccessSelect");
    if (shareAccessSelect) {
      shareAccessSelect.addEventListener("change", async () => {
        if (!state.note) return;
        const val = shareAccessSelect.value;
        state.note.shareAccess = val;
        updateShareInline();
        try {
          await api(`/api/notes/${state.note.id}`, { method: "PUT", body: { shareAccess: val } });
        } catch {
          /* keep optimistic UI; a reload/WS event will reconcile */
        }
      });
    }
    const shareCopyBtn = document.getElementById("shareCopyBtn");
    if (shareCopyBtn) {
      shareCopyBtn.addEventListener("click", async () => {
        if (!state.note || (state.note.shareAccess || "none") === "none") return;
        try {
          await navigator.clipboard.writeText(`${location.origin}/s/${state.note.shareId || ""}`);
          flashCopyIcon(shareCopyBtn);
        } catch {}
      });
    }

    const saveButton = document.getElementById("saveButton");
    if (saveButton) {
      saveButton.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSavePopover(refs);
      });
    }

if (resolvedButton) {
      resolvedButton.addEventListener("click", () => {
        state.showResolved = !state.showResolved;
        updateResolvedButton(resolvedButton);
        syncThreadLayout(refs);
      });
    }

    if (commentsButton) {
      commentsButton.addEventListener("click", () => {
        state.showComments = !state.showComments;
        updateCommentsButton(commentsButton);
        updateResolvedButton(resolvedButton);
        syncThreadLayout(refs);
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener("click", logoutOwner);
    }

    let collabEditor = null;

    function initCollabEditor() {
      if (!editorTextarea) return;
      import("/static/collab-editor.js").then(({ createCollabEditor }) => {
        collabEditor = createCollabEditor(editorTextarea, {
          noteId: isPublic ? undefined : noteId,
          shareId: isPublic ? shareId : undefined,
          name: isPublic ? (state.viewer?.commenterName || "Anonymous") : "Owner",
          onReady: (payload) => {
            state.note = {
              ...(state.note || {}),
              id: payload.noteId,
              title: payload.title,
              shareId: payload.shareId,
              markdown: payload.markdown,
            };
            if (refs.titleInput && document.activeElement !== refs.titleInput) {
              refs.titleInput.value = payload.title;
            }
            if (refs.topbarTitle) refs.topbarTitle.textContent = payload.title || "untitled";
            scheduleRender(refs);
          },
          onTextChange: (text) => {
            if (!state.note) {
              state.note = { id: noteId || "", title: "untitled", shareId: shareId || "", markdown: text };
            } else {
              state.note.markdown = text;
            }
            scheduleRender(refs);
          },
          onConnectionChange: (connected) => {
            setSaveStatus(refs, connected ? "" : "Disconnected");
            const banner = document.getElementById("disconnectedBanner");
            if (banner) banner.classList.toggle("hidden", connected);
          },
          onThreadsUpdated: () => {
            reloadThreads(isPublic);
          },
        });
      });
    }

    if (editorTextarea && !isPublic) {
      initCollabEditor();
    }

    if (titleInput) {
      let titleSaveTimer = null;
      titleInput.addEventListener("input", () => {
        if (!state.note) {
          return;
        }
        state.note.title = titleInput.value;
        clearTimeout(titleSaveTimer);
        titleSaveTimer = setTimeout(async () => {
          await api(`/api/notes/${noteId}`, {
            method: "PUT",
            body: { title: titleInput.value },
          });
        }, 500);
      });
    }

    if (selectionBubble) {
      selectionBubble.addEventListener("click", () => {
        if (!state.pendingAnchor) {
          return;
        }
        const anchor = state.pendingAnchor;
        window.getSelection()?.removeAllRanges();
        selectionBubble.classList.add("hidden");
        openComposerModal({
          mode: "thread",
          anchor,
          refs,
        });
      });
    }

    if (previewScroll) previewScroll.addEventListener("scroll", () => scheduleLayout(refs));
    window.addEventListener("resize", () => scheduleLayout(refs));

    document.addEventListener("selectionchange", () => {
      if (state.page === "list" || state.modalOpen) {
        return;
      }
      updateSelectionBubble(refs);
      updateCommentFab(refs);
    });

    if (previewFab) {
      previewFab.addEventListener("click", () => {
        const stage = document.getElementById("previewStage");
        if (stage) {
          stage.classList.add("preview-open");
          previewFab.style.display = "none";
        }
      });
    }

    // Zen mode: hide the raw-markdown pane, let the rendered preview fill the viewport.
    const zenButton = document.getElementById("zenButton");
    const workspace = document.querySelector(".workspace");
    function applyZen(on) {
      if (!workspace) return;
      workspace.classList.toggle("workspace--zen", !!on);
      if (zenButton) {
        const inner = zenButton.querySelector("button");
        if (inner) {
          inner.innerHTML = (window.__ICONS__ || {})[on ? "zenOff" : "zen"] || inner.innerHTML;
          inner.setAttribute("aria-label", on ? "Exit Zen mode" : "Zen mode (hide raw)");
          inner.title = on ? "Exit Zen mode" : "Zen mode (hide raw)";
        }
      }
    }
    applyZen(localStorage.getItem("jot.zenMode") === "1");
    if (zenButton) {
      zenButton.addEventListener("click", () => {
        const next = !(localStorage.getItem("jot.zenMode") === "1");
        localStorage.setItem("jot.zenMode", next ? "1" : "0");
        applyZen(next);
      });
    }

    // ---- Files panel (left slide-out) ----
    // Lists every note for in-place navigation without going back to /. Click
    // a row → window.location.href to that note. Owner-only (the API is gated).
    const filesPanel = document.getElementById("filesPanel");
    const filesList = document.getElementById("filesList");
    const filesSearchInput = document.getElementById("filesSearchInput");
    const filesPanelButton = document.getElementById("filesPanelButton");
    const filesCloseButton = document.getElementById("filesCloseButton");

    const filesPanelApi = (function setupFilesPanel() {
      if (!filesPanel || !filesList || !workspace || isPublic) {
        return { onCrossNoteEvent() {} };
      }

      let notesCache = [];
      let loaded = false;
      let inflight = null;
      let searchTimer = null;
      let lastQuery = "";

      function applyOpen(open) {
        workspace.classList.toggle("workspace--with-files", !!open);
      }

      // Collapsed-folder state persists across reloads. Stored as a set of
      // slugs that are currently collapsed (so brand-new folders default open).
      const COLLAPSE_KEY = "jot.folders.collapsed";
      function loadCollapsed() {
        try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); }
        catch { return new Set(); }
      }
      function saveCollapsed(set) {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(set)));
      }
      let collapsed = loadCollapsed();

      // Empty folders have no notes to anchor them, so we remember them here
      // (browser-only, like collapse state). The moment a note is filed into
      // one it becomes a real folder and is pruned from this set on render.
      const EMPTY_KEY = "jot.folders.empty";
      function loadEmptyFolders() {
        try { return new Set(JSON.parse(localStorage.getItem(EMPTY_KEY) || "[]")); }
        catch { return new Set(); }
      }
      function saveEmptyFolders(set) {
        localStorage.setItem(EMPTY_KEY, JSON.stringify(Array.from(set)));
      }
      let emptyFolders = loadEmptyFolders();

      // Mirror of the server's normalizeProject (src/server.ts) so a slug typed
      // in the browser collapses identically to one the server would store.
      function normalizeProjectSlug(value) {
        if (typeof value !== "string") return "";
        return value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9\-_/\s]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^[-/]+|[-/]+$/g, "")
          .slice(0, 60);
      }

      function renderRow(n) {
        const isCurrent = n.id === noteId;
        return `
          <button type="button" class="file-row${isCurrent ? " file-row--current" : ""}" draggable="true" data-note-id="${escapeHtml(n.id)}" data-project="${escapeHtml(n.project || "")}">
            <span class="file-row-title">${escapeHtml(n.title || "untitled")}</span>
            <span class="file-row-snippet">${escapeHtml(n.snippet || "Empty note")}</span>
            <span class="file-row-meta">${escapeHtml(formatRelativeTime(n.updatedAt))}</span>
          </button>
        `;
      }

      function renderFolder(slug, rows, forceOpen) {
        const isCollapsed = !forceOpen && collapsed.has(slug);
        const caret = isCollapsed ? "▸" : "▾";
        const isEmpty = rows.length === 0;
        const renameBtn = slug
          ? `<span class="folder-action" data-folder-action="rename" data-slug="${escapeHtml(slug)}" title="Rename folder">✎</span>`
          : "";
        // Empty placeholder folders get a remove (✕) action and a drop hint
        // instead of a count, so they read as "drag stuff here".
        const removeBtn = (isEmpty && slug)
          ? `<span class="folder-action" data-folder-action="remove" data-slug="${escapeHtml(slug)}" title="Remove empty folder">✕</span>`
          : "";
        const badge = isEmpty
          ? `<span class="folder-count folder-count--empty">empty</span>`
          : `<span class="folder-count">${rows.length}</span>`;
        const body = isEmpty
          ? `<div class="folder-empty-hint" data-drop-slug="${escapeHtml(slug)}">drag notes here…</div>`
          : rows.map(renderRow).join("");
        return `
          <div class="files-folder${isCollapsed ? " is-collapsed" : ""}${isEmpty ? " is-empty" : ""}" data-folder="${escapeHtml(slug)}">
            <div class="folder-header" data-folder-toggle="${escapeHtml(slug)}" data-drop-slug="${escapeHtml(slug)}">
              <span class="folder-caret">${caret}</span>
              <span class="folder-name">${escapeHtml(slug)}</span>
              ${badge}
              <span class="folder-actions">
                <span class="folder-action" data-folder-action="new" data-slug="${escapeHtml(slug)}" title="New jot in this folder">＋</span>
                ${renameBtn}
                ${removeBtn}
              </span>
            </div>
            <div class="folder-body">${isCollapsed ? "" : body}</div>
          </div>
        `;
      }

      function renderRoot(rows) {
        if (!rows.length) {
          return "";
        }
        return `
          <div class="files-root" data-drop-slug="">
            ${rows.map(renderRow).join("")}
          </div>
        `;
      }

      function renderList() {
        // Group by project. Root notes stay at the top; named folders follow
        // in alphabetical order.
        const groups = new Map();
        for (const n of notesCache) {
          const slug = n.project || "";
          if (!groups.has(slug)) groups.set(slug, []);
          groups.get(slug).push(n);
        }
        // A staged empty folder that now has notes is "real" — forget it.
        let pruned = false;
        for (const slug of Array.from(emptyFolders)) {
          if (groups.has(slug)) { emptyFolders.delete(slug); pruned = true; }
        }
        if (pruned) saveEmptyFolders(emptyFolders);
        // Merge remaining empty placeholders in — but not while searching,
        // since they have nothing to match.
        if (!lastQuery) {
          for (const slug of emptyFolders) {
            if (slug && !groups.has(slug)) groups.set(slug, []);
          }
        }
        if (groups.size === 0) {
          filesList.innerHTML = `<div class="files-empty">${lastQuery ? "No notes match." : "No notes yet."}</div>`;
          return;
        }
        const named = Array.from(groups.keys()).filter((s) => s).sort((a, b) => a.localeCompare(b));
        // While searching, expand everything so matches aren't hidden in a
        // collapsed folder.
        const forceOpen = !!lastQuery;
        const parts = [];
        if (groups.has("")) {
          parts.push(renderRoot(groups.get("")));
        }
        for (const slug of named) {
          parts.push(renderFolder(slug, groups.get(slug), forceOpen));
        }
        filesList.innerHTML = parts.join("");
      }

      // Reassign a jot to a folder, then refresh. Used by drag-drop.
      async function moveNote(id, slug) {
        try {
          await api(`/api/notes/${id}`, { method: "PUT", body: { project: slug } });
          fetchList(lastQuery);
        } catch (err) {
          console.error("Failed to move jot", err);
        }
      }

      async function fetchList(query = "") {
        lastQuery = query;
        if (inflight) return inflight;
        inflight = api(`/api/notes?q=${encodeURIComponent(query)}`).then((payload) => {
          notesCache = Array.isArray(payload?.notes) ? payload.notes : [];
          loaded = true;
          renderList();
        }).catch((err) => {
          console.error(err);
          filesList.innerHTML = `<div class="files-empty">Failed to load notes.</div>`;
        }).finally(() => { inflight = null; });
        return inflight;
      }

      filesList.addEventListener("click", async (event) => {
        // Folder action buttons (new / rename) — handle before navigation.
        const action = event.target.closest("[data-folder-action]");
        if (action) {
          event.stopPropagation();
          const kind = action.dataset.folderAction;
          const slug = action.dataset.slug || "";
          if (kind === "new") {
            try {
              const payload = await api("/api/notes", { method: "POST", body: { project: slug } });
              if (payload?.note?.id) {
                prepareFreshNoteOpen();
                window.location.href = `/notes/${payload.note.id}`;
              }
            } catch (err) { console.error(err); }
          } else if (kind === "rename") {
            const next = window.prompt(`Rename folder "${slug}" to:`, slug);
            if (next !== null && next.trim() !== slug) {
              try {
                await api(`/api/projects/${encodeURIComponent(slug || "_unfiled")}/rename`, {
                  method: "POST", body: { to: next.trim() },
                });
                fetchList(lastQuery);
              } catch (err) { console.error(err); }
            }
          } else if (kind === "remove") {
            // Only ever shown on empty placeholders — just forget the name.
            emptyFolders.delete(slug);
            saveEmptyFolders(emptyFolders);
            renderList();
          }
          return;
        }
        // Folder header → toggle collapse.
        const header = event.target.closest("[data-folder-toggle]");
        if (header) {
          const slug = header.dataset.folderToggle;
          if (collapsed.has(slug)) collapsed.delete(slug);
          else collapsed.add(slug);
          saveCollapsed(collapsed);
          renderList();
          return;
        }
        // Row → open the jot.
        const row = event.target.closest("[data-note-id]");
        if (!row) return;
        const id = row.dataset.noteId;
        if (!id || id === noteId) return;
        window.location.href = `/notes/${id}`;
      });

      // ---- Drag & drop: drop a jot onto a folder header to refile it. ----
      let dragId = null;
      filesList.addEventListener("dragstart", (event) => {
        const row = event.target.closest("[data-note-id]");
        if (!row) return;
        dragId = row.dataset.noteId;
        event.dataTransfer.effectAllowed = "move";
        try { event.dataTransfer.setData("text/plain", dragId); } catch {}
        row.classList.add("file-row--dragging");
      });
      filesList.addEventListener("dragend", (event) => {
        const row = event.target.closest("[data-note-id]");
        if (row) row.classList.remove("file-row--dragging");
        dragId = null;
        filesList.querySelectorAll(".folder-header--dropover")
          .forEach((el) => el.classList.remove("folder-header--dropover"));
      });
      filesList.addEventListener("dragover", (event) => {
        const header = event.target.closest("[data-drop-slug]");
        if (!header) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        header.classList.add("folder-header--dropover");
      });
      filesList.addEventListener("dragleave", (event) => {
        const header = event.target.closest("[data-drop-slug]");
        if (header) header.classList.remove("folder-header--dropover");
      });
      filesList.addEventListener("drop", (event) => {
        const header = event.target.closest("[data-drop-slug]");
        if (!header) return;
        event.preventDefault();
        header.classList.remove("folder-header--dropover");
        const id = dragId || event.dataTransfer.getData("text/plain");
        const targetSlug = header.dataset.dropSlug || "";
        const row = id && filesList.querySelector(`[data-note-id="${CSS.escape(id)}"]`);
        if (id && row && (row.dataset.project || "") !== targetSlug) {
          moveNote(id, targetSlug);
        }
        dragId = null;
      });

      if (filesSearchInput) {
        filesSearchInput.addEventListener("input", () => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => fetchList(filesSearchInput.value), 160);
        });
      }
      if (filesCloseButton) {
        filesCloseButton.addEventListener("click", () => {
          localStorage.setItem("jot.filesPanel", "0");
          applyOpen(false);
        });
      }
      const newFolderButton = document.getElementById("newFolderButton");
      if (newFolderButton) {
        newFolderButton.addEventListener("click", () => {
          const raw = window.prompt("New folder name:");
          if (raw === null) return;
          const slug = normalizeProjectSlug(raw);
          if (!slug) return;
          // Stage as an empty folder; renderList prunes it back out if a real
          // folder by that name already exists (harmless either way).
          emptyFolders.add(slug);
          collapsed.delete(slug); // open it so the drop hint shows
          saveEmptyFolders(emptyFolders);
          saveCollapsed(collapsed);
          if (!loaded) fetchList(""); else renderList();
        });
      }
      if (filesPanelButton) {
        filesPanelButton.addEventListener("click", () => {
          const next = !(localStorage.getItem("jot.filesPanel") === "1");
          localStorage.setItem("jot.filesPanel", next ? "1" : "0");
          applyOpen(next);
          if (next && !loaded) fetchList("");
          if (next && filesSearchInput) {
            // Tiny UX nicety: focus search on open so typing filters immediately.
            setTimeout(() => filesSearchInput.focus(), 50);
          }
        });
      }

      const initiallyOpen = localStorage.getItem("jot.filesPanel") === "1";
      applyOpen(initiallyOpen);
      if (initiallyOpen) fetchList("");

      return {
        // Forwarded from handleCrossNoteEvent so the list stays live across
        // peer activity. We re-fetch on note-created/deleted (cheap) rather
        // than splicing in-place — the row count is small and the search
        // result ordering depends on updatedAt anyway.
        onCrossNoteEvent(msg) {
          if (!loaded) return;
          if (
            msg.type === "note-created" ||
            msg.type === "note-deleted" ||
            msg.type === "note-meta-updated"
          ) {
            fetchList(lastQuery);
          } else if (msg.type === "revision-created") {
            // Bump updatedAt for the affected row without a refetch — the
            // sort might shift, but a small fix keeps it perceptually live.
            const row = filesList.querySelector(`[data-note-id="${CSS.escape(msg.noteId)}"]`);
            if (row) {
              const meta = row.querySelector(".file-row-meta");
              if (meta) meta.textContent = formatRelativeTime(new Date().toISOString());
            }
          }
        },
      };
    })();

    // ---- Project chip (toolbar) ----
    // Shows the current jot's folder and lets you file it inline: click the
    // chip → type/pick a project (datalist of existing folders) → Enter.
    // Owner editor only. Exposes updateProjectChip() to applyNotePayload.
    const projectChipApi = (function setupProjectChip() {
      const wrap = document.getElementById("projectChipWrap");
      const chip = document.getElementById("projectChip");
      const label = document.getElementById("projectChipLabel");
      const picker = document.getElementById("projectPicker");
      const input = document.getElementById("projectPickerInput");
      const datalist = document.getElementById("projectPickerList");
      if (!wrap || !chip || !label || !picker || !input || isPublic) {
        return { update() {} };
      }

      function update() {
        const slug = (state.note && state.note.project) || "";
        label.textContent = slug || "Root";
        chip.classList.toggle("project-chip--filed", !!slug);
      }

      async function populateDatalist() {
        try {
          const payload = await api("/api/projects");
          const slugs = (payload.projects || []).map((p) => p.slug).filter(Boolean).sort();
          datalist.innerHTML = slugs.map((s) => `<option value="${escapeHtml(s)}"></option>`).join("");
        } catch (err) { console.error(err); }
      }

      function openPicker() {
        picker.classList.remove("hidden");
        input.value = (state.note && state.note.project) || "";
        populateDatalist();
        setTimeout(() => { input.focus(); input.select(); }, 20);
      }
      function closePicker() { picker.classList.add("hidden"); }

      async function commit() {
        const next = input.value.trim();
        const slug = (state.note && state.note.project) || "";
        closePicker();
        if (!state.note || next === slug) return;
        try {
          const payload = await api(`/api/notes/${state.note.id}`, { method: "PUT", body: { project: next } });
          state.note.project = payload.project || "";
          update();
        } catch (err) { console.error(err); }
      }

      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        if (picker.classList.contains("hidden")) openPicker();
        else closePicker();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); closePicker(); }
      });
      input.addEventListener("blur", () => { setTimeout(commit, 120); });
      document.addEventListener("click", (e) => {
        if (!picker.classList.contains("hidden") && !wrap.contains(e.target)) closePicker();
      });

      return { update };
    })();

    // ---- Revisions / History panel ----
    // Toggleable right-side panel listing prior versions of the current
    // note. Lazy-loads on first open. Live-updates via the global WS
    // `revision-created` event. Owner-editor only — not wired into public
    // editor or read-only share views (the API is requireOwnerApi-gated).
    const revisionsPanel = document.getElementById("revisionsPanel");
    const revisionsList = document.getElementById("revisionsList");
    const revisionsDiff = document.getElementById("revisionsDiff");
    const historyButton = document.getElementById("historyButton");
    const revisionsCloseButton = document.getElementById("revisionsCloseButton");

    const revisionsPanelApi = (function setupRevisionsPanel() {
      if (!revisionsPanel || !revisionsList || !workspace || isPublic) {
        return { onRevisionCreated() {} };
      }

      let revisions = [];
      let loaded = false;
      let inflight = null;
      let activeRevId = null;

      function applyOpen(open) {
        workspace.classList.toggle("workspace--with-revisions", !!open);
      }

      function fmtTs(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        const now = Date.now();
        const diff = Math.round((now - d.getTime()) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
        return d.toLocaleString();
      }

      function fmtBytes(n) {
        if (n < 1024) return `${n}B`;
        return `${(n / 1024).toFixed(1)}KB`;
      }

      function reasonBadge(reason) {
        if (!reason) return "";
        const short = String(reason).split(":")[0];
        const map = {
          "import": "v0",
          "create": "new",
          "cli-update": "cli",
          "api-update": "edit",
          "api-edit": "edit",
          "crdt-flush": "live",
          "thread-change": "comment",
          "rename": "rename",
          "share-edit": "share",
          "share-access-change": "share",
          "restore": "restored",
        };
        const label = map[short] || short;
        return `<span class="revision-row-badge revision-row-badge--${escapeHtml(short)}">${escapeHtml(label)}</span>`;
      }

      function renderList() {
        if (!revisions.length) {
          revisionsList.innerHTML = `<div class="revisions-empty">No history yet.</div>`;
          return;
        }
        revisionsList.innerHTML = revisions.map((r) => `
          <button type="button" class="revision-row${r.id === activeRevId ? " revision-row--active" : ""}" data-rev-id="${escapeHtml(r.id)}">
            <span class="revision-row-top">
              <span class="revision-row-author">${escapeHtml(r.author_name || "?")}</span>
              ${reasonBadge(r.reason)}
            </span>
            <span class="revision-row-bottom">
              <span class="revision-row-when">${escapeHtml(fmtTs(r.ts))}</span>
              <span class="revision-row-size">${fmtBytes(r.body_size || 0)}</span>
            </span>
          </button>
        `).join("");
      }

      async function fetchList() {
        if (inflight) return inflight;
        inflight = api(`/api/notes/${noteId}/revisions`).then((payload) => {
          revisions = Array.isArray(payload?.revisions) ? payload.revisions : [];
          loaded = true;
          renderList();
        }).catch((err) => {
          console.error(err);
          revisionsList.innerHTML = `<div class="revisions-empty">Failed to load history.</div>`;
        }).finally(() => { inflight = null; });
        return inflight;
      }

      async function showRevisionDiff(revId) {
        activeRevId = revId;
        renderList();
        revisionsDiff.classList.remove("hidden");
        revisionsDiff.innerHTML = `<div class="revisions-diff-loading">Loading…</div>`;
        try {
          const payload = await api(`/api/notes/${noteId}/revisions/${encodeURIComponent(revId)}`);
          const segs = Array.isArray(payload?.diff) ? payload.diff : [];
          const lines = [];
          for (const part of segs) {
            const cls = part.added ? "diff-add" : part.removed ? "diff-del" : "diff-context";
            const sign = part.added ? "+" : part.removed ? "-" : " ";
            const text = String(part.value || "").replace(/\n$/, "");
            for (const line of text.split("\n")) {
              lines.push(`<span class="${cls}">${escapeHtml(sign + line)}</span>`);
            }
          }
          const r = payload.revision;
          revisionsDiff.innerHTML = `
            <div class="revisions-diff-meta">
              <strong>${escapeHtml(r.author_name || "?")}</strong>
              <span class="revisions-diff-ts">${escapeHtml(fmtTs(r.ts))}</span>
              <span class="revisions-diff-id">${escapeHtml(r.id)}</span>
            </div>
            <pre class="revisions-diff-pre">${lines.join("\n")}</pre>
            <div class="revisions-diff-actions">
              <jot-button variant="ghost" size="sm" id="revisionsDiffCloseBtn">Close</jot-button>
              <jot-button variant="primary" size="sm" id="revisionsDiffRestoreBtn">Restore this version</jot-button>
            </div>
          `;
          const closeBtn = document.getElementById("revisionsDiffCloseBtn");
          const restoreBtn = document.getElementById("revisionsDiffRestoreBtn");
          if (closeBtn) closeBtn.addEventListener("click", () => {
            activeRevId = null;
            revisionsDiff.classList.add("hidden");
            renderList();
          });
          if (restoreBtn) restoreBtn.addEventListener("click", () => doRestore(r.id, r.author_name));
        } catch (err) {
          console.error(err);
          revisionsDiff.innerHTML = `<div class="revisions-diff-loading">Failed to load revision.</div>`;
        }
      }

      async function doRestore(revId, authorLabel) {
        const ok = window.confirm(`Restore note to the version by ${authorLabel || "?"}?\n\nThis is non-destructive — a new revision will be created with the restored content.`);
        if (!ok) return;
        try {
          await api(`/api/notes/${noteId}/revisions/${encodeURIComponent(revId)}/restore`, { method: "POST" });
          showToast(`Restored from ${revId}`, { duration: 4000 });
          activeRevId = null;
          revisionsDiff.classList.add("hidden");
          // The restore endpoint broadcasts editorHello + revision-created;
          // the panel will refresh from those events. As a belt-and-braces
          // backup, also fetch directly.
          fetchList();
        } catch (err) {
          console.error(err);
          showToast(`Restore failed: ${err.message || err}`, { duration: 6000 });
        }
      }

      revisionsList.addEventListener("click", (event) => {
        const row = event.target.closest("[data-rev-id]");
        if (!row) return;
        showRevisionDiff(row.dataset.revId);
      });

      if (revisionsCloseButton) {
        revisionsCloseButton.addEventListener("click", () => {
          localStorage.setItem("jot.revisionsPanel", "0");
          applyOpen(false);
        });
      }
      if (historyButton) {
        historyButton.addEventListener("click", () => {
          const next = !(localStorage.getItem("jot.revisionsPanel") === "1");
          localStorage.setItem("jot.revisionsPanel", next ? "1" : "0");
          applyOpen(next);
          if (next && !loaded) {
            fetchList();
          }
        });
      }

      const initiallyOpen = localStorage.getItem("jot.revisionsPanel") === "1";
      applyOpen(initiallyOpen);
      if (initiallyOpen) fetchList();

      return {
        onRevisionCreated(payload) {
          if (!payload || payload.noteId !== noteId) return;
          // Refetch to pick up coalesce updates correctly. Cheap query;
          // SQLite indexed by (note_id, ts) so this is sub-ms locally.
          if (loaded) fetchList();
        },
      };
    })();

    if (previewCloseButton) {
      previewCloseButton.addEventListener("click", () => {
        const stage = document.getElementById("previewStage");
        if (stage) {
          stage.classList.remove("preview-open");
          if (previewFab) {
            previewFab.style.display = "";
          }
        }
      });
    }

    // Swipe right to close preview on mobile
    {
      let touchStartX = 0;
      let touchStartY = 0;
      const previewStage = document.getElementById("previewStage");
      if (previewStage) {
        previewStage.addEventListener("touchstart", (e) => {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }, { passive: true });
        previewStage.addEventListener("touchend", (e) => {
          const dx = e.changedTouches[0].clientX - touchStartX;
          const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
          if (dx > 80 && dy < 100) {
            previewStage.classList.remove("preview-open");
            if (previewFab) {
              previewFab.style.display = "";
            }
          }
        }, { passive: true });
      }
    }

    if (previewCanvas) previewCanvas.addEventListener("click", (event) => {
      if (event.target.closest(".thread-rail") || event.target.closest(".selection-bubble")) {
        return;
      }
      const threadId = findAnchorAtPoint(event.clientX, event.clientY, highlightLayer);
      if (!threadId) {
        return;
      }
      const railVisible = threadRail && threadRail.offsetParent !== null;
      if (railVisible) {
        activateThread(threadId, refs, true);
      } else {
        openThreadDialog(threadId, refs, isPublic);
      }
    });

    if (commentFab) {
      commentFab.addEventListener("click", () => {
        if (!state.pendingAnchor) {
          return;
        }
        const anchor = state.pendingAnchor;
        window.getSelection()?.removeAllRanges();
        commentFab.style.display = "none";
        openComposerModal({
          mode: "thread",
          anchor,
          refs,
        });
      });
    }

    if (threadRail) threadRail.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      const card = event.target.closest("[data-thread-id]");

      if (!button && card) {
        const threadId = card.dataset.threadId;
        activateThread(threadId, refs, true);
        return;
      }

      if (!button || !button.dataset.action) {
        return;
      }

      const action = button.dataset.action;
      const threadId = button.dataset.threadId;
      const messageId = button.dataset.messageId;
      if (!action || !threadId) {
        return;
      }
      await handleThreadAction(action, threadId, messageId, refs, isPublic);
    });


    loadNote().catch((error) => {
      console.error(error);
      refs.previewContent.innerHTML = `<p>${escapeHtml(error.message || "Failed to load note.")}</p>`;
    });

    function handleCrossNoteEvent(msg) {
      filesPanelApi.onCrossNoteEvent(msg);
      if (msg.type === "note-created" && msg.note) {
        if (state.note && msg.note.id === state.note.id) return;
        if (localStorage.getItem("jot.autoOpenNewNotes") === "1" && !isUserTyping()) {
          setTimeout(() => {
            prepareFreshNoteOpen();
            window.location.href = `/notes/${msg.note.id}`;
          }, 400);
          return;
        }
        queueNewNoteToast(msg.note);
      } else if (msg.type === "note-meta-updated" && msg.note) {
        updatePendingNewNoteToast(msg.note);
      } else if (msg.type === "note-deleted" && msg.id) {
        if (state.note && msg.id === state.note.id) {
          showToast("⚠︎ This note was deleted", {
            onClick: () => { window.location.href = `/`; },
            duration: 8000,
          });
        }
      } else if (msg.type === "revision-created" && msg.revision) {
        // Live-refresh the panel if it's open + showing this note.
        revisionsPanelApi.onRevisionCreated(msg);
        // Cross-note toast: only when the saved revision is for some OTHER
        // note (otherwise the user's own typing toasts itself, noisy).
        if (!state.note || msg.noteId !== state.note.id) {
          const author = msg.revision.author_name || "someone";
          const title = msg.revision.title || "untitled";
          showToast(`${author} saved a revision in '${title}'`, {
            onClick: () => { window.location.href = `/notes/${msg.noteId}`; },
            duration: 5000,
          });
        }
      }
    }

    async function loadNote() {
      if (!isPublic) {
        // Load note metadata (shareAccess, threads, etc.) via REST
        const payload = await api(`/api/notes/${noteId}`);
        applyNotePayload(payload, refs, false);
        connectGlobalWebSocket(handleCrossNoteEvent);
        return;
      }

      const endpoint = `/api/share/${shareId}`;
      const payload = await api(endpoint);
      applyNotePayload(payload, refs, isPublic);

      if (isPublicEdit) {
        if (!payload.viewer.isOwner && !payload.viewer.commenterName) {
          await openIdentityModalAsync(refs);
        }
        initCollabEditor();
      } else {
        if (shareAccess === "comment" && !payload.viewer.isOwner && !payload.viewer.commenterName) {
          openIdentityModal(refs, true);
        }
        connectWebSocket(refs, isPublic);
      }
    }

    function connectWebSocket(refsArg, publicMode) {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const param = publicMode ? `shareId=${encodeURIComponent(shareId)}` : `noteId=${encodeURIComponent(noteId)}`;
      const wsUrl = `${protocol}//${location.host}/?${param}`;
      let reconnectDelay = 1000;
      let ws;

      function connect() {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => { reconnectDelay = 1000; };
        ws.onmessage = (event) => {
          let msg;
          try { msg = JSON.parse(event.data); } catch { return; }
          if (msg.type === "threads-updated") {
            reloadThreads(publicMode);
            return;
          }
          if (msg.type === "refresh") {
            if (msg.message) showToast(msg.message);
            reloadFromServer(refsArg, publicMode);
            return;
          }
          if (msg.type === "note-created" || msg.type === "note-deleted" || msg.type === "note-meta-updated" || msg.type === "revision-created") {
            handleCrossNoteEvent(msg);
            return;
          }
          if (msg.type !== "updated") {
            return;
          }
          if (!state.note || msg.updatedAt === state.note.updatedAt) {
            return;
          }
          reloadFromServer(refsArg, publicMode);
        };
        ws.onclose = () => {
          setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
            connect();
          }, reconnectDelay);
        };
      }

      connect();
    }

    async function reloadFromServer(refsArg, publicMode) {
      const endpoint = publicMode ? `/api/share/${shareId}` : `/api/notes/${noteId}`;
      const payload = await api(endpoint);

      if (!publicMode && state.saveStatus === "Saving") {
        return;
      }

      state.note.updatedAt = payload.note.updatedAt;
      state.threads = payload.threads;
      state.viewer = payload.viewer;

      if (publicMode) {
        state.note.markdown = payload.note.markdown;
        if (refsArg.previewContent) {
          setPreviewHtml(refsArg, payload.note.renderedHtml || "");
        }
        if (refsArg.topbarTitle) {
          refsArg.topbarTitle.textContent = payload.note.title || "untitled";
        }
      } else {
        if (state.saveStatus !== "Saving") {
          state.note.markdown = payload.note.markdown;
          state.note.title = payload.note.title;
          if (refsArg.editorTextarea && refsArg.editorTextarea.value !== payload.note.markdown) {
            const scrollTop = refsArg.editorTextarea.scrollTop;
            const selStart = refsArg.editorTextarea.selectionStart;
            const selEnd = refsArg.editorTextarea.selectionEnd;
            refsArg.editorTextarea.value = payload.note.markdown;
            refsArg.editorTextarea.scrollTop = scrollTop;
            refsArg.editorTextarea.setSelectionRange(selStart, selEnd);
          }
          if (refsArg.titleInput && refsArg.titleInput.value !== payload.note.title) {
            refsArg.titleInput.value = payload.note.title;
          }
          setPreviewHtml(refsArg, payload.note.renderedHtml || "");
        }
      }

      if (refsArg.commenterLabel) {
        refsArg.commenterLabel.textContent = payload.viewer.commenterName || "anonymous";
      }
      syncThreadLayout(refsArg);
    }

    let lastThreadsUpdate = 0;

    async function reloadThreads(publicMode) {
      if (!state.note) return;
      const now = Date.now();
      if (now - lastThreadsUpdate < 500) return;
      lastThreadsUpdate = now;
      try {
        const endpoint = publicMode ? `/api/share/${state.note.shareId}` : `/api/notes/${state.note.id}`;
        const payload = await api(endpoint);
        state.viewer = payload.viewer;
        state.threads = payload.threads;
        if (refs.commenterLabel) {
          refs.commenterLabel.textContent = payload.viewer.commenterName ? payload.viewer.commenterName : "anonymous";
        }
        syncThreadLayout(refs);
        refreshOpenThreadDialog(refs, publicMode);
      } catch (e) {
        console.error("Failed to reload threads:", e);
      }
    }

    function applyNotePayload(payload, refsArg, publicMode) {
      state.note = payload.note;
      state.viewer = payload.viewer;
      state.threads = payload.threads;
      state.relatedHtml = "";

      if (refsArg.topbarTitle) {
        refsArg.topbarTitle.textContent = payload.note.title || "untitled";
      }
      if (refsArg.titleInput) {
        refsArg.titleInput.value = payload.note.title || "untitled";
      }
      if (refsArg.editorTextarea) {
        refsArg.editorTextarea.value = payload.note.markdown || "";
      }
      setPreviewHtml(refsArg, payload.note.renderedHtml || "");
      if (refsArg.commenterLabel) {
        refsArg.commenterLabel.textContent = payload.viewer.commenterName ? payload.viewer.commenterName : "anonymous";
      }
      if (refsArg.saveStatus) {
        refsArg.saveStatus.textContent = publicMode ? "" : "Saved";
      }
      updateResolvedButton(refsArg.resolvedButton);
      updateCommentsButton(refsArg.commentsButton);
      updateShareInline();
      if (typeof projectChipApi !== "undefined") projectChipApi.update();
      syncThreadLayout(refsArg);
      if (!publicMode && state.note?.id) loadNoteConnections(state.note.id, refsArg);
    }

    function renderRelatedHtml(conns) {
      return (
        `<aside class="note-related"><div class="note-related-title">Related</div><div class="note-related-list">` +
        conns
          .map(
            (c) =>
              `<a class="note-related-chip" href="/notes/${encodeURIComponent(c.id)}" title="${escapeHtml(
                (c.edges || []).map((e) => e.reason).join(" · "),
              )}">${escapeHtml(c.title || "untitled")}</a>`,
          )
          .join("") +
        `</div></aside>`
      );
    }

    async function loadNoteConnections(noteId, refsArg) {
      try {
        const payload = await api(`/api/notes/${noteId}/connections?limit=8`);
        const conns = (payload && payload.connections) || [];
        state.relatedHtml = conns.length ? renderRelatedHtml(conns) : "";
      } catch {
        state.relatedHtml = "";
      }
      if (refsArg.previewContent) {
        const existing = refsArg.previewContent.querySelector(".note-related");
        if (existing) existing.remove();
        if (state.relatedHtml) refsArg.previewContent.insertAdjacentHTML("beforeend", state.relatedHtml);
      }
    }

    function updateShareInline() {
      const select = document.getElementById("shareAccessSelect");
      if (!select || !state.note) return;
      const access = state.note.shareAccess || "none";
      const shared = access !== "none";
      const url = `${location.origin}/s/${state.note.shareId || ""}`;
      select.value = access;
      select.dataset.access = access;
      select.classList.toggle("is-shared", shared);
      const link = document.getElementById("shareLink");
      const urlField = document.getElementById("shareUrlField");
      const openLink = document.getElementById("shareOpenLink");
      if (link) link.classList.toggle("hidden", !shared);
      if (urlField) urlField.value = shared ? url : "";
      if (openLink) openLink.setAttribute("href", shared ? url : "#");
    }

    function flashCopyIcon(el) {
      const btn = el.querySelector("button") || el;
      const orig = btn.innerHTML;
      btn.innerHTML = (window.__ICONS__ && window.__ICONS__.check) || orig;
      setTimeout(() => { btn.innerHTML = orig; }, 1200);
    }

    function scheduleRender(refsArg) {
      clearTimeout(state.renderTimer);
      state.renderTimer = setTimeout(async () => {
        const endpoint = isPublic ? `/api/share/${shareId}/render` : "/api/render";
        const payload = await api(endpoint, {
          method: "POST",
          body: { markdown: state.note?.markdown || "" },
        });
        setPreviewHtml(refsArg, payload.html);
        syncThreadLayout(refsArg);
      }, 150);
    }
  }

  function renderEditorLayout() {
    return `
      <div class="app-root">
        <header class="topbar">
          <div class="topbar-left">
            <jot-icon-button icon="sidebar" label="Files panel" id="filesPanelButton"></jot-icon-button>
            <jot-icon-button icon="home" label="Back to notes" id="notesButton"></jot-icon-button>
            <input id="titleInput" class="title-input" type="text" spellcheck="false" value="untitled" />
            <div class="project-chip-wrap" id="projectChipWrap">
              <button type="button" class="project-chip" id="projectChip" title="Project folder — click to file this jot">
                <span class="project-chip-icon">${window.__ICONS__?.folder || "📁"}</span>
                <span class="project-chip-label" id="projectChipLabel">Root</span>
              </button>
              <div class="project-picker hidden" id="projectPicker">
                <input id="projectPickerInput" type="text" list="projectPickerList" placeholder="Project name…" spellcheck="false" autocomplete="off" />
                <datalist id="projectPickerList"></datalist>
              </div>
            </div>
            <span class="status-text" id="saveStatus"></span>
          </div>
          <div class="topbar-right">
            <jot-icon-button icon="history" label="Revisions (history)" id="historyButton"></jot-icon-button>
            <jot-icon-button icon="zen" label="Zen mode (hide raw)" id="zenButton"></jot-icon-button>
            <jot-icon-button icon="preview" label="Preview" id="previewFab"></jot-icon-button>
            <div class="save-popover-wrap" id="savePopoverWrap">
              <jot-icon-button icon="save" label="Save to…" id="saveButton"></jot-icon-button>
              <div class="save-popover hidden" id="savePopover"></div>
            </div>
            <div class="share-inline" id="shareInline">
              <select id="shareAccessSelect" class="share-mode-select" title="Share access" aria-label="Share access">
                <option value="none">Private</option>
                <option value="view">View</option>
                <option value="comment">Comment</option>
                <option value="edit">Edit</option>
              </select>
              <div class="share-link hidden" id="shareLink">
                <input id="shareUrlField" class="share-url-field" type="text" readonly tabindex="-1" />
                <jot-icon-button icon="copy" label="Copy share link" id="shareCopyBtn"></jot-icon-button>
                <a id="shareOpenLink" class="jot-btn-icon jot-btn-icon--md share-open-link" target="_blank" rel="noopener" aria-label="Open shared page in new tab" title="Open shared page in new tab" href="#">${window.__ICONS__?.external || ""}</a>
              </div>
            </div>
            <button type="button" class="jot-btn-icon jot-btn-icon--md theme-toggle" aria-label="Toggle theme">${themeIcon(document.documentElement.getAttribute("data-theme") || "dark")}</button>
          </div>
        </header>
        <main class="workspace">
          <aside class="files-panel" id="filesPanel" aria-label="Notes">
            <header class="files-panel-header">
              <span class="files-panel-title">Notes</span>
              <span class="files-panel-header-actions">
                <jot-icon-button icon="folderPlus" label="New folder" id="newFolderButton"></jot-icon-button>
                <jot-icon-button icon="close" label="Close files" id="filesCloseButton"></jot-icon-button>
              </span>
            </header>
            <div class="files-panel-search">
              <input id="filesSearchInput" type="search" placeholder="Search notes..." spellcheck="false" />
            </div>
            <div class="files-panel-body" id="filesList"></div>
          </aside>
          <section class="editor-pane">
            <div id="disconnectedBanner" class="editor-disconnected hidden">Disconnected. Reconnecting...</div>
            <textarea id="editorTextarea" class="editor-textarea" spellcheck="false"></textarea>
          </section>
          <section class="preview-stage" id="previewStage">
            <jot-icon-button icon="close" label="Close preview" id="previewCloseButton" class="preview-close-btn"></jot-icon-button>
            <div class="preview-controls" id="previewControls">
              <jot-button variant="ghost" size="sm" id="commentsButton">hide comments</jot-button>
              <jot-button variant="ghost" size="sm" id="resolvedButton">resolved</jot-button>
            </div>
            <div class="preview-scroll" id="previewScroll">
              <div class="preview-canvas" id="previewCanvas">
                <div class="preview-content markdown-body" id="previewContent"></div>
                <div class="highlight-layer" id="highlightLayer"></div>
                <button type="button" class="selection-bubble hidden" id="selectionBubble">+ Comment</button>
                <button type="button" class="comment-fab" id="commentFab">+ Comment</button>
                <aside class="thread-rail" id="threadRail"></aside>
              </div>
            </div>
          </section>
          <aside class="revisions-panel" id="revisionsPanel" aria-label="Revisions">
            <header class="revisions-panel-header">
              <span class="revisions-panel-title">History</span>
              <jot-icon-button icon="close" label="Close history" id="revisionsCloseButton"></jot-icon-button>
            </header>
            <div class="revisions-panel-body" id="revisionsList"></div>
            <div class="revisions-diff hidden" id="revisionsDiff" aria-live="polite"></div>
          </aside>
        </main>
        <div class="modal-backdrop hidden" id="modalBackdrop"></div>
      </div>
    `;
  }

  function renderPublicLayout(viewOnly) {
    const commentControls = viewOnly ? "" : `
            <jot-button variant="ghost" size="sm" id="commentsButton">hide comments</jot-button>
            <jot-button variant="ghost" size="sm" id="resolvedButton">resolved</jot-button>`;
    const commentElements = viewOnly ? "" : `
              <div class="highlight-layer" id="highlightLayer"></div>
              <button type="button" class="selection-bubble hidden" id="selectionBubble">+ Comment</button>
              <button type="button" class="comment-fab" id="commentFab">+ Comment</button>
              <aside class="thread-rail" id="threadRail"></aside>`;
    const subtitle = viewOnly ? "" : `<div class="topbar-title-subtle">comments as <span id="commenterLabel">anonymous</span></div>`;
    return `
      <div class="app-root">
        <header class="topbar public-page-topbar">
          <div class="topbar-left">
            <div>
              <div class="topbar-title" id="topbarTitle">note</div>
              ${subtitle}
            </div>
          </div>
          <div class="topbar-right">
            <button type="button" class="jot-btn-icon jot-btn-icon--md theme-toggle" aria-label="Toggle theme">${themeIcon(document.documentElement.getAttribute("data-theme") || "dark")}</button>
          </div>
        </header>
        <main class="preview-stage public" id="previewStage">
          <div class="preview-controls" id="previewControls">
            ${commentControls}
          </div>
          <div class="preview-scroll" id="previewScroll">
            <div class="preview-canvas" id="previewCanvas">
              <div class="preview-content markdown-body" id="previewContent"></div>
              ${commentElements}
            </div>
          </div>
        </main>
        <div class="modal-backdrop hidden" id="modalBackdrop"></div>
      </div>
    `;
  }

  function renderPublicEditorLayout() {
    return `
      <div class="app-root">
        <header class="topbar public-page-topbar">
          <div class="topbar-left">
            <div>
              <div class="topbar-title" id="topbarTitle">note</div>
            <div class="topbar-title-subtle">editing as <span id="commenterLabel">anonymous</span></div>
            </div>
            <span class="status-text" id="saveStatus"></span>
          </div>
          <div class="topbar-right">
            <jot-icon-button icon="zen" label="Zen mode (hide raw)" id="zenButton"></jot-icon-button>
            <jot-icon-button icon="preview" label="Preview" id="previewFab"></jot-icon-button>
            <button type="button" class="jot-btn-icon jot-btn-icon--md theme-toggle" aria-label="Toggle theme">${themeIcon(document.documentElement.getAttribute("data-theme") || "dark")}</button>
          </div>
        </header>
        <main class="workspace">
          <section class="editor-pane">
            <div id="disconnectedBanner" class="editor-disconnected hidden">Disconnected. Reconnecting...</div>
            <textarea id="editorTextarea" class="editor-textarea" spellcheck="false"></textarea>
          </section>
          <section class="preview-stage" id="previewStage">
            <jot-icon-button icon="close" label="Close preview" id="previewCloseButton" class="preview-close-btn"></jot-icon-button>
            <div class="preview-controls" id="previewControls">
              <jot-button variant="ghost" size="sm" id="commentsButton">hide comments</jot-button>
              <jot-button variant="ghost" size="sm" id="resolvedButton">resolved</jot-button>
            </div>
            <div class="preview-scroll" id="previewScroll">
              <div class="preview-canvas" id="previewCanvas">
                <div class="preview-content markdown-body" id="previewContent"></div>
                <div class="highlight-layer" id="highlightLayer"></div>
                <button type="button" class="selection-bubble hidden" id="selectionBubble">+ Comment</button>
                <button type="button" class="comment-fab" id="commentFab">+ Comment</button>
                <aside class="thread-rail" id="threadRail"></aside>
              </div>
            </div>
          </section>
        </main>
        <div class="modal-backdrop hidden" id="modalBackdrop"></div>
      </div>
    `;
  }

  function prepareFreshNoteOpen() {
    localStorage.setItem("jot.zenMode", "0");
    const workspace = document.querySelector(".workspace");
    if (workspace) {
      workspace.classList.remove("workspace--zen");
    }
  }

  function setSaveStatus(refs, value) {
    state.saveStatus = value;
    if (refs.saveStatus) {
      refs.saveStatus.textContent = value;
      refs.saveStatus.classList.remove("status-fade");
      if (value === "Saved") {
        clearTimeout(state.statusFadeTimer);
        state.statusFadeTimer = setTimeout(() => {
          refs.saveStatus.classList.add("status-fade");
        }, 1500);
      }
    }
  }

  async function toggleSavePopover(_refs) {
    const popover = document.getElementById("savePopover");
    if (!popover) return;
    if (!popover.classList.contains("hidden")) { popover.classList.add("hidden"); return; }
    popover.innerHTML = `<div class="save-popover-title">Save to…</div><div class="save-popover-empty">Loading…</div>`;
    popover.classList.remove("hidden");

    let destinations = [];
    try {
      const payload = await api("/api/destinations");
      destinations = Array.isArray(payload.destinations) ? payload.destinations : [];
    } catch {
      destinations = [];
    }

    const adHocRow = `
      <div class="save-popover-row save-popover-row--adhoc" data-action="pick-file">
        <span class="save-popover-label">Save to… <span class="save-popover-hint">choose location</span></span>
        <span class="save-popover-status"></span>
      </div>
    `;
    const destinationRows = destinations.map((d) => `
      <div class="save-popover-row" data-destination-id="${escapeHtml(d.id)}">
        <span class="save-popover-label">${escapeHtml(d.label)}</span>
        <span class="save-popover-status"></span>
      </div>
    `).join("");
    const divider = destinations.length > 0 ? `<div class="save-popover-divider"></div>` : "";

    popover.innerHTML = `<div class="save-popover-title">Save to…</div>${adHocRow}${divider}${destinationRows}`;

    popover.addEventListener("click", async (event) => {
      const row = event.target.closest(".save-popover-row");
      if (!row || !state.note) return;
      const status = row.querySelector(".save-popover-status");

      if (row.dataset.action === "pick-file") {
        try {
          const savedName = await saveMarkdownViaPicker(state.note);
          row.classList.add("is-saved");
          if (status) status.textContent = savedName ? `✓ ${savedName}` : "✓ saved";
          setTimeout(() => { row.classList.remove("is-saved"); if (status) status.textContent = ""; }, 2500);
        } catch (err) {
          if (err && err.name === "AbortError") {
            if (status) status.textContent = "";
            return;
          }
          if (status) status.textContent = "failed";
        }
        return;
      }

      const destId = row.dataset.destinationId;
      if (!destId) return;
      if (status) status.textContent = "saving…";
      try {
        const result = await api(`/api/notes/${state.note.id}/save-to/${encodeURIComponent(destId)}`, { method: "POST" });
        row.classList.add("is-saved");
        if (result.url && status) {
          status.innerHTML = `<a href="${result.url}" target="_blank" rel="noopener">✓ published</a>`;
        } else if (status) {
          status.textContent = `✓ ${result.path.split("/").slice(-2).join("/")}`;
        }
        setTimeout(() => {
          row.classList.remove("is-saved");
          if (status) status.textContent = "";
        }, 2500);
      } catch (err) {
        if (status) status.textContent = "failed";
      }
    });

    const closeHandler = (e) => {
      if (!popover.contains(e.target) && e.target.id !== "saveButton" && !e.target.closest("#savePopoverWrap")) {
        popover.classList.add("hidden");
        document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", closeHandler), 0);
  }

  async function saveMarkdownViaPicker(note) {
    const markdown = note.markdown || "";
    const baseName = (note.title || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled";
    const suggestedName = `${baseName}.md`;

    if (typeof window.showSaveFilePicker === "function") {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{
          description: "Markdown",
          accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(markdown);
      await writable.close();
      return handle.name || suggestedName;
    }

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return suggestedName;
  }

  let refreshToastTimer = null;
  function showToast(text, opts = {}) {
    let toast = document.getElementById("refreshToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "refreshToast";
      document.body.appendChild(toast);
    }
    toast.className = "refresh-toast"
      + (opts.onClick ? " refresh-toast--clickable" : "")
      + (opts.rich ? " refresh-toast--rich" : "");
    if (opts.html) toast.innerHTML = opts.html;
    else toast.textContent = text;
    toast.onclick = null;
    if (opts.onClick) toast.onclick = () => { opts.onClick(); toast.classList.remove("is-visible"); };
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    if (refreshToastTimer) clearTimeout(refreshToastTimer);
    refreshToastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
    }, opts.duration || 3600);
  }
  const showRefreshToast = (text) => showToast(text);

  // Debounce buffer: coalesce a just-created note with its follow-up title
  // update so the toast shows the real title instead of "untitled".
  const pendingNewNoteToasts = new Map();
  function queueNewNoteToast(note) {
    const existing = pendingNewNoteToasts.get(note.id);
    if (existing) {
      clearTimeout(existing.timer);
      existing.note = note;
      existing.timer = setTimeout(() => fireNewNoteToast(existing.note), 400);
      return;
    }
    const entry = { note, timer: null };
    entry.timer = setTimeout(() => fireNewNoteToast(entry.note), 400);
    pendingNewNoteToasts.set(note.id, entry);
  }
  function updatePendingNewNoteToast(note) {
    const existing = pendingNewNoteToasts.get(note.id);
    if (!existing) return false;
    existing.note = note;
    return true;
  }
  function fireNewNoteToast(note) {
    pendingNewNoteToasts.delete(note.id);
    const title = note.title && note.title.trim() ? note.title : "untitled";
    showToast("", {
      html: `<span class="refresh-toast-emoji">🌺</span><span class="refresh-toast-text">New note: <strong>${escapeHtml(title)}</strong></span>`,
      onClick: () => { window.location.href = `/notes/${note.id}`; },
      duration: 6000,
      rich: true,
    });
  }

  function isUserTyping() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName;
    return tag === "TEXTAREA" || tag === "INPUT" || active.isContentEditable;
  }

  function connectGlobalWebSocket(onEvent) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/`;
    let reconnectDelay = 1000;
    let ws;
    function connect() {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => { reconnectDelay = 1000; };
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        onEvent(msg);
      };
      ws.onclose = () => {
        setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
          connect();
        }, reconnectDelay);
      };
    }
    connect();
  }


  function openIdentityModalAsync(refs) {
    return new Promise((resolve) => {
      openIdentityModal(refs, false, resolve);
    });
  }

  function setButtonLabel(el, text) {
    if (!el) return;
    const btn = el.querySelector("button") || el;
    btn.textContent = text;
  }

  function updateResolvedButton(button) {
    if (!button) return;
    button.style.display = state.showComments ? "" : "none";
    setButtonLabel(button, state.showResolved ? "hide resolved" : "show resolved");
  }

  function updateCommentsButton(button) {
    setButtonLabel(button, state.showComments ? "hide comments" : "show comments");
  }

  function scheduleLayout(refs) {
    cancelAnimationFrame(state.layoutFrame);
    state.layoutFrame = requestAnimationFrame(() => syncThreadLayout(refs));
  }

  function syncThreadLayout(refs) {
    if (!refs.previewContent || !refs.threadRail || !refs.highlightLayer) {
      return;
    }

    state.visibleMatches.clear();
    refs.highlightLayer.innerHTML = "";
    refs.threadRail.innerHTML = "";

    if (!state.note) {
      return;
    }

    if (!state.showComments) {
      return;
    }

    const canvasRect = refs.previewCanvas.getBoundingClientRect();
    const visible = [];

    for (const thread of state.threads) {
      if (thread.resolved && !state.showResolved) {
        continue;
      }
      const match = locateAnchor(thread.anchor, refs.previewContent);
      if (!match) {
        continue;
      }
      const rects = Array.from(match.range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      if (!rects.length) {
        continue;
      }

      const merged = mergeRects(rects, canvasRect);
      for (const rect of merged) {
        const highlight = document.createElement("button");
        highlight.type = "button";
        highlight.className = `anchor-highlight${thread.id === state.activeThreadId ? " active" : ""}`;
        highlight.dataset.threadId = thread.id;
        highlight.setAttribute("aria-label", "Open comment thread");
        highlight.style.left = `${rect.left}px`;
        highlight.style.top = `${rect.top}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
        refs.highlightLayer.appendChild(highlight);
      }

      const top = rects[0].top - canvasRect.top;
      visible.push({ thread, top, match });
      state.visibleMatches.set(thread.id, match);
    }

    if (!visible.length) {
      refs.threadRail.innerHTML = "";
      return;
    }

    visible.sort((a, b) => {
      const startDelta = (a.thread.anchor?.start || 0) - (b.thread.anchor?.start || 0);
      if (startDelta !== 0) {
        return startDelta;
      }
      return a.top - b.top;
    });

    const cards = visible.map((item) => {
      const card = document.createElement("section");
      card.className = `thread-card${item.thread.id === state.activeThreadId ? " active" : ""}${item.thread.resolved ? " resolved" : ""}`;
      card.dataset.threadId = item.thread.id;
      card.style.top = `${item.top}px`;
      card.innerHTML = renderThreadCard(item.thread);
      refs.threadRail.appendChild(card);
      return { card, desiredTop: item.top };
    });

    let cursor = 14;
    for (const item of cards) {
      const top = Math.max(cursor, item.desiredTop);
      item.card.style.top = `${top}px`;
      cursor = top + item.card.offsetHeight + 12;
    }
  }

  function renderThreadCard(thread) {
    const tree = buildMessageTree(thread.messages);
    if (!tree.length) {
      return "";
    }

    const flat = flattenTree(tree);

    return `
      <div class="thread-tree">
        ${flat.map((item) => renderFlatMessage(thread, item.message, item.depth)).join("")}
      </div>
      ${(thread.canResolve || thread.canDeleteThread) ? `<div class="thread-footer">
        ${thread.canResolve ? `<jot-button variant="link" size="sm" data-action="${thread.resolved ? "reopen" : "resolve"}" data-thread-id="${escapeHtml(thread.id)}">${thread.resolved ? "reopen" : "resolve"}</jot-button>` : ""}
        ${thread.canDeleteThread ? `<jot-button variant="danger" size="sm" data-action="delete-thread" data-thread-id="${escapeHtml(thread.id)}">delete</jot-button>` : ""}
      </div>` : ""}
    `;
  }

  function flattenTree(roots) {
    const result = [];
    // justBranched: true if the parent was a branch point (had multiple children)
    // This causes the first generation after a branch to indent +1 for visual grouping
    function walk(nodes, indent, justBranched) {
      for (const node of nodes) {
        result.push({ message: node.message, depth: indent });
        const multipleChildren = node.children.length > 1;
        let childIndent;
        if (multipleChildren) {
          childIndent = indent + 1;
        } else if (justBranched && indent > 0) {
          childIndent = indent + 1;
        } else {
          childIndent = indent;
        }
        walk(node.children, childIndent, multipleChildren);
      }
    }
    const multipleRoots = roots.length > 1;
    walk(roots, multipleRoots ? 1 : 0, multipleRoots);
    return result;
  }

  function renderFlatMessage(thread, message, depth) {
    const canReply = thread.canReply && !thread.resolved;
    const isFirst = thread.messages[0]?.id === message.id;
    const indented = depth > 0;

    return `
      <div class="thread-node" style="--depth:${depth}">
        <div class="thread-message${indented ? " thread-message-reply" : " thread-message-root"}">
          <div class="thread-message-head">
            <span class="thread-author${isFirst ? "" : " thread-author-small"}">${escapeHtml(message.authorName)}</span>
            <span class="thread-meta">${escapeHtml(formatRelativeTime(message.updatedAt))}</span>
            <span class="thread-message-actions">
              ${canReply ? renderIconButton("reply", thread.id, message.id, "Reply") : ""}
              ${message.canEdit ? renderIconButton("edit-message", thread.id, message.id, "Edit") : ""}
              ${message.canDelete ? renderIconButton("delete-message", thread.id, message.id, "Delete", true) : ""}
            </span>
          </div>
          <div class="thread-body${isFirst ? "" : " thread-body-small"}">${escapeHtml(message.body)}</div>
        </div>
      </div>
    `;
  }

  function buildMessageTree(messages) {
    const nodes = new Map(messages.map((message) => [message.id, { message, children: [] }]));
    const roots = [];

    for (const node of nodes.values()) {
      const parentId = node.message.parentId;
      if (parentId && nodes.has(parentId)) {
        nodes.get(parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortNodes = (items) => {
      items.sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt));
      for (const item of items) {
        sortNodes(item.children);
      }
      return items;
    };

    return sortNodes(roots);
  }

  function renderIconButton(action, threadId, messageId, label, danger = false) {
    const icon = ACTION_ICON_MAP[action] || action;
    return `<jot-icon-button icon="${escapeHtml(icon)}" label="${escapeHtml(label)}" size="sm" data-action="${escapeHtml(action)}" data-thread-id="${escapeHtml(threadId)}"${messageId ? ` data-message-id="${escapeHtml(messageId)}"` : ""}${danger ? " danger" : ""}></jot-icon-button>`;
  }

  function activateThread(threadId, refs, scrollIntoView) {
    state.activeThreadId = threadId;
    syncThreadLayout(refs);
    if (!scrollIntoView) {
      return;
    }
    const match = state.visibleMatches.get(threadId);
    if (!match) {
      return;
    }
    const rects = Array.from(match.range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) {
      return;
    }
    const canvasRect = refs.previewCanvas.getBoundingClientRect();
    const targetTop = rects[0].top - canvasRect.top - 80;
    refs.previewScroll.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }

  function updateSelectionBubble(refs) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      refs.selectionBubble.classList.add("hidden");
      state.pendingAnchor = null;
      return;
    }

    const range = selection.getRangeAt(0);
    if (!refs.previewContent.contains(range.commonAncestorContainer)) {
      refs.selectionBubble.classList.add("hidden");
      state.pendingAnchor = null;
      return;
    }

    const anchor = buildAnchorFromSelection(refs.previewContent, range);
    if (!anchor || !anchor.quote.trim()) {
      refs.selectionBubble.classList.add("hidden");
      state.pendingAnchor = null;
      return;
    }

    state.pendingAnchor = anchor;

    if (isMobileDevice) {
      refs.selectionBubble.classList.add("hidden");
      return;
    }

    const rect = range.getBoundingClientRect();
    const canvasRect = refs.previewCanvas.getBoundingClientRect();
    refs.selectionBubble.style.left = `${Math.max(16, rect.left - canvasRect.left)}px`;
    refs.selectionBubble.style.top = `${rect.bottom - canvasRect.top + 6}px`;
    refs.selectionBubble.classList.remove("hidden");
  }

  function openIdentityModal(refs, mandatory, onDone) {
    openModal(refs, {
      title: "",
      description: "",
      submitLabel: "Continue",
      cancelLabel: mandatory ? null : "Cancel",
      compact: true,
      fields: [
        {
          name: "name",
          label: "",
          type: "text",
          value: state.viewer?.commenterName || "",
          placeholder: "Your name",
        },
      ],
      onSubmit: async (values) => {
        await api(`/api/share/${state.note.shareId}/identity`, {
          method: "POST",
          body: { name: values.name || "" },
        });
        const payload = await api(`/api/share/${state.note.shareId}`);
        state.viewer = payload.viewer;
        state.threads = payload.threads;
        if (refs.commenterLabel) {
          refs.commenterLabel.textContent = payload.viewer.commenterName || "anonymous";
        }
        syncThreadLayout(refs);
        if (onDone) onDone();
      },
    });
  }

  function openComposerModal(options) {
    const refs = options.refs;

    if (!state.viewer?.isOwner && !state.viewer?.commenterName) {
      openIdentityModal(refs, true);
      return;
    }

    const isEdit = options.mode === "edit";
    const isReply = options.mode === "reply";
    const reopenThreadId = (window.innerWidth <= 980) ? options.threadId : null;
    const onCancel = reopenThreadId ? () => {
      const stillExists = state.threads.find((item) => item.id === reopenThreadId);
      if (stillExists) {
        setTimeout(() => openThreadDialog(reopenThreadId, refs, state.page === "public"), 50);
      }
    } : null;

    openModal(refs, {
      title: isEdit ? "Edit comment" : isReply ? "Reply" : "New comment",
      description: isReply ? "Add a reply to this thread." : "Comment on the selected text.",
      submitLabel: isEdit ? "Save" : isReply ? "Reply" : "Comment",
      cancelLabel: "Cancel",
      compact: true,
      onCancel,
      fields: [
        ...(state.viewer?.isOwner || state.viewer?.commenterName
          ? []
          : [
              {
                name: "name",
                label: "Name",
                type: "text",
                value: "",
                placeholder: "Your name",
              },
            ]),
        {
          name: "body",
          label: "Comment",
          type: "textarea",
          value: options.initialBody || "",
          placeholder: "Write a comment",
        },
      ],
      onSubmit: async (values) => {
        if (!state.viewer?.isOwner && !state.viewer?.commenterName && values.name) {
          await api(`/api/share/${state.note.shareId}/identity`, {
            method: "POST",
            body: { name: values.name },
          });
        }

        if (options.mode === "thread") {
          await api(`/api/share/${state.note.shareId}/threads`, {
            method: "POST",
            body: { anchor: options.anchor, body: values.body },
          });
        }

        if (options.mode === "reply") {
          await api(`/api/share/${state.note.shareId}/threads/${options.threadId}/replies`, {
            method: "POST",
            body: { body: values.body, parentMessageId: options.parentMessageId || null },
          });
        }

        if (options.mode === "edit") {
          await api(`/api/share/${state.note.shareId}/messages/${options.messageId}`, {
            method: "PATCH",
            body: { body: values.body },
          });
        }

        const endpoint = state.page === "public" ? `/api/share/${state.note.shareId}` : `/api/notes/${state.note.id}`;
        const payload = await api(endpoint);
        state.viewer = payload.viewer;
        state.threads = payload.threads;
        if (refs.commenterLabel) {
          refs.commenterLabel.textContent = payload.viewer.commenterName || "anonymous";
        }
        state.pendingAnchor = null;
        if (refs.selectionBubble) refs.selectionBubble.classList.add("hidden");
        updateCommentFab(refs);
        lastThreadsUpdate = Date.now();
        syncThreadLayout(refs);
        if (reopenThreadId) {
          const stillExists = state.threads.find((item) => item.id === reopenThreadId);
          if (stillExists) {
            setTimeout(() => openThreadDialog(reopenThreadId, refs, state.page === "public"), 16);
          }
        }
      },
    });
  }

  function openModal(refs, options) {
    state.modalOpen = true;
    refs.modalBackdrop.classList.remove("hidden");
    refs.modalBackdrop.innerHTML = `
      <div class="modal${options.compact ? " compact" : ""}" role="dialog" aria-modal="true">
        ${options.compact ? "" : `<h2>${escapeHtml(options.title)}</h2>`}
        ${options.compact ? "" : options.description ? `<p>${escapeHtml(options.description)}</p>` : ""}
        <form id="modalForm">
          ${options.fields
            .map((field) => `
              <div class="field">
                ${options.compact ? "" : `<label>${escapeHtml(field.label)}</label>`}
                ${
                  field.type === "textarea"
                    ? `<textarea name="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(field.value || "")}</textarea>`
                    : `<input type="${escapeHtml(field.type)}" name="${escapeHtml(field.name)}" value="${escapeHtml(field.value || "")}" placeholder="${escapeHtml(field.placeholder || "")}" />`
                }
              </div>
            `)
            .join("")}
          <div class="inline-error hidden" id="modalError"></div>
          <div class="modal-actions">
            ${options.cancelLabel ? `<jot-button variant="ghost" id="modalCancel">${escapeHtml(options.cancelLabel)}</jot-button>` : ""}
            <jot-button variant="primary" submit>${escapeHtml(options.submitLabel)}</jot-button>
          </div>
        </form>
      </div>
    `;

    const form = document.getElementById("modalForm");
    const cancelButton = document.getElementById("modalCancel");
    const errorNode = document.getElementById("modalError");

    if (cancelButton) {
      cancelButton.addEventListener("click", () => {
        closeModal(refs);
        if (options.onCancel) {
          options.onCancel();
        }
      });
    }

    const firstInput = form.querySelector("textarea, input");
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 50);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const values = Object.fromEntries(formData.entries());
      errorNode.classList.add("hidden");
      errorNode.textContent = "";
      try {
        await options.onSubmit(values);
        closeModal(refs);
      } catch (error) {
        errorNode.textContent = error.message || "Request failed.";
        errorNode.classList.remove("hidden");
      }
    });
  }

  function closeModal(refs) {
    state.modalOpen = false;
    refs.modalBackdrop.classList.add("hidden");
    refs.modalBackdrop.innerHTML = "";
  }

  async function handleThreadAction(action, threadId, messageId, refs, isPublic) {
    if (action === "reply") {
      openComposerModal({ mode: "reply", threadId, parentMessageId: messageId, refs });
      return { kind: "opened-modal" };
    }

    if (action === "resolve" || action === "reopen") {
      await api(`/api/share/${state.note.shareId}/threads/${threadId}`, {
        method: "PATCH",
        body: { resolved: action === "resolve" },
      });
      await reloadThreadState(refs, isPublic);
      return { kind: "reloaded" };
    }

    if (action === "delete-thread") {
      if (!window.confirm("Delete this thread?")) {
        return { kind: "cancelled" };
      }
      await api(`/api/share/${state.note.shareId}/threads/${threadId}`, { method: "DELETE" });
      await reloadThreadState(refs, isPublic);
      return { kind: "reloaded" };
    }

    if (action === "edit-message" && messageId) {
      const thread = state.threads.find((item) => item.id === threadId);
      const message = thread?.messages.find((item) => item.id === messageId);
      if (!message) {
        return { kind: "cancelled" };
      }
      openComposerModal({ mode: "edit", threadId, messageId, initialBody: message.body, refs });
      return { kind: "opened-modal" };
    }

    if (action === "delete-message" && messageId) {
      if (!window.confirm("Delete this comment?")) {
        return { kind: "cancelled" };
      }
      await api(`/api/share/${state.note.shareId}/messages/${messageId}`, { method: "DELETE" });
      await reloadThreadState(refs, isPublic);
      return { kind: "reloaded" };
    }

    return { kind: "cancelled" };
  }

  async function reloadThreadState(refs, isPublic) {
    const endpoint = isPublic ? `/api/share/${state.note.shareId}` : `/api/notes/${state.note.id}`;
    const payload = await api(endpoint);
    state.viewer = payload.viewer;
    state.threads = payload.threads;
    if (refs.commenterLabel) {
      refs.commenterLabel.textContent = payload.viewer.commenterName || "anonymous";
    }
    syncThreadLayout(refs);
  }

  function refreshOpenThreadDialog(refs, isPublic) {
    if (!state.modalOpen || !state.activeThreadId) return;
    const body = refs.modalBackdrop?.querySelector(".thread-modal-body");
    if (!body) return;
    const thread = state.threads.find((item) => item.id === state.activeThreadId);
    if (!thread) {
      closeModal(refs);
      state.activeThreadId = null;
      return;
    }
    body.innerHTML = renderThreadCard(thread);
  }

  function openThreadDialog(threadId, refs, isPublic) {
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread) {
      return;
    }

    state.activeThreadId = threadId;
    syncThreadLayout(refs);

    state.modalOpen = true;
    refs.modalBackdrop.classList.remove("hidden");
    refs.modalBackdrop.innerHTML = `
      <div class="modal thread-modal" role="dialog" aria-modal="true">
        <jot-icon-button icon="close" label="Close" id="threadDialogClose" class="thread-modal-close-wrap"></jot-icon-button>
        <div class="thread-modal-body">${renderThreadCard(thread)}</div>
      </div>
    `;

    const closeThreadDialog = () => {
      state.activeThreadId = null;
      closeModal(refs);
      syncThreadLayout(refs);
    };

    refs.modalBackdrop.querySelector("#threadDialogClose").addEventListener("click", closeThreadDialog);
    refs.modalBackdrop.addEventListener("click", (event) => {
      if (event.target === refs.modalBackdrop) {
        closeThreadDialog();
      }
    });
    refs.modalBackdrop.querySelector(".thread-modal-body").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button || !button.dataset.action) {
        return;
      }
      const action = button.dataset.action;
      const actionThreadId = button.dataset.threadId;
      const actionMessageId = button.dataset.messageId;
      if (!action || !actionThreadId) {
        return;
      }
      const result = await handleThreadAction(action, actionThreadId, actionMessageId, refs, isPublic);
      if (result && result.kind === "opened-modal") {
        return;
      }
      const refreshed = state.threads.find((item) => item.id === threadId);
      if (!refreshed) {
        closeModal(refs);
        return;
      }
      openThreadDialog(threadId, refs, isPublic);
    });
  }

  function mergeRects(rects, canvasRect) {
    const items = Array.from(rects)
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        left: r.left - canvasRect.left,
        top: r.top - canvasRect.top,
        width: r.width,
        height: r.height,
      }))
      .sort((a, b) => a.top - b.top || a.left - b.left);

    if (!items.length) {
      return [];
    }

    const merged = [items[0]];
    for (let i = 1; i < items.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = items[i];
      const prevBottom = prev.top + prev.height;
      const currBottom = curr.top + curr.height;
      const verticalOverlap = Math.abs(prev.top - curr.top) < prev.height * 0.5;

      if (verticalOverlap) {
        const newLeft = Math.min(prev.left, curr.left);
        const newRight = Math.max(prev.left + prev.width, curr.left + curr.width);
        const newTop = Math.min(prev.top, curr.top);
        const newBottom = Math.max(prevBottom, currBottom);
        prev.left = newLeft;
        prev.top = newTop;
        prev.width = newRight - newLeft;
        prev.height = newBottom - newTop;
      } else {
        merged.push(curr);
      }
    }

    return merged;
  }

  function findAnchorAtPoint(x, y, layer) {
    const anchors = layer.querySelectorAll(".anchor-highlight");
    for (const anchor of anchors) {
      const rect = anchor.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return anchor.dataset.threadId || null;
      }
    }
    return null;
  }

  function updateCommentFab(refs) {
    if (!refs.commentFab) {
      return;
    }
    const bubbleVisible = refs.selectionBubble && refs.selectionBubble.offsetParent !== null;
    if (!bubbleVisible && state.pendingAnchor && state.pendingAnchor.quote.trim()) {
      refs.commentFab.style.display = "flex";
      const isMobile = isMobileDevice;
      if (isMobile) {
        refs.commentFab.style.position = "fixed";
        refs.commentFab.style.bottom = "1.25rem";
        refs.commentFab.style.right = "1.25rem";
        refs.commentFab.style.left = "";
        refs.commentFab.style.top = "";
      } else {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const canvasRect = refs.previewCanvas.getBoundingClientRect();
          refs.commentFab.style.position = "absolute";
          refs.commentFab.style.left = `${Math.max(16, rect.left - canvasRect.left)}px`;
          refs.commentFab.style.top = `${rect.bottom - canvasRect.top + 6}px`;
          refs.commentFab.style.bottom = "";
          refs.commentFab.style.right = "";
        }
      }
    } else {
      refs.commentFab.style.display = "none";
    }
  }

  function buildAnchorFromSelection(root, range) {
    const mapping = collectTextNodes(root);
    const start = resolveOffset(root, mapping, range.startContainer, range.startOffset);
    const end = resolveOffset(root, mapping, range.endContainer, range.endOffset);
    if (start == null || end == null || end <= start) {
      return null;
    }
    const quote = mapping.fullText.slice(start, end);
    if (!quote.trim()) {
      return null;
    }
    return {
      quote,
      prefix: mapping.fullText.slice(Math.max(0, start - 40), start),
      suffix: mapping.fullText.slice(end, Math.min(mapping.fullText.length, end + 40)),
      start,
      end,
    };
  }

  function locateAnchor(anchor, root) {
    const mapping = collectTextNodes(root);
    if (!mapping.fullText || !anchor.quote) {
      return null;
    }

    const candidates = [];
    const exactSlice = mapping.fullText.slice(anchor.start, anchor.end);
    if (exactSlice === anchor.quote) {
      candidates.push(anchor.start);
    }

    let index = mapping.fullText.indexOf(anchor.quote);
    while (index !== -1) {
      if (!candidates.includes(index)) {
        candidates.push(index);
      }
      index = mapping.fullText.indexOf(anchor.quote, index + Math.max(1, anchor.quote.length));
    }

    if (!candidates.length) {
      return null;
    }

    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      let score = 0;
      if (mapping.fullText.slice(Math.max(0, candidate - anchor.prefix.length), candidate) === anchor.prefix) {
        score += 12;
      }
      const suffix = mapping.fullText.slice(candidate + anchor.quote.length, candidate + anchor.quote.length + anchor.suffix.length);
      if (suffix === anchor.suffix) {
        score += 12;
      }
      score -= Math.abs(candidate - anchor.start) / 8;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (best == null) {
      return null;
    }

    const range = offsetsToRange(mapping, best, best + anchor.quote.length);
    if (!range) {
      return null;
    }

    return { range, start: best, end: best + anchor.quote.length };
  }

  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) { return node.parentElement?.closest(".mermaid-wrap") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    const segments = [];
    let node;
    let offset = 0;
    let fullText = "";

    while ((node = walker.nextNode())) {
      const value = node.nodeValue || "";
      segments.push({ node, start: offset, end: offset + value.length });
      fullText += value;
      offset += value.length;
    }

    return { fullText, segments };
  }

  function resolveOffset(root, mapping, container, localOffset) {
    if (container.nodeType === Node.TEXT_NODE) {
      const segment = mapping.segments.find((item) => item.node === container);
      return segment ? segment.start + localOffset : null;
    }

    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(container, localOffset);
    return range.toString().length;
  }

  function offsetsToRange(mapping, start, end) {
    const startSegment = mapping.segments.find((segment) => start >= segment.start && start <= segment.end);
    const endSegment = mapping.segments.find((segment) => end >= segment.start && end <= segment.end);
    if (!startSegment || !endSegment) {
      return null;
    }

    const range = document.createRange();
    range.setStart(startSegment.node, start - startSegment.start);
    range.setEnd(endSegment.node, end - endSegment.start);
    return range;
  }

  async function logoutOwner() {
    await api("/api/auth/logout", { method: "POST" });
    window.localStorage.removeItem(ownerTokenKey);
    window.location.href = "/login";
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();

    if (!response.ok) {
      const errorMessage = typeof payload === "string" ? payload : payload.error || "Request failed.";
      throw new Error(errorMessage);
    }

    return payload;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function formatRelativeTime(value) {
    const delta = Math.max(0, Date.now() - new Date(value).getTime());
    const second = 1000;
    const minute = second * 60;
    const hour = minute * 60;
    const day = hour * 24;

    if (delta < minute) {
      return `${Math.max(1, Math.floor(delta / second))}s`;
    }
    if (delta < hour) {
      return `${Math.floor(delta / minute)}m`;
    }
    if (delta < day) {
      return `${Math.floor(delta / hour)}h`;
    }
    return `${Math.floor(delta / day)}d`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
