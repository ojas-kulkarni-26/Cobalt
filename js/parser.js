// ============================================
// COBALT — parser.js
// Smart paste: parse markdown/HTML into blocks
// ============================================

import { generateId } from './utils.js';

const BLOCK_TYPES = [
  { type: 'paragraph', label: 'Paragraph',     defaultContent: { text: '' } },
  { type: 'h1',        label: 'Heading 1',     defaultContent: { text: '' } },
  { type: 'h2',        label: 'Heading 2',     defaultContent: { text: '' } },
  { type: 'h3',        label: 'Heading 3',     defaultContent: { text: '' } },
  { type: 'bullet',    label: 'Bullet List',   defaultContent: { text: '' } },
  { type: 'numbered',  label: 'Numbered List', defaultContent: { text: '', number: 1 } },
  { type: 'quote',     label: 'Quote',         defaultContent: { text: '' } },
  { type: 'callout',   label: 'Callout',       defaultContent: { text: '', icon: '💡' } },
  { type: 'code',      label: 'Code',          defaultContent: { code: '', language: 'javascript' } },
  { type: 'math',      label: 'Math / LaTeX',  defaultContent: { latex: '' } },
  { type: 'image',     label: 'Image',         defaultContent: { url: '', caption: '' } },
  { type: 'table',     label: 'Table',         defaultContent: { headers: ['Column 1', 'Column 2', 'Column 3'], rows: [['', '', ''], ['', '', '']] } },
  { type: 'divider',   label: 'Divider',       defaultContent: {} },
  { type: 'toggle',    label: 'Toggle',       defaultContent: { title: '', body: '', open: false } },
];

export function parsePastedContent(text, html = '') {
  const hasMarkdown = containsMarkdown(text);
  const hasHtmlStructure = html && html.trim().length > 0;
  
  console.log('Parser Debug:', { hasMarkdown, hasHtmlStructure, textPreview: text.substring(0, 50) });
  
  // Prefer markdown detection over HTML if markdown detected
  if (hasMarkdown) {
    return parseMarkdown(text);
  } else if (hasHtmlStructure) {
    // Even with HTML, try to parse as markdown first if text looks like markdown
    return parseMarkdown(text);
  } else {
    return [{ type: 'paragraph', content: { text: escapeHtml(text) } }];
  }
}

