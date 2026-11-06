import type { ReactNode } from 'react';

type MarkdownReaderProps = {
  text: string;
  className?: string;
  ariaLabel?: string;
};

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; language: string; text: string }
  | { type: 'rule' };

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s]*)\s*$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/;
const UNORDERED_RE = /^ {0,3}[-*+][ \t]+(.+)$/;
const ORDERED_RE = /^ {0,3}\d+[.)][ \t]+(.+)$/;
const BLOCKQUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;
const RULE_RE = /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;

function parseBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = () => {
    const value = paragraph.join('\n').trim();
    if (value) blocks.push({ type: 'paragraph', text: value });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = line.match(FENCE_RE);
    if (fence) {
      flushParagraph();
      const marker = fence[1];
      const codeLines: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[index])
      ) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language: fence[2] || '', text: codeLines.join('\n') });
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      flushParagraph();
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (UNORDERED_RE.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(UNORDERED_RE);
        if (!match) break;
        items.push(match[1].trim());
        index += 1;
      }
      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    if (ORDERED_RE.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(ORDERED_RE);
        if (!match) break;
        items.push(match[1].trim());
        index += 1;
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(BLOCKQUOTE_RE);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n').trim() });
      continue;
    }

    paragraph.push(line.trimEnd());
    index += 1;
  }

  flushParagraph();
  return blocks;
}

function isSafeHref(value: string): boolean {
  const href = value.trim();
  if (!href) return false;
  if (href.startsWith('//')) return false;
  if (/^(?:javascript|data|vbscript):/i.test(href)) return false;
  return /^(?:https?:|mailto:|#|\/|\.\.?\/)/i.test(href);
}

function inlineContent(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRe =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\((?:[^()\s]|\([^()\s]*\))+\)|\*[^*\n]+\*|_[^_\n]+_)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = tokenRe.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${tokenIndex}`;
    tokenIndex += 1;

    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{inlineContent(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^\s]+(?:\s+[^)]+)?)\)$/);
      if (!link) {
        nodes.push(token);
      } else {
        const href = link[2].trim().replace(/^<|>$/g, '');
        if (isSafeHref(href)) {
          nodes.push(
            <a
              key={key}
              href={href}
              target={/^https?:/i.test(href) ? '_blank' : undefined}
              rel="noreferrer"
            >
              {inlineContent(link[1], key)}
            </a>,
          );
        } else {
          nodes.push(inlineContent(link[1], key));
        }
      }
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{inlineContent(token.slice(1, -1), key)}</em>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function renderBlocks(blocks: MarkdownBlock[], keyPrefix: string): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (block.type) {
      case 'heading': {
        const Heading = `h${block.level}` as keyof JSX.IntrinsicElements;
        return <Heading key={key}>{inlineContent(block.text, key)}</Heading>;
      }
      case 'paragraph':
        return <p key={key}>{inlineContent(block.text, key)}</p>;
      case 'unordered-list':
        return (
          <ul key={key}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{inlineContent(item, `${key}-${itemIndex}`)}</li>
            ))}
          </ul>
        );
      case 'ordered-list':
        return (
          <ol key={key}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{inlineContent(item, `${key}-${itemIndex}`)}</li>
            ))}
          </ol>
        );
      case 'blockquote':
        return (
          <blockquote key={key}>{renderBlocks(parseBlocks(block.text), `${key}-quote`)}</blockquote>
        );
      case 'code':
        return (
          <pre key={key} data-language={block.language || undefined}>
            <code>{block.text}</code>
          </pre>
        );
      case 'rule':
        return <hr key={key} />;
      default:
        return null;
    }
  });
}

/**
 * A deliberately small, safe Markdown reader for knowledge content.
 * It renders text through React nodes instead of injecting HTML, so raw HTML
 * and unsafe link protocols remain inert text. The parser covers the common
 * document shapes used by generated knowledge: headings, paragraphs, lists,
 * quotes, rules and fenced code blocks.
 */
export function MarkdownReader({ text, className, ariaLabel = '文档正文' }: MarkdownReaderProps) {
  const classes = ['knowledge-markdown-reader', className].filter(Boolean).join(' ');
  return (
    <article className={classes} aria-label={ariaLabel}>
      {renderBlocks(parseBlocks(text), 'markdown')}
    </article>
  );
}
