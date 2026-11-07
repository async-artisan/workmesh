import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownReader } from './MarkdownReader';

describe('MarkdownReader', () => {
  it('renders common Markdown blocks with document structure', () => {
    render(
      <MarkdownReader
        text={
          '# 操作指南\n\n第一段说明。\n\n## 检查项\n- 确认环境\n- **备份数据**\n\n> 变更前先通知值班人员。\n\n```sh\nworkmesh status\n```'
        }
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '操作指南' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '检查项' })).toBeInTheDocument();
    expect(screen.getByText('第一段说明。')).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: '文档正文' })).getByRole('list'),
    ).toHaveTextContent('确认环境备份数据');
    expect(screen.getByText('备份数据').tagName).toBe('STRONG');
    expect(screen.getByText('变更前先通知值班人员。').closest('blockquote')).toBeInTheDocument();
    expect(screen.getByText('workmesh status').closest('pre')).toHaveAttribute(
      'data-language',
      'sh',
    );
  });

  it('keeps raw HTML inert and refuses unsafe link protocols', () => {
    render(
      <MarkdownReader
        text={'<script>alert("x")</script> [执行](javascript:alert(1)) [文档](https://example.com)'}
      />,
    );

    expect(screen.getByRole('article', { name: '文档正文' })).toHaveTextContent(
      '<script>alert("x")</script>',
    );
    expect(document.querySelector('script')).toBeNull();
    expect(screen.queryByRole('link', { name: '执行' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '文档' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });

  it('keeps plain text readable without treating it as HTML', () => {
    render(<MarkdownReader text={'纯文本正文\n保留换行与 & 字符'} />);

    expect(screen.getByRole('article', { name: '文档正文' })).toHaveTextContent(
      '纯文本正文 保留换行与 & 字符',
    );
  });

  it('builds an accessible directory from rendered headings and navigates to a section', () => {
    const scrollIntoView = vi.fn();
    render(
      <MarkdownReader
        text={'# 指南\n\n## **检查项**\n\n```md\n## 代码中的标题\n```\n\n## 检查项'}
      />,
    );

    const directory = screen.getByRole('navigation', { name: '本文目录' });
    const entries = within(directory).getAllByRole('button', { name: '检查项' });
    const headings = screen.getAllByRole('heading', { level: 2, name: '检查项' });
    headings[1].scrollIntoView = scrollIntoView;
    fireEvent.click(entries[1]);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(headings[1]).toHaveFocus();
    expect(headings[0].id).not.toEqual(headings[1].id);
    expect(within(directory).queryByText('代码中的标题')).not.toBeInTheDocument();
  });

  it('does not display an empty directory for short or unstructured content', () => {
    render(<MarkdownReader text={'# 简短说明\n\n只有一段正文。'} />);
    expect(screen.queryByRole('navigation', { name: '本文目录' })).not.toBeInTheDocument();
  });
});