function containsMarkdown(text) {
  const mdPatterns = [
    /^#{1,6}\s/m,
    /^[-*\u2022\u2023\u25E6\u2043\u2219]\s/m,
    /^\d+\.\s/m,
    /^>\s/m,
    /^```[\s\S]*?```/m,
    /^\|.+\|/m,
    /^[-*_]{3,}$/m,
    /\$\$[\s\S]*?\$\$/m,
    /\\\[[\s\S]*?\\\]/m,
    /\\\\\[/m,
  ];
  try {
    return mdPatterns.some(p => p.test(text));
  } catch (e) {
    return false;
  }
}

export function parseMarkdown(mdText) {
  // Pre-process display math blocks \[...\]
  let processedText = mdText.replace(/\\\[([\s\S]*?)\\\]/g, (match, latex) => {
    return `$$${latex.trim()}$$`;
  });
  
  if (!window.marked) {
    return [{ type: 'paragraph', content: { text: escapeHtml(mdText) } }];
  }

  const blocks = [];
  const tokens = window.marked.lexer(processedText);
  
  let listAccumulator = null;
  let listType = null;
  
  for (const token of tokens) {
    const block = tokenToBlock(token);
    if (!block) continue;
    
    if (block.type === 'bullet' || block.type === 'numbered') {
      // Filter out empty list items
      const text = block.content.text?.trim() || '';
      if (!text) continue;
      
      // Strip leading list markers from text
      const cleanedText = cleanListItemText(text, block.type);
      block.content.text = cleanedText;
      
      if (listAccumulator && listType === block.type) {
        listAccumulator.items.push(block.content);
      } else {
        if (listAccumulator) {
          blocks.push(listAccumulator);
        }
        listType = block.type;
        listAccumulator = {
          type: block.type,
          items: [block.content]
        };
      }
    } else {
      if (listAccumulator) {
        // Filter out empty list items before pushing
        const filteredItems = listAccumulator.items.filter(item => 
          (item.text?.trim() || '').length > 0
        );
        if (filteredItems.length > 0) {
          blocks.push({ ...listAccumulator, items: filteredItems });
        }
        listAccumulator = null;
        listType = null;
      }
      
      // Filter out empty blocks (paragraphs with empty/whitespace text)
      if (block.type === 'paragraph') {
        const text = block.content.text?.trim() || '';
        if (!text) continue;
      }
      
      blocks.push(block);
    }
  }
  
  if (listAccumulator) {
    const filteredItems = listAccumulator.items.filter(item => 
      (item.text?.trim() || '').length > 0
    );
    if (filteredItems.length > 0) {
      blocks.push({ ...listAccumulator, items: filteredItems });
    }
  }
  
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', content: { text: '' } }];
}

function cleanListItemText(text, type) {
  if (type === 'bullet') {
    return text.replace(/^[-*\u2022\u2023\u25E6\u2043\u2219+]\s*/, '');
  } else if (type === 'numbered') {
    return text.replace(/^\d+\.?\s*/, '');
  }
  return text;
}

function tokenToBlock(token) {
  switch (token.type) {
    case 'heading': {
      const level = token.depth;
      const type = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      return { type, content: { text: token.text } };
    }
    case 'paragraph':
      return { type: 'paragraph', content: { text: token.text } };
    case 'blockquote':
      return { type: 'quote', content: { text: token.text } };
    case 'code':
      return parseCodeBlock(token);
    case 'list': {
      if (token.ordered) {
        return token.items.map((item, i) => ({
          type: 'numbered',
          content: { text: item.text, number: i + 1 }
        }));
      } else {
        return token.items.map(item => ({
          type: 'bullet',
          content: { text: item.text }
        }));
      }
    }
    case 'hr':
      return { type: 'divider', content: {} };
    case 'table': {
      return parseMarkdownTable(token);
    }
    case 'math':
      return { type: 'math', content: { latex: token.text } };
    default:
      return null;
  }
}

function parseCodeBlock(token) {
  const lang = token.lang || 'javascript';
  const code = token.text || '';
  return { type: 'code', content: { code, language: lang } };
}

function parseMarkdownTable(token) {
  const headers = token.header.map(cell => cell.text || cell.text || '');
  const rows = token.rows.map(row => 
    row.map(cell => cell.text || '')
  );
  return { type: 'table', content: { headers, rows } };
}

export function parseHtml(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const body = doc.body;
  
  const blocks = [];
  let listAccumulator = null;
  let listType = null;
  
  for (const node of Array.from(body.childNodes)) {
    const block = htmlNodeToBlock(node);
    if (!block) continue;
    
    if (block.type === 'bullet' || block.type === 'numbered') {
      // Filter out empty list items
      const text = block.content.text?.trim() || '';
      if (!text) continue;
      
      if (listAccumulator && listType === block.type) {
        listAccumulator.items.push(block.content);
      } else {
        if (listAccumulator) {
          const filteredItems = listAccumulator.items.filter(item => 
            (item.text?.trim() || '').length > 0
          );
          if (filteredItems.length > 0) {
            blocks.push({ ...listAccumulator, items: filteredItems });
          }
        }
        listType = block.type;
        listAccumulator = {
          type: block.type,
          items: [block.content]
        };
      }
    } else {
      if (listAccumulator) {
        const filteredItems = listAccumulator.items.filter(item => 
          (item.text?.trim() || '').length > 0
        );
        if (filteredItems.length > 0) {
          blocks.push({ ...listAccumulator, items: filteredItems });
        }
        listAccumulator = null;
        listType = null;
      }
      
      // Filter out empty blocks
      if (block.type === 'paragraph') {
        const text = block.content.text?.trim() || '';
        if (!text) continue;
      }
      
      blocks.push(block);
    }
  }
  
  if (listAccumulator) {
    const filteredItems = listAccumulator.items.filter(item => 
      (item.text?.trim() || '').length > 0
    );
    if (filteredItems.length > 0) {
      blocks.push({ ...listAccumulator, items: filteredItems });
    }
  }
  
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', content: { text: '' } }];
}

function htmlNodeToBlock(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim();
    if (!text) return null;
    return { type: 'paragraph', content: { text: escapeHtml(text) } };
  }
  
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  
  const tag = node.tagName.toLowerCase();
  const text = getTextContent(node);
  
  switch (tag) {
    case 'h1':
      return { type: 'h1', content: { text } };
    case 'h2':
      return { type: 'h2', content: { text } };
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return { type: 'h3', content: { text } };
    case 'p':
      return { type: 'paragraph', content: { text } };
    case 'blockquote':
      return { type: 'quote', content: { text } };
    case 'pre': {
      const codeEl = node.querySelector('code');
      const code = codeEl ? codeEl.textContent : text;
      const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || 'javascript';
      return { type: 'code', content: { code, language: lang } };
    }
    case 'ul':
      return parseHtmlList(node, 'bullet');
    case 'ol':
      return parseHtmlList(node, 'numbered');
    case 'hr':
      return { type: 'divider', content: {} };
    case 'table':
      return parseHtmlTable(node);
    case 'img': {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      if (src) {
        return { type: 'image', content: { url: src, caption: alt } };
      }
      return { type: 'paragraph', content: { text } };
    }
    case 'div': {
      if (node.classList.contains('math') || node.classList.contains('katex-display')) {
        const latex = node.textContent || '';
        return { type: 'math', content: { latex } };
      }
      if (node.classList.contains('callout')) {
        const icon = node.querySelector('.callout-icon')?.textContent || '💡';
        const bodyText = node.querySelector('.callout-body')?.textContent || text;
        return { type: 'callout', content: { icon, text: bodyText } };
      }
      return { type: 'paragraph', content: { text } };
    }
    default:
      return { type: 'paragraph', content: { text } };
  }
}

