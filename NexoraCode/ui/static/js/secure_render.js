(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isSafeUrl(rawValue, allowDataImage) {
    const value = String(rawValue ?? '').trim();
    if (!value) return false;
    if (value.startsWith('#') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) {
      return true;
    }
    try {
      const parsed = new URL(value, window.location.href);
      const protocol = String(parsed.protocol || '').toLowerCase();
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:') {
        return true;
      }
      if (allowDataImage && protocol === 'data:') {
        return /^data:image\/(png|jpe?g|gif|webp|bmp|avif);/i.test(value);
      }
    } catch (_) {
      return false;
    }
    return false;
  }

  function sanitizeHtmlFragment(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html ?? '');

    const blockedTags = new Set([
      'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT',
      'BUTTON', 'SELECT', 'OPTION', 'TEXTAREA', 'NOSCRIPT', 'LINK', 'META',
      'BASE', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'CANVAS', 'FRAME', 'FRAMESET'
    ]);
    const allowedTags = new Set([
      'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DIV', 'EM', 'H1',
      'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'KBD', 'LI', 'MARK', 'OL',
      'P', 'PRE', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY',
      'TD', 'TH', 'THEAD', 'TFOOT', 'TR', 'U', 'UL', 'DETAILS', 'SUMMARY', 'FIGURE',
      'FIGCAPTION'
    ]);

    const tagAttrs = {
      A: new Set(['href', 'title', 'target', 'rel', 'class', 'id']),
      IMG: new Set(['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'referrerpolicy', 'class', 'id']),
      CODE: new Set(['class', 'id']),
      PRE: new Set(['class', 'id']),
      SPAN: new Set(['class', 'id', 'title', 'role', 'aria-hidden', 'aria-label', 'aria-describedby']),
      DIV: new Set(['class', 'id', 'title', 'role', 'aria-hidden', 'aria-label', 'aria-describedby']),
      P: new Set(['class', 'id', 'title']),
      BLOCKQUOTE: new Set(['class', 'id', 'cite']),
      TABLE: new Set(['class', 'id']),
      THEAD: new Set(['class', 'id']),
      TBODY: new Set(['class', 'id']),
      TFOOT: new Set(['class', 'id']),
      TR: new Set(['class', 'id']),
      TH: new Set(['class', 'id', 'colspan', 'rowspan', 'align']),
      TD: new Set(['class', 'id', 'colspan', 'rowspan', 'align']),
      LI: new Set(['class', 'id']),
      OL: new Set(['class', 'id']),
      UL: new Set(['class', 'id']),
      H1: new Set(['class', 'id']),
      H2: new Set(['class', 'id']),
      H3: new Set(['class', 'id']),
      H4: new Set(['class', 'id']),
      H5: new Set(['class', 'id']),
      H6: new Set(['class', 'id']),
      DETAILS: new Set(['class', 'id', 'open']),
      SUMMARY: new Set(['class', 'id']),
      FIGURE: new Set(['class', 'id']),
      FIGCAPTION: new Set(['class', 'id'])
    };

    const allElements = Array.from(template.content.querySelectorAll('*'));
    for (const el of allElements) {
      const tag = String(el.tagName || '').toUpperCase();
      if (blockedTags.has(tag)) {
        el.remove();
        continue;
      }
      if (!allowedTags.has(tag)) {
        const parent = el.parentNode;
        if (!parent) continue;
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
        continue;
      }

      const allowed = tagAttrs[tag] || new Set();
      Array.from(el.attributes).forEach((attr) => {
        const name = String(attr.name || '').toLowerCase();
        const value = String(attr.value || '');
        if (name.startsWith('on') || name === 'style' || name === 'srcdoc' || name === 'formaction') {
          el.removeAttribute(attr.name);
          return;
        }
        if (name === 'href') {
          if (!isSafeUrl(value, false)) {
            el.removeAttribute(attr.name);
            return;
          }
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer nofollow');
          return;
        }
        if (name === 'src') {
          if (!isSafeUrl(value, true)) {
            el.removeAttribute(attr.name);
          }
          return;
        }
        if (name.startsWith('aria-') || name === 'role' || name === 'title' || name === 'class' || name === 'id' || name === 'open') {
          return;
        }
        if (allowed.has(name)) {
          return;
        }
        if (name.startsWith('data-')) {
          return;
        }
        el.removeAttribute(attr.name);
      });
    }

    return template.innerHTML;
  }

  function setSafeHTML(element, html) {
    if (!element) return '';
    const safe = sanitizeHtmlFragment(html);
    element.innerHTML = safe;
    return safe;
  }

  function safeMarkdownToHtml(markdown) {
    const raw = String(markdown ?? '');
    const html = global.marked && typeof global.marked.parse === 'function'
      ? global.marked.parse(raw)
      : escapeHtml(raw).replace(/\n/g, '<br>');
    return sanitizeHtmlFragment(html);
  }

  global.NexoraSecureRender = {
    escapeHtml,
    sanitizeHtmlFragment,
    setSafeHTML,
    safeMarkdownToHtml,
    isSafeUrl,
  };
})(window);