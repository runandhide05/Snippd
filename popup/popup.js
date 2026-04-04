(() => {
  const STORAGE_KEY = 'snippets';
  const MAX_SNIPPETS = 100;
  const MAX_EXPANSION = 5000;

  let snippets = [];
  let editingId = null;       // null = adding new
  let filterCategory = null;  // null = All; string = active category
  let searchQuery = '';

  // ── DOM refs ──
  const btnAdd          = document.getElementById('btn-add');
  const formSection     = document.getElementById('form-section');
  const formTitle       = document.getElementById('form-title');
  const inputLabel      = document.getElementById('input-label');
  const inputTrigger    = document.getElementById('input-trigger');
  const inputExpansion  = document.getElementById('input-expansion');
  const inputCategory   = document.getElementById('input-category');
  const inputNewCategory = document.getElementById('input-new-category');
  const btnNewCategory  = document.getElementById('btn-new-category');
  const btnCancel       = document.getElementById('btn-cancel');
  const btnSave         = document.getElementById('btn-save');
  const formError       = document.getElementById('form-error');
  const snippetList     = document.getElementById('snippet-list');
  const emptyState      = document.getElementById('empty-state');
  const categoryBar     = document.getElementById('category-bar');
  const searchInput     = document.getElementById('search-input');
  const btnExport       = document.getElementById('btn-export');
  const importFile      = document.getElementById('import-file');
  const varChips        = document.getElementById('var-chips');

  // ── Migration ──
  function migrate(arr) {
    return arr.map((s) => ({
      category:   null,
      usageCount: 0,
      lastUsed:   null,
      ...s,
    }));
  }

  // ── Storage ──
  function load(cb) {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const raw = result[STORAGE_KEY] || [];
      const migrated = migrate(raw);
      snippets = migrated;
      if (JSON.stringify(raw) !== JSON.stringify(migrated)) {
        save(() => cb());
      } else {
        cb();
      }
    });
  }

  function save(cb) {
    chrome.storage.local.set({ [STORAGE_KEY]: snippets }, cb);
  }

  // ── Category helpers ──
  function getCategories() {
    const cats = new Set();
    snippets.forEach((s) => { if (s.category) cats.add(s.category); });
    return [...cats].sort((a, b) => a.localeCompare(b));
  }

  function getFilteredSnippets() {
    let list = snippets;

    if (filterCategory !== null) {
      list = list.filter((s) => s.category === filterCategory);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((s) =>
        s.trigger.toLowerCase().includes(q) ||
        (s.label || '').toLowerCase().includes(q) ||
        (s.expansion || '').toLowerCase().includes(q)
      );
    }

    return list;
  }

  // ── Render helpers ──
  function renderCategoryBar() {
    const cats = getCategories();
    categoryBar.innerHTML = '';

    if (cats.length === 0) {
      categoryBar.classList.add('hidden');
      return;
    }

    categoryBar.classList.remove('hidden');

    const allPill = document.createElement('button');
    allPill.className = 'cat-pill' + (filterCategory === null ? ' active' : '');
    allPill.textContent = 'All';
    allPill.dataset.cat = '';
    categoryBar.appendChild(allPill);

    cats.forEach((cat) => {
      const pill = document.createElement('button');
      pill.className = 'cat-pill' + (filterCategory === cat ? ' active' : '');
      pill.textContent = cat;
      pill.dataset.cat = cat;
      categoryBar.appendChild(pill);
    });
  }

  function renderCategorySelect(selectedCat) {
    inputCategory.innerHTML = '<option value="">— None —</option>';
    getCategories().forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (cat === selectedCat) opt.selected = true;
      inputCategory.appendChild(opt);
    });
  }

  // ── Render ──
  function render() {
    renderCategoryBar();
    snippetList.innerHTML = '';

    const visible = getFilteredSnippets();

    if (visible.length === 0) {
      emptyState.classList.remove('hidden');
      if (snippets.length === 0) {
        emptyState.innerHTML = `
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="8" width="36" height="32" rx="4" stroke="#4f46e5" stroke-width="2.5" fill="none"/>
            <line x1="13" y1="17" x2="35" y2="17" stroke="#4f46e5" stroke-width="2" stroke-linecap="round"/>
            <line x1="13" y1="24" x2="28" y2="24" stroke="#4f46e5" stroke-width="2" stroke-linecap="round"/>
            <line x1="13" y1="31" x2="22" y2="31" stroke="#4f46e5" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <p>Your snippets live here.</p>
          <p>Click <strong>+ Add Snippet</strong> to create one.</p>`;
      } else {
        emptyState.innerHTML = '<p>No snippets match your search.</p>';
      }
      return;
    }

    emptyState.classList.add('hidden');

    visible.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'snippet-item';

      const preview = s.expansion ? escapeHtml(s.expansion.replace(/\n/g, ' ').slice(0, 80)) : '';

      const catBadge   = s.category   ? `<span class="badge badge-cat">${escapeHtml(s.category)}</span>` : '';
      const usageBadge = s.usageCount > 0
        ? `<span class="badge badge-usage">${s.usageCount}×</span>`
        : '';
      const badges = (catBadge || usageBadge)
        ? `<div class="snippet-badges">${catBadge}${usageBadge}</div>`
        : '';

      item.innerHTML = `
        <div class="snippet-info">
          <div class="snippet-label" title="${escapeHtml(s.label || s.trigger)}">${escapeHtml(s.label || s.trigger)}</div>
          <div class="snippet-trigger">${escapeHtml(s.trigger)}</div>
          ${preview ? `<div class="snippet-preview" title="${preview}">${preview}</div>` : ''}
          ${badges}
        </div>
        <div class="snippet-actions">
          <button class="btn-icon edit"   data-id="${s.id}" title="Edit">Edit</button>
          <button class="btn-icon delete" data-id="${s.id}" title="Delete">Delete</button>
        </div>
      `;
      snippetList.appendChild(item);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Form helpers ──
  function showForm(title, selectedCat) {
    formTitle.textContent = title;
    renderCategorySelect(selectedCat || null);
    formSection.classList.remove('hidden');
    hideError();
    inputLabel.focus();
  }

  function hideForm() {
    formSection.classList.add('hidden');
    inputLabel.value = '';
    inputTrigger.value = '';
    inputExpansion.value = '';
    inputCategory.value = '';
    inputNewCategory.classList.add('hidden');
    inputNewCategory.value = '';
    editingId = null;
    hideError();
  }

  function showError(msg) {
    formError.textContent = msg;
    formError.classList.remove('hidden');
  }

  function hideError() {
    formError.classList.add('hidden');
    formError.textContent = '';
  }

  // ── Validation ──
  function validate() {
    const trigger = inputTrigger.value.trim();
    const expansion = inputExpansion.value;

    if (!trigger) {
      showError('Trigger is required.');
      inputTrigger.focus();
      return false;
    }
    if (!trigger.startsWith(';')) {
      showError('Trigger must start with ";".');
      inputTrigger.focus();
      return false;
    }
    if (trigger.length < 2) {
      showError('Trigger must be at least 2 characters (e.g. ";a").');
      inputTrigger.focus();
      return false;
    }
    if (!expansion.trim()) {
      showError('Expansion text is required.');
      inputExpansion.focus();
      return false;
    }
    if (expansion.length > MAX_EXPANSION) {
      showError(`Expansion must be ${MAX_EXPANSION} characters or less.`);
      inputExpansion.focus();
      return false;
    }
    const duplicate = snippets.find(
      (s) => s.trigger === trigger && s.id !== editingId
    );
    if (duplicate) {
      showError(`Trigger "${trigger}" already exists.`);
      inputTrigger.focus();
      return false;
    }
    if (editingId === null && snippets.length >= MAX_SNIPPETS) {
      showError(`Maximum of ${MAX_SNIPPETS} snippets reached.`);
      return false;
    }
    return true;
  }

  // ── Event: Add button ──
  btnAdd.addEventListener('click', () => {
    editingId = null;
    inputLabel.value = '';
    inputTrigger.value = '';
    inputExpansion.value = '';
    showForm('New Snippet', null);
  });

  // ── Event: Cancel ──
  btnCancel.addEventListener('click', hideForm);

  // ── Event: Save ──
  btnSave.addEventListener('click', () => {
    if (!validate()) return;

    const trigger   = inputTrigger.value.trim();
    const expansion = inputExpansion.value;
    const label     = inputLabel.value.trim();

    // Resolve category: prefer new-category input if visible and non-empty
    let category = null;
    if (!inputNewCategory.classList.contains('hidden') && inputNewCategory.value.trim()) {
      category = inputNewCategory.value.trim();
    } else if (inputCategory.value) {
      category = inputCategory.value;
    }

    if (editingId === null) {
      snippets.push({
        id:         crypto.randomUUID(),
        trigger,
        expansion,
        label,
        createdAt:  new Date().toISOString(),
        category,
        usageCount: 0,
        lastUsed:   null,
      });
    } else {
      const idx = snippets.findIndex((s) => s.id === editingId);
      if (idx !== -1) {
        snippets[idx] = { ...snippets[idx], trigger, expansion, label, category };
      }
    }

    save(() => {
      hideForm();
      render();
    });
  });

  // ── Event: Edit / Delete (delegated) ──
  snippetList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.classList.contains('edit')) {
      const snippet = snippets.find((s) => s.id === id);
      if (!snippet) return;
      editingId = id;
      inputLabel.value     = snippet.label || '';
      inputTrigger.value   = snippet.trigger;
      inputExpansion.value = snippet.expansion;
      showForm('Edit Snippet', snippet.category);
    }

    if (btn.classList.contains('delete')) {
      snippets = snippets.filter((s) => s.id !== id);
      save(() => render());
    }
  });

  // ── Auto-prefix trigger with ; ──
  inputTrigger.addEventListener('input', () => {
    const val = inputTrigger.value;
    if (val.length > 0 && !val.startsWith(';')) {
      inputTrigger.value = ';' + val;
    }
  });

  // ── Event: Search ──
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    render();
  });

  // ── Event: Category bar (delegated) ──
  categoryBar.addEventListener('click', (e) => {
    const pill = e.target.closest('.cat-pill');
    if (!pill) return;
    filterCategory = pill.dataset.cat === '' ? null : pill.dataset.cat;
    render();
  });

  // ── Event: New category button ──
  btnNewCategory.addEventListener('click', () => {
    inputNewCategory.classList.remove('hidden');
    inputNewCategory.focus();
    inputCategory.value = '';
  });

  inputNewCategory.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const name = inputNewCategory.value.trim();
      if (!name) return;
      let opt = [...inputCategory.options].find((o) => o.value === name);
      if (!opt) {
        opt = new Option(name, name);
        inputCategory.appendChild(opt);
      }
      inputCategory.value = name;
      inputNewCategory.classList.add('hidden');
    }
    if (e.key === 'Escape') {
      inputNewCategory.classList.add('hidden');
      inputNewCategory.value = '';
    }
  });

  // ── Event: Variable chips ──
  varChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.var-chip');
    if (!chip) return;
    const varText = chip.dataset.var;
    const pos = inputExpansion.selectionStart;
    const before = inputExpansion.value.substring(0, pos);
    const after  = inputExpansion.value.substring(inputExpansion.selectionEnd);
    inputExpansion.value = before + varText + after;
    const newPos = pos + varText.length;
    inputExpansion.selectionStart = newPos;
    inputExpansion.selectionEnd   = newPos;
    inputExpansion.focus();
  });

  // ── Event: Export ──
  btnExport.addEventListener('click', () => {
    const data = JSON.stringify(snippets, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `snippd-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Event: Import ──
  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    importFile.value = '';

    const reader = new FileReader();
    reader.onload = (ev) => {
      let parsed;
      try {
        parsed = JSON.parse(ev.target.result);
      } catch {
        alert('Import failed: invalid JSON file.');
        return;
      }

      if (!Array.isArray(parsed)) {
        alert('Import failed: JSON must be an array of snippets.');
        return;
      }

      const valid = [];
      const skipped = [];

      parsed.forEach((item, i) => {
        if (
          typeof item.trigger   !== 'string' ||
          typeof item.expansion !== 'string' ||
          !item.trigger.startsWith(';')      ||
          item.trigger.length < 2            ||
          !item.expansion.trim()             ||
          item.expansion.length > MAX_EXPANSION
        ) {
          skipped.push(i + 1);
          return;
        }

        const exists = snippets.some((s) => s.trigger === item.trigger);
        if (exists) {
          skipped.push(`${i + 1} (duplicate trigger ${item.trigger})`);
          return;
        }

        valid.push({
          id:         crypto.randomUUID(),
          trigger:    item.trigger,
          expansion:  item.expansion,
          label:      typeof item.label    === 'string' ? item.label.slice(0, 100)  : '',
          category:   typeof item.category === 'string' ? item.category.slice(0, 50) : null,
          createdAt:  new Date().toISOString(),
          usageCount: 0,
          lastUsed:   null,
        });
      });

      const canAdd = MAX_SNIPPETS - snippets.length;
      const toAdd  = valid.slice(0, canAdd);
      const capped = valid.length - toAdd.length;

      snippets = [...snippets, ...toAdd];
      save(() => {
        render();
        let msg = `Imported ${toAdd.length} snippet${toAdd.length === 1 ? '' : 's'}.`;
        if (skipped.length) msg += ` Skipped ${skipped.length} invalid/duplicate.`;
        if (capped > 0)     msg += ` ${capped} not added (100 snippet limit reached).`;
        alert(msg);
      });
    };

    reader.readAsText(file);
  });

  // ── Storage sync (e.g. usageCount updates from content.js) ──
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY]) {
      snippets = changes[STORAGE_KEY].newValue || [];
      render();
    }
  });

  // ── Init ──
  load(render);
})();
