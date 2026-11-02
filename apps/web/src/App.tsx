import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, User, X } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { SESSION_EXPIRED_EVENT, formatApiError } from './api/client';
import { authApi, bootstrapSession } from './api/auth';
import { useAuthStore } from './store/auth';
import { findNav, navItems } from './nav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastHost } from './components/ToastHost';
import { Authorization } from './pages/Authorization';
import { Board } from './pages/Board';
import { Knowledge } from './pages/Knowledge';
import { Login } from './pages/Login';
import { Prds } from './pages/Prds';
import { Profile } from './pages/Profile';
import { Projects } from './pages/Projects';
import { Requirements } from './pages/Requirements';
import { Register } from './pages/Register';
import { Reviews } from './pages/Reviews';
import { Roles } from './pages/Roles';
import { Workbench } from './pages/Workbench';
import { Workflows } from './pages/Workflows';
import { toast } from './store/toast';

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = findNav(location.pathname);
  const [apiStatus, setApiStatus] = useState<'checking' | 'ready' | 'offline'>('checking');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';

  // 启动时只读取同源 cookie 会话与内存 CSRF；不读任何本地 token。
  useEffect(() => {
    if (isAuthPage) return;
    bootstrapSession().catch((caught: unknown) => {
      toast.error(formatApiError(caught));
    });
  }, [isAuthPage]);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => setApiStatus(response.ok ? 'ready' : 'offline'))
      .catch(() => setApiStatus('offline'));
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onExpired = () => toast.info('登录已过期，请重新登录。');
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (!drawerOpen && !menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  async function logout() {
    try {
      // 登出是 cookie + CSRF 写操作；失败时仍以服务端错误提示，不臆造已登出。
      await authApi.logout();
    } catch (caught) {
      toast.error(formatApiError(caught));
    }
    navigate('/login', { replace: true });
  }

  if (isAuthPage) {
    return (
      <>
        {location.pathname === '/login' ? <Login /> : <Register />}
        <ToastHost />
      </>
    );
  }

  if (status === 'loading') {
    return (
      <section className="page-card muted">
        正在建立会话…
        <ToastHost />
      </section>
    );
  }

  if (!user)
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );

  const menuItems = (onNavigate?: () => void) =>
    navItems.map((item) => {
      const Icon = item.icon;
      const isActive = current.key === item.key;
      return (
        <button
          key={item.key}
          className={`menu-item${isActive ? ' active' : ''}`}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => {
            navigate(item.path);
            onNavigate?.();
          }}
        >
          <span className="menu-icon">
            <Icon size={16} />
          </span>
          <span className="menu-text">{item.key}</span>
        </button>
      );
    });

  const apiState = (
    <div className="api-state">
      <i className={apiStatus} />
      API {apiStatus === 'ready' ? '已连接' : apiStatus === 'offline' ? '未连接' : '检测中'}
    </div>
  );

  return (
    <>
      <nav className="navbar">
        <div className="navbar-left">
          <button
            className="nav-toggle"
            aria-label={drawerOpen ? '关闭导航菜单' : '打开导航菜单'}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((value) => !value)}
          >
            {drawerOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <button className="logo" onClick={() => navigate('/')} aria-label="返回工作台">
            <span className="logo-mark">
              <svg viewBox="0 0 32 32" width="15" height="15" aria-hidden="true">
                <path
                  d="m7 10 4 12 5-9 5 9 4-12"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>WorkMesh</span>
          </button>
        </div>
        <div className="navbar-right">
          <div className="user-menu" ref={menuRef}>
            <button
              className="user-profile"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`账号菜单：${user.email}`}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <span className="user-avatar">
                <User size={13} />
              </span>
              <span className="user-name">{user.email}</span>
              <ChevronDown size={12} />
            </button>
            {menuOpen && (
              <div className="user-menu-panel" role="menu">
                <div className="user-menu-meta">
                  <strong>{user.email}</strong>
                  <span>{user.id}</span>
                </div>
                <button
                  className="user-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/profile');
                  }}
                >
                  用户中心
                </button>
                <button
                  className="user-menu-item is-danger"
                  role="menuitem"
                  onClick={() => void logout()}
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {drawerOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <aside className="drawer" aria-label="主导航">
            <div className="menu">{menuItems(() => setDrawerOpen(false))}</div>
            {apiState}
          </aside>
        </>
      )}

      <div className="main-container">
        <aside className="sidebar" aria-label="主导航">
          <div className="menu">{menuItems()}</div>
          {apiState}
        </aside>

        <main className="content-area">
          <ErrorBoundary key={location.pathname}>
            {location.pathname === '/' ? (
              <Workbench />
            ) : location.pathname === '/projects' ? (
              <Projects />
            ) : location.pathname === '/requirements' ? (
              <Requirements />
            ) : location.pathname === '/workflows' ? (
              <Workflows />
            ) : location.pathname === '/knowledge' ? (
              <Knowledge />
            ) : location.pathname === '/prd' ? (
              <Prds />
            ) : location.pathname === '/reviews' ? (
              <Reviews />
            ) : location.pathname === '/board' ? (
              <Board />
            ) : location.pathname === '/roles' ? (
              <Roles />
            ) : location.pathname === '/authorization' ? (
              <Authorization />
            ) : location.pathname === '/profile' ? (
              <Profile />
            ) : (
              <section className="page-card">页面不存在。</section>
            )}
          </ErrorBoundary>
        </main>
      </div>
      <ToastHost />
    </>
  );
}
