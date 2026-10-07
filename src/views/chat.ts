import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ChatMessage, ChatSession, SessionMessage } from '../types';
import {
  createSession,
  fetchSessions,
  fetchSessionMessages,
  sendChatMessage,
} from '../api';
import { ChatEventSocket } from '../ws/chatSocket';

/** 在面板插入会话条目时兼容类型（ChatSession 或 CreateSessionResponse） */
type ChatSessionLike = Pick<ChatSession, 'id' | 'title' | 'time'> & { active?: boolean };

/** 后端工具名 -> 前端展示名（与 corepulse-system 各 @Tool 注册名一一对应） */
const TOOL_NAME_MAP: Record<string, string> = {
  getSystemInfo: '系统信息采集',
  getDiskSpace: '磁盘空间查询',
  scanDiskUsage: '目录空间扫描',
  cleanDiskSpace: '磁盘空间清理',
  scanDiskDevices: '磁盘设备扫描',
  checkDiskHealth: '磁盘健康检测',
  benchDisk: '硬盘测速',
  openAida64: '打开 AIDA64',
  openCpuInfo: '打开 CPU-Z',
  openCpuTemp: '打开 Core Temp',
  openGpuInfo: '打开 GPU-Z',
  startCpuStress: 'CPU 压力测试',
  getCpuStressStatus: '查询 CPU 压测状态',
  stopCpuStress: '停止 CPU 压测',
  startMemStress: '内存压力测试',
  getMemStressStatus: '查询内存压测状态',
  stopMemStress: '停止内存压测',
  runMemTest: '内存故障检测',
  startFurMark: '显卡压力测试',
  scanVcRedist: 'VC++ 运行库检测',
  repairVcRedist: 'VC++ 运行库修复',
  runShellCommand: '执行终端命令',
  authorizeReadonlyCommands: '授权只读命令',
};

/** 工具展示名：未收录的工具直接显示原始名 */
function toolDisplayName(name: string): string {
  return TOOL_NAME_MAP[name] ?? name;
}

const WELCOME_MSG: ChatMessage = {
  id: 'welcome',
  role: 'ai',
  content:
    '你好，我是 **小脉，CorePulse 核心律动 的诊断专家**。\n\n描述一下你遇到的问题，例如：\n\n*"玩游戏时出现蓝屏"* 或 *"风扇噪声异常"*\n\n或者试试输入：**"帮我对显卡进行压力测试"**',
  time: '刚刚',
};

/** 简易 HTML 转义（仅处理会话标题这类非信任字符串） */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 将 markdown 文本渲染为净化后的 HTML（供 AI 回复使用）。
 * 支持表格、加粗、列表等语法，并经过 DOMPurify 清洗防 XSS。
 */
function renderMarkdown(content: string): string {
  const raw = marked.parse(String(content ?? '')) as string;
  return DOMPurify.sanitize(raw);
}

