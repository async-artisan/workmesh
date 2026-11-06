import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiError } from '../api/client';
import {
  aclApi,
  projectApi,
  type AccessView,
  type MemberView,
  type RoleView,
} from '../api/resources';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { InviteMemberDialog } from '../components/InviteMemberDialog';
import { Modal } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { InlineLoading, SkeletonLines, TableSkeletonRows } from '../components/Skeleton';
import { useProjectContext } from '../hooks/useProjectContext';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import { toast } from '../store/toast';

const PERMISSIONS: Array<'READ' | 'PROPOSE' | 'PUBLISH' | 'REVOKE'> = [
  'READ',
  'PROPOSE',
  'PUBLISH',
  'REVOKE',
];

const PERMISSION_LABELS: Record<(typeof PERMISSIONS)[number], string> = {
  READ: '读取',
  PROPOSE: '提议',
  PUBLISH: '发布',
  REVOKE: '撤销',
};

type AclPermission = (typeof PERMISSIONS)[number];

interface AclGrantDraft {
  subjectKind: 'USER' | 'ROLE';
  subjectUserId: string | null;
  subjectRoleId: string | null;
  permissions: AclPermission[];
}

const aclStyles = `
.acl-subject-builder { display:flex; flex-wrap:wrap; gap:10px; align-items:end; padding:10px; border:1px dashed var(--border-strong,#cbd5e1); border-radius:8px; }
.acl-form-span { grid-column:1 / -1; }
.acl-subject-builder .field { flex:1 1 180px; min-width:0; }
.acl-subject-builder .field > span { margin-bottom:4px; }
.acl-grant-edit-list { display:grid; gap:10px; }
.acl-grant-edit-row { border:1px solid var(--border,#e2e8f0); border-radius:8px; padding:10px; display:grid; gap:8px; min-width:0; }
.acl-grant-edit-head { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; }
.acl-grant-edit-head strong { overflow-wrap:anywhere; }
.acl-permission-options { display:flex; flex-wrap:wrap; gap:6px 14px; }
.acl-permission-option { display:inline-flex; gap:6px; align-items:center; min-height:30px; font-size:12px; white-space:nowrap; }
.acl-permission-option input { margin:0; flex:none; }
.acl-grant-empty { color:var(--danger,#cf2d33); font-size:12px; }
.acl-form-error { margin:0; }
.acl-detail-subject { display:grid; gap:2px; }
.acl-detail-subject small { color:var(--text-muted,#7b8aa0); font-size:var(--wm-text-xs,12px); }
.acl-overview-table th, .acl-overview-table td { white-space:nowrap; }
.acl-detail-table th, .acl-detail-table td { vertical-align:top; }
@media (max-width: 720px) {
  .acl-subject-builder { align-items:stretch; flex-direction:column; }
  .acl-subject-builder .field, .acl-subject-builder .ghost { width:100%; }
  .acl-overview-table th, .acl-overview-table td { white-space:normal; padding:8px 10px; }
  .acl-detail-table th, .acl-detail-table td { padding:8px 10px; }
  .acl-grant-edit-head { align-items:flex-start; }
  .acl-grant-edit-head .danger { width:100%; }
}
`;

interface RoleGrantTarget {
  member: MemberView;
  role: RoleView;
  revoke: boolean;
  reason: string;
}

/**
 * 授予/撤销被拒时给出能照做的提示。
 * 服务端区分两种：不是项目成员 → 404 PROJECT_NOT_FOUND；是成员但没管理权 →
 * 403 PROJECT_MANAGER_REQUIRED。对使用者都意味着“权限不够”，提示合并处理。
 */
function explainRoleError(caught: unknown): never {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (message.includes('PROJECT_MANAGER_REQUIRED') || message.includes('PROJECT_NOT_FOUND'))
    throw new Error(
      '操作被拒绝：需要本项目的 OWNER/ADMIN 权限。若权限确认无误，请刷新页面后确认项目仍在列表中。',
    );
  throw caught;
}

/**
 * 角色与 ACL 管理页。授予/撤销业务角色与替换知识库访问集合都是票据动作：
 * 客户端只提供输入，权限与角色边界由服务端判定，403/409 原样展示。
 */

