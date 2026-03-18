/**
 * ExchangeInterface — unified abstraction for all trading backends.
 *
 * Implemented by:
 *   BinanceUSExchange  — live / testnet Binance.US REST API
 *   PaperExchange      — fully in-process simulation, no network calls
 */

export interface Order {
  id:          string;
  symbol:      string;
  type:        'BUY' | 'SELL';
  quantity:    number;
  price:       number;
  status:      'PENDING' | 'FILLED' | 'PARTIAL' | 'CANCELED';
  timestamp:   Date;
  commission?: number;
}

export interface Balance {
  symbol:    string;
  available: number;
  held:      number;
  total:     number;
}

export interface PlaceOrderParams {
  symbol:     string;
  side:       'BUY' | 'SELL';
  size:       number;
  price?:     number;
  orderType?: 'MARKET' | 'LIMIT';
}

export interface ExchangeInterface {
  getExchangeName(): Promise<string>;
  isConnected():     Promise<boolean>;

  getBalance(symbol: string):  Promise<Balance>;
  getAllBalances():             Promise<Balance[]>;

  getCurrentPrice(symbol: string):   Promise<number>;
  getPrices(symbols: string[]):      Promise<Map<string, number>>;

  placeOrder(params: PlaceOrderParams): Promise<Order>;
  cancelOrder(orderId: string):         Promise<boolean>;
  getOpenOrders(symbol?: string):       Promise<Order[]>;
  getOrderStatus(orderId: string):      Promise<Order>;
  getOrderHistory(limit?: number):      Promise<Order[]>;
}
