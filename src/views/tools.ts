import type { ToolItem, ToolReadyStatus, InstallVcRedistData } from '../types';
import { fetchTools, fetchToolsManagerStatus, prepareTools, installVcRedist } from '../api';

const ICO = (name: string): string =>
  (window as Window & { __ICONS?: Record<string, string> }).__ICONS?.[name] ?? '';

const TOOL_ICONS: Record<string, string> = {
  t1: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  t2: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/></svg>`,
  t3: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6"/></svg>`,
  t4: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4v10a2 2 0 1 1-4 0V4a2 2 0 1 1 4 0z"/><path d="M8 14h8"/></svg>`,
  t5: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
  t6: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/><rect x="9" y="1" width="6" height="4" rx="1"/><path d="M9 13l2 2 4-4"/></svg>`,
};

/** 工具就绪状态 → 展示文案与样式标识 */
const STATUS_TEXT: Record<ToolReadyStatus['status'], string> = {
  READY: '已就绪',
  MISSING: '未安装',
};

/** 工具库视图 */
export class ToolsView {
  readonly root: HTMLElement;
  /** 点击运行回调：返回该工具的注入指令，供切换聊天视图使用 */
  onRunTool: ((command: string) => void) | null = null;

  /** 一键准备面板相关状态 */
  private toolStatus: ToolReadyStatus[] = [];
  private preparing = false;
  private installingVc = false;
  /** VC++ 运行库安装结果（发起后用于展示 UAC 确认引导） */
  private vcResult: InstallVcRedistData | null = null;

  constructor() {
    this.root = document.createElement('section');
    this.root.className = 'view';
    this.root.id = 'view-tools';
  }

  async mount(): Promise<void> {
    // 并行加载工具库列表与工具就绪状态
    const [tools] = await Promise.allSettled([
      fetchTools(),
      this.loadStatus(),
    ]);
    this.render(tools.status === 'fulfilled' ? tools.value : []);
  }

  /** 拉取工具就绪状态（失败时置空并提示） */
  private async loadStatus(): Promise<ToolReadyStatus[]> {
    try {
      this.toolStatus = await fetchToolsManagerStatus();
    } catch (e) {
      console.warn('[tools] fetchToolsManagerStatus failed:', e);
      this.toolStatus = [];
    }
    return this.toolStatus;
  }

  private render(tools: ToolItem[]): void {
    const items = tools
      .map(
        (t) => `
        <div class="tool-item">
          <div class="tool-icon">${TOOL_ICONS[t.id] ?? t.icon}</div>
          <div class="tool-name">${t.name}</div>
          <div class="tool-desc">${t.desc}</div>
          <button class="btn-run" data-command="${t.command}">运行</button>
        </div>`,
      )
      .join('');

    this.root.innerHTML = `
      <div class="page-head">
        <div class="page-title">
          <span class="title-ico">${ICO('tools')}</span>
          诊断工具集
        </div>
        <div class="page-sub">点击「运行」即可单独执行测试，诊断助手会自动读取结果</div>
      </div>
      ${this.renderManagerCard()}
      <div class="tools-grid">${items}</div>`;

    this.root.querySelectorAll('.btn-run').forEach((btn) => {
      btn.addEventListener('click', () => {
        const command = (btn as HTMLButtonElement).dataset.command ?? '';
        if (!command) {
          window.alert('正在生成诊断报告... (模拟)');
          return;
        }
        this.onRunTool?.(command);
      });
    });

    this.bindManagerEvents();
  }

  /** 渲染「一键准备」面板 */
  private renderManagerCard(): string {
    const statuses = this.toolStatus;
    const missing = statuses.filter((s) => !s.ready);

    const rows = statuses.length
      ? statuses
          .map((s) => {
            const cls = s.ready ? 'ready' : 'missing';
            const dot = s.ready
              ? `<span class="dot ready"></span>`
              : `<span class="dot missing"></span>`;
            const reason = s.ready
              ? ''
              : `<span class="reason">${s.reason ?? '未安装'}</span>`;
            return `
              <div class="tm-row ${cls}">
                ${dot}
                <span class="tm-name">${s.name}</span>
                <span class="tm-status">${STATUS_TEXT[s.status]}</span>
                ${reason}
              </div>`;
          })
          .join('')
      : `<div class="tm-empty">正在检测工具状态...</div>`;

    const summary = statuses.length
      ? missing.length
        ? `检测到 ${missing.length} 个工具未安装`
        : `全部 ${statuses.length} 个工具均已就绪`
      : '';

    return `
      <div class="tool-manager-card">
        <div class="tm-head">
          <div>
            <h3><span class="title-ico">${ICO('settings')}</span>工具一键准备</h3>
            <div class="tm-sub">${summary || '正在检测工具就绪状态...'}</div>
          </div>
          <div class="tm-actions">
            <button class="btn-outline" id="tmRefreshBtn">${ICO('refresh')}刷新</button>
            <button class="btn-primary" id="tmPrepareBtn" ${missing.length ? '' : 'disabled'}>
              ${this.preparing ? '准备中...' : '一键准备'}
            </button>
          </div>
        </div>
        <div class="tm-list">${rows}</div>
        ${this.vcResult ? this.renderVcBanner() : ''}
        <div class="tm-foot">
          <button class="btn-vc" id="tmVcBtn" ${this.installingVc ? 'disabled' : ''}>
            ${this.installingVc ? '安装中...' : '安装 VC++ 运行库'}
          </button>
          <span class="tm-hint">安装 VC++ 运行库将触发系统 UAC 弹窗，需要管理员权限。</span>
        </div>
      </div>`;
  }

  /** 渲染 VC++ 运行库安装结果（UAC 确认引导） */
  private renderVcBanner(): string {
    const r = this.vcResult;
    if (!r) return '';
    const toolNames = (r.tools ?? []).map((t) => t.name).join('、');
    return `
      <div class="tm-vc-banner">
        <div class="tm-vc-ico">${ICO('settings')}</div>
        <div class="tm-vc-body">
          <div class="tm-vc-title">${r.message || (r.started ? '已发起安装' : '安装未完成')}</div>
          ${toolNames ? `<div class="tm-vc-detail">涉及运行库：${toolNames}</div>` : ''}
          <div class="tm-vc-tip">请在系统弹出的 UAC 窗口中点击「是」以继续安装。</div>
        </div>
        <button class="btn-vc" id="tmVcDismissBtn">知道了</button>
      </div>`;
  }

  /** 绑定一键准备面板的事件 */
  private bindManagerEvents(): void {
    this.root.querySelector('#tmRefreshBtn')?.addEventListener('click', () => this.refreshStatus());
    this.root.querySelector('#tmPrepareBtn')?.addEventListener('click', () => this.prepare());
    this.root.querySelector('#tmVcBtn')?.addEventListener('click', () => this.installVc());
    this.root.querySelector('#tmVcDismissBtn')?.addEventListener('click', () => {
      this.vcResult = null;
      this.rerenderManager();
    });
  }

  /** 刷新工具状态 */
  private async refreshStatus(): Promise<void> {
    await this.loadStatus();
    this.rerenderManager();
  }

  /** 一键准备：下载安装所有缺失的工具 */
  private async prepare(): Promise<void> {
    if (this.preparing) return;
    this.preparing = true;
    this.rerenderManager();

    try {
      const data = await prepareTools({ confirmed: true, toolIds: [] });
      this.toolStatus = data.tools;
      if (data.unknownIds.length) {
        window.alert(`以下工具 ID 无法识别：${data.unknownIds.join('、')}`);
      }
      window.alert(data.message || (data.completed ? '所选工具已全部准备完成' : '部分工具准备失败'));
    } catch (e) {
      console.warn('[tools] prepare failed:', e);
      window.alert('准备工具失败，请稍后重试。');
    } finally {
      this.preparing = false;
      this.rerenderManager();
    }
  }

  /** 安装 VC++ 运行库 */
  private async installVc(): Promise<void> {
    if (this.installingVc) return;
    this.installingVc = true;
    this.rerenderManager();

    try {
      const data = await installVcRedist({ confirmed: true, arch: 'both' });
      this.vcResult = data;
    } catch (e) {
      console.warn('[tools] installVc failed:', e);
      this.vcResult = {
        started: false,
        message: '安装 VC++ 运行库失败，请稍后重试。',
        tools: [],
      };
    } finally {
      this.installingVc = false;
      this.rerenderManager();
    }
  }

  /** 仅重渲染「一键准备」面板，避免整页重建（保留工具网格） */
  private rerenderManager(): void {
    const card = this.root.querySelector('.tool-manager-card');
    if (card) {
      const next = this.renderManagerCard();
      const temp = document.createElement('div');
      temp.innerHTML = next;
      card.replaceWith(temp.firstElementChild as Element);
      this.bindManagerEvents();
    }
  }
}