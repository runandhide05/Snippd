(() => {
  let snippets = [];

  // ── Undo state ──
  let lastExpansion = null;
  let undoTimer = null;

  // ── Load snippets from storage ──
  function loadSnippets() {
    chrome.storage.local.get('snippets', (result) => {
      snippets = result.snippets || [];
    });
  }

  loadSnippets();

  // Refresh snippets when they change in storage (e.g. popup saved)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.snippets) {
      snippets = changes.snippets.newValue || [];
    }
  });

  // ── Variable resolution ──

  // Minimal date formatter: supports YYYY, MM, M, DD, D tokens
  function formatDate(date, fmt) {
    return fmt
      .replace('YYYY', date.getFullYear())
      .replace('MM',   String(date.getMonth() + 1).padStart(2, '0'))
      .replace('M',    date.getMonth() + 1)
      .replace('DD',   String(date.getDate()).padStart(2, '0'))
      .replace('D',    date.getDate());
  }

  // Resolves {{variable}} placeholders. Returns { resolved, cursorOffset }.
  // cursorOffset is null if {{cursor}} is not present.
  function resolveVariables(text) {
    const now = new Date();
    let resolved = text
      .replace(/\{\{date:([^}]+)\}\}/gi, (_, fmt) => formatDate(now, fmt))
      .replace(/\{\{date\}\}/gi, now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))
      .replace(/\{\{time\}\}/gi, now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
      .replace(/\{\{datetime\}\}/gi, now.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }))
      .replace(/\{\{day\}\}/gi, now.toLocaleDateString('en-US', { weekday: 'long' }))
      .replace(/\{\{month\}\}/gi, now.toLocaleDateString('en-US', { month: 'long' }))
      .replace(/\{\{year\}\}/gi, String(now.getFullYear()));

    const cursorOffset = resolved.indexOf('{{cursor}}');
    if (cursorOffset !== -1) {
      resolved = resolved.replace('{{cursor}}', '');
    }
    return { resolved, cursorOffset: cursorOffset === -1 ? null : cursorOffset };
  }

  // ── Cursor helpers ──

  function getTextBeforeCursor(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return el.value.substring(0, el.selectionStart);
    }
    return null;
  }

  function getTextBeforeCursorContentEditable() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    range.setStart(sel.anchorNode, 0);
    return range.toString();
  }

  // ── Trigger matching ──

  function matchTrigger(textBefore) {
    for (const snippet of snippets) {
      const trigger = snippet.trigger;
      if (!trigger || !textBefore.endsWith(trigger)) continue;
      const preceding = textBefore.slice(0, textBefore.length - trigger.length);
      if (preceding.length === 0 || /\s$/.test(preceding)) {
        return snippet;
      }
    }
    return null;
  }

  // ── Expansion: input / textarea ──

  function getNativeSetter(el) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, 'value').set;
  }

  // expansion = already-resolved string. cursorOffset = position within expansion
  // where the cursor should land (null = end of expansion).
  function expandInInput(el, trigger, expansion, cursorOffset) {
    const start = el.selectionStart;
    const value = el.value;
    const triggerStart = start - trigger.length;
    const newValue =
      value.substring(0, triggerStart) +
      expansion +
      value.substring(start);

    const nativeSetter = getNativeSetter(el);
    nativeSetter.call(el, newValue);

    const newCursor = triggerStart + (cursorOffset !== null ? cursorOffset : expansion.length);
    el.selectionStart = newCursor;
    el.selectionEnd   = newCursor;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Expansion: contenteditable ──

  function expandInContentEditable(trigger, expansion, cursorOffset) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const anchorNode   = range.startContainer;
    const anchorOffset = range.startOffset;
    if (anchorNode.nodeType !== Node.TEXT_NODE) return;
    const triggerStart = anchorOffset - trigger.length;
    if (triggerStart < 0) return;
    range.setStart(anchorNode, triggerStart);
    range.deleteContents();
    const textNode = document.createTextNode(expansion);
    range.insertNode(textNode);
    // Position cursor
    const finalOffset = cursorOffset !== null ? cursorOffset : expansion.length;
    range.setStart(textNode, finalOffset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ── Undo ──

  function storeUndo(el, trigger, resolved) {
    if (undoTimer) clearTimeout(undoTimer);

    if (el) {
      // Input / textarea: snapshot the full value before expansion
      const start = el.selectionStart;
      lastExpansion = {
        isContentEditable: false,
        el,
        preValue:  el.value,
        preCursor: start - trigger.length, // start of trigger in pre-expansion value
        trigger,
        resolved,
      };
    } else {
      // Contenteditable: store enough to reverse the insertion
      const sel = window.getSelection();
      const anchorNode   = sel ? sel.anchorNode   : null;
      const anchorOffset = sel ? sel.anchorOffset : 0;
      lastExpansion = {
        isContentEditable: true,
        anchorNode,
        anchorOffset,
        trigger,
        resolved,
      };
    }

    undoTimer = setTimeout(() => { lastExpansion = null; }, 2000);
  }

  function undoLastExpansion() {
    if (!lastExpansion) return;
    clearTimeout(undoTimer);
    const u = lastExpansion;
    lastExpansion = null;

    if (!u.isContentEditable) {
      // Restore the pre-expansion value
      const nativeSetter = getNativeSetter(u.el);
      nativeSetter.call(u.el, u.preValue);
      const restoredCursor = u.preCursor + u.trigger.length;
      u.el.selectionStart = restoredCursor;
      u.el.selectionEnd   = restoredCursor;
      u.el.dispatchEvent(new Event('input',  { bubbles: true }));
      u.el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Delete the expanded text and re-insert the trigger
      const sel = window.getSelection();
      if (!sel || !u.anchorNode || u.anchorNode.nodeType !== Node.TEXT_NODE) return;
      // After expansion the cursor is somewhere in the node; walk back resolved.length
      const currentOffset = sel.anchorOffset;
      const expandedEnd   = currentOffset;
      const expandedStart = expandedEnd - u.resolved.length;
      if (expandedStart < 0) return;
      const range = document.createRange();
      range.setStart(u.anchorNode, expandedStart);
      range.setEnd(u.anchorNode, expandedEnd);
      range.deleteContents();
      const restored = document.createTextNode(u.trigger);
      range.insertNode(restored);
      range.setStart(restored, u.trigger.length);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // Catch Escape before the page does
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !lastExpansion) return;
    e.stopPropagation();
    undoLastExpansion();
  }, true);

  // ── Increment usage counter ──

  function incrementUsage(snippetId) {
    chrome.storage.local.get('snippets', (result) => {
      const arr = result.snippets || [];
      const idx = arr.findIndex((s) => s.id === snippetId);
      if (idx === -1) return;
      arr[idx].usageCount = (arr[idx].usageCount || 0) + 1;
      arr[idx].lastUsed   = new Date().toISOString();
      chrome.storage.local.set({ snippets: arr });
      snippets = arr;
    });
  }

  // ── Reserved ;snippd trigger to open popup ──

  const POPUP_TRIGGER = ';snippd';

  function tryOpenPopup(textBefore, el) {
    if (!textBefore.endsWith(POPUP_TRIGGER)) return false;
    const preceding = textBefore.slice(0, textBefore.length - POPUP_TRIGGER.length);
    if (preceding.length > 0 && !/\s$/.test(preceding)) return false;
    if (el) {
      expandInInput(el, POPUP_TRIGGER, '', null);
    } else {
      expandInContentEditable(POPUP_TRIGGER, '', null);
    }
    chrome.runtime.sendMessage({ action: 'openPopup' });
    return true;
  }

  // ── Main keyup handler ──

  function onKeyUp(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const el = e.target;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const textBefore = getTextBeforeCursor(el);
      if (textBefore === null) return;
      if (tryOpenPopup(textBefore, el)) return;
      if (!snippets.length) return;
      const snippet = matchTrigger(textBefore);
      if (snippet) {
        const { resolved, cursorOffset } = resolveVariables(snippet.expansion);
        storeUndo(el, snippet.trigger, resolved);
        expandInInput(el, snippet.trigger, resolved, cursorOffset);
        incrementUsage(snippet.id);
      }
      return;
    }

    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      const textBefore = getTextBeforeCursorContentEditable();
      if (textBefore === null) return;
      if (tryOpenPopup(textBefore, null)) return;
      if (!snippets.length) return;
      const snippet = matchTrigger(textBefore);
      if (snippet) {
        const { resolved, cursorOffset } = resolveVariables(snippet.expansion);
        storeUndo(null, snippet.trigger, resolved);
        expandInContentEditable(snippet.trigger, resolved, cursorOffset);
        incrementUsage(snippet.id);
      }
    }
  }

  document.addEventListener('keyup', onKeyUp, true);

  // MutationObserver kept for future per-element setup if needed
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true });
})();
