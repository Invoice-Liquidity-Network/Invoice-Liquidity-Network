import { createPubSub } from 'graphql-yoga';
import type { Invoice } from './types';

type PubSubChannels = {
  INVOICE_CREATED: [Invoice];
  INVOICE_UPDATED: [Invoice];
};

export const pubSub = createPubSub<PubSubChannels>();
