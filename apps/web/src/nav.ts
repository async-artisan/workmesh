import {
  BookOpen,
  Bot,
  ClipboardList,
  FileText,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  User,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  key: string;
  icon: LucideIcon;
  path: string;
  desc: string;
}

export const navItems: NavItem[] = [
  { key: '控制台', icon: LayoutDashboard, path: '/', desc: '工作区概览与最近动态' },
  { key: '项目列表', icon: FolderKanban, path: '/projects', desc: '按项目隔离需求、PRD 与知识库' },
  { key: 'AI 运行', icon: Bot, path: '/runs', desc: '四步访谈生成需求草稿' },
  { key: '需求管理', icon: ClipboardList, path: '/requirements', desc: '维护需求条目与状态流转' },
  { key: 'PRD', icon: FileText, path: '/prds', desc: '从需求生成 PRD，管理版本与审批' },
  { key: '知识库', icon: BookOpen, path: '/knowledge', desc: '沉淀项目知识，支持全文检索' },
  { key: '追溯', icon: GitBranch, path: '/trace', desc: '需求到代码的追溯关系' },
  { key: '用户中心', icon: User, path: '/profile', desc: '账号资料与安全设置' },
];

export function findNav(pathname: string): NavItem {
  return navItems.find((item) => item.path === pathname) ?? navItems[0];
}
