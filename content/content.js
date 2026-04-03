(() => {
  let snippets = [];

  // Load snippets from storage
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

  // Get the text before the cursor in an input/textarea
  function getTextBeforeCursor(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return el.value.substring(0, el.selectionStart);
    }
    return null;
  }

  // Get the text before the cursor in a contenteditable element
  function getTextBeforeCursorContentEditable() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    // Move to start of container
    range.setStart(sel.anchorNode, 0);
    return range.toString();
  }

  // Check if a trigger matches at the end of text and is preceded by
  // whitespace or the start of the field
  function matchTrigger(textBefore) {
    for (const snippet of snippets) {
      const trigger = snippet.trigger;
      if (!trigger || !textBefore.endsWith(trigger)) continue;
      const preceding = textBefore.slice(0, textBefore.length - trigger.length);
      // Trigger must be at start of field or preceded by whitespace
      if (preceding.length === 0 || /\s$/.test(preceding)) {
        return snippet;
      }
    }
    return null;
  }

  // Replace trigger with expansion in input/textarea
  function expandInInput(el, trigger, expansion) {
    const start = el.selectionStart;
    const value = el.value;
    const triggerStart = start - trigger.length;
    const newValue =
      value.substring(0, triggerStart) +
      expansion +
      value.substring(start);

    // Use the native prototype setter so React/Vue controlled inputs
    // recognize the change (direct el.value= assignment bypasses their
    // internal tracking and gets reverted on the next render)
    const proto =
      el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    nativeSetter.call(el, newValue);

    const newCursor = triggerStart + expansion.length;
    el.selectionStart = newCursor;
    el.selectionEnd = newCursor;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Replace trigger with expansion in contenteditable
  function expandInContentEditable(trigger, expansion) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // Walk back trigger.length characters to select the trigger text
    const anchorNode = range.startContainer;
    const anchorOffset = range.startOffset;
    if (anchorNode.nodeType !== Node.TEXT_NODE) return;
    const triggerStart = anchorOffset - trigger.length;
    if (triggerStart < 0) return;
    range.setStart(anchorNode, triggerStart);
    range.deleteContents();
    const textNode = document.createTextNode(expansion);
    range.insertNode(textNode);
    // Move cursor to end of inserted text
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Increment usageCount and update lastUsed for a snippet
  function incrementUsage(snippetId) {
    chrome.storage.local.get('snippets', (result) => {
      const arr = result.snippets || [];
      const idx = arr.findIndex((s) => s.id === snippetId);
      if (idx === -1) return;
      arr[idx].usageCount = (arr[idx].usageCount || 0) + 1;
      arr[idx].lastUsed = new Date().toISOString();
      chrome.storage.local.set({ snippets: arr });
      snippets = arr;
    });
  }

  // Reserved trigger to open the popup
  const POPUP_TRIGGER = ';snippd';

  function tryOpenPopup(textBefore, el) {
    const preceding = textBefore.slice(0, textBefore.length - POPUP_TRIGGER.length);
    if (!textBefore.endsWith(POPUP_TRIGGER)) return false;
    if (preceding.length > 0 && !/\s$/.test(preceding)) return false;

    // Delete the trigger text then open the popup
    if (el) {
      expandInInput(el, POPUP_TRIGGER, '');
    } else {
      expandInContentEditable(POPUP_TRIGGER, '');
    }
    chrome.runtime.sendMessage({ action: 'openPopup' });
    return true;
  }

  // Main keyup handler
  function onKeyUp(e) {
    // Ignore modifier-only, arrow, and other non-character keys
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const el = e.target;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const textBefore = getTextBeforeCursor(el);
      if (textBefore === null) return;
      if (tryOpenPopup(textBefore, el)) return;
      if (!snippets.length) return;
      const snippet = matchTrigger(textBefore);
      if (snippet) {
        expandInInput(el, snippet.trigger, snippet.expansion);
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
        expandInContentEditable(snippet.trigger, snippet.expansion);
        incrementUsage(snippet.id);
      }
    }
  }

  document.addEventListener('keyup', onKeyUp, true);

  // Watch for dynamically added inputs (Gmail, SPAs, etc.)
  const observer = new MutationObserver(() => {
    // No extra work needed — event delegation on document catches all elements
    // Observer is here in case future versions need per-element setup
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
