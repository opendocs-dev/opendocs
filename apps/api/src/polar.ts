import { Polar } from '@polar-sh/sdk';

export interface PolarClient {
  checkouts: {
    create: (params: {
      products?: string[];
      externalCustomerId?: string;
      [key: string]: any;
    }) => Promise<{ url: string; [key: string]: any }>;
  };
  customerSessions: {
    create: (params: {
      customerId?: string;
      externalCustomerId?: string;
      [key: string]: any;
    }) => Promise<{ customerPortalUrl?: string; customer_portal_url?: string; url?: string; [key: string]: any }>;
  };
  orders: {
    list: (params: {
      customerId?: string;
      externalCustomerId?: string;
      [key: string]: any;
    }) => Promise<{ result?: { items?: any[] }; items?: any[] } | any[]>;
    invoice?: (params: { id: string }) => Promise<{ url: string }>;
  };
}

let customPolarClient: PolarClient | null = null;

export function setPolarClient(client: PolarClient | null): void {
  customPolarClient = client;
}

export function getPolarClient(): PolarClient {
  if (customPolarClient) {
    return customPolarClient;
  }
  const token = process.env.POLAR_ACCESS_TOKEN;
  return new Polar({ accessToken: token }) as unknown as PolarClient;
}
