/** ===== 全局数据模型定义（后续对接后端时保持字段一致） ===== */

/** 磁盘健康状态枚举（后端约定） */
export type DiskHealth = 'HEALTHY' | 'WARNING';

/**
 * 系统信息（硬件配置 + 实时状态）
 * 对应后端 GET /api/system/info 返回的 data 结构
 */
export interface SystemInfo {
  os: string;
  cpu: string;
  ram: string;
  gpu: string;
  motherboard: string;
  disk: string;
  cpuLoad: number;
  memUsage: number;
  /** CPU 温度（℃）。某些机器无法读取时为 null */
  cpuTemp: number | null;
  diskHealth: DiskHealth;
}

/** 会话历史记录 */
export interface ChatSession {
  id: string;
  title: string;
  time: string;
  active?: boolean;
  /** 后端下发的时间戳字段（新增字段，供列表接口使用） */
  updatedAt?: string;
}

/** 会话列表查询参数 */
export interface SessionListParams {
  /** 页码，从 1 开始，默认 1 */
  page?: number;
  /** 每页条数，默认 20 */
  size?: number;
}

/** 会话列表接口返回结构 */
export interface SessionListData {
  list: ChatSession[];
  total: number;
}

/** 消息查询参数 */
export interface SessionMessageParams {
  /** 页码，从 1 开始，默认 1 */
  page?: number;
  /** 每页条数，默认 50 */
  size?: number;
}

/** 会话消息历史记录（对应后端 /api/sessions/{sessionId}/messages 返回的 list 元素） */
export interface SessionMessage {
  /** 消息 id */
  id: number;
  /** 消息角色：user 用户输入 / assistant AI 回复 / tool 工具调用结果（中间过程，前端不展示） */
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** 关联工具名（可选，如执行了某个工具） */
  toolName?: string;
  /** 关联任务 id（可选） */
  taskId?: number;
  /** 附加扩展字段（可选） */
  extra?: Record<string, unknown>;
  createdAt: string;
}

/** 会话消息历史接口返回结构 */
export interface SessionMessageListData {
  list: SessionMessage[];
  total: number;
}

/** 聊天气泡 */
export interface ChatMessage {
  id: string;
  role: 'ai' | 'user';
  content: string;
  time: string;
  /** 附加渲染卡片（如工具运行卡片） */
  tool?: 'stress-test';
}

/** 工具库条目 */
export interface ToolItem {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** 点击运行后注入聊天输入框的指令 */
  command: string;
}

/* ===== 工具一键准备（/api/tools/manager/*） ===== */

/** 工具就绪状态枚举 */
export type ToolStatus = 'READY' | 'MISSING';

/** 单个工具的安装/就绪状态（GET /api/tools/manager/status 返回元素） */
export interface ToolReadyStatus {
  id: string;
  name: string;
  status: ToolStatus;
  /** 是否就绪 */
  ready: boolean;
  /** 缺失时的原因 */
  reason: string | null;
  /** 是否支持自动下载 */
  downloadable: boolean;
  /** 不可下载的原因 */
  unavailableReason: string | null;
}

/** 一键准备工具请求体（POST /api/tools/manager/prepare） */
export interface PrepareToolsRequest {
  /** 是否确认下载（必须为 true 才会真正下载） */
  confirmed: boolean;
  /** 要准备的工具 ID 列表；空数组 = 全部 */
  toolIds: string[];
}

/** 一键准备工具响应 data（POST /api/tools/manager/prepare） */
export interface PrepareToolsData {
  /** 是否全部完成 */
  completed: boolean;
  /** 结果描述 */
  message: string;
  /** 每个工具的准备结果 */
  tools: ToolReadyStatus[];
  /** 请求中传了但系统不认识的工具 ID 列表 */
  unknownIds: string[];
}

/** 安装 VC++ 运行库请求体（POST /api/tools/manager/install） */
export interface InstallVcRedistRequest {
  /** 是否确认安装（必须为 true 才会真正安装） */
  confirmed: boolean;
  /** 架构：both = x86 + x64 都装，x64 = 仅 64 位 */
  arch: 'both' | 'x64';
}

/** 安装 VC++ 运行库响应 data（POST /api/tools/manager/install） */
export interface InstallVcRedistData {
  /** 是否已发起安装 */
  started: boolean;
  /** 安装结果描述（如"请在 UAC 窗口中确认"） */
  message: string;
  /** 本次安装涉及的运行库详情 */
  tools: VcRedistTool[];
}

/** VC++ 运行库条目（安装响应 tools 元素） */
export interface VcRedistTool {
  id: string;
  name: string;
  /** 用途说明 */
  purpose: string;
  relativePath: string;
  absolutePath: string;
  /** 官方下载地址 */
  officialUrl: string;
  license: string;
  status: ToolStatus;
  ready: boolean;
  reason: string | null;
}

/** 当前用户信息 */
export interface UserProfile {
  name: string;
  avatarChar: string;
  accountId: string;
  email: string;
  apiKey: string;
  registeredAt: string;
}

/* ===== API 请求 / 响应类型 ===== */

/** 创建会话请求体 */
export interface CreateSessionRequest {
  /** 会话标题（可选，后端默认 '新会话'） */
  title?: string;
}

/** 创建会话响应 */
export interface CreateSessionResponse {
  /** 后端下发的唯一会话 id（整数） */
  id: number;
  title: string;
}

/** 发送聊天消息请求体 */
export interface SendMessageRequest {
  /** 会话 ID，为空时后端自动新建会话 */
  sessionId?: number | string;
  /** 用户输入 */
  content: string;
}

/** 发送聊天消息响应 */
export interface SendMessageResponse {
  /** 实际使用的会话 id（新建会话时为后端下发的 id） */
  sessionId?: number | string;
  /** AI 的最终回复文本 */
  reply: string;
  /** 触发异步工具（如烤机）时返回任务 id，否则为 null */
  taskId?: number | null;
}

/* ===== WebSocket 对话过程事件（通道 ws://{host}/ws/chat?sessionId=xxx） ===== */

/** 聊天过程推送事件。任务事件(tool_progress 等)字段不同，此处仅约束对话过程事件 */
export interface ChatProcessEvent {
  /** chat_thinking / tool_started / tool_result，任务事件为其他值 */
  type: string;
  sessionId?: number;
  /** chat_thinking：阶段提示文案 */
  message?: string;
  /** tool_started / tool_result：工具名 */
  toolName?: string;
  /** tool_started：调用参数 JSON 字符串（截断至 200 字符） */
  args?: string | null;
  /** tool_result：结果摘要（截断至 200 字符） */
  summary?: string | null;
}