/** 生成前端侧临时会话 ID 兑底（优先使用后端下发的唯一 id） */
function genLocalId(): string {
  const g = (globalThis as typeof globalThis & { crypto?: Crypto }).crypto;
  if (g && typeof g.randomUUID === 'function') {
    return g.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 视图渲染与聊天逻辑 */
export class ChatView {
  readonly root: HTMLElement;
  private messages: ChatMessage[] = [];
  private toolTimer: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;
  private isSending = false;
  /** 会话历史面板（渲染在全局左侧栏插槽，与导航合并为单栏） */
  private historyPanel: HTMLElement | null = null;
  /** 对话过程事件 WebSocket（思考中/调用工具实时展示） */
  private chatSocket = new ChatEventSocket();
  /** 会话总数（后端返回的 total，用于页脚统计，区别于当前页条数） */
  private sessionTotal = 0;
  /** 会话列表当前已加载的页数 */
  private sessionPage = 1;
  /** 是否正在加载下一页（防止重复请求） */
  private sessionLoading = false;

  constructor() {
    this.root = document.createElement('section');
    this.root.className = 'view view-chat';
    this.root.id = 'view-chat';
  }

  async mount(): Promise<void> {
    // 先同步渲染 DOM 结构，确保视图在挂载时即有内容，
    // 避免异步请求期间面板为空、切换视图时出现“空白”竞态。
    this.renderShell([]);
    this.bindEvents();
    // 再异步拉取会话列表，完成后更新侧边栏
    await this.loadSessions();
  }

  /** 拉取会话列表并更新侧边栏 */
  private async loadSessions(): Promise<void> {
    this.sessionPage = 1;
    let sessions: ChatSessionLike[] = [];
    try {
      const data = await fetchSessions({ page: 1, size: 20 });
      // 记录后端返回的总条数，用于页脚统计（区别于当前页条数）
      this.sessionTotal = data?.total ?? 0;
      // 按后端返回结构渲染：id / title / updatedAt
      // 注意：后端 list 已做倒序排序（最新在前），前端仅保持原序，不要再次排序
      sessions = (data?.list ?? []).map((s) => ({
        id: String(s.id),
        title: s.title,
        time: s.updatedAt ?? '',
      }));
    } catch (e) {
      console.warn('[chat] fetchSessions failed, falling back to empty list:', e);
    }
    this.updateSessionPanel(sessions);
  }

  /** 滚动到底部时加载下一页（更早的会话），追加到列表末尾 */
  private async loadMoreSessions(): Promise<void> {
    if (this.sessionLoading) return;
    // 已加载全部（当前页条数达到总数）则不再请求
    const loaded = this.historyPanel?.querySelectorAll('.h-item').length ?? 0;
    if (loaded >= this.sessionTotal) return;

    this.sessionLoading = true;
    try {
      const next = this.sessionPage + 1;
      const data = await fetchSessions({ page: next, size: 20 });
      const list = (data?.list ?? []).map((s) => ({
        id: String(s.id),
        title: s.title,
        time: s.updatedAt ?? '',
      }));
      if (list.length > 0) {
        this.sessionPage = next;
        this.appendSessionItems(list);
      }
    } catch (e) {
      console.warn('[chat] loadMoreSessions failed:', e);
    } finally {
      this.sessionLoading = false;
    }
  }

  /** 追加会话条目到列表末尾（footer 之前），保持后端倒序 */
  private appendSessionItems(sessions: ChatSessionLike[]): void {
    const panel = this.historyPanel;
    if (!panel) return;
    const footer = panel.querySelector('.panel-footer') as HTMLElement | null;
    // 追加到 footer 之前
    let anchor: HTMLElement = footer ?? panel;
    for (const s of sessions) {
      const el = document.createElement('div');
      el.className = `h-item${s.active ? ' active' : ''}`;
      el.dataset.sid = String(s.id);
      el.innerHTML = `${escapeHtml(s.title)}<span class="time">${escapeHtml(s.time)}</span>`;
      anchor.insertAdjacentElement('beforebegin', el);
    }
  }

  /** 用新的会话列表重建侧边栏条目 */
  private updateSessionPanel(sessions: ChatSessionLike[]): void {
    const panel = this.historyPanel;
    if (!panel) return;

    // 移除旧的会话条目
    panel.querySelectorAll('.h-item').forEach((el) => el.remove());

    const searchInput = panel.querySelector('.h-search') as HTMLElement | null;
    if (!searchInput) return;

    // 从搜索框后面开始，按顺序逐个追加，保持后端倒序（最新在最上面）
    let anchor: HTMLElement = searchInput;
    for (const s of sessions) {
      const el = document.createElement('div');
      el.className = `h-item${s.active ? ' active' : ''}`;
      el.dataset.sid = String(s.id);
      el.innerHTML = `${escapeHtml(s.title)}<span class="time">${escapeHtml(s.time)}</span>`;
      anchor.insertAdjacentElement('afterend', el);
      anchor = el;
    }

    const footer = panel.querySelector('.panel-footer') as HTMLElement | null;
    if (footer) footer.textContent = `共 ${this.sessionTotal} 条记录`;
  }

  private renderShell(sessions: ChatSessionLike[]): void {
    const sessionItems = sessions
      .map(
        (s) => `
        <div class="h-item ${s.active ? 'active' : ''}" data-sid="${escapeHtml(s.id)}">
          ${escapeHtml(s.title)}<span class="time">${escapeHtml(s.time)}</span>
        </div>`,
      )
      .join('');

    // 会话历史渲染到全局左侧栏插槽（与导航合并为单栏，仅会话视图可见）
    const slot = document.getElementById('chatHistorySlot');
    if (slot) {
      slot.innerHTML = `
        <div class="panel-title">历史会话</div>
        <button class="btn-new-chat" id="newChatBtn">+ 新建会话</button>
        <input class="h-search" type="text" placeholder="搜索会话...">
        ${sessionItems}
        <div class="panel-footer">共 ${this.sessionTotal} 条记录</div>`;
      this.historyPanel = slot;
    }

    // 主内容区仅保留对话主体
    this.root.innerHTML = `
      <div class="chat-main">
        <div class="chat-messages" id="messageContainer"></div>
        <div class="chat-input-area">
          <div class="wrapper">
            <input type="text" id="chatInput" placeholder="输入你的问题或指令..." autofocus>
            <button id="clearInputBtn">×</button>
          </div>
          <button class="btn-send" id="sendBtn">发送</button>
        </div>
      </div>`;

    this.messages = [{ ...WELCOME_MSG }];
    this.renderMessages();
  }

  private renderMessages(): void {
    const container = this.getEl('messageContainer');
    container.innerHTML = this.messages.map((m) => this.messageToHtml(m)).join('');
    container.scrollTop = container.scrollHeight;
  }

  private messageToHtml(m: ChatMessage): string {
    const roleLabel = m.role === 'ai' ? '小脉' : '你';
    // AI 回复为 markdown，渲染为 HTML；用户消息为纯文本，转义防注入
    const body =
      m.role === 'ai'
        ? `<div class="markdown-body">${renderMarkdown(m.content)}</div>`
        : `<div class="bubble">${escapeHtml(m.content)}</div>`;
    return `
      <div class="msg ${m.role}">
        ${body}
        ${m.tool === 'stress-test' ? this.stressCardHtml() : ''}
        <div class="meta"><span>${roleLabel}</span> <span>· ${escapeHtml(m.time)}</span></div>
      </div>`;
  }

  private stressCardHtml(): string {
    return `
      <div class="tool-card" id="toolCard">
        <div class="header">
          <span class="spinner"></span>
          正在执行 FurMark 显卡压力测试
        </div>
        <div class="progress"><div class="fill" id="progressFill" style="width:0%;"></div></div>
        <div class="stats">
          <span>温度: 67℃</span>
          <span>帧率: 89 FPS</span>
          <span><span id="elapsedTime">0</span>s</span>
        </div>
      </div>`;
  }

  private getEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return el;
  }

  /** 切换底部发送按钮的加载态 */
  private setSending(flag: boolean): void {
    this.isSending = flag;
    const btn = document.getElementById('sendBtn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = flag;
      btn.textContent = flag ? '发送中...' : '发送';
    }
  }

  private bindEvents(): void {
    const input = this.getEl('chatInput') as HTMLInputElement;
    const sendBtn = this.getEl('sendBtn');
    const clearBtn = this.getEl('clearInputBtn');

    const send = async () => {
      const text = input.value.trim();
      if (!text || this.isSending) return;
      input.value = '';
      input.focus();
      await this.sendUserMessage(text);
    };

    sendBtn.addEventListener('click', send);
    clearBtn.addEventListener('click', () => {
      input.value = '';
      input.focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });

    // 新建会话：调用 POST /api/sessions 获取后端下发的唯一 id
    this.historyPanel?.querySelector('#newChatBtn')?.addEventListener('click', () => {
      this.createNewSession();
    });

    // 历史会话点击：加载该会话的消息历史
    // 采用事件委托绑定在面板容器上，确保异步动态插入的会话条目也能响应点击
    const panel = this.historyPanel;
    panel?.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.h-item') as HTMLElement | null;
      if (!item) return;
      const sid = item.dataset.sid ?? '';
      if (!sid) return;

      this.historyPanel?.querySelectorAll('.h-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      this.currentSessionId = sid;
      this.loadSessionMessages(sid);
    });

    // 滚动到底部时加载下一页会话
    panel?.addEventListener('scroll', () => {
      if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 20) {
        this.loadMoreSessions();
      }
    });
  }

  /** 加载指定会话的消息历史（GET /api/sessions/{sessionId}/messages） */
  private async loadSessionMessages(sessionId: string): Promise<void> {
    // 加载中占位
    this.messages = [
      {
        id: `hist-loading-${Date.now()}`,
        role: 'ai',
        content: '正在加载历史消息...',
        time: '',
      },
    ];
    this.renderMessages();

    try {
      const data = await fetchSessionMessages(sessionId, { page: 1, size: 50 });
      // 过滤工具调用结果（role === 'tool'）：这是 function calling 的中间过程数据，
      // 内容多为原始 JSON，不作为独立气泡展示。历史仅保留用户输入与 AI 最终回复。
      const list = (data?.list ?? []).filter((m) => m.role !== 'tool');
      this.messages =
        list.length > 0
          ? list.map((m) => this.toChatMessage(m))
          : [
              {
                id: `hist-empty-${Date.now()}`,
                role: 'ai',
                content: '该会话暂无历史消息，可以开始新的对话。',
                time: '',
              },
            ];
    } catch (e) {
      console.warn('[chat] fetchSessionMessages failed:', e);
      this.messages = [
        {
          id: `hist-error-${Date.now()}`,
          role: 'ai',
          content: '加载历史消息失败，请稍后重试。',
          time: '',
        },
      ];
    }
    this.renderMessages();
  }

  /** 把后端消息记录转换为前端渲染用的 ChatMessage（tool 消息已在上游过滤） */
  private toChatMessage(m: SessionMessage): ChatMessage {
    return {
      id: String(m.id),
      // 后端 assistant 对应前端 ai 气泡；user 保持不变
      role: m.role === 'user' ? 'user' : 'ai',
      content: m.content,
      time: m.createdAt,
    };
  }

  /**
   * 新建会话：由后端生成唯一会话 id。
   * 调用过程中先乐观更新 UI，失败时兑底使用前端生成的临时 id。
   */
  private async createNewSession(): Promise<void> {
    this.historyPanel?.querySelectorAll('.h-item').forEach((i) => i.classList.remove('active'));
    this.currentSessionId = null;
    this.messages = [{ ...WELCOME_MSG }];
    this.renderMessages();

    try {
      const resp = await createSession({});
      if (resp?.id == null) throw new Error('Empty session id from server');
      const sid = String(resp.id);
      this.currentSessionId = sid;
      const title = resp.title || '新会话';
      const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      this.insertSessionToPanel(sid, title, time);
    } catch (e) {
      console.error('[chat] createSession failed:', e);
      this.currentSessionId = genLocalId();
      this.insertSessionToPanel(this.currentSessionId, '新会话', '刚刚', true);
      window.alert('后端暂时无法访问，已使用本地会话 ID 兑底。');
    }

    const input = document.getElementById('chatInput') as HTMLInputElement | null;
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  /** 向侧边栏插入新会话条目 */
  private insertSessionToPanel(
    sid: string,
    title: string,
    time: string,
    fallback = false,
  ): void {
    const panel = this.historyPanel;
    const searchInput = panel?.querySelector('.h-search') as HTMLElement | null;
    if (!panel || !searchInput) return;

    panel.querySelectorAll('.h-item').forEach((i) => i.classList.remove('active'));

    const el = document.createElement('div');
    el.className = 'h-item active';
    el.dataset.sid = sid;
    el.innerHTML = `${escapeHtml(title)}${
      fallback ? ' <small style="color:var(--warning);">(本地)</small>' : ''
    }<span class="time">${escapeHtml(time)}</span>`;
    searchInput.insertAdjacentElement('afterend', el);

    const footer = panel.querySelector('.panel-footer') as HTMLElement | null;
    if (footer) {
      this.sessionTotal += 1;
      footer.textContent = `共 ${this.sessionTotal} 条记录`;
    }
  }

  /** 发送用户消息，并请求后端返回 AI 回复 */
  private async sendUserMessage(text: string): Promise<void> {
    this.addMessage('user', text);
    this.setSending(true);
    // 显示「思考中」加载气泡，等待后端回复；气泡文案随 WS 事件实时更新
    this.showThinking('思考中');

    try {
      // sessionId 为空时先向后端创建会话：拿到真实 sessionId 才能订阅该会话的 WS 事件
      if (!this.currentSessionId) {
        try {
          const resp = await createSession({});
          if (resp?.id != null) {
            this.currentSessionId = String(resp.id);
            const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            this.insertSessionToPanel(this.currentSessionId, resp.title || '新会话', time);
          }
        } catch (e) {
          console.warn('[chat] createSession before send failed:', e);
        }
      }

      // 发消息前先连 WebSocket，避免错过后端在请求处理早期推送的事件
      if (this.currentSessionId) {
        await this.ensureChatSocket(this.currentSessionId);
      }

      const data = await sendChatMessage({
        sessionId: this.currentSessionId ?? undefined,
        content: text,
      });

      if (data.sessionId != null && String(data.sessionId) !== this.currentSessionId) {
        this.currentSessionId = String(data.sessionId);
        // 若是后端新建的会话，同步到侧边栏
        this.insertSessionToPanel(this.currentSessionId, '新会话', '刚刚');
      }

      // 收到回复，移除思考气泡再渲染正式回复
      this.hideThinking();
      this.addMessage('ai', data.reply ?? '');

      // 触发异步工具（烤机等）：返回 taskId，进度走 WebSocket
      if (data.taskId != null) {
        this.addMessage('ai', '', 'stress-test');
        this.attachTaskPolling(data.taskId);
      }
    } catch (e) {
      console.error('[chat] sendChatMessage failed, use fallback reply:', e);
      this.hideThinking();
      this.fallbackLocalReply(text);
    } finally {
      this.setSending(false);
    }
  }

  /** 确保对话过程事件的 WebSocket 已连接指定会话（失败不阻断聊天主流程） */
  private async ensureChatSocket(sessionId: string): Promise<void> {
    this.chatSocket.setHandlers({
      onThinking: (message) => this.updateThinking(message),
      onToolStarted: (toolName, args) => {
        const suffix = args && args !== '{}' ? `（${args}）` : '';
        this.updateThinking(`正在调用工具：${toolDisplayName(toolName)}${suffix}`);
      },
      onToolResult: (toolName) => {
        this.updateThinking(`${toolDisplayName(toolName)} 执行完成，正在分析结果`);
      },
    });
    if (this.chatSocket.connectedSessionId === sessionId) return;
    try {
      await this.chatSocket.connect(sessionId);
    } catch {
      console.warn('[chat] chat socket connect failed, progress events unavailable');
    }
  }

  /** 显示「思考中」加载气泡（三个点循环动画），文案可随 WS 事件更新 */
  private showThinking(message = '思考中'): void {
    const container = this.getEl('messageContainer');
    const el = document.createElement('div');
    el.className = 'msg ai thinking';
    el.innerHTML = `
      <div class="bubble thinking-bubble">
        <span class="thinking-text">${escapeHtml(message)}</span><span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
      </div>
      <div class="meta"><span>小脉</span> <span>· 正在分析</span></div>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  /** 实时更新思考气泡文案（来自 chat_thinking / tool_started / tool_result 事件） */
  private updateThinking(message: string): void {
    const el = this.root.querySelector('.msg.thinking .thinking-text');
    if (el) el.textContent = message;
    const container = this.getEl('messageContainer');
    container.scrollTop = container.scrollHeight;
  }

  /** 移除「思考中」加载气泡 */
  private hideThinking(): void {
    this.root.querySelector('.msg.thinking')?.remove();
  }

  /**
   * 绑定异步任务的进度轮询（占位）。
   * 说明：后端进度走 WebSocket，此处先以轮询占位；
   * 待 WebSocket 客户端就绪后可改为连接 ws://… 实时接收进度。
   */
  private attachTaskPolling(taskId: number): void {
    console.log('[chat] async task started, taskId =', taskId);
    // TODO: 接入 WebSocket 后改为实时进度；目前仅启动前端压力测试卡片动画作为占位
    this.startStressCard();
  }

  /** 本地兑底回复：仅在接口异常时触发 */
  private fallbackLocalReply(text: string): void {
    const lower = text.toLowerCase();
    if (
      lower.includes('显卡') &&
      (lower.includes('压力') || lower.includes('测试') || lower.includes('烤机'))
    ) {
      this.addMessage(
        'ai',
        '即将对 **RTX 4060** 进行 30 分钟压力测试。\n\n请确保散热正常。',
      );
      setTimeout(() => this.addMessage('ai', '', 'stress-test'), 700);
    } else if (lower.includes('蓝屏') || lower.includes('重启')) {
      this.addMessage(
        'ai',
        '蓝屏多与 **内存** 或 **驱动** 有关。建议先运行「内存诊断」，是否开始？',
      );
    } else if (lower.includes('全面') || lower.includes('体检')) {
      this.addMessage(
        'ai',
        '正在扫描全系统...\n\n发现 2 个建议：① 更新显卡驱动 ② 清理磁盘垃圾。是否逐一修复？',
      );
    } else {
      this.addMessage(
        'ai',
        '后端暂时不可用。为了精准定位，建议试试输入 **"显卡压力测试"** 或 **"全面体检"**。',
      );
    }
  }

  private addMessage(role: 'ai' | 'user', content: string, tool?: ChatMessage['tool']): void {
    const now = new Date();
    const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    this.messages.push({ id: `m-${Date.now()}-${Math.random()}`, role, content, time, tool });
    const container = this.getEl('messageContainer');
    const div = document.createElement('div');
    div.innerHTML = this.messageToHtml(this.messages[this.messages.length - 1]);
    container.appendChild(div.firstElementChild as HTMLElement);
    container.scrollTop = container.scrollHeight;

    if (tool === 'stress-test') this.startStressCard();
  }

  /** 运行 FurMark 压力测试卡片 */
  private startStressCard(): void {
    const fill = this.getEl('progressFill');
    const timeSpan = this.getEl('elapsedTime');
    let seconds = 0;
    let progress = 0;

    if (this.toolTimer) clearInterval(this.toolTimer);
    this.toolTimer = setInterval(() => {
      seconds++;
      const temp = 67 + Math.floor(Math.random() * 8);
      const fps = 85 + Math.floor(Math.random() * 15);
      const statSpans = this.root.querySelectorAll('.tool-card .stats span');
      if (statSpans.length >= 3) {
        statSpans[0].innerHTML = `温度: ${temp}℃`;
        statSpans[1].innerHTML = `帧率: ${fps} FPS`;
      }
      if (timeSpan) timeSpan.textContent = String(seconds);
      if (progress < 100) {
        progress += Math.random() * 3 + 1;
        if (progress > 100) progress = 100;
        if (fill) fill.style.width = progress + '%';
      }
      if (seconds >= 30 || progress >= 100) {
        if (this.toolTimer) clearInterval(this.toolTimer);
        this.toolTimer = null;
        const header = this.root.querySelector('.tool-card .header');
        if (header) {
          header.innerHTML = '压力测试完成 (模拟30分钟结束)';
          const spinner = header.querySelector('.spinner');
          if (spinner) (spinner as HTMLElement).style.display = 'none';
        }
        setTimeout(() => {
          this.addMessage(
            'ai',
            '测试报告：显卡运行稳定，峰值 79℃，无降频。\n\n建议：更新驱动或检查游戏垂直同步。',
          );
        }, 500);
      }
    }, 400);
  }

  /** 外部触发：工具库运行 → 切换到聊天并填入指令 */
  runToolCommand(command: string): void {
    const input = this.getEl('chatInput') as HTMLInputElement;
    input.value = command;
    input.focus();
  }
}
