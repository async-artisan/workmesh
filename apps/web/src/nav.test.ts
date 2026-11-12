import { describe, expect, it } from 'vitest';
import { NAV_GROUP_LABELS, findNav, navItems, type NavGroup } from './nav';

describe('主导航分组', () => {
  it('按工作、交付、团队、设置组织，并保留全部真实路径', () => {
    expect(NAV_GROUP_LABELS).toEqual({
      daily: '工作',
      delivery: '交付',
      admin: '团队',
      account: '设置',
    });
    const groups = navItems.map((item) => item.group);
    expect(groups).toEqual(
      [...groups].sort((a, b) => {
        const order: NavGroup[] = ['daily', 'delivery', 'admin', 'account'];
        return order.indexOf(a) - order.indexOf(b);
      }),
    );
    expect(navItems.map((item) => item.path)).toEqual([
      '/',
      '/requirements',
      '/pipeline',
      '/reviews',
      '/projects',
      '/board',
      '/knowledge',
      '/prd',
      '/workflows',
      '/roles',
      '/workspace',
      '/profile',
      '/authorization',
    ]);
  });

  it('我的待办、成员与角色、项目文档、设置分组可被找到', () => {
    expect(findNav('/').key).toBe('我的待办');
    expect(findNav('/roles').key).toBe('成员与角色');
    expect(findNav('/prd').key).toBe('项目文档');
    expect(findNav('/authorization').group).toBe('account');
    expect(findNav('/workspace').key).toBe('接入与工作区');
    expect(findNav('/requirements/req-1').key).toBe('需求');
  });
});
