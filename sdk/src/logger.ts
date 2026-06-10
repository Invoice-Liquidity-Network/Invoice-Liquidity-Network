import debug from "debug";

const isDebugEnabled =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  process.env.ILN_DEBUG === "1";

if (isDebugEnabled) {
  debug.log = console.debug?.bind(console) ?? console.log.bind(console);
  debug.enable("iln:sdk:*");
}

function createNoopDebugger(): debug.Debugger {
  return Object.assign(() => {}, { enabled: false }) as debug.Debugger;
}

export function createLogger(namespace: string): debug.Debugger {
  return isDebugEnabled ? debug(`iln:sdk:${namespace}`) : createNoopDebugger();
}
