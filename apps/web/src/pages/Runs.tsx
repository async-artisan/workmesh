import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Circle,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  UserRound,
  X,
} from 'lucide-react';
import {
  aiRunApi,
  type AiRunDetail,
  type AiRunDraft,
  type AiRunItem,
  type AiRunMessage,
} from '../api/resources';
import { useAuthStore } from '../store/auth';
import { useLocation } from 'react-router-dom';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';

const steps = [
  ['BACKGROUND_GOAL', '背景与目标'],
  ['USERS_SCENARIOS', '用户与场景'],
  ['USER_STORIES_FLOWS', '故事与流程'],
  ['ACCEPTANCE_CRITERIA', '验收标准'],
] as const;
const statuses: Record<string, string> = {
  ACTIVE: '进行中',
  PROCESSING: '处理中',
  PAUSED: '已暂停',
  WAITING_CONFIRMATION: '待确认',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  FAILED: '失败，可重试',
};
const emptyDraft: AiRunDraft = {
  backgroundGoal: '',
  usersScenarios: [],
  userStoriesFlows: [],
  acceptanceCriteria: [],
};

function messageContent(message: AiRunMessage) {
  return message.content ?? message.text ?? '';
}

function normalizeList(value: unknown): AiRunItem[] {
  if (Array.isArray(value)) return value as AiRunItem[];
  if (value && typeof value === 'object' && 'items' in value) {
    const items = (value as { items?: unknown }).items;
    return Array.isArray(items) ? (items as AiRunItem[]) : [];
  }
  return [];
}

function normalizeDetail(value: AiRunDetail | AiRunItem): AiRunDetail {
  const detail = value as AiRunDetail;
  if (detail.run) return { run: detail.run, messages: detail.messages ?? [] };
  const run = value as AiRunItem;
  return { run, messages: run.messages ?? [] };
}

function mergeDetails(current: AiRunDetail, next: AiRunDetail): AiRunDetail {
  const messages = new Map<string, AiRunMessage>();
  for (const item of [...current.messages, ...next.messages]) {
    messages.set(String(item.sequence ?? item.id), item);
  }
  return {
    ...current,
    ...next,
    run: { ...current.run, ...next.run },
    messages: [...messages.values()].sort(
      (left, right) => (left.sequence ?? 0) - (right.sequence ?? 0),
    ),
  };
}

function draftFromRun(run: AiRunItem): AiRunDraft {
  const draft = run.draft;
  if (!draft || typeof draft === 'string' || !('backgroundGoal' in draft)) return emptyDraft;
  return {
    backgroundGoal: draft.backgroundGoal ?? '',
    usersScenarios: draft.usersScenarios ?? [],
    userStoriesFlows: draft.userStoriesFlows ?? [],
    acceptanceCriteria: draft.acceptanceCriteria ?? [],
  };
}

function stepIndex(run: AiRunItem, messages: AiRunMessage[]) {
  if (run.step === 'WAITING_CONFIRMATION') return steps.length;
  const explicit = steps.findIndex(([value]) => value === run.step);
  if (explicit >= 0) return explicit;
  return Math.min(
    steps.length - 1,
    messages.filter((message) => (message.role ?? '').toUpperCase() === 'USER').length,
  );
}

function statusClass(status: string) {
  if (status === 'COMPLETED') return 'is-done';
  if (status === 'PAUSED' || status === 'WAITING_CONFIRMATION') return 'is-review';
  if (status === 'ACTIVE' || status === 'PROCESSING') return 'is-active';
  return '';
}

function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatMessageTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="runs-markdown">
      {content.split(/\r?\n/).map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div className="runs-markdown-space" key={index} />;
        const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (heading)
          return (
            <strong className={`runs-markdown-heading level-${heading[1].length}`} key={index}>
              {heading[2]}
            </strong>
          );
        if (/^[-*]\s+/.test(trimmed))
          return (
            <div className="runs-markdown-list-item" key={index}>
              <span aria-hidden="true">•</span>
              <span>{trimmed.replace(/^[-*]\s+/, '')}</span>
            </div>
          );
        return <p key={index}>{trimmed}</p>;
      })}
    </div>
  );
}