export function Roles() {
  const { projectId, projects } = useProjectContext();
  const navigate = useNavigate();
  const narrow = useNarrowViewport();
  const [members, setMembers] = useState<MemberView[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  /** 成员与业务角色是分开请求的两块内容，各自有 loading，首屏不先闪空态。 */
  const [membersLoading, setMembersLoading] = useState(Boolean(projectId));
  const [rolesLoading, setRolesLoading] = useState(Boolean(projectId));
  /** 成员/角色读取序号：项目切换后旧请求不能清掉新请求的 loading。 */
  const loadRequestRef = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [grantTarget, setGrantTarget] = useState<RoleGrantTarget | null>(null);
  const [roleMember, setRoleMember] = useState<MemberView | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const [knowledgeBaseId, setKnowledgeBaseId] = useState('');
  const [access, setAccess] = useState<AccessView | null>(null);
  const [accessError, setAccessError] = useState('');
  /** 读取访问集合按钮也是异步动作：请求中必须有可读状态。 */
  const [accessLoading, setAccessLoading] = useState(false);
  const accessRequestRef = useRef(0);
  const [aclOpen, setAclOpen] = useState(false);
  const [aclForm, setAclForm] = useState({
    visibility: 'PROJECT' as 'PROJECT' | 'RESTRICTED',
    publicationApproverUserId: '',
    publicationApproverRoleId: '',
    grants: [] as Array<{
      subjectKind: 'USER' | 'ROLE';
      subjectUserId: string | null;
      subjectRoleId: string | null;
      permissions: Array<'READ' | 'PROPOSE' | 'PUBLISH' | 'REVOKE'>;
    }>,
    reason: '',
  });
  const [aclBinding, setAclBinding] = useState<{
    expectedVersion: number;
    expectedAuthzVersion: number;
  } | null>(null);
  const [aclSubjectKind, setAclSubjectKind] = useState<'USER' | 'ROLE'>('USER');
  const [aclSubjectId, setAclSubjectId] = useState('');
  const [aclFormError, setAclFormError] = useState('');
  const [aclSubjectQuery, setAclSubjectQuery] = useState('');
  const [aclOriginalGrants, setAclOriginalGrants] = useState<AclGrantDraft[]>([]);

  async function load() {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    if (!projectId) {
      setMembers([]);
      setRoles([]);
      setMembersLoading(false);
      setRolesLoading(false);
      return;
    }
    setMembersLoading(true);
    setRolesLoading(true);
    try {
      const [memberRows, roleRows] = await Promise.all([
        projectApi.members(projectId),
        projectApi.roles(projectId),
      ]);
      if (loadRequestRef.current !== requestId) return;
      setMembers(memberRows);
      setRoles(roleRows);
      setError('');
    } catch (caught) {
      if (loadRequestRef.current !== requestId) return;
      setError(formatApiError(caught));
    } finally {
      if (loadRequestRef.current === requestId) {
        setMembersLoading(false);
        setRolesLoading(false);
      }
    }
  }

  useEffect(() => {
    // 项目切换：先清掉上一个项目的成员/角色，避免旧项目数据继续展示；刷新仍保留现有行。
    setMembers([]);
    setRoles([]);
    setMembersLoading(Boolean(projectId));
    setRolesLoading(Boolean(projectId));
    void load();
  }, [projectId]);

  const selectedProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    if (selectedProject?.defaultKnowledgeBaseId)
      setKnowledgeBaseId(selectedProject.defaultKnowledgeBaseId);
  }, [projectId, selectedProject?.defaultKnowledgeBaseId]);

  const memberEmailById = new Map(members.map((member) => [member.id, member.email]));
  const memberLabelById = new Map(
    members.map((member) => [member.id, member.name?.trim() || member.email]),
  );
  const roleTitleById = new Map(roles.map((role) => [role.id, role.title]));
  const roleLabelById = new Map(
    roles.map((role) => [role.id, role.key ? `${role.title}（${role.key}）` : role.title]),
  );

  function grantSubjectLabel(grant: AclGrantDraft): string {
    return grant.subjectKind === 'USER'
      ? (memberLabelById.get(grant.subjectUserId ?? '') ?? '未知成员')
      : (roleLabelById.get(grant.subjectRoleId ?? '') ?? '未知角色');
  }

  function aclPayloadGrants(): AclGrantDraft[] {
    return aclForm.grants.map((grant) => ({
      subjectKind: grant.subjectKind,
      subjectUserId: grant.subjectKind === 'USER' ? grant.subjectUserId : null,
      subjectRoleId: grant.subjectKind === 'ROLE' ? grant.subjectRoleId : null,
      permissions: [...grant.permissions],
    }));
  }

  function hasAclGrant(kind: 'USER' | 'ROLE', id: string): boolean {
    return aclForm.grants.some((grant) =>
      kind === 'USER'
        ? grant.subjectKind === 'USER' && grant.subjectUserId === id
        : grant.subjectKind === 'ROLE' && grant.subjectRoleId === id,
    );
  }

  function aclGrantKey(grant: AclGrantDraft): string {
    return `${grant.subjectKind}:${
      grant.subjectKind === 'USER' ? grant.subjectUserId : grant.subjectRoleId
    }`;
  }

  function aclDiff() {
    const original = new Map(aclOriginalGrants.map((grant) => [aclGrantKey(grant), grant]));
    const current = new Map(aclForm.grants.map((grant) => [aclGrantKey(grant), grant]));
    const lines: string[] = [];
    for (const [key, grant] of current) {
      const before = original.get(key);
      const label = grantSubjectLabel(grant);
      if (!before) {
        lines.push(`新增主体：${label}（${grant.subjectKind === 'USER' ? '成员' : '角色'}）`);
        continue;
      }
      const added = grant.permissions.filter(
        (permission) => !before.permissions.includes(permission),
      );
      const removed = before.permissions.filter(
        (permission) => !grant.permissions.includes(permission),
      );
      if (added.length > 0)
        lines.push(
          `${label}：增加权限 ${added.map((permission) => PERMISSION_LABELS[permission]).join('、')}`,
        );
      if (removed.length > 0)
        lines.push(
          `${label}：移除权限 ${removed
            .map((permission) => PERMISSION_LABELS[permission])
            .join('、')}`,
        );
    }
    for (const [key, grant] of original) {
      if (!current.has(key)) lines.push(`删除主体：${grantSubjectLabel(grant)}`);
    }
    return { changed: lines.length > 0, lines };
  }

  const currentAclDiff = aclDiff();
  const aclSubjectQueryLower = aclSubjectQuery.trim().toLowerCase();
  const filteredAclMembers = members.filter((member) => {
    if (!aclSubjectQueryLower) return true;
    return [member.name ?? '', member.email].some((value) =>
      value.toLowerCase().includes(aclSubjectQueryLower),
    );
  });
  const filteredAclRoles = roles.filter((role) => {
    if (!aclSubjectQueryLower) return true;
    return [role.title, role.key].some((value) =>
      value.toLowerCase().includes(aclSubjectQueryLower),
    );
  });

  function validateAclDraft(): string {
    if (aclForm.reason.trim().length === 0) return '原因不能为空';
    const seen = new Set<string>();
    for (const grant of aclForm.grants) {
      if (grant.permissions.length === 0)
        return `授权主体「${grantSubjectLabel(grant)}」至少需要一个权限。`;
      const subjectId = grant.subjectKind === 'USER' ? grant.subjectUserId : grant.subjectRoleId;
      if (!subjectId) return '每个 grant 必须包含有效的主体 ID。';
      if (
        (grant.subjectKind === 'USER' && grant.subjectRoleId !== null) ||
        (grant.subjectKind === 'ROLE' && grant.subjectUserId !== null)
      )
        return 'USER 与 ROLE 主体字段不能同时设置。';
      const key = `${grant.subjectKind}:${subjectId}`;
      if (seen.has(key)) return `主体「${grantSubjectLabel(grant)}」不能重复添加。`;
      seen.add(key);
      if (grant.permissions.some((permission) => !PERMISSIONS.includes(permission)))
        return '包含不支持的权限。';
    }
    return '';
  }

  async function submitGrant(confirmation: { ticketId: string; ticketSecret: string }) {
    if (!projectId || !grantTarget) throw new Error('缺少角色授予目标');
    if (!grantTarget.reason.trim()) throw new Error('原因不能为空');
    // 项目可能在页面停留期间被删除，或本地记住的项目 ID 已失效：
    // 先挡在本地，避免变成服务端一个看不懂的 404。
    if (!projects.some((item) => item.id === projectId))
      throw new Error('当前项目已不在项目列表中，请刷新页面后重试。');
    if (grantTarget.revoke) {
      try {
        await projectApi.revokeRole(projectId, grantTarget.member.id, grantTarget.role.id, {
          expectedVersion: grantTarget.member.version,
          reason: grantTarget.reason.trim(),
          confirmation,
        });
      } catch (caught) {
        throw explainRoleError(caught);
      }
      toast.success('业务角色已撤销。');
    } else {
      try {
        await projectApi.assignRole(projectId, grantTarget.member.id, grantTarget.role.id, {
          expectedVersion: grantTarget.member.version,
          reason: grantTarget.reason.trim(),
          confirmation,
        });
      } catch (caught) {
        throw explainRoleError(caught);
      }
      toast.success('业务角色已授予。');
    }
    await load();
  }

  async function loadAccess() {
    const id = knowledgeBaseId.trim();
    if (!id) {
      setAccessError('当前项目没有默认知识库，无法读取 ACL。');
      return;
    }
    const requestId = accessRequestRef.current + 1;
    accessRequestRef.current = requestId;
    setAccessLoading(true);
    try {
      const next = await aclApi.getAccess(id);
      if (accessRequestRef.current !== requestId) return;
      setAccess(next);
      setAccessError('');
    } catch (caught) {
      if (accessRequestRef.current !== requestId) return;
      setAccess(null);
      setAccessError(formatApiError(caught));
    } finally {
      if (accessRequestRef.current === requestId) setAccessLoading(false);
    }
  }

  function openAcl() {
    if (!access) return;
    const activeGrants: AclGrantDraft[] = access.grants
      .filter((grant) => !grant.revokedAt)
      .map((grant) => ({
        subjectKind: grant.subjectKind,
        subjectUserId: grant.subjectKind === 'USER' ? grant.subjectUserId : null,
        subjectRoleId: grant.subjectKind === 'ROLE' ? grant.subjectRoleId : null,
        permissions: [...grant.permissions],
      }));
    setAclOriginalGrants(activeGrants);
    setAclForm({
      visibility: access.visibility === 'RESTRICTED' ? 'RESTRICTED' : 'PROJECT',
      publicationApproverUserId: access.publicationApproverUserId ?? '',
      publicationApproverRoleId: access.publicationApproverRoleId ?? '',
      grants: activeGrants,
      reason: '',
    });
    setAclBinding({ expectedVersion: access.version, expectedAuthzVersion: access.authzVersion });
    setAclSubjectKind('USER');
    setAclSubjectId('');
    setAclSubjectQuery('');
    setAclFormError('');
    setAclOpen(true);
  }

  function addAclGrant() {
    const id = aclSubjectId;
    if (!id) {
      setAclFormError('请先选择要添加的成员或角色。');
      return;
    }
    if (hasAclGrant(aclSubjectKind, id)) {
      setAclFormError('同一主体只能添加一次。');
      return;
    }
    setAclForm({
      ...aclForm,
      grants: [
        ...aclForm.grants,
        {
          subjectKind: aclSubjectKind,
          subjectUserId: aclSubjectKind === 'USER' ? id : null,
          subjectRoleId: aclSubjectKind === 'ROLE' ? id : null,
          permissions: ['READ'],
        },
      ],
    });
    setAclSubjectId('');
    setAclFormError('');
  }

  function updateAclGrantPermissions(index: number, permission: AclPermission) {
    setAclForm({
      ...aclForm,
      grants: aclForm.grants.map((grant, grantIndex) => {
        if (grantIndex !== index) return grant;
        const permissions = grant.permissions.includes(permission)
          ? grant.permissions.filter((item) => item !== permission)
          : [...grant.permissions, permission];
        return { ...grant, permissions };
      }),
    });
    setAclFormError('');
  }

  async function submitAcl(confirmation: { ticketId: string; ticketSecret: string }) {
    if (!access || !aclBinding) throw new Error('缺少 ACL 目标');
    const validation = validateAclDraft();
    if (validation) throw new Error(validation);
    if (!currentAclDiff.changed) throw new Error('当前没有权限变化，无需提交替换。');
    const grants = aclPayloadGrants();
    await aclApi.replaceAccess(access.knowledgeBaseId, {
      expectedVersion: aclBinding.expectedVersion,
      expectedAuthzVersion: aclBinding.expectedAuthzVersion,
      visibility: aclForm.visibility,
      publicationApproverUserId: aclForm.publicationApproverUserId.trim(),
      publicationApproverRoleId: aclForm.publicationApproverRoleId.trim() || null,
      grants,
      reason: aclForm.reason.trim(),
      confirmation,
    });
    setAccess(await aclApi.getAccess(access.knowledgeBaseId));
    setNotice('知识库访问集合已替换；历史 grant 以撤销时间保留。');
  }

  return (
    <section>
      <style>{aclStyles}</style>
      <header className="page-head">
        <div>
          <h2>角色 / ACL</h2>
          <p className="page-sub">
            管理身份与业务角色分离；知识库访问按 grant 集合替换，所有写操作都需要一次性票据。
          </p>
        </div>
        <div className="page-actions">
          <ProjectSelect
            onChange={() => {
              accessRequestRef.current += 1;
              setAccess(null);
              setAccessLoading(false);
            }}
            onCreateProject={() => navigate('/projects')}
          />
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="kb-notice">{notice}</p>}

      <div className="table-card">
        <div className="card-head">
          <h3>
            成员
            <small>{membersLoading && members.length === 0 ? '加载中…' : members.length}</small>
          </h3>
          <div className="card-head-actions">
            {membersLoading && (
              <InlineLoading label={members.length > 0 ? '正在刷新成员…' : '正在加载成员…'} />
            )}
            <button
              className="ghost"
              onClick={() => setInviteOpen(true)}
              disabled={!projectId || !selectedProject}
            >
              邀请成员
            </button>
          </div>
        </div>
        {narrow ? (
          <ul className="wm-mobile-card-list" data-testid="roles-member-card-list">
            {membersLoading && members.length === 0 && (
              <li className="wm-mobile-card">
                <SkeletonLines lines={3} />
              </li>
            )}
            {members.map((member) => (
              <li className="wm-mobile-card" key={member.id} data-testid="roles-member-card">
                <div className="wm-mobile-card-head">
                  <strong>{member.name || member.email}</strong>
                  <span className="status-tag">{member.role}</span>
                </div>
                {member.name && member.name !== member.email && (
                  <span className="wm-mobile-card-meta cell-mono cell-truncate">
                    {member.email}
                  </span>
                )}
                <p className="wm-mobile-card-meta">下一步：管理业务角色</p>
                <details className="wm-mobile-card-details">
                  <summary>查看业务角色与版本</summary>
                  <div className="wm-mobile-card-tags">
                    {(member.roles ?? []).length === 0 ? (
                      <span className="muted">未授予业务角色</span>
                    ) : (
                      member.roles?.map((role) => (
                        <span className="status-tag" key={role.id}>
                          {role.title}
                        </span>
                      ))
                    )}
                  </div>
                  <p className="wm-mobile-card-meta">成员版本：v{member.version}</p>
                </details>
                <div className="wm-mobile-card-actions">
                  <button className="ghost" onClick={() => setRoleMember(member)}>
                    管理角色
                  </button>
                </div>
              </li>
            ))}
            {!membersLoading && members.length === 0 && (
              <li className="wm-mobile-empty">
                {projectId
                  ? error
                    ? '成员列表读取失败，请稍后重试。'
                    : '没有活动成员。'
                  : '先选择项目。'}
              </li>
            )}
          </ul>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>管理身份</th>
                  <th>成员版本</th>
                  <th className="col-actions">业务角色</th>
                </tr>
              </thead>
              <tbody>
                {membersLoading && members.length === 0 ? (
                  <TableSkeletonRows rows={4} columns={4} />
                ) : (
                  <>
                    {members.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <strong>{member.name || member.email}</strong>
                          {member.name && member.name !== member.email && (
                            <div className="cell-mono cell-truncate">{member.email}</div>
                          )}
                        </td>
                        <td>
                          <span className="status-tag">{member.role}</span>
                        </td>
                        <td className="cell-num">v{member.version}</td>
                        <td className="col-actions">
                          <div className="role-summary">
                            <div className="role-tags">
                              {(member.roles ?? []).length === 0 ? (
                                <span className="muted">未授予业务角色</span>
                              ) : (
                                member.roles?.map((role) => (
                                  <span className="status-tag" key={role.id}>
                                    {role.title}
                                  </span>
                                ))
                              )}
                            </div>
                            <button className="ghost" onClick={() => setRoleMember(member)}>
                              管理角色
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {members.length === 0 && (
                      <tr className="table-empty">
                        <td colSpan={4}>
                          {projectId
                            ? error
                              ? '成员列表读取失败，请稍后重试。'
                              : '没有活动成员。'
                            : '先选择项目。'}
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(roleMember)}
        title="管理业务角色"
        description={roleMember ? `${roleMember.email} · 成员 v${roleMember.version}` : ''}
        variant="drawer"
        size="md"
        onClose={() => setRoleMember(null)}
      >
        <div className="role-manage-list">
          {rolesLoading && roles.length === 0 ? (
            <InlineLoading label="正在加载业务角色…" />
          ) : (
            <>
              {roles.map((role) => {
                const granted = Boolean(
                  roleMember?.roles?.some((assignment) => assignment.id === role.id),
                );
                return (
                  <div className="role-manage-row" key={role.id}>
                    <div>
                      <strong>{role.title}</strong>
                      <small>{role.key}</small>
                    </div>
                    <button
                      className={granted ? 'danger' : 'ghost'}
                      onClick={() => {
                        if (!roleMember) return;
                        setGrantTarget({
                          member: roleMember,
                          role,
                          revoke: granted,
                          reason: '',
                        });
                        setRoleMember(null);
                      }}
                    >
                      {granted ? '撤销' : '授予'}
                    </button>
                  </div>
                );
              })}
              {roles.length === 0 && (
                <p className="detail-empty">
                  {error ? '业务角色读取失败，请刷新页面后重试。' : '项目还没有业务角色。'}
                </p>
              )}
            </>
          )}
        </div>
      </Modal>

      <div className="table-card">
        <div className="card-head">
          <h3>知识库访问（ACL）</h3>
          <div className="card-head-actions">
            {accessLoading && (
              <InlineLoading label={access ? '正在刷新访问集合…' : '正在读取访问集合…'} />
            )}
            <span className="acl-kb-label">默认知识库：{selectedProject?.name ?? '未配置'}</span>
            <button
              className="ghost"
              onClick={() => void loadAccess()}
              disabled={!knowledgeBaseId || accessLoading}
            >
              {accessLoading ? '读取中…' : '读取访问集合'}
            </button>
            {access && (
              <button className="primary" onClick={openAcl}>
                替换访问集合
              </button>
            )}
          </div>
        </div>
        {accessError && (
          <p className="error" role="alert">
            {accessError}
          </p>
        )}
        {access && (
          <>
            <div className="card-head">
              <h3>访问集合概览</h3>
            </div>
            <div className="table-scroll">
              <table className="data-table acl-overview-table" data-testid="acl-overview-table">
                <thead>
                  <tr>
                    <th>可见性</th>
                    <th>集合版本</th>
                    <th>授权版本</th>
                    <th>出版审批人</th>
                    <th>Grant 数量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{access.visibility === 'RESTRICTED' ? '受限' : '项目可见'}</td>
                    <td className="cell-num">v{access.version}</td>
                    <td className="cell-num">v{access.authzVersion}</td>
                    <td>
                      {access.publicationApproverUserId
                        ? (memberLabelById.get(access.publicationApproverUserId) ??
                          memberEmailById.get(access.publicationApproverUserId) ??
                          '—')
                        : '—'}
                      {access.publicationApproverRoleId
                        ? ` / ${roleTitleById.get(access.publicationApproverRoleId) ?? '角色'}`
                        : ''}
                    </td>
                    <td>
                      有效 {access.grants.filter((grant) => !grant.revokedAt).length} 条 / 共{' '}
                      {access.grants.length} 条
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="card-head">
              <h3>Grant 明细</h3>
              <small className="muted">有效与已撤销历史均保留展示；编辑只针对有效 grant。</small>
            </div>
            <div className="table-scroll">
              <table className="data-table acl-detail-table" data-testid="acl-detail-table">
                <thead>
                  <tr>
                    <th>主体</th>
                    <th>权限</th>
                    <th>版本</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {access.grants.map((grant) => (
                    <tr key={grant.id}>
                      <td>
                        <div className="acl-detail-subject">
                          <strong>
                            {grant.subjectKind === 'USER'
                              ? (memberLabelById.get(grant.subjectUserId ?? '') ??
                                memberEmailById.get(grant.subjectUserId ?? '') ??
                                '未知成员')
                              : (roleLabelById.get(grant.subjectRoleId ?? '') ??
                                roleTitleById.get(grant.subjectRoleId ?? '') ??
                                '未知角色')}
                          </strong>
                          <small>{grant.subjectKind === 'USER' ? '成员' : '角色'}</small>
                        </div>
                      </td>
                      <td>
                        {grant.permissions
                          .map((permission) => PERMISSION_LABELS[permission] ?? permission)
                          .join('、') || '—'}
                      </td>
                      <td className="cell-num">v{grant.version}</td>
                      <td>
                        <span
                          className={`status-tag${grant.revokedAt ? ' is-danger' : ' is-done'}`}
                        >
                          {grant.revokedAt ? '已撤销' : '有效'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {access.grants.length === 0 && (
                    <tr className="table-empty">
                      <td colSpan={4}>当前访问集合没有 grant。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <ConfirmationPrompt
        open={Boolean(grantTarget)}
        title={grantTarget?.revoke ? '撤销业务角色' : '授予业务角色'}
        description={
          grantTarget
            ? `${grantTarget.member.email} · ${grantTarget.role.title} · 成员 v${grantTarget.member.version}`
            : ''
        }
        targetLabel={
          grantTarget ? `${grantTarget.member.email} · ${grantTarget.role.title}` : undefined
        }
        impact={
          grantTarget?.revoke
            ? [
                '该成员立即失去这个业务角色；已领取的任务与已作出的决定会保留。',
                '如需恢复，需要重新授予并留下新的审计记录。',
              ]
            : [
                '该成员立即获得该业务角色对应的任务与审批权限。',
                '角色权限由服务端按项目重新校验，越权操作仍会被拒绝。',
              ]
        }
        binding={
          grantTarget && projectId
            ? {
                action: grantTarget.revoke ? 'PROJECT_ROLE_UNASSIGN' : 'PROJECT_ROLE_ASSIGN',
                projectId,
                targetType: 'PROJECT_MEMBER',
                targetId: grantTarget.member.id,
                expectedVersion: grantTarget.member.version,
                roleSlot: null,
                payload: {
                  userId: grantTarget.member.id,
                  roleId: grantTarget.role.id,
                  reason: grantTarget.reason.trim(),
                },
              }
            : null
        }
        submitLabel={grantTarget?.revoke ? '撤销角色' : '授予角色'}
        onClose={() => setGrantTarget(null)}
        onConfirmed={submitGrant}
      >
        {grantTarget && (
          <div className="field">
            <span>原因（必填）</span>
            <textarea
              value={grantTarget.reason}
              aria-label="角色变更原因"
              rows={3}
              onChange={(event) => setGrantTarget({ ...grantTarget, reason: event.target.value })}
            />
          </div>
        )}
      </ConfirmationPrompt>

      <ConfirmationPrompt
        open={aclOpen}
        title="替换知识库访问集合（需二次验证）"
        description={
          access
            ? `${selectedProject?.name ?? '默认知识库'} · 访问集合 v${access.version} · ${
                currentAclDiff.changed ? currentAclDiff.lines.join('；') : '无权限变化'
              }`
            : ''
        }
        targetLabel={
          access
            ? `${selectedProject?.name ?? '默认知识库'} · 访问集合 v${access.version}`
            : undefined
        }
        impact={[
          '替换会整体覆盖当前访问集合，不是增量修改。',
          '被移除的成员/角色立即失去该知识库的读取权限。',
          '历史发布与审计记录会保留。',
        ]}
        binding={
          access && aclBinding
            ? {
                action: 'KB_ACCESS_REPLACE',
                projectId: access.projectId,
                targetType: 'KNOWLEDGE_BASE',
                targetId: access.knowledgeBaseId,
                expectedVersion: aclBinding.expectedVersion,
                roleSlot: null,
                payload: {
                  expectedAuthzVersion: aclBinding.expectedAuthzVersion,
                  visibility: aclForm.visibility,
                  publicationApproverUserId: aclForm.publicationApproverUserId.trim(),
                  publicationApproverRoleId: aclForm.publicationApproverRoleId.trim() || null,
                  grants: aclPayloadGrants(),
                  reason: aclForm.reason.trim(),
                },
              }
            : null
        }
        submitLabel="替换访问集合"
        onClose={() => setAclOpen(false)}
        onConfirmed={submitAcl}
      >
        {access && (
          <div className="form-grid">
            <div className="field">
              <span>可见性</span>
              <select
                value={aclForm.visibility}
                aria-label="知识库可见性"
                onChange={(event) =>
                  setAclForm({
                    ...aclForm,
                    visibility: event.target.value as 'PROJECT' | 'RESTRICTED',
                  })
                }
              >
                <option value="PROJECT">项目可见</option>
                <option value="RESTRICTED">受限</option>
              </select>
            </div>
            <div className="field">
              <span>出版审批人</span>
              <select
                value={aclForm.publicationApproverUserId}
                aria-label="出版审批人"
                onChange={(event) =>
                  setAclForm({ ...aclForm, publicationApproverUserId: event.target.value })
                }
              >
                <option value="">未设置</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>出版审批角色（可选）</span>
              <select
                value={aclForm.publicationApproverRoleId}
                aria-label="出版审批角色"
                onChange={(event) =>
                  setAclForm({ ...aclForm, publicationApproverRoleId: event.target.value })
                }
              >
                <option value="">未设置</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field acl-form-span">
              <span>添加授权主体</span>
              <div className="acl-subject-builder">
                <div className="field">
                  <span>主体类型</span>
                  <select
                    aria-label="ACL 主体类型"
                    value={aclSubjectKind}
                    onChange={(event) => {
                      setAclSubjectKind(event.target.value as 'USER' | 'ROLE');
                      setAclSubjectId('');
                      setAclFormError('');
                    }}
                  >
                    <option value="USER">成员</option>
                    <option value="ROLE">角色</option>
                  </select>
                </div>
                <div className="field">
                  <span>搜索主体</span>
                  <input
                    aria-label="搜索 ACL 主体"
                    value={aclSubjectQuery}
                    placeholder="姓名、邮箱、角色标题或 key"
                    onChange={(event) => {
                      setAclSubjectQuery(event.target.value);
                      setAclSubjectId('');
                    }}
                  />
                </div>
                <div className="field">
                  <span>{aclSubjectKind === 'USER' ? '项目成员' : '项目角色'}</span>
                  <select
                    aria-label={aclSubjectKind === 'USER' ? 'ACL 成员' : 'ACL 角色'}
                    value={aclSubjectId}
                    onChange={(event) => {
                      setAclSubjectId(event.target.value);
                      setAclFormError('');
                    }}
                  >
                    <option value="">
                      {aclSubjectKind === 'USER' ? '选择项目成员' : '选择项目角色'}
                    </option>
                    {aclSubjectKind === 'USER'
                      ? filteredAclMembers.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name?.trim() && member.name !== member.email
                              ? `${member.name}（${member.email}）`
                              : member.email}
                          </option>
                        ))
                      : filteredAclRoles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.title}
                            {role.key ? `（${role.key}）` : ''}
                          </option>
                        ))}
                  </select>
                  {aclSubjectQuery.trim() &&
                    (aclSubjectKind === 'USER'
                      ? filteredAclMembers.length === 0
                      : filteredAclRoles.length === 0) && (
                      <small className="muted">
                        没有匹配的{aclSubjectKind === 'USER' ? '成员' : '角色'}。
                      </small>
                    )}
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={addAclGrant}
                  disabled={!aclSubjectId || hasAclGrant(aclSubjectKind, aclSubjectId)}
                >
                  添加授权主体
                </button>
              </div>
              {aclSubjectId && hasAclGrant(aclSubjectKind, aclSubjectId) && (
                <small className="error">该主体已在授权列表中，不能重复添加。</small>
              )}
              {aclSubjectKind === 'USER' && members.length === 0 && (
                <small className="muted">项目没有已加载成员，无法添加成员 grant。</small>
              )}
              {aclSubjectKind === 'ROLE' && roles.length === 0 && (
                <small className="muted">项目没有已加载角色，无法添加角色 grant。</small>
              )}
            </div>
            <div className="field acl-form-span">
              <span>有效 Grant（按当前有效集合整组替换）</span>
              <div className="acl-grant-edit-list">
                {aclForm.grants.map((grant, index) => (
                  <div
                    className="acl-grant-edit-row"
                    data-testid="acl-grant-edit"
                    key={`${grant.subjectKind}-${grant.subjectUserId ?? grant.subjectRoleId}`}
                  >
                    <div className="acl-grant-edit-head">
                      <strong>{grantSubjectLabel(grant)}</strong>
                      <span className="status-tag">
                        {grant.subjectKind === 'USER' ? '成员' : '角色'}
                      </span>
                      <button
                        type="button"
                        className="danger"
                        aria-label={`移除授权：${grantSubjectLabel(grant)}`}
                        onClick={() => {
                          setAclForm({
                            ...aclForm,
                            grants: aclForm.grants.filter((_, itemIndex) => itemIndex !== index),
                          });
                          setAclFormError('');
                        }}
                      >
                        移除
                      </button>
                    </div>
                    <div
                      className="acl-permission-options"
                      role="group"
                      aria-label={`${grantSubjectLabel(grant)} 的权限`}
                    >
                      {PERMISSIONS.map((permission) => (
                        <label key={permission} className="acl-permission-option">
                          <input
                            type="checkbox"
                            checked={grant.permissions.includes(permission)}
                            aria-label={`${grantSubjectLabel(grant)}：${PERMISSION_LABELS[permission]}`}
                            onChange={() => updateAclGrantPermissions(index, permission)}
                          />
                          {PERMISSION_LABELS[permission]}
                        </label>
                      ))}
                    </div>
                    {grant.permissions.length === 0 && (
                      <p className="acl-grant-empty" role="alert">
                        每个 grant 至少需要一个权限；空权限不会提交。
                      </p>
                    )}
                  </div>
                ))}
                {aclForm.grants.length === 0 && (
                  <small>当前有效集合为空；提交会整体移除既有 grant，但仍会保留历史记录。</small>
                )}
              </div>
            </div>
            {aclFormError && (
              <p className="error acl-form-error acl-form-span" role="alert">
                {aclFormError}
              </p>
            )}
            <div className="field acl-form-span" data-testid="acl-diff-summary">
              <span>提交前权限变化</span>
              {currentAclDiff.changed ? (
                <ul>
                  {currentAclDiff.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <small className="muted">当前没有权限变化；不会提交无意义替换。</small>
              )}
            </div>
            <div className="field acl-form-span">
              <span>原因（必填）</span>
              <textarea
                value={aclForm.reason}
                aria-label="ACL 变更原因"
                rows={3}
                onChange={(event) => setAclForm({ ...aclForm, reason: event.target.value })}
              />
            </div>
          </div>
        )}
      </ConfirmationPrompt>

      <InviteMemberDialog
        open={inviteOpen}
        projectId={projectId}
        projectVersion={selectedProject?.version ?? null}
        roles={roles}
        rolesLoading={rolesLoading}
        onClose={() => setInviteOpen(false)}
      />
    </section>
  );
}
