import express, { Request, Response } from 'express';
import {
  createSubscription,
  deleteSubscriptionByAddressAndDestination,
  deleteSubscriptionById,
  getSubscriptionsByAddress,
  getSubscriptionById,
} from './db';
import {
  ALLOWED_CHANNELS,
  ALLOWED_TRIGGERS,
  isValidEmail,
  isValidUrl,
  validateChannel,
  validateTrigger,
} from './config';
import type { NotificationTrigger } from './types';
import { sendWebhook } from './delivery';

interface SubscribeRequest {
  stellar_address: string;
  channel: string;
  destination: string;
  triggers: unknown;
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.post('/subscribe', (req: Request, res: Response) => {
    const body = req.body as SubscribeRequest;

    if (!body?.stellar_address || typeof body.stellar_address !== 'string') {
      return res.status(400).json({ error: 'stellar_address is required' });
    }

    if (!validateChannel(body.channel)) {
      return res
        .status(400)
        .json({ error: `channel must be one of: ${ALLOWED_CHANNELS.join(', ')}` });
    }

    if (!body.destination || typeof body.destination !== 'string') {
      return res.status(400).json({ error: 'destination is required' });
    }

    if (!Array.isArray(body.triggers) || body.triggers.length === 0) {
      return res.status(400).json({ error: 'triggers must be a non-empty array' });
    }

    const triggers = body.triggers as unknown[];
    if (!triggers.every(validateTrigger)) {
      return res
        .status(400)
        .json({ error: `triggers must be one of: ${ALLOWED_TRIGGERS.join(', ')}` });
    }

    if (body.channel === 'email' && !isValidEmail(body.destination)) {
      return res.status(400).json({ error: 'destination must be a valid email address' });
    }

    if (body.channel === 'webhook' && !isValidUrl(body.destination)) {
      return res.status(400).json({ error: 'destination must be a valid http or https URL' });
    }

    const subscription = createSubscription({
      stellar_address: body.stellar_address,
      channel: body.channel as 'email' | 'webhook',
      destination: body.destination,
      triggers: triggers as NotificationTrigger[],
    });

    return res.status(201).json({ subscription });
  });

  app.delete('/unsubscribe', (req: Request, res: Response) => {
    const { id, address, destination } = req.body as {
      id?: number;
      address?: string;
      destination?: string;
    };

    let deleted = false;

    if (typeof id === 'number') {
      deleted = deleteSubscriptionById(id);
    } else if (address && destination) {
      deleted = deleteSubscriptionByAddressAndDestination(address, destination);
    } else {
      return res.status(400).json({ error: 'Provide subscription id or address and destination' });
    }

    if (!deleted) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    return res.status(200).json({ success: true });
  });

  app.get('/subscriptions/:address', (req: Request, res: Response) => {
    const address = req.params.address;

    if (!address) {
      return res.status(400).json({ error: 'address is required' });
    }

    const subscriptions = getSubscriptionsByAddress(address);
    return res.json({ subscriptions });
  });

  app.post('/test-webhook', async (req: Request, res: Response) => {
    const { id } = req.body as { id: number };

    if (typeof id !== 'number') {
      return res.status(400).json({ error: 'id is required and must be a number' });
    }

    const subscription = getSubscriptionById(id);
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    if (subscription.channel !== 'webhook') {
      return res.status(400).json({ error: 'Subscription is not a webhook' });
    }

    try {
      await sendWebhook(subscription, {
        trigger: 'invoice_funded',
        invoice: {
          id: 0,
          freelancer: subscription.stellar_address,
          payer: subscription.stellar_address,
          amount: '100',
          due_date: Math.floor(Date.now() / 1000) + 86400,
          discount_rate: 100,
          status: 'Funded',
          funder: null,
          funded_at: null,
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        },
        recipientAddress: subscription.stellar_address,
        subject: 'Webhook Test',
        message: 'This is a test notification from the ILN Notification Service.',
        actor: 'freelancer',
      });

      return res.json({ success: true, statusCode: 200 });
    } catch (error: any) {
      const statusCode = error.message.includes('attempts:')
        ? parseInt(error.message.split(': ')[1]) || 500
        : 500;

      return res.json({ success: false, statusCode });
    }
  });

  return app;
}