function apiErrorMessage(error: unknown, fallback: string) {
  const response = (
    error as {
      response?: { status?: number; data?: { message?: unknown } };
    }
  )?.response;
  const message = response?.data?.message;
  const detail =
    typeof message === 'string'
      ? message
      : Array.isArray(message)
        ? message.filter((item): item is string => typeof item === 'string').join('；')
        : message && typeof message === 'object' && 'message' in message
          ? String((message as { message: unknown }).message)
          : '';
  if (detail) return `${fallback}：${detail}`;
  return response?.status ? `${fallback}（HTTP ${response.status}）` : fallback;
}

export function Runs() {
  const location = useLocation();
  const accessToken = useAuthStore((state) => state.accessToken);
  const { projectId, setProjectId } = useProjectContext();
  const [runs, setRuns] = useState<AiRunItem[]>([]);
  const [selected, setSelected] = useState<AiRunDetail | null>(null);
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [createMessage, setCreateMessage] = useState('');
  const [draft, setDraft] = useState<AiRunDraft>(emptyDraft);
  const [draftTitle, setDraftTitle] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamState, setStreamState] = useState<'idle' | 'connected' | 'disconnected' | 'error'>(
    'idle',
  );
  const [streamAttempt, setStreamAttempt] = useState(0);
  const lastEventIds = useRef<Record<string, string>>({});
  const messageEndRef = useRef<HTMLDivElement>(null);

  const currentStep = useMemo(
    () => (selected ? stepIndex(selected.run, selected.messages) : 0),
    [selected],
  );
  const userMessageCount = selected
    ? selected.messages.filter((item) => (item.role ?? '').toUpperCase() === 'USER').length
    : 0;
  const canMessage =
    !!selected && selected.run.status === 'ACTIVE' && userMessageCount < steps.length;
  const canConfirm = selected?.run.status === 'WAITING_CONFIRMATION';
  const isProcessing = selected?.run.status === 'PROCESSING';

  // 深链接优先：URL 指定的项目写入共享上下文
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('projectId');
    if (requested && requested !== projectId) setProjectId(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRuns(targetProject = projectId) {
    if (!targetProject) {
      setRuns([]);
      setSelected(null);
      return;
    }
    try {
      const result = await aiRunApi.list(targetProject, 1, 20, status || undefined);
      setRuns(normalizeList(result));
      setError('');
    } catch {
      setRuns([]);
      setError('无法加载 AI 运行，可能是服务尚未启用或项目无访问权限。');
    }
  }

  async function selectRun(run: AiRunItem) {
    setError('');
    try {
      const detail = normalizeDetail(await aiRunApi.get(run.id));
      setSelected(detail);
      setDraft(draftFromRun(detail.run));
      setDraftTitle(detail.run.title ?? '');
      setPriority(detail.run.priority ?? 'MEDIUM');
    } catch {
      setError('无法加载运行详情。');
    }
  }

  useEffect(() => {
    void loadRuns();
  }, [projectId, status]);

  useEffect(() => {
    if (
      !selected ||
      !accessToken ||
      !['ACTIVE', 'PROCESSING', 'PAUSED', 'WAITING_CONFIRMATION'].includes(selected.run.status)
    )
      return;
    const runId = selected.run.id;
    const token = accessToken;
    const controller = new AbortController();
    let lastEventId = lastEventIds.current[runId] ?? '';
    let active = true;
    async function connect() {
      try {
        const response = await aiRunApi.stream(runId, token, controller.signal, lastEventId);
        if (!response.ok || !response.body) throw new Error('SSE unavailable');
        if (active) setStreamState('connected');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (active) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const id = chunk.match(/^id:\s*(.+)$/m)?.[1]?.trim();
            if (id) {
              lastEventId = id;
              lastEventIds.current[runId] = id;
            }
            const eventType = chunk.match(/^event:\s*(.+)$/m)?.[1]?.trim();
            const line = chunk.split(/\r?\n/).find((item) => item.startsWith('data:'));
            if (!line) continue;
            try {
              const event = JSON.parse(line.slice(5).trim()) as AiRunMessage;
              if (event.sequence != null) {
                lastEventId = String(event.sequence);
                lastEventIds.current[runId] = lastEventId;
              }
              setSelected((current) => {
                if (!current || current.run.id !== runId) return current;
                const exists =
                  event.sequence != null &&
                  current.messages.some((item) => item.sequence === event.sequence);
                return {
                  ...current,
                  messages: exists
                    ? current.messages
                    : [
                        ...current.messages,
                        { ...event, id: event.id || String(event.sequence ?? Date.now()) },
                      ],
                };
              });
              if (eventType && eventType !== 'message.created' && eventType !== 'heartbeat') {
                const detail = normalizeDetail(await aiRunApi.get(runId));
                setSelected((current) =>
                  current?.run.id === runId ? mergeDetails(current, detail) : current,
                );
                setRuns((current) =>
                  current.map((item) => (item.id === runId ? { ...item, ...detail.run } : item)),
                );
              }
            } catch {
              // Ignore malformed events while preserving the loaded run details.
            }
          }
          if (done) break;
        }
        if (active) setStreamState('disconnected');
      } catch {
        if (active && !controller.signal.aborted) setStreamState('error');
      }
    }
    void connect();
    return () => {
      active = false;
      controller.abort();
      setStreamState('idle');
    };
  }, [accessToken, selected?.run.id, selected?.run.status, streamAttempt]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [selected?.run.id, selected?.messages.length, isProcessing]);

  async function createRun() {
    if (!projectId) {
      setError('请先选择项目。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const firstMessage = createMessage.trim();
      const detail = normalizeDetail(await aiRunApi.create({ projectId }));
      setCreateMessage('');
      setSelected(detail);
      setDraft(draftFromRun(detail.run));
      setDraftTitle(detail.run.title ?? '');
      setPriority(detail.run.priority ?? 'MEDIUM');
      await loadRuns();
      if (firstMessage) {
        try {
          const reply = normalizeDetail(await aiRunApi.sendMessage(detail.run.id, firstMessage));
          setSelected((current) => (current ? mergeDetails(current, reply) : reply));
          setNotice('运行已创建，首条消息已发送');
        } catch {
          setMessage(firstMessage);
          setError('运行已创建，但首条消息发送失败；可在运行详情中重试。');
        }
      } else {
        setNotice('运行已创建');
      }
    } catch (error) {
      setError(apiErrorMessage(error, '创建运行失败'));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    if (!selected || !message.trim()) return;
    setBusy(true);
    try {
      const detail = normalizeDetail(await aiRunApi.sendMessage(selected.run.id, message.trim()));
      setSelected((current) => (current ? mergeDetails(current, detail) : detail));
      if (detail.run.step === 'WAITING_CONFIRMATION') {
        setDraft(draftFromRun(detail.run));
        setDraftTitle(detail.run.title ?? '');
        setPriority(detail.run.priority ?? 'MEDIUM');
      }
      setMessage('');
      setNotice('消息已发送');
      await loadRuns();
    } catch {
      setError('消息发送失败，当前步骤可能已经完成。');
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: 'pause' | 'resume' | 'cancel') {
    if (!selected) return;
    setBusy(true);
    try {
      const detail = normalizeDetail(await aiRunApi[action](selected.run.id));
      setSelected((current) => (current ? mergeDetails(current, detail) : detail));
      await loadRuns();
      setNotice(
        action === 'pause' ? '运行已暂停' : action === 'resume' ? '运行已恢复' : '运行已取消',
      );
    } catch {
      setError('运行状态更新失败，请刷新后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function confirmRun() {
    if (!selected || !canConfirm) return;
    setBusy(true);
    try {
      await aiRunApi.confirm(selected.run.id, {
        title: draftTitle.trim() || undefined,
        priority,
        draft,
      });
      await selectRun(selected.run);
      await loadRuns();
      setNotice('草稿已确认，需求已创建。');
    } catch {
      setError('确认失败，请确保运行处于待确认状态。');
    } finally {
      setBusy(false);
    }
  }

  function updateLines(
    key: 'usersScenarios' | 'userStoriesFlows' | 'acceptanceCriteria',
    value: string,
  ) {
    setDraft((current) => ({ ...current, [key]: value.split('\n') }));
  }

  return (
    <section className="page-card runs-page">
      <header className="runs-page-header">
        <div>
          <span className="eyebrow">AI RUNTIME</span>
          <h2>产品需求发现</h2>
          <p>通过四步访谈，把想法整理成可评审的需求草稿。</p>
        </div>
        <div className="runs-toolbar">
          <label>
            <span>项目</span>
            <ProjectSelect
              onChange={() => {
                setSelected(null);
                setRuns([]);
              }}
            />
          </label>
          <label className="runs-filter">
            <span>状态</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="运行状态筛选"
            >
              <option value="">全部状态</option>
              {Object.keys(statuses).map((value) => (
                <option key={value} value={value}>
                  {statuses[value]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ghost runs-refresh"
            onClick={() => void loadRuns()}
            disabled={!projectId || busy}
            aria-label="刷新运行列表"
          >
            <RefreshCw size={15} />
            刷新
          </button>
        </div>
      </header>

      {error && (
        <p className="error runs-feedback" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="runs-notice" role="status">
          {notice}
        </p>
      )}

      <div className="runs-workspace">
        <aside className="runs-sidebar">
          <div className="runs-create">
            <div className="runs-section-heading">
              <div>
                <h3>新建访谈</h3>
                <p>从目标开始，也可以先写下你的想法。</p>
              </div>
              <span className="runs-create-icon" aria-hidden="true">
                <Plus size={18} />
              </span>
            </div>
            <textarea
              value={createMessage}
              onChange={(event) => setCreateMessage(event.target.value)}
              placeholder="例如：我想减少报价单的重复录入……"
              rows={3}
              aria-label="访谈初始想法"
            />
            <button
              className="primary runs-create-button"
              onClick={() => void createRun()}
              disabled={!projectId || busy}
            >
              {busy ? <LoaderCircle className="runs-spin" size={16} /> : <Plus size={16} />}
              开始需求访谈
            </button>
          </div>

          <div className="runs-list-heading">
            <h3>最近访谈</h3>
            <span>{runs.length}</span>
          </div>
          <div className="runs-list">
            {runs.map((run) => (
              <button
                className={`runs-item ${selected?.run.id === run.id ? 'is-selected' : ''}`}
                key={run.id}
                onClick={() => void selectRun(run)}
              >
                <span className="runs-item-topline">
                  <strong>{run.title || '产品需求发现'}</strong>
                  <span className={`status-tag ${statusClass(run.status)}`}>
                    {statuses[run.status] ?? run.status}
                  </span>
                </span>
                <small>{formatTime(run.updatedAt || run.createdAt)}</small>
              </button>
            ))}
            {!runs.length && (
              <div className="runs-list-empty">
                <Bot size={20} />
                <p>{projectId ? '还没有访谈记录' : '先选择一个项目'}</p>
              </div>
            )}
          </div>
        </aside>

        {!selected ? (
          <section className="runs-empty-panel">
            <div className="runs-empty-icon">
              <Bot size={24} />
            </div>
            <h3>准备好梳理一个需求了吗？</h3>
            <p>开始一场访谈，AI 会逐步了解背景、用户、流程和验收标准。</p>
            <div className="runs-empty-steps">
              {steps.map(([, label], index) => (
                <span key={label}>
                  <i>{index + 1}</i>
                  {label}
                </span>
              ))}
            </div>
          </section>
        ) : (
          <section className="runs-chat" aria-label="需求发现对话">
            <header className="runs-chat-header">
              <div className="runs-chat-title">
                <div className="runs-chat-avatar">
                  <Bot size={18} />
                </div>
                <div>
                  <h3>{selected.run.title || '产品需求访谈'}</h3>
                  <p>
                    <span className={`runs-live-dot ${streamState}`} />
                    {streamState === 'connected'
                      ? '实时同步中'
                      : streamState === 'error' || streamState === 'disconnected'
                        ? '实时连接已断开'
                        : '需求发现助手'}
                  </p>
                </div>
              </div>
              <div className="runs-chat-actions">
                <span className={`status-tag ${statusClass(selected.run.status)}`}>
                  {statuses[selected.run.status] ?? selected.run.status}
                </span>
                {(streamState === 'error' || streamState === 'disconnected') && (
                  <button
                    className="ghost runs-icon-button"
                    onClick={() => setStreamAttempt((current) => current + 1)}
                    aria-label="重新连接实时消息"
                    title="重新连接实时消息"
                  >
                    <RefreshCw size={15} />
                  </button>
                )}
                {['PAUSED', 'FAILED'].includes(selected.run.status) ? (
                  <button
                    className="ghost runs-action"
                    onClick={() => void runAction('resume')}
                    disabled={busy}
                  >
                    <Play size={14} />
                    恢复
                  </button>
                ) : ['ACTIVE', 'PROCESSING'].includes(selected.run.status) ? (
                  <button
                    className="ghost runs-action"
                    onClick={() => void runAction('pause')}
                    disabled={busy}
                  >
                    <Pause size={14} />
                    暂停
                  </button>
                ) : null}
                {['ACTIVE', 'PROCESSING', 'PAUSED', 'WAITING_CONFIRMATION'].includes(
                  selected.run.status,
                ) && (
                  <button
                    className="ghost runs-action runs-cancel"
                    onClick={() => void runAction('cancel')}
                    disabled={busy}
                  >
                    <X size={14} />
                    取消
                  </button>
                )}
              </div>
            </header>

            <ol className="runs-stepper" aria-label="需求访谈进度">
              {steps.map(([key, label], index) => {
                const done = selected.run.status === 'COMPLETED' || index < currentStep;
                const active = index === currentStep && !done;
                return (
                  <li
                    className={`runs-step ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}
                    key={key}
                    aria-label={`${index + 1}. ${label}`}
                    aria-current={active ? 'step' : undefined}
                  >
                    <span className="runs-step-indicator">
                      {done ? <Check size={13} /> : <span>{index + 1}</span>}
                    </span>
                    <span className="runs-step-label">{label}</span>
                    <small>{done ? '已完成' : active ? '进行中' : '待开始'}</small>
                  </li>
                );
              })}
            </ol>

            <div className="runs-thread" role="log" aria-live="polite" aria-relevant="additions">
              {selected.messages.map((item, index) => {
                const role = (item.role ?? 'SYSTEM').toUpperCase();
                const content = messageContent(item);
                if (role === 'SYSTEM')
                  return (
                    <div className="runs-event" key={item.id || index}>
                      <span />
                      <p>{content}</p>
                      <time>{formatMessageTime(item.createdAt)}</time>
                    </div>
                  );
                const isUser = role === 'USER';
                return (
                  <article
                    className={`runs-message ${isUser ? 'is-user' : 'is-assistant'}`}
                    key={item.id || index}
                    aria-label={isUser ? '你的消息' : 'AI 助手消息'}
                  >
                    <div className="runs-message-avatar" aria-hidden="true">
                      {isUser ? <UserRound size={15} /> : <Bot size={15} />}
                    </div>
                    <div className="runs-message-body">
                      <div className="runs-message-meta">
                        <strong>{isUser ? '你' : '需求助手'}</strong>
                        <time>{formatMessageTime(item.createdAt)}</time>
                      </div>
                      <div className="runs-bubble">
                        <MarkdownContent content={content} />
                      </div>
                    </div>
                  </article>
                );
              })}
              {isProcessing && (
                <div className="runs-typing" role="status">
                  <span className="runs-typing-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  助手正在整理你的回答…
                </div>
              )}
              {canConfirm && (
                <details className="runs-draft" open>
                  <summary>
                    <span>
                      <Check size={16} />
                      访谈完成，检查需求草稿
                    </span>
                    <small>可编辑后确认</small>
                  </summary>
                  <div className="runs-draft-fields">
                    <label className="runs-draft-title">
                      <span>需求标题</span>
                      <input
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        placeholder="输入需求标题"
                      />
                    </label>
                    <label>
                      <span>优先级</span>
                      <select
                        value={priority}
                        onChange={(event) => setPriority(event.target.value)}
                        aria-label="需求优先级"
                      >
                        {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>背景与目标</span>
                      <textarea
                        value={draft.backgroundGoal}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            backgroundGoal: event.target.value,
                          }))
                        }
                        rows={2}
                      />
                    </label>
                    <label>
                      <span>用户与场景</span>
                      <textarea
                        value={draft.usersScenarios.join('\n')}
                        onChange={(event) => updateLines('usersScenarios', event.target.value)}
                        rows={2}
                      />
                    </label>
                    <label>
                      <span>用户故事与流程</span>
                      <textarea
                        value={draft.userStoriesFlows.join('\n')}
                        onChange={(event) => updateLines('userStoriesFlows', event.target.value)}
                        rows={2}
                      />
                    </label>
                    <label>
                      <span>验收标准</span>
                      <textarea
                        value={draft.acceptanceCriteria.join('\n')}
                        onChange={(event) => updateLines('acceptanceCriteria', event.target.value)}
                        rows={2}
                      />
                    </label>
                  </div>
                </details>
              )}
              <div ref={messageEndRef} />
            </div>

            <footer className="runs-composer">
              {canMessage ? (
                <>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        if (!busy && message.trim()) void sendMessage();
                      }
                    }}
                    placeholder="补充回答…（Enter 发送，Shift + Enter 换行）"
                    rows={2}
                    aria-label="回复当前步骤"
                  />
                  <button
                    className="primary runs-send-button"
                    onClick={() => void sendMessage()}
                    disabled={busy || !message.trim()}
                  >
                    <Send size={15} />
                    发送
                  </button>
                </>
              ) : canConfirm ? (
                <>
                  <p>确认后会在当前项目中创建一条需求。</p>
                  <button
                    className="primary runs-confirm-button"
                    onClick={() => void confirmRun()}
                    disabled={busy || !draftTitle.trim()}
                  >
                    {busy ? <LoaderCircle className="runs-spin" size={15} /> : <Check size={15} />}
                    确认并创建需求
                  </button>
                </>
              ) : isProcessing ? (
                <p className="runs-composer-state">
                  <LoaderCircle className="runs-spin" size={15} />
                  助手正在处理，完成后可以继续回答。
                </p>
              ) : selected.run.status === 'COMPLETED' ? (
                <p className="runs-composer-state">
                  <Check size={15} />
                  需求已创建，访谈已完成。
                </p>
              ) : (
                <p className="runs-composer-state">
                  <Circle size={14} />
                  {selected.run.status === 'PAUSED' || selected.run.status === 'FAILED'
                    ? '恢复访谈后可继续回答。'
                    : '当前访谈已结束。'}
                </p>
              )}
            </footer>
          </section>
        )}
      </div>
    </section>
  );
}
