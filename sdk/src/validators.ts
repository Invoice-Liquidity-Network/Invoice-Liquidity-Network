import { ValidationError } from './errors';

export interface ValidationIssue {
  path: string;
  message: string;
  code?: string;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  issues?: ValidationIssue[];
}

export interface StellarAddressValidationOptions {
  allowTestnet?: boolean;
  allowPublic?: boolean;
}

export interface AmountValidationOptions {
  min?: bigint;
  max?: bigint;
  decimals?: number;
  allowZero?: boolean;
}

export interface DateValidationOptions {
  min?: Date;
  max?: Date;
  allowPast?: boolean;
  allowFuture?: boolean;
  unit?: 'milliseconds' | 'seconds';
}

export interface DiscountRateValidationOptions {
  min?: number;
  max?: number;
  allowZero?: boolean;
}

export type ValidatorFunction<T = unknown> = (value: T, path?: string) => ValidationResult;

export interface SchemaField<T = unknown> {
  required?: boolean;
  validate: ValidatorFunction<T>;
}

export type ValidationSchema = Record<string, SchemaField | ValidatorFunction>;

export type CustomValidator<T = unknown> = (
  value: T,
  path?: string
) => ValidationResult | boolean | string | void;

export type ValidationMiddleware<T = unknown> = (input: T) => void;

type ObjectLike = Record<string, unknown>;

export class Validators {
  private static readonly customValidators = new Map<string, CustomValidator>();

  static readonly submitInvoiceSchema: ValidationSchema = {
    freelancer: {
      required: true,
      validate: (value) => this.validateStellarAddress(value as string, {}, 'freelancer'),
    },
    payer: {
      required: true,
      validate: (value) => this.validateStellarAddress(value as string, {}, 'payer'),
    },
    amount: {
      required: true,
      validate: (value) => this.validateAmount(value as bigint, { allowZero: false }),
    },
    dueDate: { required: true, validate: (value) => this.validateUnixTimestamp(value) },
    discountRate: {
      required: true,
      validate: (value) =>
        this.validateDiscountRate(value as number, {
          min: 0,
          max: 10000,
          allowZero: false,
        }),
    },
  };

  static readonly fundingSchema: ValidationSchema = {
    funder: {
      required: true,
      validate: (value) => this.validateStellarAddress(value as string, {}, 'funder'),
    },
    invoiceId: { required: true, validate: (value) => this.validateInvoiceId(value) },
  };

  static readonly paymentSchema: ValidationSchema = {
    invoiceId: { required: true, validate: (value) => this.validateInvoiceId(value) },
  };

  static readonly storageSchema: ValidationSchema = {
    key: { required: true, validate: (value) => this.validateNonEmptyString(value, 'Storage key') },
  };

  static validateStellarAddress(
    address: string,
    options: StellarAddressValidationOptions = {},
    fieldPath = 'address'
  ): ValidationResult {
    void options;

    if (!address || typeof address !== 'string') {
      return this.invalid('Address must be a non-empty string', fieldPath, 'REQUIRED');
    }

    if (address.length !== 56) {
      return this.invalid(
        'Invalid Stellar address format. Must be 56 characters',
        fieldPath,
        'INVALID_LENGTH'
      );
    }

    if (!address.startsWith('G')) {
      return this.invalid(
        "Invalid Stellar address format. Must start with 'G'",
        fieldPath,
        'INVALID_PREFIX'
      );
    }

    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    for (const char of address.slice(1)) {
      if (!base32Chars.includes(char)) {
        return this.invalid(
          'Address contains invalid base32 characters',
          fieldPath,
          'INVALID_BASE32'
        );
      }
    }

    return { isValid: true };
  }

  static validateAmount(
    amount: bigint | number | string,
    options: AmountValidationOptions = {}
  ): ValidationResult {
    let bigintAmount: bigint;

    if (typeof amount === 'bigint') {
      bigintAmount = amount;
    } else if (typeof amount === 'number') {
      if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
        return this.invalid('Amount must be a finite integer number', 'amount', 'INVALID_NUMBER');
      }
      bigintAmount = BigInt(amount);
    } else if (typeof amount === 'string') {
      if (!/^-?\d+$/.test(amount)) {
        return this.invalid('Amount must be a valid integer string', 'amount', 'INVALID_STRING');
      }
      bigintAmount = BigInt(amount);
    } else {
      return this.invalid('Amount must be a bigint, number, or string', 'amount', 'INVALID_TYPE');
    }

    if (!options.allowZero && bigintAmount === 0n) {
      return this.invalid('Amount cannot be zero', 'amount', 'ZERO_NOT_ALLOWED');
    }

