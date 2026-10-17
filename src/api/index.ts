import type {
  SystemInfo,
  SessionListParams,
  SessionListData,
  SessionMessageParams,
  SessionMessageListData,
  ToolItem,
  UserProfile,
  CreateSessionRequest,
  CreateSessionResponse,
  SendMessageRequest,
  SendMessageResponse,
  ToolReadyStatus,
  PrepareToolsRequest,
  PrepareToolsData,
  InstallVcRedistRequest,
  InstallVcRedistData,
  CommandConfirmedData,
} from '../types';

/**
 * ===== 接口层 =====
 * 统一封装前端对后端的所有请求。
 *
 * 后端基址由环境变量 VITE_API_BASE 决定（留空即使用相对路径 /api/*，
 * 由 vite 开发代理转发或同域部署）。
 *
 * 约定：
 *  - 后端统一返回 { code: 0, data, message } 时，本层解包为 data 后返回给视图层；
 *  - 当 code !== 0 或网络异常时，向上层抛出 Error，由调用方做兜底处理。
 */

const API_BASE: string = (
  (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE ?? ''
).replace(/\/+$/, '');

interface ApiResponse<T> {
  code: number;
  data: T;
  message?: string;
}

/** 统一请求工具 */
async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!res.ok) {
    throw new Error(`Request ${path} failed with ${res.status}`);
  }

  const payload = (await res.json()) as ApiResponse<T>;
  if (payload.code !== 0) {
    throw new Error(payload.message ?? `Business error: code=${payload.code}`);
  }
  return payload.data;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
  }
  const suffix = qs.toString();
  return request<T>(suffix ? `${path}?${suffix}` : path, { method: 'GET' });
}

/**
 * 获取系统信息（硬件配置 + 实时状态）
 * 对应 GET /api/system/info，后端同步执行 get_system_info 简单工具，秒级返回。
 */
export function fetchSystemInfo(): Promise<SystemInfo> {
  return get<SystemInfo>('/api/system/info');
}

/**
 * 获取会话历史列表（分页）
 * @param params 分页参数：page 默认 1，size 默认 20
 */
export function fetchSessions(params: SessionListParams = {}): Promise<SessionListData> {
  return get<SessionListData>('/api/sessions', {
    page: params.page ?? 1,
    size: params.size ?? 20,
  });
}

/** 创建新会话：由后端生成唯一会话 id 并返回 */
export function createSession(body?: CreateSessionRequest): Promise<CreateSessionResponse> {
  return post<CreateSessionResponse>('/api/sessions', body ?? {});
}

/**
 * 获取指定会话的消息历史（分页）
 * @param sessionId 会话 id
 * @param params 分页参数：page 默认 1，size 默认 50
 */
export function fetchSessionMessages(
  sessionId: string | number,
  params: SessionMessageParams = {},
): Promise<SessionMessageListData> {
  return get<SessionMessageListData>(
    `/api/sessions/${encodeURIComponent(String(sessionId))}/messages`,
    {
      page: params.page ?? 1,
      size: params.size ?? 50,
    },
  );
}

/**
 * 发送聊天消息（同步返回 AI 回复）
 * 后端流程：存用户消息 → 调 LLM(function calling) → 同步工具执行回填 → 生成最终回复。
 * 若触发异步工具（如烤机），返回 taskId，进度走 WebSocket。
 * @param body sessionId 为空时后端自动新建会话
 */
export function sendChatMessage(body: SendMessageRequest): Promise<SendMessageResponse> {
  return post<SendMessageResponse>('/api/chat/message', body);
}

/** 获取工具库列表 */
export function fetchTools(): Promise<ToolItem[]> {
  return get<ToolItem[]>('/api/tools');
}

/** 查询所有工具是否就绪（是否已下载安装） */
export function fetchToolsManagerStatus(): Promise<ToolReadyStatus[]> {
  return get<ToolReadyStatus[]>('/api/tools/manager/status');
}

/** 一键准备工具（下载安装缺失的工具） */
export function prepareTools(body: PrepareToolsRequest): Promise<PrepareToolsData> {
  return post<PrepareToolsData>('/api/tools/manager/prepare', body);
}

/** 安装 VC++ 运行库（会触发 Windows UAC 弹窗，需要管理员权限） */
export function installVcRedist(body: InstallVcRedistRequest): Promise<InstallVcRedistData> {
  return post<InstallVcRedistData>('/api/tools/manager/install', body);
}

/** 获取当前用户信息 */
export function fetchProfile(): Promise<UserProfile> {
  return get<UserProfile>('/api/profile');
}

/**
 * 命令确认（用户确认/授权执行某条待确认命令）
 * 对应 POST /api/Confirmed/{messageid}，路径参数为待确认消息 id。
 * 注意：该接口无请求体，确认结果由后端返回。
 */
export function confirmCommand(messageId: string | number): Promise<CommandConfirmedData> {
  return post<CommandConfirmedData>(
    `/api/Confirmed/${encodeURIComponent(String(messageId))}`,
  );
}
