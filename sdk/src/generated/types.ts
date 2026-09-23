// !! AUTO-GENERATED — do not edit by hand.
// Re-generate with: pnpm generate:types
// Source: ILN-Smart-Contract/target/spec.json

/** Contract-level errors returned by the ILN smart contract. */
export enum ContractError {
  InvoiceNotFound = 1,
  AlreadyFunded = 2,
  AlreadyPaid = 3,
  NotFunder = 4,
  NotPayer = 5,
  NotDueYet = 6,
  InvalidAmount = 7,
  InvalidDiscount = 8,
  InvalidDueDate = 9,
  Unauthorized = 10,
}