function parseHtmlList(ul, type) {
  const items = Array.from(ul.querySelectorAll(':scope > li')).map(li => {
    const text = getTextContent(li).trim();
    return { text };
  });
  
  if (items.length === 0) return null;
  
  if (type === 'numbered') {
    return items.map((item, i) => ({
      type: 'numbered',
      content: { text: item.text, number: i + 1 }
    }));
  }
  
  return items.map(item => ({
    type: 'bullet',
    content: { text: item.text }
  }));
}

function parseHtmlTable(table) {
  const headers = [];
  const rows = [];
  
  const thead = table.querySelector('thead');
  if (thead) {
    const headerRow = thead.querySelector('tr');
    if (headerRow) {
      headerRow.querySelectorAll('th, td').forEach(th => {
        headers.push(getTextContent(th).trim());
      });
    }
  }
  
  const tbody = table.querySelector('tbody') || table;
  tbody.querySelectorAll('tr').forEach(tr => {
    const row = [];
    tr.querySelectorAll('th, td').forEach(td => {
      row.push(getTextContent(td).trim());
    });
    if (row.length > 0) rows.push(row);
  });
  
  if (headers.length === 0) {
    if (rows.length > 0) {
      headers.push(...rows.shift());
    } else {
      headers.push('Column 1', 'Column 2', 'Column 3');
    }
  }
  
  if (rows.length === 0) {
    rows.push(new Array(headers.length).fill(''));
    rows.push(new Array(headers.length).fill(''));
  }
  
  return { type: 'table', content: { headers, rows } };
}

function getTextContent(el) {
  return el.innerText || el.textContent || '';
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}