// Simple ANSI color helpers for zero-dependency logging
const color = (code: number) => (str: string) => `\x1b[${code}m${str}\x1b[0m`;
const pc = {
  gray: color(90),
  blue: color(34),
  yellow: color(33),
  red: color(31),
  cyan: color(36),
  magenta: color(35),
  white: color(37),
  dim: (str: string) => `\x1b[2m${str}\x1b[0m`,
  bold: (str: string) => `\x1b[1m${str}\x1b[0m`,
};

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  level: keyof typeof LogLevel;
  namespace: string;
  message: string;
  timestamp: string;
  data?: any;
  durationMs?: number;
}

export type Transport = (entry: LogEntry) => void;

export interface Logger {
  (message: string, ...args: any[]): void;
  debug(message: string, data?: any): void;
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, data?: any): void;
  measure<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  enabled: boolean;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const env = typeof process !== "undefined" ? process.env : {};

let currentLogLevel = LogLevel.INFO;
const rawLevel = (env.ILN_LOG_LEVEL || "").toUpperCase();
if (rawLevel in LogLevel) {
  currentLogLevel = LogLevel[rawLevel as keyof typeof LogLevel];
} else if (env.ILN_DEBUG === "1") {
  currentLogLevel = LogLevel.DEBUG;
}

const isJsonFormat = env.ILN_LOG_FORMAT === "json";
const transports: Transport[] = [];

// Default console transport
const defaultTransport: Transport = (entry) => {
  if (isJsonFormat) {
    console.log(JSON.stringify(entry));
    return;
  }

  const colorMap = {
    DEBUG: pc.gray,
    INFO: pc.blue,
    WARN: pc.yellow,
    ERROR: pc.red,
  };

  const levelColor = colorMap[entry.level] || pc.white;
  const timeStr = pc.dim(new Date(entry.timestamp).toLocaleTimeString());
  const nsStr = pc.cyan(entry.namespace);
  const durStr = entry.durationMs ? pc.magenta(` (+${entry.durationMs}ms)`) : "";
  
  let msg = `${timeStr} ${levelColor(entry.level.padEnd(5))} [${nsStr}] ${entry.message}${durStr}`;
  
  if (entry.data) {
    msg += ` ${pc.dim(JSON.stringify(entry.data))}`;
  }

  if (entry.level === "ERROR") {
    console.error(msg);
  } else {
    console.log(msg);
  }
};

transports.push(defaultTransport);

// ─── Implementation ───────────────────────────────────────────────────────────

class LoggerImpl {
  public enabled: boolean;

  constructor(private namespace: string) {
    this.enabled = LogLevel.DEBUG >= currentLogLevel;
  }

  // Implementation of the function signature
  // We use a trick to make the class instance callable
  public static create(namespace: string): Logger {
    const instance = new LoggerImpl(namespace);
    
    const logger = ((msg: string, ...args: any[]) => {
      instance.debug(msg, args.length > 1 ? args : args[0]);
    }) as unknown as Logger;
    
    logger.debug = instance.debug.bind(instance);
    logger.info = instance.info.bind(instance);
    logger.warn = instance.warn.bind(instance);
    logger.error = instance.error.bind(instance);
    logger.measure = instance.measure.bind(instance);
    logger.enabled = instance.enabled;
    (logger as any).namespace = namespace;
    
    return logger;
  }

  public debug(message: string, data?: any): void {
    this.log("DEBUG", message, data);
  }

  public info(message: string, data?: any): void {
    this.log("INFO", message, data);
  }

  public warn(message: string, data?: any): void {
    this.log("WARN", message, data);
  }

  public error(message: string, data?: any): void {
    this.log("ERROR", message, data);
  }

  public async measure<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - start;
      this.log("DEBUG", `Measured ${name}`, { durationMs });
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      this.log("ERROR", `Failed ${name} after ${durationMs}ms`, { error: err });
      throw err;
    }
  }

  private log(levelStr: keyof typeof LogLevel, message: string, data?: any, durationMs?: number): void {
    const level = LogLevel[levelStr];
    if (level < currentLogLevel) return;

    const entry: LogEntry = {
      level: levelStr,
      namespace: this.namespace,
      message,
      timestamp: new Date().toISOString(),
      data,
      durationMs,
    };

    for (const transport of transports) {
      try {
        transport(entry);
      } catch (err) {
        // Fallback to basic console if transport fails
        console.error("Logger transport failed", err);
      }
    }
  }
}

/**
 * Creates a new logger instance for the given namespace.
 */
export function createLogger(namespace: string): Logger {
  return LoggerImpl.create(namespace);
}

/**
 * Adds a custom transport to the logger.
 */
export function addTransport(transport: Transport): void {
  transports.push(transport);
}

/**
 * Manually sets the log level.
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}
