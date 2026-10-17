import type { ChatProcessEvent } from '../types';

/**
 * ===== 聊天 WebSocket 客户端 =====
 * 连接后端 ws://{host}/ws/chat?sessionId={sessionId}，
 * 实时接收对话过程事件（chat_thinking / tool_started / tool_result / command_confirm）
 * 与异步任务事件（tool_progress / tool_finished）。
 *
 * 开发环境经 vite 代理 /ws 转发到后端；VITE_API_BASE 为绝对地址时据此推导 ws 地址。
 */

/** 依据 VITE_API_BASE 推导 WebSocket 基址（默认走同源相对路径 /ws） */
function wsBase(): string {
  const apiBase = (
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE ?? ''
  ).replace(/\/+$/, '');
  if (!apiBase) return '/ws';
  return `${apiBase.replace(/^http/, 'ws')}/ws`;
}

export interface ChatEventHandlers {
  /** AI 思考/分析中 */
  onThinking?: (message: string) => void;
  /** 工具开始执行 */
  onToolStarted?: (toolName: string, args: string | null) => void;
  /** 工具执行完成 */
  onToolResult?: (toolName: string, summary: string | null) => void;
  /**
   * 命令待确认（后端在工具执行期间落库 PENDING 记录后即时推送）。
   * messageId 用于去重与后续确认请求，command 为纯命令原文。
   */
  onCommandConfirm?: (messageId: number, command: string) => void;
  /** 其他未知事件类型（便于调试） */
  onUnknown?: (event: ChatProcessEvent) => void;
}

/** 聊天事件 WebSocket 封装：按 sessionId 连接、JSON 解析分发 */
export class ChatEventSocket {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private handlers: ChatEventHandlers = {};

  /** 注册事件回调（重复调用覆盖） */
  setHandlers(handlers: ChatEventHandlers): void {
    this.handlers = handlers;
  }

  /** 当前已连接且打开的会话 ID（未连接返回 null） */
  get connectedSessionId(): string | null {
    return this.socket?.readyState === WebSocket.OPEN ? this.sessionId : null;
  }

  /**
   * 确保与指定会话建立连接；已是该会话且连接打开则直接复用。
   * resolve 于连接打开（失败时 reject），调用方应 await 后再发消息，
   * 避免错过服务端在请求处理早期推送的事件。
   */
  connect(sessionId: string): Promise<void> {
    if (this.sessionId === sessionId && this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    this.close();
    this.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const url = `${wsBase()}/chat?sessionId=${encodeURIComponent(sessionId)}`;
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.onopen = () => {
        console.log('[chat-ws] connected:', url);
        resolve();
      };

      socket.onerror = () => {
        // 连接失败不阻断聊天主流程：HTTP 响应仍会带回最终回复
        console.warn('[chat-ws] connection failed:', url);
        reject(new Error('WebSocket connection failed'));
      };

      socket.onclose = () => {
        if (this.socket === socket) {
          this.socket = null;
        }
      };

      socket.onmessage = (ev) => this.dispatch(ev.data);
    });
  }

  /** 关闭连接（切换视图/销毁时调用） */
  close(): void {
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    this.sessionId = null;
  }

  /** 解析消息并分发到对应回调；未知 type 走 onUnknown */
  private dispatch(raw: unknown): void {
    let event: ChatProcessEvent;
    try {
      event = JSON.parse(String(raw)) as ChatProcessEvent;
    } catch {
      console.warn('[chat-ws] non-JSON message ignored:', raw);
      return;
    }

    switch (event.type) {
      case 'chat_thinking':
        this.handlers.onThinking?.(event.message ?? '思考中');
        break;
      case 'tool_started':
        this.handlers.onToolStarted?.(event.toolName ?? '', event.args ?? null);
        break;
      case 'tool_result':
        this.handlers.onToolResult?.(event.toolName ?? '', event.summary ?? null);
        break;
      case 'command_confirm':
        // messageId 缺失时无法去重/确认，直接忽略
        if (typeof event.messageId === 'number') {
          this.handlers.onCommandConfirm?.(event.messageId, event.command ?? '');
        }
        break;
      default:
        // tool_progress / tool_finished 等任务事件暂不在此处理
        this.handlers.onUnknown?.(event);
        break;
    }
  }
}
