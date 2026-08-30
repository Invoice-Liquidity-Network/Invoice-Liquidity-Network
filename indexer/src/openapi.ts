import type { OpenAPIV3 } from 'openapi-types';

// ─── Reusable schema fragments ────────────────────────────────────────────────

const StellarAddress: OpenAPIV3.SchemaObject = {
  type: 'string',
  pattern: '^G[A-Z2-7]{55}$',
  example: 'GABC1234EXAMPLESTELLARADDRESS000000000000000000000000000',
};

const InvoiceStatus: OpenAPIV3.SchemaObject = {
  type: 'string',
  enum: ['Pending', 'Funded', 'Paid', 'Defaulted'],
};

const Invoice: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'integer', example: 1 },
    freelancer: StellarAddress,
    payer: StellarAddress,
    amount: { type: 'string', example: '1000000' },
    due_date: { type: 'integer', description: 'Unix timestamp in seconds', example: 1893456000 },
    discount_rate: { type: 'integer', description: 'Basis points (e.g. 500 = 5%)', example: 500 },
    status: InvoiceStatus,
    funder: { ...StellarAddress, nullable: true },
    funded_at: { type: 'integer', nullable: true, description: 'Unix timestamp of funding' },
    created_at: { type: 'integer', description: 'Millisecond timestamp when indexed' },
    updated_at: { type: 'integer', description: 'Millisecond timestamp of last update' },
  },
  required: [
    'id',
    'freelancer',
    'payer',
    'amount',
    'due_date',
    'discount_rate',
    'status',
    'created_at',
    'updated_at',
  ],
};

const ErrorResponse: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
};

