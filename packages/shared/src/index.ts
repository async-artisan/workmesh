export type Role = 'USER' | 'ADMIN' | 'SUPER_ADMIN';
export type RequirementStatus =
  | 'DRAFT'
  | 'PRD_READY'
  | 'DESIGN_READY'
  | 'IN_DEV'
  | 'CODE_LINKED'
  | 'TESTED'
  | 'RELEASED'
  | 'ARCHIVED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface User {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
}
export interface Project {
  id: string;
  name: string;
  key: string;
  description?: string | null;
}
export interface Requirement {
  id: string;
  projectId: string;
  seq: number;
  code: string;
  title: string;
  description: string;
  status: RequirementStatus;
  priority: Priority;
  createdById: string;
  acceptanceCriteria: string[];
  userStories: string[];
  createdAt: string;
  updatedAt: string;
}
export interface Prd {
  id: string;
  requirementId: string;
  version: number;
  content: string;
  status: 'DRAFT' | 'APPROVED';
}
export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}
