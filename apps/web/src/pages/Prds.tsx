import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  knowledgeApi,
  prdApi,
  projectApi,
  requirementApi,
  type RequirementItem,
} from '../api/resources';
import { useAuthStore } from '../store/auth';
import { Modal } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';

interface PrdItem {
  id: string;
  title: string;
  version: number;
  content: string;
  status?: string;
}
interface PrdVersion {
  version: number;
  content: string;
  current: boolean;
}
interface KnowledgeBaseOption {
  id: string;
  name: string;
}
interface SpecItem {
  id: string;
  title: string;
  content: string;
  status: string;
}
interface DecisionItem {
  id: string;
  title: string;
  context: string;
  decision: string;
  consequences?: string;
  status: string;
}

const APPROVAL_LABELS: Record<string, string> = {
  PENDING: '待审批',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  CHANGES_REQUESTED: '要求修改',
};

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-preview">
      {content.split(/\r?\n/).map((line, index) => {
        if (line.startsWith('### ')) return <h4 key={index}>{line.slice(4)}</h4>;
        if (line.startsWith('## ')) return <h3 key={index}>{line.slice(3)}</h3>;
        if (line.startsWith('# ')) return <h2 key={index}>{line.slice(2)}</h2>;
        if (line.startsWith('- ')) return <li key={index}>{line.slice(2)}</li>;
        return line.trim() ? <p key={index}>{line}</p> : <br key={index} />;
      })}
    </div>
  );
}

