import type { Request, Response } from 'express';
import express from 'express';
import { MongoClient, Db } from 'mongodb';
import {
  INITIAL_PRODUCTS,
  INITIAL_USERS,
  INITIAL_SALES,
  INITIAL_STOCK_TRANSACTIONS,
  INITIAL_PAYMENTS,
  INITIAL_NOTIFICATIONS,
  INITIAL_LOGS,
  INITIAL_SETTINGS,
} from '../src/data/seedData.ts';
import type {
  Product,
  User,
  Sale,
  StockTransaction,
  PaymentRecord,
  AppNotification,
  AdminLog,
  BusinessSettings,
  UnitType,
} from '../src/types.ts';

interface DatabaseSchema {
  products: Product[];
  users: User[];
  sales: Sale[];
  stockTransactions: StockTransaction[];
  payments: PaymentRecord[];
  notifications: AppNotification[];
  logs: AdminLog[];
  settings: BusinessSettings;
}

let memoryDb: DatabaseSchema = {
  products: INITIAL_PRODUCTS,
  users: INITIAL_USERS,
  sales: INITIAL_SALES,
  stockTransactions: INITIAL_STOCK_TRANSACTIONS,
  payments: INITIAL_PAYMENTS,
  notifications: INITIAL_NOTIFICATIONS,
  logs: INITIAL_LOGS,
  settings: INITIAL_SETTINGS,
};

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;
let isMongoConnecting = false;

async function getMongoDatabase(): Promise<Db | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  if (cachedDb) return cachedDb;
  if (isMongoConnecting) return null;

  isMongoConnecting = true;
  try {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      maxPoolSize: 5,
    });
    await client.connect();
    cachedClient = client;
    cachedDb = client.db(process.env.MONGODB_DB_NAME || 'deshi_bite');
    return cachedDb;
  } catch (err: any) {
    console.warn('[Vercel Serverless] MongoDB fallback:', err?.message || err);
    return null;
  } finally {
    isMongoConnecting = false;
  }
}

