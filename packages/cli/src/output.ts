import pc from 'picocolors';
import { spawnSync } from 'child_process';

export type OutputFormat = 'table' | 'json' | 'yaml';

function toYaml(data: any, indent = 0): string {
  if (data === null) return 'null';
  if (typeof data === 'string') {
    // Basic escaping for strings that contain newlines or colons
    if (data.includes('\n') || data.includes(':')) {
      return `"${data.replace(/"/g, '\\"')}"`;
    }
    return data;
  }
  if (typeof data !== 'object') return String(data);

  const spaces = ' '.repeat(indent);
  let result = '';

  if (Array.isArray(data)) {
    if (data.length === 0) return '[]';
    for (const item of data) {
      const itemYaml = toYaml(item, indent + 2);
      if (typeof item === 'object' && item !== null) {
        result += `${spaces}- \n${itemYaml}\n`;
      } else {
        result += `${spaces}- ${itemYaml}\n`;
      }
    }
  } else {
    const keys = Object.keys(data);
    if (keys.length === 0) return '{}';
    for (const key of keys) {
      const value = data[key];
      const valYaml = toYaml(value, indent + 2);
      if (typeof value === 'object' && value !== null) {
        result += `${spaces}${key}:\n${valYaml}\n`;
      } else {
        result += `${spaces}${key}: ${valYaml}\n`;
      }
    }
  }

  return result.trimEnd();
}

export function handleOutput(
  data: any,
  renderHuman: () => string | void,
  format: OutputFormat = 'table'
) {
  let outputText = '';

  if (format === 'json') {
    outputText = JSON.stringify(data, null, 2);
  } else if (format === 'yaml') {
    outputText = toYaml(data);
  } else {
    // "table" or default
    // We capture the output if renderHuman returns a string, else it assumes renderHuman prints directly
    // but to support paging, we need the string.
    const result = renderHuman();
    if (typeof result === 'string') {
      outputText = result;
    } else {
      // If it doesn't return string, it probably already printed to console.
      return;
    }
  }

  pageOutput(outputText);
}

function pageOutput(text: string) {
  // Rough estimate of terminal height
  const terminalHeight = process.stdout.rows || 24;
  const lineCount = text.split('\n').length;

  if (lineCount > terminalHeight) {
    try {
      // Try to use less for paging
      spawnSync('less', ['-R', '-F', '-X'], {
        input: text,
        stdio: ['pipe', process.stdout, process.stderr],
      });
    } catch (e) {
      // Fallback if less is not available
      console.log(text);
    }
  } else {
    console.log(text);
  }
}