export function Prds() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { projectId, setProjectId } = useProjectContext();
  const [requirements, setRequirements] = useState<RequirementItem[]>([]);
  const [requirementId, setRequirementId] = useState(searchParams.get('req') ?? '');
  const [kbs, setKbs] = useState<KnowledgeBaseOption[]>([]);
  const [items, setItems] = useState<PrdItem[]>([]);
  const [selected, setSelected] = useState<PrdItem | null>(null);
  const [versions, setVersions] = useState<PrdVersion[]>([]);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [compareFrom, setCompareFrom] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [specs, setSpecs] = useState<SpecItem[]>([]);
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [modalError, setModalError] = useState('');

  const [genOpen, setGenOpen] = useState(false);
  const [genForm, setGenForm] = useState({ templateId: '', knowledgeBaseId: '' });
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '', content: '', isDefault: false });
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisedContent, setRevisedContent] = useState('');
  const [approvalSubmitOpen, setApprovalSubmitOpen] = useState(false);
  const [approverId, setApproverId] = useState('');
  const [approvalDecideOpen, setApprovalDecideOpen] = useState(false);
  const [approvalId, setApprovalId] = useState('');
  const [members, setMembers] = useState<
    Array<{ id: string; name?: string | null; email: string; role: string }>
  >([]);
  const [approvals, setApprovals] = useState<
    Array<{
      id: string;
      status: string;
      createdAt?: string;
      approver?: { id: string; name?: string | null; email: string };
    }>
  >([]);
  const [approvalStatusCurrent, setApprovalStatusCurrent] = useState('');
  const [approvalStatus, setApprovalStatus] = useState<
    'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'
  >('APPROVED');
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionForm, setDecisionForm] = useState({ title: '', context: '', decision: '' });
  const [editingDecision, setEditingDecision] = useState<DecisionItem | null>(null);
  const [editingSpec, setEditingSpec] = useState<SpecItem | null>(null);
  const accessToken = useAuthStore((state) => state.accessToken);

  // 深链接优先：URL 指定的项目写入共享上下文
  useEffect(() => {
    const requested = searchParams.get('project');
    if (requested && requested !== projectId) setProjectId(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const params = new URLSearchParams({ project: projectId });
    if (requirementId) params.set('req', requirementId);
    setSearchParams(params, { replace: true });
  }, [projectId, requirementId, setSearchParams]);

  useEffect(() => {
    if (!projectId) {
      setRequirements([]);
      setKbs([]);
      setTemplates([]);
      setSpecs([]);
      setDecisions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [reqRows, kbRows, templateRows, specRows, decisionRows, memberRows] =
          await Promise.all([
            requirementApi.list(projectId, 1, 50),
            knowledgeApi.list(projectId),
            prdApi.templates(projectId),
            prdApi.specs(projectId),
            prdApi.decisions(projectId),
            projectApi.members(projectId).catch(() => []),
          ]);
        if (cancelled) return;
        setRequirements(reqRows.items);
        setMembers(memberRows);
        setKbs(
          ((kbRows as unknown as { items?: KnowledgeBaseOption[] }).items ??
            []) as KnowledgeBaseOption[],
        );
        setTemplates(templateRows as unknown as Array<{ id: string; name: string }>);
        setSpecs(specRows as unknown as SpecItem[]);
        setDecisions(decisionRows as unknown as DecisionItem[]);
        setError('');
      } catch {
        if (!cancelled) setError('无法加载该项目的工作流资源，请检查项目访问权限。');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (projectId && requirementId) void load(requirementId);
  }, [projectId, requirementId]);

  useEffect(() => {
    if (!selected?.id) {
      setApprovals([]);
      setApprovalId('');
      setApprovalStatusCurrent('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await prdApi.approvals(selected.id);
        if (cancelled) return;
        setApprovals(rows);
        const pending = rows.find((row) => row.status === 'PENDING') ?? rows[0];
        if (pending) {
          setApprovalId(pending.id);
          setApprovalStatusCurrent(pending.status);
        }
      } catch {
        if (!cancelled) setApprovals([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function loadVersions(prdId: string) {
    try {
      const rows = (await prdApi.versions(prdId)) as unknown as PrdVersion[];
      setVersions(rows);
      setPreviewVersion(rows[0]?.version ?? null);
    } catch {
      setVersions([]);
      setPreviewVersion(null);
    }
  }

  async function load(targetRequirementId = requirementId) {
    if (!targetRequirementId.trim()) return;
    setError('');
    try {
      const value = (await prdApi.list(targetRequirementId.trim())) as unknown as PrdItem[];
      setItems(value);
      setSelected(value[0] ?? null);
      setCompareFrom(null);
      setCompareTo(null);
      if (value[0]) await loadVersions(value[0].id);
      else setVersions([]);
    } catch {
      setError('无法加载该需求的 PRD，请检查需求访问权限。');
    }
  }

  async function createTemplate() {
    if (!projectId.trim() || !templateForm.name.trim() || !templateForm.content.trim()) {
      setModalError('模板名称与内容不能为空。');
      return;
    }
    try {
      await prdApi.createTemplate(projectId.trim(), {
        name: templateForm.name.trim(),
        content: templateForm.content,
        isDefault: templateForm.isDefault,
      });
      setTemplateForm({ name: '', content: '', isDefault: false });
      setTemplateOpen(false);
      setTemplates(
        (await prdApi.templates(projectId.trim())) as unknown as Array<{
          id: string;
          name: string;
        }>,
      );
    } catch {
      setModalError('PRD 模板创建失败。');
    }
  }

  async function submitApproval() {
    if (!selected?.id || !approverId) {
      setModalError('请选择审批人。');
      return;
    }
    try {
      const approval = (await prdApi.submitApproval(selected.id, {
        approverId,
      })) as unknown as { id: string; status?: string };
      setApprovalId(approval.id);
      setApprovalStatusCurrent(approval.status ?? 'PENDING');
      setApprovalSubmitOpen(false);
      setApproverId('');
      setNotice('审批已提交');
      setModalError('');
    } catch {
      setModalError('审批提交失败，请确认审批人属于项目。');
    }
  }

  async function decideApproval() {
    if (!approvalId.trim()) return;
    try {
      await prdApi.decideApproval(approvalId.trim(), { status: approvalStatus });
      setApprovalStatusCurrent(approvalStatus);
      setApprovalDecideOpen(false);
      setNotice('审批决定已保存');
      await load();
    } catch {
      setModalError('审批决定保存失败。');
    }
  }

  async function generateSpec() {
    if (!projectId.trim() || !selected?.id) return;
    try {
      await prdApi.generateSpec(projectId.trim(), selected.id);
      setSpecs((await prdApi.specs(projectId.trim())) as unknown as SpecItem[]);
      setNotice('技术规格已生成');
    } catch {
      setError('技术规格生成失败。');
    }
  }

  async function createDecision() {
    if (!projectId.trim() || !decisionForm.title.trim() || !decisionForm.context.trim() || !decisionForm.decision.trim()) {
      setModalError('标题、背景与决策内容不能为空。');
      return;
    }
    try {
      await prdApi.createDecision(projectId.trim(), {
        title: decisionForm.title.trim(),
        context: decisionForm.context.trim(),
        decision: decisionForm.decision.trim(),
      });
      setDecisionForm({ title: '', context: '', decision: '' });
      setDecisionOpen(false);
      setDecisions((await prdApi.decisions(projectId.trim())) as unknown as DecisionItem[]);
    } catch {
      setModalError('技术决策创建失败。');
    }
  }

  async function saveSpec() {
    if (!editingSpec) return;
    try {
      await prdApi.updateSpecContent(editingSpec.id, {
        title: editingSpec.title.trim(),
        content: editingSpec.content,
      });
      setEditingSpec(null);
      setSpecs((await prdApi.specs(projectId.trim())) as unknown as SpecItem[]);
    } catch {
      setModalError('技术规格更新失败。');
    }
  }

  async function saveDecision() {
    if (!editingDecision) return;
    try {
      await prdApi.updateDecisionContent(editingDecision.id, {
        title: editingDecision.title.trim(),
        context: editingDecision.context,
        decision: editingDecision.decision,
        consequences: editingDecision.consequences ?? '',
      });
      setEditingDecision(null);
      setDecisions((await prdApi.decisions(projectId.trim())) as unknown as DecisionItem[]);
    } catch {
      setModalError('技术决策更新失败。');
    }
  }

  async function saveRevision() {
    if (!selected?.id || !revisedContent.trim()) return;
    try {
      const updated = (await prdApi.revise(selected.id, revisedContent)) as unknown as PrdItem;
      setSelected(updated);
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setRevisedContent('');
      setRevisionOpen(false);
      await loadVersions(updated.id);
    } catch {
      setModalError('PRD 新版本保存失败。');
    }
  }

  async function generate() {
    if (!requirementId.trim()) return;
    setBusy(true);
    setError('');
    setNotice('');
    setGenOpen(false);
    try {
      if (!accessToken) throw new Error('Authentication required');
      setSelected({ id: '', title: '正在生成 PRD', version: 0, content: '' });
      setVersions([]);
      const query = new URLSearchParams();
      if (genForm.templateId.trim()) query.set('templateId', genForm.templateId.trim());
      if (genForm.knowledgeBaseId.trim()) query.set('knowledgeBaseId', genForm.knowledgeBaseId.trim());
      const suffix = query.size ? `?${query.toString()}` : '';
      const response = await fetch(
        `/api/requirements/${encodeURIComponent(requirementId.trim())}/prds/generate-stream${suffix}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'text/event-stream' } },
      );
      if (!response.ok || !response.body) throw new Error('PRD stream failed');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const messages = buffer.split('\n\n');
        buffer = messages.pop() ?? '';
        for (const message of messages) {
          const line = message.split('\n').find((item) => item.startsWith('data:'));
          if (!line) continue;
          const event = JSON.parse(line.slice(5).trim()) as {
            content?: string;
            done?: boolean;
            prd?: PrdItem;
          };
          if (event.content) {
            content += event.content;
            setSelected({ id: '', title: '正在生成 PRD', version: 0, content });
          }
          if (event.done && event.prd) {
            const generated = event.prd;
            setItems((current) => [
              generated,
              ...current.filter((item) => item.id !== generated.id),
            ]);
            setSelected(generated);
            await loadVersions(generated.id);
          }
        }
        if (done) break;
      }
      await reader.cancel().catch(() => undefined);
    } catch {
      setError('PRD 生成失败，请确认需求存在并可访问。');
    } finally {
      setBusy(false);
    }
  }

  async function exportMarkdown() {
    if (!selected) return;
    const response = await prdApi.exportMarkdown(selected.id);
    const url = URL.createObjectURL(response as unknown as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected.title}-v${selected.version}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function exportHtml() {
    if (!selected) return;
    const response = await prdApi.exportHtml(selected.id);
    const url = URL.createObjectURL(response as unknown as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected.title}-v${selected.version}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function printPdf() {
    if (!selected) return;
    const response = await prdApi.exportHtml(selected.id);
    const url = URL.createObjectURL(response as unknown as Blob);
    const windowRef = window.open(url, '_blank');
    if (windowRef) windowRef.addEventListener('load', () => windowRef.print(), { once: true });
  }
  async function restoreVersion(version: number) {
    if (!selected?.id) return;
    try {
      const restored = (await prdApi.restore(selected.id, version)) as unknown as PrdItem;
      setSelected(restored);
      setItems((current) => current.map((item) => (item.id === restored.id ? restored : item)));
      await loadVersions(restored.id);
    } catch {
      setError('PRD 版本恢复失败。');
    }
  }

  function selectRequirement(id: string) {
    setRequirementId(id);
    setItems([]);
    setSelected(null);
    setVersions([]);
    setApprovalId('');
    setApprovalStatusCurrent('');
  }

  function openGenerate() {
    setGenForm({ templateId: '', knowledgeBaseId: '' });
    setModalError('');
    setGenOpen(true);
  }

  const currentRequirement = requirements.find((item) => item.id === requirementId);
  const previewContent =
    versions.find((version) => version.version === previewVersion)?.content ??
    selected?.content ??
    '';

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>PRD 工作台</h2>
          <p className="page-sub">从需求生成 PRD，管理版本、审批与技术决策</p>
        </div>
        <div className="page-actions">
          <ProjectSelect
            onChange={() => {
              setRequirementId('');
              setItems([]);
              setSelected(null);
              setVersions([]);
              setApprovalId('');
              setApprovalStatusCurrent('');
            }}
          />
          <button className="primary" disabled={!requirementId || busy} onClick={openGenerate}>
            {busy ? '生成中…' : '生成 PRD'}
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {notice && <p className="kb-notice">{notice}</p>}

      <div className="table-card">
        <div className="card-head">
          <h3>
            需求<small>{requirements.length}</small>
          </h3>
          <span className="card-head-actions">
            <small>{currentRequirement ? `当前：${currentRequirement.title}` : '先选择一个需求'}</small>
          </span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>优先级</th>
                <th>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {requirements.map((requirement) => (
                <tr
                  key={requirement.id}
                  className={requirementId === requirement.id ? 'is-selected' : undefined}
                >
                  <td>
                    <strong>{requirement.title}</strong>
                  </td>
                  <td>{requirement.priority ?? 'MEDIUM'}</td>
                  <td>
                    <span className="status-tag">{requirement.status}</span>
                  </td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      <button
                        className="ghost"
                        onClick={() => selectRequirement(requirement.id)}
                      >
                        {requirementId === requirement.id ? '当前' : '选择'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {requirements.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={4}>{projectId ? '该项目还没有需求。' : '先选择项目。'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-card">
        <div className="card-head">
          <h3>
            PRD<small>{items.length}</small>
          </h3>
          <span className="card-head-actions">
            <small>{selected ? `当前：${selected.title} v${selected.version}` : '先选择需求'}</small>
          </span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>标题</th>
                <th>版本</th>
                <th>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={selected?.id === item.id ? 'is-selected' : undefined}>
                  <td>
                    <strong>{item.title}</strong>
                  </td>
                  <td className="cell-num">v{item.version}</td>
                  <td>{item.status ?? '—'}</td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      <button
                        className="ghost"
                        onClick={() => {
                          setSelected(item);
                          setCompareFrom(null);
                          setCompareTo(null);
                          void loadVersions(item.id);
                        }}
                      >
                        {selected?.id === item.id ? '当前' : '查看'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={4}>
                    {requirementId ? '该需求还没有 PRD，点右上角「生成 PRD」。' : '先选择一个需求。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="table-card">
          <div className="card-head">
            <h3>
              {selected.title}
              <small>
                v{selected.version}
                {previewVersion !== null && previewVersion !== selected.version
                  ? ` · 正在预览 v${previewVersion}`
                  : ''}
              </small>
            </h3>
            <span className="card-head-actions">
              <button className="ghost" onClick={exportMarkdown}>
                导出 Markdown
              </button>
              <button className="ghost" onClick={exportHtml}>
                导出 HTML
              </button>
              <button className="ghost" onClick={printPdf}>
                打印 / PDF
              </button>
              <button
                className="ghost"
                disabled={!selected.id}
                onClick={() => {
                  setRevisedContent(previewContent);
                  setModalError('');
                  setRevisionOpen(true);
                }}
              >
                编辑新版本
              </button>
              <button
                className="ghost"
                disabled={!selected.id || !approvalStatusCurrent}
                onClick={() => {
                  setApprovalId('');
                  setModalError('');
                  setApprovalDecideOpen(true);
                }}
              >
                处理审批
              </button>
              <button
                className="ghost"
                disabled={!selected.id}
                onClick={() => {
                  setModalError('');
                  setApprovalSubmitOpen(true);
                }}
              >
                提交审批
              </button>
            </span>
          </div>
          <div className="prd-doc-body">
            <MarkdownPreview content={previewContent} />
          </div>
        </div>
      )}

      <div className="table-card">
        <div className="card-head">
          <h3>
            版本<small>{versions.length}</small>
          </h3>
          <span className="card-head-actions">
            <small>{selected ? selected.title : '先选择 PRD'}</small>
          </span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>版本</th>
                <th>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr
                  key={version.version}
                  className={previewVersion === version.version ? 'is-selected' : undefined}
                >
                  <td>
                    <strong>v{version.version}</strong>
                  </td>
                  <td>{version.current ? <span className="status-tag">当前版本</span> : '历史版本'}</td>
                  <td className="col-actions">
                    <div className="cell-actions row-actions">
                      <button
                        className="ghost"
                        onClick={() => setPreviewVersion(version.version)}
                        aria-label={`预览版本 ${version.version}`}
                      >
                        预览
                      </button>
                      {!version.current && (
                        <button
                          className="ghost"
                          onClick={() => void restoreVersion(version.version)}
                          aria-label={`恢复版本 ${version.version}`}
                        >
                          恢复
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {versions.length === 0 && (
                <tr className="table-empty">
                  <td colSpan={3}>{selected ? '暂无版本记录。' : '先选择 PRD。'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {versions.length > 1 && (
          <div className="table-foot prd-compare-bar">
            <span>版本对比</span>
            <div className="prd-compare-selects">
              <select
                value={compareFrom ?? ''}
                onChange={(event) => setCompareFrom(Number(event.target.value) || null)}
                aria-label="选择版本 A"
              >
                <option value="">版本 A</option>
                {versions.map((version) => (
                  <option key={version.version} value={version.version}>
                    v{version.version}
                  </option>
                ))}
              </select>
              <select
                value={compareTo ?? ''}
                onChange={(event) => setCompareTo(Number(event.target.value) || null)}
                aria-label="选择版本 B"
              >
                <option value="">版本 B</option>
                {versions.map((version) => (
                  <option key={version.version} value={version.version}>
                    v{version.version}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {compareFrom && compareTo && (
          <div className="prd-compare-columns">
            {[compareFrom, compareTo].map((versionNumber) => (
              <pre key={versionNumber} className="search-result">
                {versions.find((version) => version.version === versionNumber)?.content}
              </pre>
            ))}
          </div>
        )}
      </div>

      <div className="prd-grid-2">
        <div className="table-card">
          <div className="card-head">
            <h3>
              模板<small>{templates.length}</small>
            </h3>
            <button
              className="ghost"
              disabled={!projectId}
              onClick={() => {
                setTemplateForm({ name: '', content: '', isDefault: false });
                setModalError('');
                setTemplateOpen(true);
              }}
            >
              新建模板
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <strong>{template.name}</strong>
                    </td>
                    <td className="col-actions">
                      <div className="cell-actions row-actions">
                        <button
                          className="ghost"
                          onClick={() => {
                            setGenForm((current) => ({ ...current, templateId: template.id }));
                            setModalError('');
                            setGenOpen(true);
                          }}
                        >
                          用于生成
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {templates.length === 0 && (
                  <tr className="table-empty">
                    <td colSpan={2}>{projectId ? '该项目还没有模板。' : '先选择项目。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="table-card">
          <div className="card-head">
            <h3>
              审批<small>{approvalStatusCurrent || '未提交'}</small>
            </h3>
            <span className="card-head-actions">
              <small>{selected ? selected.title : '先选择 PRD'}</small>
            </span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>审批记录</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {approvalId ? (
                  <tr>
                    <td>
                      <span className="cell-truncate cell-mono" title={approvalId}>
                        {approvalId}
                      </span>
                    </td>
                    <td>
                      <span className="status-tag">{approvalStatusCurrent || 'PENDING'}</span>
                    </td>
                  </tr>
                ) : (
                  <tr className="table-empty">
                    <td colSpan={2}>当前 PRD 还没有提交审批记录。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="table-card">
          <div className="card-head">
            <h3>
              技术规格<small>{specs.length}</small>
            </h3>
            <button
              className="ghost"
              disabled={!projectId || !selected?.id}
              onClick={() => void generateSpec()}
            >
              从当前 PRD 生成
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>状态</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {specs.map((spec) => (
                  <tr key={spec.id}>
                    <td>
                      <strong>{spec.title}</strong>
                    </td>
                    <td>{spec.status}</td>
                    <td className="col-actions">
                      <div className="cell-actions row-actions">
                        <button
                          className="ghost"
                          onClick={() => {
                            setEditingSpec({ ...spec });
                            setModalError('');
                          }}
                        >
                          编辑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {specs.length === 0 && (
                  <tr className="table-empty">
                    <td colSpan={3}>{projectId ? '还没有技术规格。' : '先选择项目。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="table-card">
          <div className="card-head">
            <h3>
              技术决策<small>{decisions.length}</small>
            </h3>
            <button
              className="ghost"
              disabled={!projectId}
              onClick={() => {
                setDecisionForm({ title: '', context: '', decision: '' });
                setModalError('');
                setDecisionOpen(true);
              }}
            >
              新建决策
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>状态</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((decision) => (
                  <tr key={decision.id}>
                    <td>
                      <strong>{decision.title}</strong>
                    </td>
                    <td>{decision.status}</td>
                    <td className="col-actions">
                      <div className="cell-actions row-actions">
                        <button
                          className="ghost"
                          onClick={() => {
                            setEditingDecision({ ...decision });
                            setModalError('');
                          }}
                        >
                          编辑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {decisions.length === 0 && (
                  <tr className="table-empty">
                    <td colSpan={3}>{projectId ? '还没有技术决策。' : '先选择项目。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        open={genOpen}
        title="生成 PRD"
        description={currentRequirement ? `需求：${currentRequirement.title}` : ''}
        size="md"
        onClose={() => setGenOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setGenOpen(false)}>
              取消
            </button>
            <button className="primary" onClick={() => void generate()}>
              开始生成
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>PRD 模板</span>
            <select
              value={genForm.templateId}
              onChange={(event) => setGenForm({ ...genForm, templateId: event.target.value })}
              aria-label="选择 PRD 模板"
            >
              <option value="">{templates.length ? '默认方式生成' : '无可用模板'}</option>
              {templates.map((template) => (
                <option value={template.id} key={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span>引用知识库</span>
            <select
              value={genForm.knowledgeBaseId}
              onChange={(event) =>
                setGenForm({ ...genForm, knowledgeBaseId: event.target.value })
              }
              aria-label="选择知识库"
            >
              <option value="">{kbs.length ? '不引用知识库' : '无可用知识库'}</option>
              {kbs.map((base) => (
                <option value={base.id} key={base.id}>
                  {base.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      <Modal
        open={templateOpen}
        title="新建模板"
        description="模板内容使用 Markdown，可作为 PRD 生成的结构骨架。"
        size="lg"
        onClose={() => setTemplateOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setTemplateOpen(false)}>
              取消
            </button>
            <button className="primary" onClick={() => void createTemplate()}>
              创建模板
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>模板名称</span>
            <input
              value={templateForm.name}
              onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })}
              maxLength={200}
              aria-label="模板名称"
            />
          </div>
          <div className="field">
            <span>模板内容（Markdown）</span>
            <textarea
              value={templateForm.content}
              onChange={(event) =>
                setTemplateForm({ ...templateForm, content: event.target.value })
              }
              aria-label="模板内容"
            />
          </div>
          <label className="field">
            <span>默认模板</span>
            <span>
              <input
                type="checkbox"
                checked={templateForm.isDefault}
                onChange={(event) =>
                  setTemplateForm({ ...templateForm, isDefault: event.target.checked })
                }
                aria-label="设为默认模板"
              />{' '}
              生成 PRD 时默认使用该模板
            </span>
          </label>
          {modalError && <p className="modal-error">{modalError}</p>}
        </div>
      </Modal>

      <Modal
        open={revisionOpen}
        title="编辑新版本"
        description={selected ? `基于 v${previewVersion ?? selected.version} 创建新版本` : ''}
        size="lg"
        onClose={() => setRevisionOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setRevisionOpen(false)}>
              取消
            </button>
            <button className="primary" onClick={() => void saveRevision()}>
              保存新版本
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>PRD 内容</span>
            <textarea
              value={revisedContent}
              onChange={(event) => setRevisedContent(event.target.value)}
              aria-label="PRD 新版本内容"
              style={{ minHeight: 320 }}
            />
          </div>
          {modalError && <p className="modal-error">{modalError}</p>}
        </div>
      </Modal>

      <Modal
        open={approvalSubmitOpen}
        title="提交审批"
        description={selected ? selected.title : ''}
        size="sm"
        onClose={() => setApprovalSubmitOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setApprovalSubmitOpen(false)}>
              取消
            </button>
            <button
              className="primary"
              disabled={!approverId.trim()}
              onClick={() => void submitApproval()}
            >
              提交
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>审批人</span>
            <select
              value={approverId}
              onChange={(event) => setApproverId(event.target.value)}
              aria-label="审批人"
            >
              <option value="">选择项目成员</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || member.email}（{member.email}）
                </option>
              ))}
            </select>
            <small>只有项目成员可以被指定为审批人。</small>
          </div>
          {modalError && <p className="modal-error">{modalError}</p>}
        </div>
      </Modal>

      <Modal
        open={approvalDecideOpen}
        title="处理审批决定"
        description={selected ? selected.title : ''}
        size="sm"
        onClose={() => setApprovalDecideOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setApprovalDecideOpen(false)}>
              取消
            </button>
            <button className="primary" onClick={() => void decideApproval()}>
              保存决定
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>审批记录</span>
            <select
              value={approvalId}
              onChange={(event) => setApprovalId(event.target.value)}
              aria-label="审批记录"
            >
              {approvals.length === 0 && <option value="">暂无审批记录，请先提交审批</option>}
              {approvals.map((approval) => (
                <option key={approval.id} value={approval.id}>
                  {approval.approver?.name || approval.approver?.email || '未知审批人'} ·{' '}
                  {APPROVAL_LABELS[approval.status] ?? approval.status}
                </option>
              ))}
            </select>
            <small>默认选中最近一条待审批记录。</small>
          </div>
          <div className="field">
            <span>审批决定</span>
            <select
              value={approvalStatus}
              onChange={(event) => setApprovalStatus(event.target.value as typeof approvalStatus)}
              aria-label="审批决定"
            >
              <option value="APPROVED">通过</option>
              <option value="REJECTED">驳回</option>
              <option value="CHANGES_REQUESTED">要求修改</option>
            </select>
          </div>
          {modalError && <p className="modal-error">{modalError}</p>}
        </div>
      </Modal>

      <Modal
        open={decisionOpen}
        title="新建技术决策"
        description="记录关键取舍，便于后续追溯。"
        size="md"
        onClose={() => setDecisionOpen(false)}
        footer={
          <>
            <button className="ghost" onClick={() => setDecisionOpen(false)}>
              取消
            </button>
            <button className="primary" onClick={() => void createDecision()}>
              创建
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field">
            <span>决策标题</span>
            <input
              value={decisionForm.title}
              onChange={(event) =>
                setDecisionForm({ ...decisionForm, title: event.target.value })
              }
              aria-label="决策标题"
            />
          </div>
          <div className="field">
            <span>决策背景</span>
            <textarea
              value={decisionForm.context}
              onChange={(event) =>
                setDecisionForm({ ...decisionForm, context: event.target.value })
              }
              aria-label="决策背景"
            />
          </div>
          <div className="field">
            <span>决策内容</span>
            <textarea
              value={decisionForm.decision}
              onChange={(event) =>
                setDecisionForm({ ...decisionForm, decision: event.target.value })
              }
              aria-label="决策内容"
            />
          </div>
          {modalError && <p className="modal-error">{modalError}</p>}
        </div>
      </Modal>

      <Modal
        open={Boolean(editingDecision)}
        title="编辑技术决策"
        description={editingDecision?.title}
        size="md"
        onClose={() => setEditingDecision(null)}
        footer={
          <>
            <button className="ghost" onClick={() => setEditingDecision(null)}>
              取消
            </button>
            <button className="primary" onClick={() => void saveDecision()}>
              保存
            </button>
          </>
        }
      >
        {editingDecision && (
          <div className="form-grid">
            <div className="field">
              <span>决策标题</span>
              <input
                value={editingDecision.title}
                onChange={(event) =>
                  setEditingDecision({ ...editingDecision, title: event.target.value })
                }
                aria-label="编辑决策标题"
              />
            </div>
            <div className="field">
              <span>决策背景</span>
              <textarea
                value={editingDecision.context}
                onChange={(event) =>
                  setEditingDecision({ ...editingDecision, context: event.target.value })
                }
                aria-label="编辑决策背景"
              />
            </div>
            <div className="field">
              <span>决策内容</span>
              <textarea
                value={editingDecision.decision}
                onChange={(event) =>
                  setEditingDecision({ ...editingDecision, decision: event.target.value })
                }
                aria-label="编辑决策内容"
              />
            </div>
            <div className="field">
              <span>决策后果</span>
              <textarea
                value={editingDecision.consequences ?? ''}
                onChange={(event) =>
                  setEditingDecision({ ...editingDecision, consequences: event.target.value })
                }
                aria-label="编辑决策后果"
              />
            </div>
            {modalError && <p className="modal-error">{modalError}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(editingSpec)}
        title="编辑技术规格"
        description={editingSpec?.title}
        size="lg"
        onClose={() => setEditingSpec(null)}
        footer={
          <>
            <button className="ghost" onClick={() => setEditingSpec(null)}>
              取消
            </button>
            <button className="primary" onClick={() => void saveSpec()}>
              保存
            </button>
          </>
        }
      >
        {editingSpec && (
          <div className="form-grid">
            <div className="field">
              <span>规格标题</span>
              <input
                value={editingSpec.title}
                onChange={(event) =>
                  setEditingSpec({ ...editingSpec, title: event.target.value })
                }
                aria-label="编辑规格标题"
              />
            </div>
            <div className="field">
              <span>规格内容</span>
              <textarea
                value={editingSpec.content}
                onChange={(event) =>
                  setEditingSpec({ ...editingSpec, content: event.target.value })
                }
                aria-label="编辑规格内容"
                style={{ minHeight: 280 }}
              />
            </div>
            {modalError && <p className="modal-error">{modalError}</p>}
          </div>
        )}
      </Modal>
    </section>
  );
}
