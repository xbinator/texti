import log from 'electron-log/main.js';

export function initLogger(): void {
  // 初始化 electron-log
  log.initialize();

  // 禁用文件日志记录（彻底关闭文件写入通道）
  log.transports.file.level = false;

  // 确保控制台日志记录已启用
  log.transports.console.level = 'info';

  // 捕获未处理的异常
  log.errorHandler.startCatching();

  // 覆盖原生的 console 方法，将其路由到 electron-log
  Object.assign(console, log.functions);
}

export { log };
