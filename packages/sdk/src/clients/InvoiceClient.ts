import { Horizon } from '@stellar/stellar-sdk';

export class InvoiceClient {
  private server: Horizon.Server;
  private contractId: string;

  constructor(serverUrl: string, contractId: string) {
    this.server = new Horizon.Server(serverUrl);
    this.contractId = contractId;
  }

  public async submitInvoice(invoiceData: any) {
    console.log("Submitting invoice...");
  }

  public async fundInvoice(invoiceId: string) {
    console.log("Funding invoice: " + invoiceId);
  }

  public async markPaid(invoiceId: string) {
    console.log("Marking invoice as paid: " + invoiceId);
  }
}