    if (bigintAmount < 0n) {
      return this.invalid('Amount cannot be negative', 'amount', 'NEGATIVE');
    }

    if (options.min !== undefined && bigintAmount < options.min) {
      return this.invalid(`Amount must be at least ${options.min.toString()}`, 'amount', 'MIN');
    }

    if (options.max !== undefined && bigintAmount > options.max) {
      return this.invalid(`Amount must be at most ${options.max.toString()}`, 'amount', 'MAX');
    }

    return { isValid: true };
  }

  static validateDate(
    date: Date | number | string,
    options: DateValidationOptions = {}
  ): ValidationResult {
    const parsed = this.toDate(date, options.unit ?? 'milliseconds');
    if (!parsed.isValid) {
      return parsed;
    }

    const dateObj = (parsed as ValidationResult & { value: Date }).value;
    const now = new Date();

    if (!options.allowPast && dateObj < now) {
      return this.invalid('Date cannot be in the past', 'date', 'PAST_NOT_ALLOWED');
    }

    if (options.allowFuture === false && dateObj > now) {
      return this.invalid('Date cannot be in the future', 'date', 'FUTURE_NOT_ALLOWED');
    }

    if (options.min && dateObj < options.min) {
      return this.invalid(`Date must be after ${options.min.toISOString()}`, 'date', 'MIN');
    }

    if (options.max && dateObj > options.max) {
      return this.invalid(`Date must be before ${options.max.toISOString()}`, 'date', 'MAX');
    }

    return { isValid: true };
  }

  static validateUnixTimestamp(value: unknown, path = 'dueDate'): ValidationResult {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      return this.invalid('Due date must be a Unix timestamp in seconds', path, 'INVALID_TYPE');
    }

    return this.withPath(
      this.validateDate(value, { allowPast: false, allowFuture: true, unit: 'seconds' }),
      path
    );
  }

  static validateDiscountRate(
    rate: number,
    options: DiscountRateValidationOptions = {}
  ): ValidationResult {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || !Number.isInteger(rate)) {
      return this.invalid(
        'Discount rate must be a finite integer number',
        'discountRate',
        'INVALID_TYPE'
      );
    }

    if (!options.allowZero && rate === 0) {
      return this.invalid('Discount rate cannot be zero', 'discountRate', 'ZERO_NOT_ALLOWED');
    }

    if (rate < 0) {
      return this.invalid('Discount rate cannot be negative', 'discountRate', 'NEGATIVE');
    }

    if (options.min !== undefined && rate < options.min) {
      return this.invalid(`Discount rate must be at least ${options.min}`, 'discountRate', 'MIN');
    }

    if (options.max !== undefined && rate > options.max) {
      return this.invalid(`Discount rate must be at most ${options.max}`, 'discountRate', 'MAX');
    }

    if (options.max === undefined && rate > 10000) {
      return this.invalid('Discount rate cannot exceed 10000 (100%)', 'discountRate', 'MAX');
    }

    return { isValid: true };
  }

  static validateInvoiceId(value: unknown, path = 'invoiceId'): ValidationResult {
    if (typeof value !== 'bigint') {
      return this.invalid('Invoice ID must be a bigint', path, 'INVALID_TYPE');
    }

    if (value < 0n) {
      return this.invalid('Invoice ID cannot be negative', path, 'NEGATIVE');
    }

    return { isValid: true };
  }

  static validateNonEmptyString(value: unknown, label = 'Value', path = 'value'): ValidationResult {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return this.invalid(`${label} must be a non-empty string`, path, 'REQUIRED');
    }

    return { isValid: true };
  }

  static validateCallback(value: unknown, path = 'callback'): ValidationResult {
    if (typeof value !== 'function') {
      return this.invalid('Callback must be a function', path, 'INVALID_TYPE');
    }

    return { isValid: true };
  }

  static validateObject(value: unknown, path = 'input'): ValidationResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return this.invalid(`${path} must be an object`, path, 'INVALID_TYPE');
    }

    return { isValid: true };
  }

  static validateSchema(
    value: unknown,
    schema: ValidationSchema,
    path = 'input'
  ): ValidationResult {
    const objectResult = this.validateObject(value, path);
    if (!objectResult.isValid) {
      return objectResult;
    }

    const objectValue = value as ObjectLike;
    const issues: ValidationIssue[] = [];

    for (const [field, definition] of Object.entries(schema)) {
      const fieldPath = `${path}.${field}`;
      const schemaField =
        typeof definition === 'function' ? { required: false, validate: definition } : definition;
      const fieldValue = objectValue[field];

      if (fieldValue === undefined || fieldValue === null) {
        if (schemaField.required) {
          issues.push({
            path: fieldPath,
            message: `${field} is required`,
            code: 'REQUIRED',
          });
        }
        continue;
      }

      const result = this.withPath(schemaField.validate(fieldValue, fieldPath), fieldPath);
      if (!result.isValid) {
        issues.push(...this.resultIssues(result, fieldPath));
      }
    }

    return this.fromIssues(issues);
  }

  static validateComposite(
    value: unknown,
    validators: Array<(value: unknown) => ValidationResult>
  ): ValidationResult {
    for (const validator of validators) {
      const result = validator(value);
      if (!result.isValid) {
        return result;
      }
    }
    return { isValid: true };
  }

  static validateInvoiceSubmission(params: {
    freelancer: string;
    payer: string;
    amount: bigint;
    dueDate: number;
    discountRate: number;
  }): ValidationResult {
    return this.validateSchema(params, this.submitInvoiceSchema, 'submitInvoice');
  }

  static validateFunding(params: { funder: string; invoiceId: bigint }): ValidationResult {
    return this.validateSchema(params, this.fundingSchema, 'funding');
  }

  static validatePayment(params: { invoiceId: bigint }): ValidationResult {
    return this.validateSchema(params, this.paymentSchema, 'payment');
  }

  static validateBatchSubmission(params: { invoices: unknown[] }): ValidationResult {
    const objectResult = this.validateObject(params, 'batchSubmitInvoices');
    if (!objectResult.isValid) return objectResult;

    if (!Array.isArray(params.invoices)) {
      return this.invalid(
        'invoices must be an array',
        'batchSubmitInvoices.invoices',
        'INVALID_TYPE'
      );
    }

    if (params.invoices.length === 0) {
      return this.invalid(
        'invoices must contain at least one invoice',
        'batchSubmitInvoices.invoices',
        'EMPTY'
      );
    }

    const issues = params.invoices.flatMap((invoice, index) =>
      this.resultIssues(
        this.validateSchema(
          invoice,
          this.submitInvoiceSchema,
          `batchSubmitInvoices.invoices.${index}`
        ),
        `batchSubmitInvoices.invoices.${index}`
      )
    );

    return this.fromIssues(issues);
  }

  static validateBatchFunding(params: { funder: string; invoiceIds: unknown[] }): ValidationResult {
    const baseResult = this.validateSchema(
      params,
      {
        funder: this.fundingSchema.funder,
        invoiceIds: {
          required: true,
          validate: (value) =>
            Array.isArray(value)
              ? { isValid: true }
              : this.invalid('invoiceIds must be an array', 'invoiceIds', 'INVALID_TYPE'),
        },
      },
      'batchFundInvoices'
    );
    if (!baseResult.isValid) return baseResult;

    if (params.invoiceIds.length === 0) {
      return this.invalid(
        'invoiceIds must contain at least one invoice ID',
        'batchFundInvoices.invoiceIds',
        'EMPTY'
      );
    }

    return this.fromIssues(
      params.invoiceIds.flatMap((invoiceId, index) =>
        this.resultIssues(
          this.validateInvoiceId(invoiceId, `batchFundInvoices.invoiceIds.${index}`),
          `batchFundInvoices.invoiceIds.${index}`
        )
      )
    );
  }

  static validateBatchPayment(params: { invoiceIds: unknown[] }): ValidationResult {
    const baseResult = this.validateSchema(
      params,
      {
        invoiceIds: {
          required: true,
          validate: (value) =>
            Array.isArray(value)
              ? { isValid: true }
              : this.invalid('invoiceIds must be an array', 'invoiceIds', 'INVALID_TYPE'),
        },
      },
      'batchMarkPaid'
    );
    if (!baseResult.isValid) return baseResult;

    if (params.invoiceIds.length === 0) {
      return this.invalid(
        'invoiceIds must contain at least one invoice ID',
        'batchMarkPaid.invoiceIds',
        'EMPTY'
      );
    }

    return this.fromIssues(
      params.invoiceIds.flatMap((invoiceId, index) =>
        this.resultIssues(
          this.validateInvoiceId(invoiceId, `batchMarkPaid.invoiceIds.${index}`),
          `batchMarkPaid.invoiceIds.${index}`
        )
      )
    );
  }

  static registerCustomValidator(name: string, validator: CustomValidator): void {
    const nameResult = this.validateNonEmptyString(name, 'Validator name', 'name');
    this.assertValid(nameResult, 'registerCustomValidator');

    if (typeof validator !== 'function') {
      throw new ValidationError('registerCustomValidator: validator must be a function');
    }

    this.customValidators.set(name, validator);
  }

  static getCustomValidator(name: string): CustomValidator | undefined {
    return this.customValidators.get(name);
  }

  static runCustomValidator(name: string, value: unknown, path = name): ValidationResult {
    const validator = this.customValidators.get(name);
    if (!validator) {
      return this.invalid(
        `Custom validator "${name}" is not registered`,
        path,
        'UNKNOWN_VALIDATOR'
      );
    }

    return this.normalizeCustomResult(validator(value, path), path);
  }

  static createValidationMiddleware<T>(
    schemaOrValidator: ValidationSchema | ValidatorFunction<T>,
    context = 'validation'
  ): ValidationMiddleware<T> {
    return (input: T) => {
      const result =
        typeof schemaOrValidator === 'function'
          ? schemaOrValidator(input)
          : this.validateSchema(input, schemaOrValidator, context);

      this.assertValid(result, context);
    };
  }

  static withValidation<T, TResult>(
    handler: (input: T) => TResult,
    schemaOrValidator: ValidationSchema | ValidatorFunction<T>,
    context = handler.name || 'validation'
  ): (input: T) => TResult {
    const middleware = this.createValidationMiddleware(schemaOrValidator, context);

    return (input: T) => {
      middleware(input);
      return handler(input);
    };
  }

  static formatError(result: ValidationResult): string {
    if (result.isValid) return '';
    if (result.issues?.length) {
      return result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    }
    return result.error ?? 'Validation failed';
  }

  static assertValid(result: ValidationResult, context?: string): void {
    if (!result.isValid) {
      const message = this.formatError(result);
      throw new ValidationError(context ? `${context}: ${message}` : message);
    }
  }

  private static toDate(
    date: Date | number | string,
    unit: 'milliseconds' | 'seconds'
  ): ValidationResult & { value?: Date } {
    let dateObj: Date;

    if (date instanceof Date) {
      dateObj = date;
    } else if (typeof date === 'number') {
      if (!Number.isFinite(date) || !Number.isInteger(date)) {
        return this.invalid('Timestamp must be a finite integer', 'date', 'INVALID_TYPE');
      }
      if (date < 0) {
        return this.invalid('Timestamp cannot be negative', 'date', 'NEGATIVE');
      }
      dateObj = new Date(unit === 'seconds' ? date * 1000 : date);
    } else if (typeof date === 'string') {
      dateObj = new Date(date);
      if (Number.isNaN(dateObj.getTime())) {
        return this.invalid('Invalid date string format', 'date', 'INVALID_STRING');
      }
    } else {
      return this.invalid('Date must be a Date, number, or string', 'date', 'INVALID_TYPE');
    }

    if (Number.isNaN(dateObj.getTime())) {
      return this.invalid('Invalid date value', 'date', 'INVALID_DATE');
    }

    return { isValid: true, value: dateObj };
  }

  private static normalizeCustomResult(
    result: ValidationResult | boolean | string | void,
    path: string
  ): ValidationResult {
    if (result === undefined || result === true) {
      return { isValid: true };
    }
    if (result === false) {
      return this.invalid('Custom validation failed', path, 'CUSTOM');
    }
    if (typeof result === 'string') {
      return this.invalid(result, path, 'CUSTOM');
    }
    return this.withPath(result, path);
  }

  private static invalid(message: string, path: string, code?: string): ValidationResult {
    return {
      isValid: false,
      error: message,
      issues: [{ path, message, code }],
    };
  }

  private static fromIssues(issues: ValidationIssue[]): ValidationResult {
    if (issues.length === 0) {
      return { isValid: true };
    }

    return {
      isValid: false,
      error: issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      issues,
    };
  }

  private static withPath(result: ValidationResult, path: string): ValidationResult {
    if (result.isValid) {
      return result;
    }

    const issues = this.resultIssues(result, path);
    return {
      isValid: false,
      error: issues.map((issue) => issue.message).join('; ') || result.error,
      issues,
    };
  }

  private static resultIssues(result: ValidationResult, fallbackPath: string): ValidationIssue[] {
    if (result.isValid) {
      return [];
    }

    if (result.issues?.length) {
      return result.issues.map((issue) => ({
        ...issue,
        path: issue.path || fallbackPath,
      }));
    }

    return [
      {
        path: fallbackPath,
        message: result.error ?? 'Validation failed',
      },
    ];
  }
}
