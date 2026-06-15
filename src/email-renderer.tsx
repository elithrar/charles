import { render } from '@react-email/render';
import type { ReactNode } from 'react';

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'image'; alt: string; url: string };

const MAX_IMAGE_WIDTH = 560;

function safeHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list.length) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const image = trimmed.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/);
    const listItem = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (image) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'image', alt: image[1], url: image[2] });
      continue;
    }

    if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks.length ? blocks : [{ type: 'paragraph', text: markdown }];
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern =
    /(!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\))|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const imageAlt = match[2];
    const imageUrl = match[3];
    const linkLabel = match[5];
    const linkUrl = match[6];
    const boldText = match[8];

    if (imageUrl) {
      const url = safeHttpUrl(imageUrl);
      nodes.push(
        url ? (
          <img
            key={`${match.index}:image`}
            src={url}
            alt={imageAlt || ''}
            width={MAX_IMAGE_WIDTH}
            style={{ display: 'block', maxWidth: '100%', height: 'auto', margin: '12px 0' }}
          />
        ) : (
          imageAlt
        ),
      );
    } else if (linkUrl) {
      const url = safeHttpUrl(linkUrl);
      nodes.push(
        url ? (
          <a key={`${match.index}:link`} href={url} style={{ color: '#5f4b32' }}>
            {linkLabel}
          </a>
        ) : (
          linkLabel
        ),
      );
    } else if (boldText) {
      nodes.push(
        <strong key={`${match.index}:bold`} style={{ fontWeight: 700 }}>
          {boldText}
        </strong>,
      );
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

export async function renderMarkdownEmail(
  markdown: string,
): Promise<{ html: string; text: string }> {
  const blocks = parseMarkdownBlocks(markdown);
  const html = await render(
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: '24px',
          backgroundColor: '#F5F4EC',
          color: '#2d261d',
          fontFamily: 'Georgia, Cambria, "Times New Roman", serif',
          fontSize: '16px',
          lineHeight: '1.55',
        }}
      >
        <main
          style={{
            maxWidth: '640px',
            margin: '0 auto',
            padding: '24px',
            backgroundColor: '#fffdf6',
            border: '1px solid #ded6c7',
            borderRadius: '16px',
          }}
        >
          {blocks.map((block, index) => {
            if (block.type === 'list') {
              return (
                <ul key={index} style={{ margin: '0 0 16px', paddingLeft: '24px' }}>
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex} style={{ marginBottom: '8px' }}>
                      {renderInlineMarkdown(item)}
                    </li>
                  ))}
                </ul>
              );
            }

            if (block.type === 'image') {
              const url = safeHttpUrl(block.url);
              return url ? (
                <img
                  key={index}
                  src={url}
                  alt={block.alt}
                  width={MAX_IMAGE_WIDTH}
                  style={{ display: 'block', maxWidth: '100%', height: 'auto', margin: '0 0 16px' }}
                />
              ) : null;
            }

            return (
              <p key={index} style={{ margin: '0 0 16px' }}>
                {renderInlineMarkdown(block.text)}
              </p>
            );
          })}
        </main>
      </body>
    </html>,
  );

  return { html, text: markdown };
}
