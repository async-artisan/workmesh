import { BadRequestException } from '@nestjs/common';

export function normalizeRepositoryUrl(value?: string | null): string | null {
  if (value == null || value.trim() === '') return null;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BadRequestException('仓库 URL 无效');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new BadRequestException('仓库 URL 必须是不含凭据、查询或片段的 HTTP(S) 地址');
  }

  const path = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!path) throw new BadRequestException('仓库 URL 必须包含仓库路径');
  return `${url.protocol}//${url.host.toLowerCase()}${path}`;
}
