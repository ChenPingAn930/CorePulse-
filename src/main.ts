import './style.css';
import { ChatView } from './views/chat';
import { SystemView } from './views/system';
import { ToolsView } from './views/tools';
import { ProfileView } from './views/profile';
import { fetchSystemInfo } from './api';

type ViewKey = 'chat' | 'system' | 'tools' | 'profile';
type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'ai-theme';

/** 极简线性图标（stroke-based，无 emoji 味） */
const ICONS: Record<string, string> = {
  logo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h4l2-5 4 10 2-5h4"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  system: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
  tools: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2.2-2.2 2.8-2.8z"/></svg>`,
  profile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l14-7-5 16-3-7-6-2z"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
};

(window as Window & { __ICONS?: Record<string, string> }).__ICONS = ICONS;

/** 主题管理 */
function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* 忽略存储异常 */
  }
}

function initThemeToggle(): void {
  const btn = document.querySelector<HTMLButtonElement>('.theme-toggle');
  if (!btn) return;
  const updateIcon = () => {
    const theme = document.documentElement.getAttribute('data-theme') as Theme;
    btn.innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon;
  };
  btn.addEventListener('click', () => {
    const next: Theme =
      document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    updateIcon();
  });
  updateIcon();
}

/** 侧边栏实时状态轮询间隔（毫秒） */
const SIDEBAR_POLL_INTERVAL = 5000;

/** 磁盘健康状态 → 展示文案与进度条宽度/颜色 */
const DISK_STATUS: Record<string, { text: string; width: number; cls: string }> = {
  HEALTHY: { text: '健康', width: 100, cls: 'green' },
  WARNING: { text: '警告', width: 50, cls: 'amber' },
};

/** 更新侧边栏「实时状态」卡片（CPU 负载 / 内存 / 硬盘健康） */
function applySidebarStatus(info: {
  cpuLoad: number;
  memUsage: number;
  diskHealth: string;
}): void {
  const cpu = document.getElementById('mcCpu');
  const cpuBar = document.getElementById('mcCpuBar') as HTMLElement | null;
  const mem = document.getElementById('mcMem');
  const memBar = document.getElementById('mcMemBar') as HTMLElement | null;
  const disk = document.getElementById('mcDisk');
  const diskBar = document.getElementById('mcDiskBar') as HTMLElement | null;

  if (cpu) cpu.textContent = `${info.cpuLoad}%`;
  if (cpuBar) cpuBar.style.width = `${Math.min(100, Math.max(0, info.cpuLoad))}%`;
  if (mem) mem.textContent = `${info.memUsage}%`;
  if (memBar) memBar.style.width = `${Math.min(100, Math.max(0, info.memUsage))}%`;

  const diskStatus = DISK_STATUS[info.diskHealth] ?? { text: '未知', width: 0, cls: '' };
  if (disk) disk.textContent = diskStatus.text;
  if (diskBar) {
    diskBar.style.width = `${diskStatus.width}%`;
    // 重置颜色类：先移除已知类，再按状态添加
    diskBar.classList.remove('green', 'amber');
    if (diskStatus.cls) diskBar.classList.add(diskStatus.cls);
  }
}

/** 启动侧边栏实时状态轮询：立即拉取一次，随后每 5s 静默更新 */
function startSidebarStatusPolling(): void {
  const tick = () => {
    fetchSystemInfo()
      .then(applySidebarStatus)
      .catch((e) => console.warn('[sidebar] fetchSystemInfo failed:', e));
  };
  tick();
  setInterval(tick, SIDEBAR_POLL_INTERVAL);
}

interface ViewMeta {
  key: ViewKey;
  view: HTMLElement;
  mount: () => Promise<void>;
  /** 视图激活时的回调（如启动轮询） */
  onActivate?: () => void;
  /** 视图离开时的回调（如停止轮询） */
  onDeactivate?: () => void;
}

class App {
  private views: ViewMeta[] = [];

  constructor(private root: HTMLElement) {}

