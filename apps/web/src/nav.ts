import {
  BookOpen,
  ClipboardList,
  FileText,
  FolderGit2,
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
  daily: '工作',
  delivery: '交付',
  admin: '团队',
  account: '设置',
};

export interface NavItem {
  key: string;
  icon: LucideIcon;
  path: string;
  desc: string;
  group: NavGroup;
}

export const navItems: NavItem[] = [
  {
    key: '我的待办',
    icon: LayoutDashboard,
    path: '/',
    desc: '跨项目待办与签字入口',
    group: 'daily',
  },
  {
    key: '需求',
    icon: ClipboardList,
    path: '/requirements',
    desc: '需求列表、详情与流程入口',
    group: 'daily',
  },
  {
    key: '评审',
    icon: ShieldCheck,
    path: '/reviews',
    desc: '槽位、摘要、版本与批准/撤销',
    group: 'daily',
  },

  {
    key: '项目',
    icon: FolderKanban,
    path: '/projects',
    desc: '项目创建、归档与文档入口',
    group: 'delivery',
  },
  {
    key: '接入与工作区',
    icon: FolderGit2,
    path: '/workspace',
    desc: '仓库声明、工作区定义与一次性接入码',
    group: 'delivery',
  },
  { key: '看板', icon: Kanban, path: '/board', desc: '只读任务与交付状态', group: 'delivery' },
  {
    key: '需求流水线',
    icon: GitBranch,
    path: '/pipeline',
    desc: '按阶段查看需求进度与阻塞',
    group: 'delivery',
  },
  {
    key: '知识库',
    icon: BookOpen,
    path: '/knowledge',
    desc: '候选文档、修订与撤销发布',
    group: 'delivery',
  },
  {
    key: '项目文档',
    icon: FileText,
    path: '/prd',
    desc: 'PRD 候选、返修与撤销发布',
    group: 'delivery',
  },

  {
    key: '流程配置',
    icon: GitBranch,
    path: '/workflows',
    desc: '流程定义校验、发布与版本基线',
    group: 'admin',
  },
  {
    key: '成员与角色',
    icon: Users,
    path: '/roles',
    desc: '成员、业务角色与知识库访问集合',
    group: 'admin',
  },

  {
    key: '设备授权',
    icon: KeyRound,
    path: '/authorization',
    desc: 'CLI 设备授权批准',
    group: 'account',
  },

  {
    key: '用户中心',
    icon: User,
    path: '/profile',
    desc: '当前会话与 Agent 凭据',
    group: 'account',
  },
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
