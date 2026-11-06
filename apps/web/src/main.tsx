import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './index.css';
import './ui-v2.css';
import './ui-v3.css';
import './ui-v4.css';
// 新公共组件使用独立的 --wm-* 令牌；放在旧样式之后引入，避免受主题层覆盖顺序影响。
import './styles/tokens.css';
import './styles/feedback.css';
import './styles/task-state.css';
import './styles/workflow-dialog.css';
import './styles/requirement-detail.css';
import './styles/mobile-lists.css';
import './styles/project-detail.css';
import './styles/decision-drawer.css';
import './styles/workbench-mobile.css';
import './styles/shell.css';
import './styles/contrast.css';
import './styles/confirm.css';
import './styles/foundations.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