  async init(): Promise<void> {
    const chat = new ChatView();
    const system = new SystemView();
    const tools = new ToolsView();
    const profile = new ProfileView();

    this.views = [
      { key: 'chat', view: chat.root, mount: () => chat.mount() },
      {
        key: 'system',
        view: system.root,
        mount: () => system.mount(),
        onActivate: () => system.startPolling(),
        onDeactivate: () => system.stopPolling(),
      },
      { key: 'tools', view: tools.root, mount: () => tools.mount() },
      { key: 'profile', view: profile.root, mount: () => profile.mount() },
    ];

    // 挂载各视图 DOM
    for (const meta of this.views) {
      this.root.appendChild(meta.view);
    }

    // 工具库「运行」回调：切到聊天并填入指令
    tools.onRunTool = (command) => {
      this.switchView('chat');
      setTimeout(() => chat.runToolCommand(command), 100);
    };

    // 等待数据加载完成后激活默认视图。
    // 用 allSettled：任一视图挂载失败（如后端接口异常）不影响其他视图初始化，
    // 也确保 switchView('chat') 一定会执行，避免默认视图无法激活。
    const results = await Promise.allSettled(this.views.map((m) => m.mount()));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.warn(`[app] view "${this.views[i].key}" mount failed:`, r.reason);
      }
    });
    this.switchView('chat');
  }

  switchView(key: ViewKey): void {
    for (const meta of this.views) {
      const isActive = meta.key === key;
      meta.view.classList.toggle('active', isActive);
      // 离开旧视图时停止其后台任务（如轮询），激活新视图时启动
      if (isActive) {
        meta.onActivate?.();
      } else {
        meta.onDeactivate?.();
      }
    }
    // 更新左侧导航高亮（侧边栏与主内容区为兄弟节点，需从 document 查询）
    document
      .querySelectorAll('.sidebar .side-nav .nav-item')
      .forEach((btn) => btn.classList.toggle('active', (btn as HTMLElement).dataset.view === key));
    // 仅会话视图展示左侧会话历史
    document
      .querySelector('.sidebar')
      ?.classList.toggle('chat-mode', key === 'chat');
    if (key === 'chat') {
      setTimeout(() => {
        const input = document.getElementById('chatInput') as HTMLInputElement | null;
        input?.focus();
      }, 150);
    }
  }
}

function renderLayout(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="app">
      <header class="top-bar">
        <div class="brand">
          <div class="logo-mark">${ICONS.logo}</div>
          <div class="brand-text">
            <span class="bn">CorePulse</span>
            <span class="bs">电脑智能诊断助手</span>
          </div>
        </div>
        <span class="status-badge"><span class="dot"></span>服务正常 · 已连接</span>
        <div class="user-actions">
          <button class="theme-toggle" title="切换深浅色主题">${ICONS.sun}</button>
          <span class="user-name">开发者</span>
          <div class="avatar">J</div>
        </div>
      </header>
      <div class="body">
        <nav class="sidebar chat-mode">
          <div class="side-nav">
            <div class="nav-label">导航</div>
            <button class="nav-item active" data-view="chat"><span class="icon">${ICONS.chat}</span><span class="label">智能诊断</span></button>
            <button class="nav-item" data-view="system"><span class="icon">${ICONS.system}</span><span class="label">系统信息</span></button>
            <button class="nav-item" data-view="tools"><span class="icon">${ICONS.tools}</span><span class="label">工具库</span></button>
            <button class="nav-item" data-view="profile"><span class="icon">${ICONS.profile}</span><span class="label">我的</span></button>
          </div>
          <div class="side-history" id="chatHistorySlot"></div>
          <div class="side-foot">
            <div class="mini-card">
              <div class="mc-title"><span class="dot"></span>实时状态</div>
              <div class="mc-row"><span>CPU</span><span id="mcCpu">--</span></div>
              <div class="mini-meter"><div class="fill" id="mcCpuBar" style="width:0%"></div></div>
              <div class="mc-row"><span>内存</span><span id="mcMem">--</span></div>
              <div class="mini-meter"><div class="fill" id="mcMemBar" style="width:0%"></div></div>
              <div class="mc-row"><span>硬盘</span><span id="mcDisk">--</span></div>
              <div class="mini-meter"><div class="fill green" id="mcDiskBar" style="width:0%"></div></div>
            </div>
          </div>
        </nav>
        <main class="main" id="contentArea"></main>
      </div>
    </div>`;

  // 左侧导航点击事件
  document.querySelectorAll('.sidebar .side-nav .nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      appInstance.switchView((btn as HTMLElement).dataset.view as ViewKey);
    });
  });
}

let appInstance: App;

async function bootstrap(): Promise<void> {
  renderLayout();
  initThemeToggle();
  startSidebarStatusPolling();
  const contentArea = document.getElementById('contentArea')!;
  appInstance = new App(contentArea);
  await appInstance.init();
}

bootstrap().catch((err) => {
  console.error('应用启动失败：', err);
});
