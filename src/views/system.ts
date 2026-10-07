import type { SystemInfo } from '../types';
import { fetchSystemInfo } from '../api';

const ICO = (name: string): string =>
  (window as Window & { __ICONS?: Record<string, string> }).__ICONS?.[name] ?? '';

/** 磁盘健康状态枚举 → 展示文案 */
const DISK_HEALTH_TEXT: Record<SystemInfo['diskHealth'], string> = {
  HEALTHY: '健康',
  WARNING: '警告',
};

/**
 * 格式化硬件字段值：
 * 后端用「；」分隔多项（如多条内存、多块硬盘），并且常以"总容量 (项1；项2...)"的形式给出。
 * 前端将每个硬件项独立成行，用「·」作为项目符号，去除总容量与括号包裹，排版更清晰。
 * 为避免 HTML 注入，先做一次安全转义。
 */
function formatHardwareValue(s: string): string {
  const escaped = String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 按「；」拆分成多个硬件项
  const parts = escaped
    .split('；')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // 仅一项时直接返回（保留原样）
  if (parts.length <= 1) return escaped;

  // 去除每项末尾残留的括号，避免出现悬空的 ")"
  const clean = parts.map((p) => p.replace(/[()（）]+$/g, ''));

  // 去掉形如 "1874GB" 的纯总容量（不带括号描述的项）
  const items = clean.filter((p) => !/^\d+(\.\d+)?\s*(GB|TB|MB|KB)$/i.test(p));

  // 如果过滤后只剩一项，直接展示；否则每项带项目符号分行
  if (items.length <= 1) return items[0] || escaped;
  return items.map((p) => `· ${p}`).join('<br>');
}

/** 温度数字 → 展示文案（null/无值时显示 -） */
function formatCpuTemp(t: number | null | undefined): string {
  if (t == null || Number.isNaN(t)) return '-';
  return `${t}℃`;
}

/** 轮询间隔（毫秒） */
const POLL_INTERVAL = 5000;

/** 系统信息视图 */
export class SystemView {
  readonly root: HTMLElement;
  private info: SystemInfo | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.root = document.createElement('section');
    this.root.className = 'view';
    this.root.id = 'view-system';
  }

  async mount(): Promise<void> {
    try {
      this.info = await fetchSystemInfo();
    } catch (e) {
      console.warn('[system] fetchSystemInfo failed:', e);
      this.info = null;
    }
    this.render();
  }

  /** 启动实时轮询：每 5s 静默拉取一次并更新界面 */
  startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.poll().catch((e) => console.warn('[system] poll failed:', e));
    }, POLL_INTERVAL);
  }

  /** 停止轮询 */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** 轮询更新：仅更新实时状态区，不整页重渲染，避免闪烁 */
  private async poll(): Promise<void> {
    const info = await fetchSystemInfo();
    this.info = info;
    this.applyStatus(info);
  }

  /** 仅更新底部实时状态卡片（CPU 负载/内存/温度/磁盘） */
  private applyStatus(info: SystemInfo): void {
    const nums = this.root.querySelectorAll('.status-item .num');
    if (nums.length < 4) return;
    nums[0].textContent = `${info.cpuLoad}%`;
    nums[1].textContent = `${info.memUsage}%`;
    nums[2].textContent = formatCpuTemp(info.cpuTemp);
    nums[3].textContent = DISK_HEALTH_TEXT[info.diskHealth];
  }

  private render(): void {
    const info = this.info;
    this.root.innerHTML = `
      <div class="page-head">
        <div class="page-title">
          <span class="title-ico">${ICO('system')}</span>
          系统信息
        </div>
        <div class="page-sub">查看当前设备的硬件配置与实时运行状态</div>
      </div>
      <div class="system-card" id="systemCard">
        <div class="card-header">
          <h3><span class="title-ico">${ICO('settings')}</span>设备配置</h3>
          <button class="btn-refresh" id="refreshBtn">${ICO('refresh')}<span>重新检测</span></button>
        </div>
        <div class="system-grid">
          <div class="system-item"><span class="label">操作系统</span><span class="value">${info ? formatHardwareValue(info.os) : '-'}</span></div>
          <div class="system-item"><span class="label">CPU</span><span class="value">${info ? formatHardwareValue(info.cpu) : '-'}</span></div>
          <div class="system-item"><span class="label">内存</span><span class="value">${info ? formatHardwareValue(info.ram) : '-'}</span></div>
          <div class="system-item"><span class="label">显卡</span><span class="value">${info ? formatHardwareValue(info.gpu) : '-'}</span></div>
          <div class="system-item"><span class="label">主板</span><span class="value">${info ? formatHardwareValue(info.motherboard) : '-'}</span></div>
          <div class="system-item"><span class="label">硬盘</span><span class="value">${info ? formatHardwareValue(info.disk) : '-'}</span></div>
        </div>
        <div class="system-status-grid">
          <div class="status-item"><div class="num">${info?.cpuLoad ?? 0}%</div><div class="lbl">CPU 负载</div></div>
          <div class="status-item"><div class="num">${info?.memUsage ?? 0}%</div><div class="lbl">内存使用</div></div>
          <div class="status-item"><div class="num">${formatCpuTemp(info?.cpuTemp)}</div><div class="lbl">CPU 温度</div></div>
          <div class="status-item"><div class="num">${info ? DISK_HEALTH_TEXT[info.diskHealth] : '-'}</div><div class="lbl">磁盘状态</div></div>
        </div>
      </div>
      <div class="system-tip">点击「重新检测」刷新硬件信息与实时状态。</div>`;

    this.root.querySelector('#refreshBtn')?.addEventListener('click', () => this.refresh());
  }

  /** 重新检测：调用 GET /api/system/info 刷新硬件配置与实时状态 */
  private async refresh(): Promise<void> {
    const btn = this.root.querySelector('#refreshBtn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" style="width:12px;height:12px;border:2px solid var(--accent-soft);border-top-color:var(--accent);border-radius:50%;display:inline-block;animation:spin 0.8s linear infinite;"></span><span>检测中...</span>`;
    }

    try {
      const info = await fetchSystemInfo();
      this.info = info;

      const values = [info.os, info.cpu, info.ram, info.gpu, info.motherboard, info.disk];
      this.root.querySelectorAll('.system-item .value').forEach((el, i) => {
        if (values[i] != null) el.innerHTML = formatHardwareValue(values[i]!);
      });

      this.applyStatus(info);
    } catch (e) {
      console.warn('[system] refresh failed:', e);
      window.alert('获取系统信息失败，请稍后重试。');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${ICO('refresh')}<span>重新检测</span>`;
      }
    }
  }
}