async function syncWithMongo() {
  try {
    const db = await getMongoDatabase();
    if (!db) return;

    const stateDoc = await db.collection('app_state').findOne({ _id: 'enterprise_state' as any });
    if (stateDoc) {
      if (Array.isArray(stateDoc.products) && stateDoc.products.length > 0) {
        memoryDb.products = stateDoc.products;
      }
      if (Array.isArray(stateDoc.users) && stateDoc.users.length > 0) {
        memoryDb.users = stateDoc.users;
      }
      if (Array.isArray(stateDoc.sales)) memoryDb.sales = stateDoc.sales;
      if (Array.isArray(stateDoc.payments)) memoryDb.payments = stateDoc.payments;
      if (Array.isArray(stateDoc.stockTransactions)) memoryDb.stockTransactions = stateDoc.stockTransactions;
      if (Array.isArray(stateDoc.notifications)) memoryDb.notifications = stateDoc.notifications;
      if (Array.isArray(stateDoc.logs)) memoryDb.logs = stateDoc.logs;
      if (stateDoc.settings) memoryDb.settings = stateDoc.settings;
    } else {
      await db.collection('app_state').updateOne(
        { _id: 'enterprise_state' as any },
        { $set: { ...memoryDb, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    }
  } catch (err: any) {
    console.warn('[Vercel Sync Warning]:', err?.message || err);
  }
}

async function saveToMongo() {
  try {
    const db = await getMongoDatabase();
    if (!db) return;
    await db.collection('app_state').updateOne(
      { _id: 'enterprise_state' as any },
      { $set: { ...memoryDb, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
  } catch (err: any) {
    console.warn('[Vercel Save Warning]:', err?.message || err);
  }
}

function getBangladeshDateTime() {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);

  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(now);

  return { date: dateStr, time: timeStr, timestamp: now.getTime() };
}

let app: express.Express | null = null;

function buildServerlessApp(): express.Express {
  const exp = express();
  exp.use(express.json());

  exp.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  const api = express.Router();

  // Health
  api.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'DESHI BITE Vercel Serverless',
      timezone: 'Asia/Dhaka',
      time: getBangladeshDateTime(),
      mongodbConnected: !!cachedDb,
      platform: 'vercel-serverless',
    });
  });

  // Full State
  api.get('/state', async (req, res) => {
    await syncWithMongo();
    res.json({
      products: memoryDb.products,
      users: memoryDb.users.map((u) => {
        const { passwordHash, ...safeUser } = u;
        return safeUser;
      }),
      sales: memoryDb.sales,
      stockTransactions: memoryDb.stockTransactions,
      payments: memoryDb.payments,
      notifications: memoryDb.notifications,
      logs: memoryDb.logs,
      settings: memoryDb.settings,
      systemTime: getBangladeshDateTime(),
    });
  });

  // Auth: Login
  api.post('/auth/login', async (req, res) => {
    await syncWithMongo();
    const { phone, password } = req.body || {};
    const user = memoryDb.users.find((u) => u.phone === phone?.trim());

    if (!user) {
      return res.status(401).json({ error: 'Invalid phone number or password' });
    }
    if (user.passwordHash !== password?.trim()) {
      return res.status(401).json({ error: 'Invalid phone number or password' });
    }
    if (user.status === 'PENDING') {
      return res.status(403).json({ error: 'Your account registration is currently PENDING approval by an Administrator.' });
    }
    if (user.status === 'REJECTED') {
      return res.status(403).json({ error: 'Your account registration has been rejected. Please contact management.' });
    }
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Your account is suspended. Please contact management.' });
    }

    const { passwordHash, ...safeUser } = user;
    return res.json({ success: true, user: safeUser });
  });

  // Auth: Register
  api.post('/auth/register', async (req, res) => {
    await syncWithMongo();
    const { name, phone, password, address } = req.body || {};
    if (!name?.trim() || !phone?.trim() || !password?.trim()) {
      return res.status(400).json({ error: 'Name, phone, and password are required' });
    }

    const cleanPhone = phone.trim();
    if (memoryDb.users.some((u) => u.phone === cleanPhone)) {
      return res.status(400).json({ error: 'An account with this phone number already exists' });
    }

    const dt = getBangladeshDateTime();
    const newAgent: User = {
      id: `AGENT-${String(memoryDb.users.filter((u) => u.role === 'AGENT').length + 1).padStart(4, '0')}`,
      name: name.trim(),
      phone: cleanPhone,
      passwordHash: password.trim(),
      role: 'AGENT',
      status: 'PENDING',
      totalSales: 0,
      totalPaid: 0,
      currentDue: 0,
      address: address?.trim() || '',
      joinedDate: dt.date,
    };

    memoryDb.users.push(newAgent);
    memoryDb.notifications.unshift({
      id: `NOTIF-${Date.now()}`,
      title: 'New Agent Registration Pending',
      message: `${newAgent.name} (${newAgent.phone}) has applied for an agent account.`,
      type: 'INFO',
      isRead: false,
      date: dt.date,
      time: dt.time,
      targetRole: 'ADMIN',
      timestamp: dt.timestamp,
    });

    await saveToMongo();
    res.json({
      success: true,
      message: 'Agent registration submitted successfully! Please wait for Admin approval.',
      agentId: newAgent.id,
    });
  });

  // Products: Get
  api.get('/products', async (req, res) => {
    await syncWithMongo();
    res.json(memoryDb.products);
  });

  // Products: Add
  api.post('/products', async (req, res) => {
    const {
      name,
      retailPriceKg,
      retailPricePcs,
      wholesalePriceKg,
      wholesalePricePcs,
      stockKg,
      stockPcs,
      lowStockThresholdKg,
      lowStockThresholdPcs,
      active,
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    const dt = getBangladeshDateTime();
    const newProd: Product = {
      id: `PROD-${1000 + memoryDb.products.length + 1}`,
      name: name.trim(),
      retailPriceKg: retailPriceKg ? Number(retailPriceKg) : null,
      retailPricePcs: retailPricePcs ? Number(retailPricePcs) : null,
      wholesalePriceKg: wholesalePriceKg ? Number(wholesalePriceKg) : null,
      wholesalePricePcs: wholesalePricePcs ? Number(wholesalePricePcs) : null,
      stockKg: Number(stockKg) || 0,
      stockPcs: Number(stockPcs) || 0,
      lowStockThresholdKg: lowStockThresholdKg !== undefined && lowStockThresholdKg !== '' ? Number(lowStockThresholdKg) : 0.5,
      lowStockThresholdPcs: Number(lowStockThresholdPcs) || 20,
      active: active !== undefined ? active : true,
      updatedAt: dt.date,
    };

    memoryDb.products.push(newProd);
    await saveToMongo();
    res.json({ success: true, product: newProd });
  });

  // Products: Edit
  api.put('/products/:id', async (req, res) => {
    const prod = memoryDb.products.find((p) => p.id === req.params.id);
    if (!prod) return res.status(404).json({ error: 'Product not found' });

    Object.assign(prod, {
      name: req.body.name?.trim() || prod.name,
      retailPriceKg: req.body.retailPriceKg !== undefined ? (req.body.retailPriceKg ? Number(req.body.retailPriceKg) : null) : prod.retailPriceKg,
      retailPricePcs: req.body.retailPricePcs !== undefined ? (req.body.retailPricePcs ? Number(req.body.retailPricePcs) : null) : prod.retailPricePcs,
      wholesalePriceKg: req.body.wholesalePriceKg !== undefined ? (req.body.wholesalePriceKg ? Number(req.body.wholesalePriceKg) : null) : prod.wholesalePriceKg,
      wholesalePricePcs: req.body.wholesalePricePcs !== undefined ? (req.body.wholesalePricePcs ? Number(req.body.wholesalePricePcs) : null) : prod.wholesalePricePcs,
      stockKg: req.body.stockKg !== undefined ? Number(req.body.stockKg) : prod.stockKg,
      stockPcs: req.body.stockPcs !== undefined ? Number(req.body.stockPcs) : prod.stockPcs,
      lowStockThresholdKg: req.body.lowStockThresholdKg !== undefined && req.body.lowStockThresholdKg !== '' ? Number(req.body.lowStockThresholdKg) : prod.lowStockThresholdKg,
      lowStockThresholdPcs: req.body.lowStockThresholdPcs !== undefined ? Number(req.body.lowStockThresholdPcs) : prod.lowStockThresholdPcs,
      active: req.body.active !== undefined ? Boolean(req.body.active) : prod.active,
      updatedAt: getBangladeshDateTime().date,
    });

    await saveToMongo();
    res.json({ success: true, product: prod });
  });

  // Sales: Create
  api.post('/sales', async (req, res) => {
    const { agentId, saleType, items, customerName, customerPhone, customerAddress, discount } = req.body;
    const agent = memoryDb.users.find((u) => u.id === agentId && u.role === 'AGENT');
    if (!agent) {
      return res.status(403).json({ error: 'Authorized Agent account required to create sale' });
    }

    if (!items || !items.length) {
      return res.status(400).json({ error: 'At least one product item is required' });
    }

    const dt = getBangladeshDateTime();
    const invoiceCounter = memoryDb.sales.length + 1;
    const invoiceNumber = `DB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(invoiceCounter).padStart(5, '0')}`;
    const saleId = `SALE-${Date.now()}-${invoiceCounter}`;

    let subtotal = 0;
    const frozenItems = items.map((it: any) => {
      const itemSubtotal = Number((it.quantity * it.unitPrice).toFixed(2));
      subtotal += itemSubtotal;
      return {
        productId: it.productId,
        productName: it.productName,
        unit: it.unit as UnitType,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: itemSubtotal,
      };
    });

    const discountAmount = Number(discount) || 0;
    const grandTotal = Math.max(0, subtotal - discountAmount);

    // Deduct stock
    for (const item of frozenItems) {
      const prod = memoryDb.products.find((p) => p.id === item.productId);
      if (prod) {
        const stockBefore = item.unit === 'KG' ? prod.stockKg : prod.stockPcs;
        if (item.unit === 'KG') {
          prod.stockKg = Number((prod.stockKg - item.quantity).toFixed(3));
        } else {
          prod.stockPcs = Math.max(0, prod.stockPcs - item.quantity);
        }
        const stockAfter = item.unit === 'KG' ? prod.stockKg : prod.stockPcs;

        memoryDb.stockTransactions.unshift({
          id: `STX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          productId: prod.id,
          productName: prod.name,
          type: 'SALE_OUT',
          quantity: item.quantity,
          unit: item.unit,
          referenceNote: `Deducted via Sale ${invoiceNumber}`,
          recordedBy: agent.name,
          date: dt.date,
          time: dt.time,
          createdAtDate: dt.date,
          createdAtTime: dt.time,
          timestamp: dt.timestamp,
          stockBefore,
          stockAfter,
        });
      }
    }

    agent.totalSales = Number((agent.totalSales + grandTotal).toFixed(2));
    agent.currentDue = Number((agent.currentDue + grandTotal).toFixed(2));

    const newSale: Sale = {
      id: saleId,
      invoiceNo: invoiceNumber,
      agentId: agent.id,
      agentName: agent.name,
      customerName: customerName?.trim() || 'Direct Customer',
      customerPhone: customerPhone?.trim() || '',
      customerAddress: customerAddress?.trim() || '',
      saleType,
      items: frozenItems,
      subtotal,
      discount: discountAmount,
      grandTotal,
      paymentStatus: 'UNPAID',
      createdAtDate: dt.date,
      createdAtTime: dt.time,
      timestamp: dt.timestamp,
    };

    memoryDb.sales.unshift(newSale);
    await saveToMongo();

    res.json({
      success: true,
      sale: newSale,
      agentUpdatedDue: agent.currentDue,
      invoiceNo: invoiceNumber,
    });
  });

  // Payments: Record
  api.post('/payments', async (req, res) => {
    const { agentId, amount, paymentMethod, referenceNote, recordedBy } = req.body;
    const agent = memoryDb.users.find((u) => u.id === agentId && u.role === 'AGENT');
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ error: 'Valid payment amount is required' });
    }

    const previousDue = agent.currentDue;
    const remainingDue = Number((previousDue - numAmount).toFixed(2));

    agent.totalPaid = Number((agent.totalPaid + numAmount).toFixed(2));
    agent.currentDue = remainingDue;

    const dt = getBangladeshDateTime();
    const paymentRecord: PaymentRecord = {
      id: `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`,
      agentId: agent.id,
      agentName: agent.name,
      amount: numAmount,
      previousDue,
      remainingDue,
      paymentMethod: paymentMethod || 'Cash in Hand',
      referenceNote: referenceNote || 'Due clearance payment',
      recordedBy: recordedBy || 'Admin Manager',
      date: dt.date,
      time: dt.time,
      createdAtDate: dt.date,
      createdAtTime: dt.time,
      timestamp: dt.timestamp,
    };

    memoryDb.payments.unshift(paymentRecord);
    await saveToMongo();

    res.json({
      success: true,
      payment: paymentRecord,
      agentRemainingDue: remainingDue,
    });
  });

  // Settings: Update
  api.post('/settings', async (req, res) => {
    Object.assign(memoryDb.settings, req.body);
    await saveToMongo();
    res.json({ success: true, settings: memoryDb.settings });
  });

  exp.use('/api', api);
  exp.use('/', api);

  return exp;
}

export default async function handler(req: Request, res: Response) {
  try {
    if (!app) {
      app = buildServerlessApp();
    }

    const originalUrl = (req.headers['x-forwarded-uri'] || req.headers['x-vercel-original-path'] || req.url) as string;
    if (originalUrl) {
      req.url = originalUrl;
    }

    return app(req, res);
  } catch (error: any) {
    console.error('[Vercel Fatal Serverless Error]:', error);
    return res.status(500).json({
      error: 'Server error processing request',
      message: error?.message || 'Unknown Serverless Error',
    });
  }
}
