const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  1: 'Invoice not found.',
  2: 'Invoice has already been funded.',
  3: 'Invoice has already been paid.',
  4: 'Invoice is not funded yet.',
  5: 'Unauthorized for this operation.',
  6: 'Invalid amount. Amount must be greater than zero.',
  7: 'Invalid discount rate. Use a value between 1 and the configured maximum.',
  8: 'Invalid due date. Use a future date.',
  9: 'Invoice has defaulted.',
  10: 'Nothing to claim for this invoice.',
  11: 'Invoice is not yet eligible for default actions.',
  12: 'Funding amount exceeds the remaining balance.',
  13: 'Invoice has expired.',
  14: 'Batch size is too large.',
};

export function explainContractError(code: number): string {
  return CONTRACT_ERROR_MESSAGES[code] ?? `Contract returned error code ${code}.`;
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error.';
}
