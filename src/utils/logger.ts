export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  SUCCESS = "SUCCESS",
}

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace("T", " ").substring(0, 19);
}

export const logger = {
  debug(msg: string, ...args: unknown[]) {
    if (process.env.DEBUG === "true") {
      console.log(`${colors.dim}[${formatTimestamp()}] [DEBUG]${colors.reset} ${msg}`, ...args);
    }
  },

  info(msg: string, ...args: unknown[]) {
    console.log(`${colors.blue}[${formatTimestamp()}] [INFO]${colors.reset} ${msg}`, ...args);
  },

  success(msg: string, ...args: unknown[]) {
    console.log(`${colors.green}[${formatTimestamp()}] [SUCCESS]${colors.reset} ${msg}`, ...args);
  },

  warn(msg: string, ...args: unknown[]) {
    console.warn(`${colors.yellow}[${formatTimestamp()}] [WARN]${colors.reset} ${msg}`, ...args);
  },

  error(msg: string, ...args: unknown[]) {
    console.error(`${colors.red}[${formatTimestamp()}] [ERROR]${colors.reset} ${msg}`, ...args);
  },

  trade(msg: string, ...args: unknown[]) {
    console.log(`${colors.magenta}[${formatTimestamp()}] [TRADE]${colors.reset} ${msg}`, ...args);
  },

  scan(msg: string, ...args: unknown[]) {
    console.log(`${colors.cyan}[${formatTimestamp()}] [SCANNER]${colors.reset} ${msg}`, ...args);
  },
};
