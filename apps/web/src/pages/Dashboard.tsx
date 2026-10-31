import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, FileText, FolderKanban, Gauge } from 'lucide-react';
import { dashboardApi } from '../api/resources';

interface DashboardData {
  projectCount: number;
  activeRequirementCount: number;
  completionRate: number;
  prdCount: number;
  statusCounts: Record<string, number>;
  recentRequirements: Array<{ id: string; title: string; status: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  IN_REVIEW: '评审中',
  APPROVED: '已批准',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
  ARCHIVED: '已归档',
};

const STATUS_TONES: Record<string, string> = {
  IN_REVIEW: 'is-review',
  IN_PROGRESS: 'is-active',
  APPROVED: 'is-active',
  DONE: 'is-done',
};

const BAR_TONES: Record<string, string> = {
  IN_REVIEW: 'is-review',
  IN_PROGRESS: 'is-active',
  DONE: 'is-done',
};

export function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    dashboardApi
      .summary()
      .then((value) => setData(value as unknown as DashboardData))
      .catch(() => setError('暂时无法加载工作区统计。'));
  }, []);

  const head = (
    <header className="page-head">
      <div>
        <h2>控制台</h2>
        <p className="page-sub">工作区概览：需求进度、PRD 产出与最近动态</p>
      </div>
    </header>
  );

  if (error)
    return (
      <>
        {head}
        <section className="page-card error">{error}</section>
      </>
    );

  if (!data)
    return (
      <>
        {head}
        <div className="stats-grid" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <div className="stat-card skeleton-card" key={index} />
          ))}
        </div>
        <p className="muted">正在加载工作区统计…</p>
      </>
    );

  const statuses = ['DRAFT', 'IN_REVIEW', 'IN_PROGRESS', 'DONE'];
  const rate = Math.max(0, Math.min(100, Math.round(data.completionRate)));
  const maxStatus = Math.max(1, ...statuses.map((status) => data.statusCounts[status] ?? 0));
  const totalStatus = statuses.reduce((sum, status) => sum + (data.statusCounts[status] ?? 0), 0);

  return (
    <>
      {head}

      <div className="stats-grid">
        <article className="stat-card">
          <div className="stat-head">
            <span className="stat-icon">
              <FolderKanban size={14} />
            </span>
            <span className="stat-title">项目统计</span>
          </div>
          <div className="stat-value">{data.projectCount}</div>
          <div className="stat-label">进行中需求 {data.activeRequirementCount} 条</div>
        </article>

        <article className="stat-card">
          <div className="stat-head">
            <span className="stat-icon">
              <FileText size={14} />
            </span>
            <span className="stat-title">PRD 产出</span>
          </div>
          <div className="stat-value">{data.prdCount}</div>
          <div className="stat-label">累计生成的 PRD 数量</div>
        </article>

        <article className="stat-card">
          <div className="stat-head">
            <span className="stat-icon">
              <Gauge size={14} />
            </span>
            <span className="stat-title">需求完成率</span>
          </div>
          <div className="stat-value">{rate}%</div>
          <div className="meter" role="img" aria-label={`需求完成率 ${rate}%`}>
            <i style={{ width: `${rate}%` }} />
          </div>
          <div className="stat-label">按已完成需求占比计算</div>
        </article>
      </div>

      <div className="chart-card">
        <div className="card-head chart-head">
          <h3>需求状态分布</h3>
          <span className="muted">共 {totalStatus} 条</span>
        </div>
        {totalStatus === 0 ? (
          <p className="muted chart-empty">还没有需求数据，创建第一条需求后这里会显示分布。</p>
        ) : (
          <div className="bar-chart" role="img" aria-label="需求状态分布柱状图">
            <div className="bar-plot">
              {statuses.map((status) => {
                const value = data.statusCounts[status] ?? 0;
                return (
                  <div className="bar-col" key={status}>
                    <span className="bar-value">{value}</span>
                    <div className="bar-track">
                      <i
                        className={BAR_TONES[status] ?? ''}
                        style={{ height: `${Math.max(3, (value / maxStatus) * 100)}%` }}
                        title={`${STATUS_LABELS[status]}：${value} 条`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="bar-labels" aria-hidden="true">
              {statuses.map((status) => (
                <span key={status}>{STATUS_LABELS[status]}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="activity-card">
        <div className="card-head">
          <h3>最近需求</h3>
          <button className="ghost" onClick={() => navigate('/requirements')}>
            查看全部
          </button>
        </div>
        <div className="activity-list">
          {data.recentRequirements.length ? (
            data.recentRequirements.map((item) => (
              <button
                className="activity-item"
                key={item.id}
                onClick={() => navigate(`/requirements?req=${encodeURIComponent(item.id)}`)}
              >
                <span className={`status-tag ${STATUS_TONES[item.status] ?? ''}`}>
                  {STATUS_LABELS[item.status] ?? item.status}
                </span>
                <span className="activity-text">{item.title}</span>
                <span className="activity-open">打开</span>
              </button>
            ))
          ) : (
            <p className="muted">
              <ClipboardList size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              还没有需求，去「需求管理」创建第一条。
            </p>
          )}
        </div>
      </div>
    </>
  );
}
