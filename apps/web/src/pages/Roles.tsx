import { useEffect, useState } from 'react';
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
import { useProjectContext } from '../hooks/useProjectContext';
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
  const [members, setMembers] = useState<MemberView[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [grantTarget, setGrantTarget] = useState<RoleGrantTarget | null>(null);
  const [roleMember, setRoleMember] = useState<MemberView | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const [knowledgeBaseId, setKnowledgeBaseId] = useState('');
  const [access, setAccess] = useState<AccessView | null>(null);
  const [accessError, setAccessError] = useState('');
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

  async function load() {
    if (!projectId) {
      setMembers([]);
      setRoles([]);
      return;
    }
    try {
      const [memberRows, roleRows] = await Promise.all([
        projectApi.members(projectId),
        projectApi.roles(projectId),
      ]);
      setMembers(memberRows);
      setRoles(roleRows);
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  const selectedProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    if (selectedProject?.defaultKnowledgeBaseId)
      setKnowledgeBaseId(selectedProject.defaultKnowledgeBaseId);
  }, [projectId, selectedProject?.defaultKnowledgeBaseId]);

  const memberEmailById = new Map(members.map((member) => [member.id, member.email]));
  const roleTitleById = new Map(roles.map((role) => [role.id, role.title]));

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
    try {
      setAccess(await aclApi.getAccess(id));
      setAccessError('');
    } catch (caught) {
      setAccess(null);
      setAccessError(formatApiError(caught));
    }
  }

  function openAcl() {
    if (!access) return;
    setAclForm({
      visibility: access.visibility === 'RESTRICTED' ? 'RESTRICTED' : 'PROJECT',
      publicationApproverUserId: access.publicationApproverUserId ?? '',
      publicationApproverRoleId: access.publicationApproverRoleId ?? '',
      grants: access.grants
        .filter((grant) => !grant.revokedAt)
        .map((grant) => ({
          subjectKind: grant.subjectKind,
          subjectUserId: grant.subjectUserId,
          subjectRoleId: grant.subjectRoleId,
          permissions: [...grant.permissions],
        })),
      reason: '',
    });
    setAclBinding({ expectedVersion: access.version, expectedAuthzVersion: access.authzVersion });
    setAclOpen(true);
  }

  async function submitAcl(confirmation: { ticketId: string; ticketSecret: string }) {
    if (!access || !aclBinding) throw new Error('缺少 ACL 目标');
    if (aclForm.reason.trim().length === 0) throw new Error('原因不能为空');
    await aclApi.replaceAccess(access.knowledgeBaseId, {
      expectedVersion: aclBinding.expectedVersion,
      expectedAuthzVersion: aclBinding.expectedAuthzVersion,
      visibility: aclForm.visibility,
      publicationApproverUserId: aclForm.publicationApproverUserId.trim(),
      publicationApproverRoleId: aclForm.publicationApproverRoleId.trim() || null,
      grants: aclForm.grants,
      reason: aclForm.reason.trim(),
      confirmation,
    });
    setAccess(await aclApi.getAccess(access.knowledgeBaseId));
    setNotice('知识库访问集合已替换；历史 grant 以撤销时间保留。');
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>角色 / ACL</h2>
          <p className="page-sub">
            管理身份与业务角色分离；知识库访问按 grant 集合替换，所有写操作都需要一次性票据。
          </p>
        </div>
        <div className="page-actions">
          <ProjectSelect onChange={() => setAccess(null)} />
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
            成员<small>{members.length}</small>
          </h3>
          <span className="card-head-actions">
            <button
              className="ghost"
              onClick={() => setInviteOpen(true)}
              disabled={!projectId || !selectedProject}
            >
              邀请成员
            </button>
          </span>
        </div>
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
                  <td colSpan={4}>{projectId ? '没有活动成员。' : '先选择项目。'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
          {roles.length === 0 && <p className="detail-empty">项目还没有业务角色。</p>}
        </div>
      </Modal>

      <div className="table-card">
        <div className="card-head">
          <h3>知识库访问（ACL）</h3>
          <span className="card-head-actions">
            <span className="acl-kb-label">默认知识库：{selectedProject?.name ?? '未配置'}</span>
            <button className="ghost" onClick={() => void loadAccess()} disabled={!knowledgeBaseId}>
              读取访问集合
            </button>
            {access && (
              <button className="primary" onClick={openAcl}>
                替换访问集合
              </button>
            )}
          </span>
        </div>
        {accessError && (
          <p className="error" role="alert">
            {accessError}
          </p>
        )}
        {access && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>可见性</th>
                  <th>版本</th>
                  <th>授权版本</th>
                  <th>审批人</th>
                  <th>Grant</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{access.visibility}</td>
                  <td className="cell-num">v{access.version}</td>
                  <td className="cell-num">v{access.authzVersion}</td>
                  <td>
                    {access.publicationApproverUserId
                      ? (memberEmailById.get(access.publicationApproverUserId) ?? '—')
                      : '—'}
                    {access.publicationApproverRoleId
                      ? ` / ${roleTitleById.get(access.publicationApproverRoleId) ?? '角色'}`
                      : ''}
                  </td>
                  <td>{access.grants.length} 条</td>
                </tr>
                {access.grants.map((grant) => (
                  <tr key={grant.id}>
                    <td>
                      {grant.subjectKind === 'USER'
                        ? (memberEmailById.get(grant.subjectUserId ?? '') ?? '—')
                        : (roleTitleById.get(grant.subjectRoleId ?? '') ?? '—')}
                    </td>
                    <td>{grant.permissions.join('、')}</td>
                    <td className="cell-num">v{grant.version}</td>
                    <td className="cell-mono">{grant.revokedAt ? '已撤销' : '有效'}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          access ? `${selectedProject?.name ?? '默认知识库'} · 访问集合 v${access.version}` : ''
        }
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
                  grants: aclForm.grants,
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
            <div className="field">
              <span>保留 Grant（按当前有效集合整组替换）</span>
              {aclForm.grants.map((grant, index) => (
                <div
                  className="cell-actions row-actions acl-grant-row"
                  key={`${grant.subjectKind}-${index}`}
                >
                  <strong>
                    {grant.subjectKind === 'USER'
                      ? (memberEmailById.get(grant.subjectUserId ?? '') ?? '未知成员')
                      : (roleTitleById.get(grant.subjectRoleId ?? '') ?? '未知角色')}
                  </strong>
                  {PERMISSIONS.map((permission) => (
                    <label key={permission} className="inline-check">
                      <input
                        type="checkbox"
                        checked={grant.permissions.includes(permission)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...grant.permissions, permission]
                            : grant.permissions.filter((item) => item !== permission);
                          setAclForm({
                            ...aclForm,
                            grants: aclForm.grants.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, permissions: next } : item,
                            ),
                          });
                        }}
                      />
                      {PERMISSION_LABELS[permission]}
                    </label>
                  ))}
                  <button
                    className="danger"
                    onClick={() =>
                      setAclForm({
                        ...aclForm,
                        grants: aclForm.grants.filter((_, itemIndex) => itemIndex !== index),
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
              {aclForm.grants.length === 0 && (
                <small>当前集合为空；授权将整体移除既有 grant。</small>
              )}
            </div>
            <div className="field">
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
        onClose={() => setInviteOpen(false)}
      />
    </section>
  );
}
