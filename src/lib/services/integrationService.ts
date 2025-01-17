import { create } from 'zustand';
import { RateLimiter } from '../../utils/RateLimiter';
import { WebhookHandler } from '../../utils/WebhookHandler';

interface Transaction {
  id: string;
  type: 'sales' | 'purchase' | 'adjustment';
  status: 'pending' | 'completed' | 'failed';
  items: {
    sku: string;
    quantity: number;
    price: number;
  }[];
  module: 'sales' | 'purchase' | 'accounting';
  timestamp: string;
  reference: string;
}

interface IntegrationState {
  pendingTransactions: Transaction[];
  processedTransactions: Transaction[];
  syncStatus: 'idle' | 'syncing' | 'error';
  addTransaction: (transaction: Transaction) => void;
  processTransaction: (transactionId: string) => void;
  setSyncStatus: (status: 'idle' | 'syncing' | 'error') => void;
  inventorySync: {
    lastSync: string;
    batchSize: number;
    retryAttempts: number;
    forecast: InventoryForecast[];
  };
  syncInventory: (items: InventoryItem[]) => Promise<void>;
  getForecast: (sku: string) => Promise<InventoryForecast>;
  integrationStatus: {
    systems: SystemStatus[];
    healthCheck: HealthStatus;
    errors: ErrorLog[];
    metrics: IntegrationMetrics;
    logs: IntegrationLog[];
  };
  checkSystemStatus: () => Promise<void>;
  logError: (error: ErrorLog) => void;
  updateMetrics: (metrics: Partial<IntegrationMetrics>) => void;
}

interface InventoryItem {
  sku: string;
  quantity: number;
  location: string;
  lastUpdated: string;
  minimumStock: number;
  maximumStock: number;
}

interface InventoryForecast {
  sku: string;
  predictedDemand: number;
  suggestedReorder: number;
  confidence: number;
}

interface SystemStatus {
  name: string;
  status: 'online' | 'offline' | 'degraded';
  lastCheck: string;
  responseTime: number;
  endpoint: string;
}

interface HealthStatus {
  overall: 'healthy' | 'unhealthy' | 'degraded';
  lastUpdated: string;
  checks: {
    database: boolean;
    api: boolean;
    queue: boolean;
  };
}

interface ErrorLog {
  timestamp: string;
  system: string;
  error: string;
  context: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface IntegrationMetrics {
  successfulSync: number;
  failedSync: number;
  averageResponseTime: number;
  lastDayTransactions: number;
  activeConnections: number;
}

interface IntegrationLog {
  timestamp: string;
  action: string;
  status: 'success' | 'failure';
  details: any;
}

const rateLimiter = new RateLimiter({ maxRequests: 100, timeWindow: 60000 });
const webhookHandler = new WebhookHandler();

export const useIntegrationStore = create<IntegrationState>((set, get) => ({
  pendingTransactions: [],
  processedTransactions: [],
  syncStatus: 'idle',
  addTransaction: (transaction) =>
    set((state) => ({
      pendingTransactions: [...state.pendingTransactions, transaction],
    })),
  processTransaction: (transactionId) =>
    set((state) => {
      const transaction = state.pendingTransactions.find((t) => t.id === transactionId);
      if (!transaction) return state;
      return {
        pendingTransactions: state.pendingTransactions.filter((t) => t.id !== transactionId),
        processedTransactions: [...state.processedTransactions, { ...transaction, status: 'completed' }],
      };
    }),
  setSyncStatus: (status) => set({ syncStatus: status }),
  inventorySync: {
    lastSync: '',
    batchSize: 50,
    retryAttempts: 3,
    forecast: [],
  },
  syncInventory: async (items: InventoryItem[]) => {
    await rateLimiter.checkLimit();
    set({ syncStatus: 'syncing' });

    try {
      const batches = chunk(items, get().inventorySync.batchSize);

      for (const batch of batches) {
        await processBatch(batch);
        webhookHandler.notify('inventory.updated', { items: batch });
      }

      set(state => ({
        inventorySync: {
          ...state.inventorySync,
          lastSync: new Date().toISOString()
        },
        syncStatus: 'idle'
      }));
    } catch (error) {
      set({ syncStatus: 'error' });
      throw error;
    }
  },
  getForecast: async (sku: string) => {
    const forecast = await calculateForecast(sku);
    set(state => ({
      inventorySync: {
        ...state.inventorySync,
        forecast: [...state.inventorySync.forecast, forecast]
      }
    }));
    return forecast;
  },
  integrationStatus: {
    systems: [],
    healthCheck: {
      overall: 'healthy',
      lastUpdated: new Date().toISOString(),
      checks: { database: true, api: true, queue: true }
    },
    errors: [],
    metrics: {
      successfulSync: 0,
      failedSync: 0,
      averageResponseTime: 0,
      lastDayTransactions: 0,
      activeConnections: 0
    },
    logs: []
  },
  checkSystemStatus: async () => {
    const systems = [
      { name: 'WMS', endpoint: '/api/wms/health' },
      { name: 'ERP', endpoint: '/api/erp/health' },
      { name: 'POS', endpoint: '/api/pos/health' }
    ];

    const statuses = await Promise.all(
      systems.map(async (sys) => {
        const start = Date.now();
        try {
          await fetch(sys.endpoint);
          return {
            name: sys.name,
            status: 'online',
            lastCheck: new Date().toISOString(),
            responseTime: Date.now() - start,
            endpoint: sys.endpoint
          } as SystemStatus;
        } catch (error) {
          return {
            name: sys.name,
            status: 'offline',
            lastCheck: new Date().toISOString(),
            responseTime: -1,
            endpoint: sys.endpoint
          } as SystemStatus;
        }
      })
    );

    set(state => ({
      integrationStatus: {
        ...state.integrationStatus,
        systems: statuses
      }
    }));
  },
  logError: (error: ErrorLog) => 
    set(state => ({
      integrationStatus: {
        ...state.integrationStatus,
        errors: [...state.integrationStatus.errors, error]
      }
    })),
  updateMetrics: (metrics: Partial<IntegrationMetrics>) =>
    set(state => ({
      integrationStatus: {
        ...state.integrationStatus,
        metrics: { ...state.integrationStatus.metrics, ...metrics }
      }
    }))
}));

async function processBatch(items: InventoryItem[]): Promise<void> {
  // Implementation for processing inventory batches
  // with retry mechanism
}

async function calculateForecast(sku: string): Promise<InventoryForecast> {
  // Implementation for inventory demand forecasting
  // using historical data and trends
  return {
    sku,
    predictedDemand: 0,
    suggestedReorder: 0,
    confidence: 0
  };
}

function chunk<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
}