const errorResponses: OpenAPIV3.ResponsesObject = {
  '400': {
    description: 'Bad request — invalid query parameter or path segment',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  '404': {
    description: 'Resource not found',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  '429': {
    description: 'Too many requests — rate limit exceeded',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  '500': {
    description: 'Internal server error',
    content: { 'application/json': { schema: ErrorResponse } },
  },
};

// ─── Full OpenAPI document ────────────────────────────────────────────────────

export const openApiSpec: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'Invoice Liquidity Network — Indexer API',
    version: '1.0.0',
    description:
      'REST API for the ILN on-chain event indexer. ' +
      'Unversioned paths (`/invoices`, etc.) are deprecated; prefer `/v1/` equivalents. ' +
      'A GraphQL endpoint is also available at `/graphql`.',
    contact: { name: 'ILN Team' },
    license: { name: 'MIT' },
  },
  servers: [
    { url: '/v1', description: 'Current stable version' },
    { url: '/', description: 'Deprecated unversioned routes' },
  ],
  tags: [
    { name: 'System', description: 'Health and observability' },
    { name: 'Invoices', description: 'Invoice queries' },
    { name: 'Participants', description: 'LP and freelancer statistics' },
    { name: 'Archive', description: 'Archived data management' },
    { name: 'Backup', description: 'Database backup management' },
    { name: 'Export', description: 'Async data exports' },
  ],
  paths: {
    // ── System ──────────────────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Returns service health, database status, last sync ledger time, and uptime.',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'Service status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['ok', 'degraded'] },
                    db: { type: 'string', enum: ['ok', 'error'] },
                    lastSync: { type: 'string', format: 'date-time', nullable: true },
                    uptime: { type: 'integer', description: 'Milliseconds since process start' },
                  },
                  required: ['status', 'db', 'lastSync', 'uptime'],
                },
              },
            },
          },
        },
      },
    },
    '/dashboard': {
      get: {
        tags: ['System'],
        summary: 'Dashboard metrics',
        description: 'Aggregate request count, error rates, and latency data for monitoring.',
        operationId: 'getDashboard',
        responses: {
          '200': {
            description: 'Dashboard metrics object',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/stats': {
      get: {
        tags: ['Invoices'],
        summary: 'Protocol statistics',
        description:
          'Returns aggregate stats: total invoices, total volume, total yield, and default rate.',
        operationId: 'getStats',
        responses: {
          '200': {
            description: 'Protocol statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    totalInvoices: { type: 'integer' },
                    totalVolume: { type: 'string', description: 'Smallest token unit' },
                    totalYield: { type: 'string', description: 'Smallest token unit' },
                    defaultRate: { type: 'number', minimum: 0, maximum: 1 },
                  },
                  required: ['totalInvoices', 'totalVolume', 'totalYield', 'defaultRate'],
                },
              },
            },
          },
        },
      },
    },

    // ── Invoices ────────────────────────────────────────────────────────────
    '/invoices': {
      get: {
        tags: ['Invoices'],
        summary: 'List invoices',
        description:
          'Returns a paginated list of indexed invoices. All filters are optional and ANDed together. ' +
          'Use `cursor` from the previous response to fetch the next page.',
        operationId: 'listInvoices',
        parameters: [
          {
            name: 'status',
            in: 'query',
            schema: InvoiceStatus,
            description: 'Filter by invoice status',
          },
          {
            name: 'freelancer',
            in: 'query',
            schema: StellarAddress,
            description: 'Filter by freelancer Stellar address',
          },
          {
            name: 'payer',
            in: 'query',
            schema: StellarAddress,
            description: 'Filter by payer Stellar address',
          },
          {
            name: 'funder',
            in: 'query',
            schema: StellarAddress,
            description: 'Filter by funder Stellar address',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
            description: 'Maximum number of results to return',
          },
          {
            name: 'cursor',
            in: 'query',
            schema: { type: 'string' },
            description: 'Opaque pagination cursor from a previous response',
          },
        ],
        responses: {
          '200': {
            description: 'Paginated invoice list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    invoices: { type: 'array', items: Invoice },
                    hasMore: { type: 'boolean' },
                    nextCursor: { type: 'string', nullable: true },
                  },
                  required: ['invoices', 'hasMore'],
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/invoice/{id}': {
      get: {
        tags: ['Invoices'],
        summary: 'Get invoice by ID',
        description:
          'Fetch the current indexed state of a single invoice. Responses are cached for 30 seconds.',
        operationId: 'getInvoiceById',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer', minimum: 1 },
            description: 'Invoice ID',
          },
        ],
        responses: {
          '200': {
            description: 'Invoice details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { invoice: Invoice },
                  required: ['invoice'],
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/history/{address}': {
      get: {
        tags: ['Invoices'],
        summary: 'Invoice history for an address',
        description: 'Returns all invoices where the given address played the specified role.',
        operationId: 'getHistory',
        parameters: [
          {
            name: 'address',
            in: 'path',
            required: true,
            schema: StellarAddress,
            description: 'Stellar address',
          },
          {
            name: 'role',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['freelancer', 'payer', 'funder'],
              default: 'freelancer',
            },
            description: 'Role the address played in the invoice',
          },
        ],
        responses: {
          '200': {
            description: 'List of matching invoices',
            content: {
              'application/json': {
                schema: { type: 'array', items: Invoice },
              },
            },
          },
          ...errorResponses,
        },
      },
    },

    // ── Participants ─────────────────────────────────────────────────────────
    '/lps/top': {
      get: {
        tags: ['Participants'],
        summary: 'Top liquidity providers',
        description:
          'Returns the top LPs ranked by yield earned, optionally filtered by time period.',
        operationId: 'getTopLPs',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
          },
          {
            name: 'period',
            in: 'query',
            schema: { type: 'string', enum: ['all', 'week', 'month'], default: 'all' },
          },
        ],
        responses: {
          '200': {
            description: 'Ranked LP list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      address: StellarAddress,
                      yield: { type: 'string' },
                      invoiceCount: { type: 'integer' },
                    },
                    required: ['address', 'yield', 'invoiceCount'],
                  },
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/lps/{address}/stats': {
      get: {
        tags: ['Participants'],
        summary: 'LP statistics',
        description:
          'Returns total deployed capital, earned yield, invoice count, and default rate for a liquidity provider.',
        operationId: 'getLPStats',
        parameters: [
          {
            name: 'address',
            in: 'path',
            required: true,
            schema: StellarAddress,
          },
        ],
        responses: {
          '200': {
            description: 'LP statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    deployed: { type: 'string' },
                    yield: { type: 'string' },
                    invoiceCount: { type: 'integer' },
                    defaultRate: { type: 'number' },
                  },
                  required: ['deployed', 'yield', 'invoiceCount', 'defaultRate'],
                },
              },
            },
          },
        },
      },
    },
    '/freelancers/{address}/stats': {
      get: {
        tags: ['Participants'],
        summary: 'Freelancer statistics',
        description:
          'Returns submitted count, funded count, total received, and average discount rate for a freelancer.',
        operationId: 'getFreelancerStats',
        parameters: [
          {
            name: 'address',
            in: 'path',
            required: true,
            schema: StellarAddress,
          },
        ],
        responses: {
          '200': {
            description: 'Freelancer statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    submitted: { type: 'integer' },
                    funded: { type: 'integer' },
                    totalReceived: { type: 'string' },
                    avgDiscount: { type: 'number' },
                  },
                  required: ['submitted', 'funded', 'totalReceived', 'avgDiscount'],
                },
              },
            },
          },
        },
      },
    },

    // ── Archive ──────────────────────────────────────────────────────────────
    '/archive/stats': {
      get: {
        tags: ['Archive'],
        summary: 'Archive statistics',
        description: 'Returns counts and byte sizes of archived invoices and events.',
        operationId: 'getArchiveStats',
        responses: {
          '200': {
            description: 'Archive statistics',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/archive/invoices': {
      get: {
        tags: ['Archive'],
        summary: 'Query archived invoices',
        description: 'Returns invoices that have been moved to the archive table.',
        operationId: 'queryArchiveInvoices',
        parameters: [
          { name: 'status', in: 'query', schema: InvoiceStatus },
          { name: 'freelancer', in: 'query', schema: StellarAddress },
          { name: 'payer', in: 'query', schema: StellarAddress },
          { name: 'funder', in: 'query', schema: StellarAddress },
        ],
        responses: {
          '200': {
            description: 'Archived invoices',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { invoices: { type: 'array', items: Invoice } },
                  required: ['invoices'],
                },
              },
            },
          },
        },
      },
    },
    '/archive/events': {
      get: {
        tags: ['Archive'],
        summary: 'Query archived events',
        description: 'Returns contract events that have been archived.',
        operationId: 'queryArchiveEvents',
        parameters: [{ name: 'invoiceId', in: 'query', schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'Archived events',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { events: { type: 'array', items: { type: 'object' } } },
                  required: ['events'],
                },
              },
            },
          },
        },
      },
    },
    '/archive/restore/{id}': {
      post: {
        tags: ['Archive'],
        summary: 'Restore archived invoice',
        description:
          'Moves an invoice and its events back from the archive table to the active tables.',
        operationId: 'restoreInvoice',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer', minimum: 1 },
          },
        ],
        responses: {
          '200': {
            description: 'Invoice restored',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                  required: ['success', 'message'],
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/archive/run': {
      post: {
        tags: ['Archive'],
        summary: 'Trigger archival run',
        description:
          'Manually moves invoices older than the given threshold from active to archive tables.',
        operationId: 'runArchive',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  olderThanDays: { type: 'integer', minimum: 1, default: 90 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Archival result',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          ...errorResponses,
        },
      },
    },

    // ── Backup ───────────────────────────────────────────────────────────────
    '/backup': {
      get: {
        tags: ['Backup'],
        summary: 'List backups',
        description: 'Returns metadata for all locally stored database backups.',
        operationId: 'listBackups',
        responses: {
          '200': {
            description: 'Backup list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    backups: { type: 'array', items: { type: 'object' } },
                    total: { type: 'integer' },
                  },
                  required: ['backups', 'total'],
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Backup'],
        summary: 'Trigger manual backup',
        description: 'Creates a new database backup snapshot immediately.',
        operationId: 'createBackup',
        responses: {
          '200': {
            description: 'Backup result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    backup: { type: 'object' },
                  },
                  required: ['success'],
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/backup/latest': {
      get: {
        tags: ['Backup'],
        summary: 'Latest backup',
        description: 'Returns the manifest of the most recent backup.',
        operationId: 'getLatestBackup',
        responses: {
          '200': {
            description: 'Latest backup manifest',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '404': { description: 'No backups found' },
        },
      },
    },
    '/backup/restore': {
      post: {
        tags: ['Backup'],
        summary: 'Restore from backup',
        description: 'Restores the database from the given backup file path.',
        operationId: 'restoreBackup',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  backupPath: { type: 'string', description: 'Path to the backup file' },
                  verify: {
                    type: 'boolean',
                    default: true,
                    description: 'Verify backup integrity before restore',
                  },
                },
                required: ['backupPath'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Restore result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                  required: ['success'],
                },
              },
            },
          },
          ...errorResponses,
        },
      },
    },

    // ── Export ───────────────────────────────────────────────────────────────
    '/export/invoices': {
      get: {
        tags: ['Export'],
        summary: 'Export invoices synchronously',
        description: 'Returns up to the sync limit of invoices in CSV or JSON format.',
        operationId: 'exportInvoices',
        parameters: [
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'], default: 'json' } },
          { name: 'status', in: 'query', schema: InvoiceStatus },
          { name: 'freelancer', in: 'query', schema: StellarAddress },
          { name: 'payer', in: 'query', schema: StellarAddress },
          { name: 'funder', in: 'query', schema: StellarAddress },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          '200': {
            description: 'Exported invoices',
            content: {
              'application/json': { schema: { type: 'array', items: Invoice } },
              'text/csv': { schema: { type: 'string' } }
            },
          },
          '413': { description: 'Result set too large, use async export' },
          ...errorResponses,
        },
      },
    },
    '/export/events': {
      get: {
        tags: ['Export'],
        summary: 'Export events synchronously',
        description: 'Returns up to the sync limit of events in CSV or JSON format.',
        operationId: 'exportEvents',
        parameters: [
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'], default: 'json' } },
          { name: 'invoiceId', in: 'query', schema: { type: 'integer' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          '200': {
            description: 'Exported events',
            content: {
              'application/json': { schema: { type: 'array', items: { type: 'object' } } },
              'text/csv': { schema: { type: 'string' } }
            },
          },
          '413': { description: 'Result set too large, use async export' },
          ...errorResponses,
        },
      },
    },
    '/export/jobs': {
      post: {
        tags: ['Export'],
        summary: 'Create async export job',
        description: 'Starts an asynchronous export job for large datasets.',
        operationId: 'createExportJob',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['invoices', 'events'] },
                  format: { type: 'string', enum: ['csv', 'json'] },
                  from: { type: 'string', format: 'date-time' },
                  to: { type: 'string', format: 'date-time' },
                  status: InvoiceStatus,
                  freelancer: StellarAddress,
                  payer: StellarAddress,
                  funder: StellarAddress,
                  invoiceId: { type: 'integer' }
                },
                required: ['type', 'format']
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Job created',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          ...errorResponses,
        },
      },
    },
    '/export/jobs/{jobId}': {
      get: {
        tags: ['Export'],
        summary: 'Poll job status',
        description: 'Returns the status of an async export job.',
        operationId: 'getExportJob',
        parameters: [
          { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Job status',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          ...errorResponses,
        },
      },
    },
    '/export/download/{jobId}': {
      get: {
        tags: ['Export'],
        summary: 'Download export',
        description: 'Downloads the completed export file.',
        operationId: 'downloadExport',
        parameters: [
          { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Export file',
            content: {
              'application/json': { schema: { type: 'array', items: { type: 'object' } } },
              'text/csv': { schema: { type: 'string' } }
            },
          },
          '202': { description: 'Export not ready yet' },
          ...errorResponses,
        },
      },
    },
  },
};
