declare module 'dotenv' {
  export function config(): void;
}

declare module 'better-sqlite3' {
  export default class Database {
    constructor(path: string);
    pragma(sql: string): void;
    prepare(sql: string): Statement;
    exec(sql: string): void;
    close(): void;
  }

  export interface Statement {
    run(...params: any[]): { lastInsertRowid: number | bigint; changes: number };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
}

declare module '@resend/resend' {
  export class Resend {
    constructor(apiKey: string);
    emails: {
      send(options: { from: string; to: string; subject: string; html: string }): Promise<any>;
    };
  }
}

declare module '@stellar/stellar-sdk' {
  export * from 'stellar-sdk';
}

declare module 'express' {
  export interface Request {
    body: any;
    params: Record<string, string>;
  }

  export interface Response {
    status(code: number): Response;
    json(data: any): Response;
    send(data: any): Response;
  }

  export function json(): any;
  export default function express(): any;
}

declare module 'supertest' {
  export default function supertest(app: any): any;
}

declare module 'vitest' {
  export * from 'vitest';
}
