import {
  BookOpen,
  ClipboardList,
  FileText,
  FolderKanban,
  GitBranch,
  Kanban,
  KeyRound,
  LayoutDashboard,
  ShieldCheck,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavGroup = 'daily' | 'delivery' | 'admin' | 'account';

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  daily: '日常',
  delivery: '交付',
  admin: '管理',
  account: '账号',
};

export interface NavItem {
  key: string;
  icon: LucideIcon;
  path: string;
  desc: string;
  group: NavGroup;
}

export const navItems: NavItem[] = [
  { key: '工作台', icon: LayoutDashboard, path: '/', desc: '跨项目待办与签字入口', group: 'daily' },
  { key: '需求', icon: ClipboardList, path: '/requirements', desc: '需求列表、详情与流程入口', group: 'daily' },
  { key: '评审', icon: ShieldCheck, path: '/reviews', desc: '槽位、摘要、版本与批准/撤销', group: 'daily' },

  { key: '项目', icon: FolderKanban, path: '/projects', desc: '项目创建、归档与文档入口', group: 'delivery' },
  { key: '看板', icon: Kanban, path: '/board', desc: '只读任务与交付状态', group: 'delivery' },
  { key: '知识库', icon: BookOpen, path: '/knowledge', desc: '候选文档、修订与撤销发布', group: 'delivery' },
  { key: 'PRD', icon: FileText, path: '/prd', desc: 'PRD 候选、返修与撤销发布', group: 'delivery' },

  { key: '流程', icon: GitBranch, path: '/workflows', desc: '流程定义校验、发布与版本基线', group: 'admin' },
  { key: '角色/ACL', icon: Users, path: '/roles', desc: '成员、业务角色与知识库访问集合', group: 'admin' },
  { key: '设备授权', icon: KeyRound, path: '/authorization', desc: 'CLI 设备授权批准', group: 'admin' },

  { key: '用户中心', icon: User, path: '/profile', desc: '当前会话与 Agent 凭据', group: 'account' },
];

export function findNav(pathname: string): NavItem {
  return (
    navItems.find((item) =>
      item.path === '/'
        ? pathname === '/'
        : pathname === item.path || pathname.startsWith(`${item.path}/`),
    ) ?? navItems[0]
  );
}
