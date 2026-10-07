import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // loadEnv 的 cwd 参数留空时，使用 vite 默认的项目根目录
  const env = loadEnv(mode, '');
  // 后端代理目标：通过 .env 文件 VITE_API_PROXY_TARGET 覆盖，
  // 默认走 http://localhost:927（后端服务端口）。
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:927';

  return {
    server: {
      port: 5173,
      host: true,
      open: true,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },
        // WebSocket 通道：对话过程事件(chat_thinking/tool_started/tool_result)与任务进度推送
        '/ws': {
          target: proxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});
