import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requirementApi, type ProjectItem, type RequirementItem } from '../api/resources';
import { navItems } from '../nav';
import { loadProjects, useProjectStore } from '../store/project';

interface Entry {
  id: string;
  group: '页面' | '项目' | '需求';
  label: string;
  meta?: string;
  run: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  IN_REVIEW: '评审中',
  APPROVED: '已批准',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
  ARCHIVED: '已归档',
};

const GROUP_LABELS: Record<Entry['group'], string> = {
  页面: '页面',
  项目: '项目',
  需求: '需求 · 当前项目',
};

export function GlobalSearch() {
  const navigate = useNavigate();
  const projectId = useProjectStore((state) => state.projectId);
  const setProjectId = useProjectStore((state) => state.setProjectId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [requirements, setRequirements] = useState<RequirementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open || projects.length) return;
    loadProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [open, projects.length]);

  useEffect(() => {
    if (!open || !projectId) return;
    let alive = true;
    setLoading(true);
    requirementApi
      .list(projectId, 1, 50)
      .then((result) => {
        if (alive) setRequirements(result.items);
      })
      .catch(() => {
        if (alive) setRequirements([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const keyword = query.trim().toLowerCase();
    const match = (value: string) => value.toLowerCase().includes(keyword);
    const pages: Entry[] = navItems
      .filter((item) => !keyword || match(item.key) || match(item.desc))
      .map((item) => ({
        id: `page-${item.path}`,
        group: '页面',
        label: item.key,
        meta: item.desc,
        run: () => {
          navigate(item.path);
          close();
        },
      }));
    const projectEntries: Entry[] = projects
      .filter((project) => !keyword || match(project.name) || match(project.key))
      .slice(0, 5)
      .map((project) => ({
        id: `project-${project.id}`,
        group: '项目',
        label: project.name,
        meta: project.key,
        run: () => {
          setProjectId(project.id);
          navigate('/requirements');
          close();
        },
      }));
    const requirementEntries: Entry[] = requirements
      .filter((item) => !keyword || match(item.title))
      .slice(0, 6)
      .map((item) => ({
        id: `requirement-${item.id}`,
        group: '需求',
        label: item.title,
        meta: STATUS_LABELS[item.status] ?? item.status,
        run: () => {
          navigate(`/requirements?req=${encodeURIComponent(item.id)}`);
          close();
        },
      }));
    return [...pages, ...projectEntries, ...requirementEntries];
  }, [query, projects, requirements, navigate, setProjectId]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function close() {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, Math.max(entries.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      entries[active]?.run();
    }
  }

  const showPanel = open;
  const groups = ['页面', '项目', '需求'] as const;

  return (
    <div className="search-box" ref={boxRef}>
      <span className="search-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>
      <input
        ref={inputRef}
        type="text"
        className="search-input"
        placeholder="搜索页面、项目、需求… (⌘K)"
        value={query}
        role="combobox"
        aria-label="全局搜索"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        aria-activedescendant={
          showPanel && entries[active] ? `search-entry-${entries[active].id}` : undefined
        }
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showPanel && (
        <div className="search-panel" id="global-search-results" role="listbox" aria-label="搜索结果">
          {entries.length === 0 && (
            <p className="search-empty">
              {loading
                ? '正在加载需求…'
                : `没有匹配「${query.trim()}」的结果，试试项目名、需求标题或页面名。`}
            </p>
          )}
          {groups.map((group) => {
            const rows = entries.filter((entry) => entry.group === group);
            if (rows.length === 0) return null;
            return (
              <div key={group}>
                <p className="search-group">{GROUP_LABELS[group]}</p>
                {rows.map((entry) => {
                  const index = entries.indexOf(entry);
                  return (
                    <button
                      key={entry.id}
                      id={`search-entry-${entry.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      className="search-item"
                      onMouseEnter={() => setActive(index)}
                      onClick={entry.run}
                    >
                      <span className="search-item-label">{entry.label}</span>
                      {entry.meta && <span className="search-item-meta">{entry.meta}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <p className="search-hint">↑↓ 选择 · Enter 打开 · Esc 关闭</p>
        </div>
      )}
    </div>
  );
}
