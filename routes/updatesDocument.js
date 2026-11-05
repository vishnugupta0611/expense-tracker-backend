const ALLOWED_NODES = new Set([
  'doc', 'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList',
  'listItem', 'codeBlock', 'horizontalRule', 'hardBreak', 'text', 'table',
  'tableRow', 'tableCell', 'tableHeader', 'image', 'factCard',
]);
const ALLOWED_MARKS = new Set([
  'bold', 'italic', 'strike', 'code', 'underline', 'highlight', 'link', 'textStyle',
]);
const SAFE_FONT_FAMILIES = new Set([
  'Georgia, serif',
  "'Courier New', monospace",
  'Arial, sans-serif',
  'system-ui, sans-serif',
]);

function safeText(value, maxLength = 500) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > 2048) return null;
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return null;
}

function safeColor(value) {
  if (typeof value !== 'string') return null;
  const color = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)$/i.test(color)) return color;
  if (/^[a-z]{3,20}$/i.test(color)) return color;
  return null;
}

function sanitizeDocument(document) {
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized, 'utf8') > 5 * 1024 * 1024) {
    throw new Error('Chapter content exceeds the 5 MB limit');
  }

  let visited = 0;
  const sanitizeNode = (node, depth = 0, isRoot = false) => {
    visited += 1;
    if (visited > 25000 || depth > 40) {
      throw new Error('Chapter content is too large or deeply nested');
    }
    if (!node || typeof node !== 'object' || !ALLOWED_NODES.has(node.type)) {
      throw new Error('Unsupported editor node in chapter content');
    }

    const clean = { type: node.type };
    const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : {};

    if (node.type === 'heading') {
      const level = Number(attrs.level);
      clean.attrs = { level: Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1 };
    } else if (node.type === 'orderedList') {
      const start = Number(attrs.start);
      clean.attrs = { start: Number.isInteger(start) && start > 0 && start <= 9999 ? start : 1 };
    } else if (node.type === 'codeBlock') {
      clean.attrs = { language: safeText(attrs.language, 48).replace(/[^a-z0-9_+#.-]/gi, '') || 'text' };
    } else if (node.type === 'tableCell' || node.type === 'tableHeader') {
      const colspan = Number(attrs.colspan);
      const rowspan = Number(attrs.rowspan);
      const colwidth = Array.isArray(attrs.colwidth)
        ? attrs.colwidth.slice(0, 12).map((value) => Math.max(1, Math.min(2000, Number(value) || 1)))
        : null;
      clean.attrs = {
        colspan: Number.isInteger(colspan) && colspan > 0 && colspan <= 12 ? colspan : 1,
        rowspan: Number.isInteger(rowspan) && rowspan > 0 && rowspan <= 100 ? rowspan : 1,
        colwidth,
      };
    } else if (node.type === 'image') {
      const src = safeUrl(attrs.src);
      if (!src || !/^https?:/i.test(src)) throw new Error('Image URLs must use HTTPS or HTTP');
      const position = ['left', 'right', 'center', 'top'].includes(attrs.position) ? attrs.position : 'center';
      const size = ['small', 'medium', 'large', 'full'].includes(attrs.size) ? attrs.size : 'medium';
      clean.attrs = {
        src,
        alt: safeText(attrs.alt, 300),
        title: safeText(attrs.title, 300),
        position,
        size,
        caption: safeText(attrs.caption, 1000),
      };
    } else if (node.type === 'factCard') {
      clean.attrs = {
        emoji: safeText(attrs.emoji, 12) || '💡',
        color: safeColor(attrs.color),
        fontStyle: ['serif', 'mono', 'italic', 'bold'].includes(attrs.fontStyle) ? attrs.fontStyle : null,
      };
    }

    if (node.type === 'text') {
      if (typeof node.text !== 'string' || node.text.length > 200000) {
        throw new Error('Invalid text node in chapter content');
      }
      clean.text = node.text;
    }

    if (Array.isArray(node.marks)) {
      clean.marks = node.marks.map((mark) => {
        if (!mark || !ALLOWED_MARKS.has(mark.type)) {
          throw new Error('Unsupported text mark in chapter content');
        }
        const nextMark = { type: mark.type };
        const markAttrs = mark.attrs && typeof mark.attrs === 'object' ? mark.attrs : {};
        if (mark.type === 'link') {
          const href = safeUrl(markAttrs.href);
          if (!href) throw new Error('Links must use HTTP, HTTPS, mailto, tel or a relative URL');
          nextMark.attrs = {
            href,
            target: markAttrs.target === '_blank' ? '_blank' : '_self',
            rel: 'noopener noreferrer',
            title: safeText(markAttrs.title, 200),
          };
        } else if (mark.type === 'highlight') {
          const color = safeColor(markAttrs.color);
          nextMark.attrs = color ? { color } : {};
        } else if (mark.type === 'textStyle') {
          const attrs = {};
          const color = safeColor(markAttrs.color);
          if (color) attrs.color = color;
          if (SAFE_FONT_FAMILIES.has(markAttrs.fontFamily)) attrs.fontFamily = markAttrs.fontFamily;
          nextMark.attrs = attrs;
        }
        return nextMark;
      });
    }

    if (node.content !== undefined && !Array.isArray(node.content)) {
      throw new Error('Invalid child content in chapter document');
    }
    if (Array.isArray(node.content)) {
      clean.content = node.content.map((child) => sanitizeNode(child, depth + 1));
    }

    const blockTypes = [
      'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList',
      'codeBlock', 'horizontalRule', 'table', 'factCard',
    ];
    const childRules = {
      doc: blockTypes,
      paragraph: ['text', 'hardBreak', 'image'],
      heading: ['text', 'hardBreak', 'image'],
      blockquote: blockTypes,
      bulletList: ['listItem'],
      orderedList: ['listItem'],
      listItem: blockTypes,
      codeBlock: ['text'],
      table: ['tableRow'],
      tableRow: ['tableCell', 'tableHeader'],
      tableCell: blockTypes,
      tableHeader: blockTypes,
      factCard: blockTypes,
    };
    const children = clean.content || [];
    if (
      childRules[node.type] &&
      children.some((child) => !childRules[node.type].includes(child.type))
    ) {
      throw new Error('Invalid node nesting in chapter document');
    }
    if (
      ['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'table',
        'tableRow', 'tableCell', 'tableHeader', 'factCard'].includes(node.type) &&
      children.length === 0
    ) {
      throw new Error('A required content section is empty');
    }
    if (
      !childRules[node.type] &&
      Array.isArray(node.content) &&
      node.content.length > 0
    ) {
      throw new Error('This editor node cannot contain child content');
    }
    if (Array.isArray(node.marks) && node.type !== 'text' && node.marks.length) {
      throw new Error('Only text nodes can contain text marks');
    }

    if (isRoot && clean.type !== 'doc') throw new Error('Document root must be a doc node');
    return clean;
  };

  return sanitizeNode(document, 0, true);
}

module.exports = { sanitizeDocument };
