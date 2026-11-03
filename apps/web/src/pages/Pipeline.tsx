import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiError } from '../api/client';
import { requirementApi } from '../api/resources';
import { ProjectPipelineOverview } from '../components/ProjectPipelineOverview';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';

export function Pipeline() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [requirements, setRequirements] = useState<Awaited<ReturnType<typeof requirementApi.list>>['items']>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) {
      setRequirements([]);
      return;
    }
    let alive = true;
    setLoading(true);
    requirementApi.list(projectId)
      .then((page) => { if (alive) { setRequirements(page.items); setError(''); } })
      .catch((caught: unknown) => { if (alive) { setRequirements([]); setError(formatApiError(caught)); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>需求流水线</h2>
          <p className="page-sub">按阶段查看项目中的需求，快速定位当前角色、阻塞项与下一步。</p>
        </div>
        <div className="page-actions"><ProjectSelect onChange={() => setRequirements([])} /></div>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {!projectId ? <p className="page-card muted">先选择项目。</p> : loading ? <p className="page-card muted">加载中…</p> : (
        <ProjectPipelineOverview
          requirements={requirements}
          onSelectRequirement={(item) => navigate(`/requirements/${encodeURIComponent(item.code)}`)}
        />
      )}
    </section>
  );
}
