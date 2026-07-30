class TerminalState {
  constructor() {
    this.listeners = {};
    this.state = {
      user: { id: null, token: null },
      connection: { status: 'disconnected' },
      spot: { symbol: 'NIFTY', ltp: 0, change: 0 },
      atm: { ce: null, pe: null, itm_ce: null, itm_pe: null, spot: null },
      strikes: { atm_ce_premium: 0, atm_pe_premium: 0, itm_ce_premium: 0, itm_pe_premium: 0 },
      strategy: { name: null, signal_type: null, entry_price: null, signal_time: null, confidence: null, reason: null, badge: null },
      position: { active: false, symbol: null, opt_type: null, strike: null, qty: 0, entry_price: 0, current_price: 0, sl: null, target: null, pnl: 0, roi: 0, holding_time: null, strategy: null, mode: null, direction: null },
      trade: { status: 'No Position', mode: null, direction: null, quantity: null },
      today: { trades: 0, wins: 0, pnl: 0, win_rate: 0 },
      chart: { symbol: 'NIFTY', timeframe: '1m', activeOption: null },
      candles: [],
      trades: [],
      signals: [],
      events: [],
      wsConnected: false
    };
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    const old = this.state[key];
    this.state[key] = value;
    this._notify(key, value, old);
  }

  update(key, partial) {
    const old = { ...this.state[key] };
    this.state[key] = { ...this.state[key], ...partial };
    this._notify(key, this.state[key], old);
  }

  on(key, callback) {
    if (!this.listeners[key]) this.listeners[key] = [];
    this.listeners[key].push(callback);
    return () => {
      this.listeners[key] = this.listeners[key].filter(cb => cb !== callback);
    };
  }

  _notify(key, value, old) {
    if (this.listeners[key]) {
      this.listeners[key].forEach(cb => {
        try { cb(value, old); } catch(e) { console.error('State listener error:', e); }
      });
    }
  }
}

const terminalState = new TerminalState();
