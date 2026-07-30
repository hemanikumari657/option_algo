class TerminalWebSocket {
  constructor(state) {
    this.state = state;
    this.ws = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnect = 10;
    this.reconnectDelay = 1000;
    this.heartbeatTimer = null;
    this.userId = null;
    this.token = null;
    this.callbacks = {};
    this.pendingMessages = [];
  }

  connect(userId, token) {
    this.userId = userId;
    this.token = token;
    this._doConnect();
  }

  _doConnect() {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) return;
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/${this.userId}?token=${this.token}`;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.error('[TerminalWS] Connection error:', e);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[TerminalWS] Connected');
      this.reconnectAttempts = 0;
      this.state.set('wsConnected', true);
      this.state.update('connection', { status: 'connected' });
      this._drainPending();
      this._startHeartbeat();
      this._fire('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleMessage(data);
      } catch (e) {
        console.error('[TerminalWS] Parse error:', e);
      }
    };

    this.ws.onclose = (event) => {
      console.log('[TerminalWS] Disconnected:', event.code);
      this.state.set('wsConnected', false);
      this.state.update('connection', { status: 'disconnected' });
      this._stopHeartbeat();
      this._fire('disconnected');
      if (event.code !== 4001 && this.reconnectAttempts < this.maxReconnect) {
        this._scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.error('[TerminalWS] Error:', err);
    };
  }

  disconnect() {
    this.reconnectAttempts = this.maxReconnect;
    this._clearReconnect();
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _scheduleReconnect() {
    this._clearReconnect();
    if (this.reconnectAttempts >= this.maxReconnect) return;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    console.log(`[TerminalWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this._doConnect(), delay);
  }

  _drainPending() {
    if (this.pendingMessages.length > 0) {
      const batch = this.pendingMessages.splice(0);
      batch.forEach(msg => this.send(msg));
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { /* ignore */ }
      }
    }, 25000);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  on(event, callback) {
    if (!this.callbacks[event]) this.callbacks[event] = [];
    this.callbacks[event].push(callback);
  }

  off(event, callback) {
    if (!this.callbacks[event]) return;
    this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
  }

  _fire(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(cb => { try { cb(data); } catch(e) { console.error(e); } });
    }
  }

  _handleMessage(data) {
    const type = data.type || data.event || 'unknown';

    switch (type) {
      case 'tick':
      case 'market_data':
        this._handleTick(data);
        break;
      case 'position':
      case 'positions':
        this._handlePosition(data);
        break;
      case 'signal':
        this._handleSignal(data);
        break;
      case 'entry':
      case 'ENTRY':
        this._handleEntry(data);
        break;
      case 'exit':
      case 'EXIT':
        this._handleExit(data);
        break;
      case 'sl_trail':
      case 'SL_TRAIL':
        this._handleSLTrail(data);
        break;
      case 'modify_sl':
      case 'modify_target':
        this._handleModify(data);
        break;
      case 'bot_status':
      case 'BOT_STATUS':
        this._handleBotStatus(data);
        break;
      case 'candle':
        this._handleCandle(data);
        break;
      case 'event':
        this._handleEvent(data);
        break;
      case 'trade_summary':
      case 'today':
        this._handleTodaySummary(data);
        break;
      case 'order_update':
        this._handleOrderUpdate(data);
        break;
      case 'pong':
        break;
      default:
        if (data.symbol && data.ltp !== undefined) this._handleTick(data);
        break;
    }

    this._fire('message', data);
  }

  _handleTick(data) {
    const symbol = data.symbol || data.instrument || 'NIFTY';
    const ltp = data.ltp || data.price || data.last_price || 0;
    const change = data.change || data.chg || 0;

    if (symbol === 'NIFTY' || symbol === this.state.get('chart').symbol) {
      this.state.update('spot', { symbol, ltp, change });
    }

    this.state.update('chart', { ltp });
    this._fire('tick', { symbol, ltp, change });
  }

  _handlePosition(data) {
    const positions = data.positions || data.data || [];
    const raw = positions[0] || data;

    if (!raw || !raw.qty || raw.qty <= 0) {
      this.state.set('position', {
        active: false, symbol: null, opt_type: null, strike: null, qty: 0,
        entry_price: 0, current_price: 0, sl: null, target: null,
        pnl: 0, roi: 0, holding_time: null, strategy: null, mode: null, direction: null
      });
      this.state.update('trade', { status: 'No Position', direction: null, quantity: null });
      this._fire('position_closed');
      return;
    }

    const inner = raw.position || raw;
    const pnl = inner.pnl || inner.mtm || 0;
    const entryPrice = inner.entry_price || inner.entry || 0;
    const currentPrice = inner.current_price || inner.ltp || inner.current || 0;
    const direction = (inner.opt_type || inner.option_type || '').toUpperCase() === 'PE' ? 'SHORT' : 'LONG';
    const roi = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

    this.state.set('position', {
      active: true,
      symbol: inner.symbol || inner.trading_symbol || raw.symbol || 'NIFTY',
      opt_type: inner.opt_type || inner.option_type || '',
      strike: inner.strike || '',
      qty: inner.qty || 0,
      entry_price: entryPrice,
      current_price: currentPrice,
      sl: inner.sl || inner.stop_loss || inner.sl_trigger || null,
      target: inner.target || inner.take_profit || null,
      pnl: pnl,
      roi: roi,
      holding_time: inner.holding_time || inner.duration || null,
      strategy: inner.strategy || this.state.get('strategy').name || null,
      mode: inner.mode || inner.execution_mode || raw.mode || null,
      direction: direction
    });

    this.state.update('trade', {
      status: 'Active',
      direction: direction,
      quantity: inner.qty
    });

    this._fire('position_update', this.state.get('position'));
  }

  _handleSignal(data) {
    const sig = data.signal || data;
    const signal = {
      time: sig.time || sig.signal_time || data.time || new Date().toISOString(),
      strategy: sig.strategy || sig.name || data.strategy || '',
      signal_type: sig.signal_type || sig.type || sig.action || data.signal_type || data.type || data.action || '',
      symbol: sig.symbol || data.symbol || '',
      price: sig.price || sig.entry_price || data.price || data.entry_price || 0,
      confidence: sig.confidence || data.confidence || null,
      status: sig.status || data.status || 'ACTIVE',
      reason: sig.reason || sig.description || data.reason || data.description || ''
    };

    this.state.update('strategy', {
      name: signal.strategy,
      signal_type: signal.signal_type,
      entry_price: signal.price,
      signal_time: signal.time,
      confidence: signal.confidence,
      reason: signal.reason,
      badge: signal.strategy
    });

    const signals = this.state.get('signals');
    signals.unshift(signal);
    if (signals.length > 100) signals.length = 100;
    this.state.set('signals', signals);

    this._fire('new_signal', signal);
  }

  _handleEntry(data) {
    this.state.update('trade', { status: 'In Position' });
    const events = this.state.get('events');
    events.unshift({
      time: data.time || new Date().toISOString(),
      type: 'ENTRY',
      description: `Entered ${data.symbol || ''} ${data.opt_type || ''} @ ${data.price || data.entry_price || ''}`
    });
    if (events.length > 100) events.length = 100;
    this.state.set('events', events);

    if (data.opt_type) {
      this.state.update('chart', { activeOption: data.opt_type });
    }
  }

  _handleExit(data) {
    this.state.update('trade', { status: 'No Position' });
    const events = this.state.get('events');
    events.unshift({
      time: data.time || new Date().toISOString(),
      type: 'EXIT',
      description: `Exited ${data.symbol || ''} ${data.opt_type || ''} PnL: ${data.pnl || data.mtm || 0}`
    });
    if (events.length > 100) events.length = 100;
    this.state.set('events', events);
    this._fire('position_closed');
  }

  _handleSLTrail(data) {
    const events = this.state.get('events');
    events.unshift({
      time: data.time || new Date().toISOString(),
      type: 'SL_TRAIL',
      description: `SL Trailed to ${data.new_sl || data.price || ''}`
    });
    if (events.length > 100) events.length = 100;
    this.state.set('events', events);
  }

  _handleModify(data) {
    const type = data.type === 'modify_sl' ? 'SL' : 'Target';
    const events = this.state.get('events');
    events.unshift({
      time: data.time || new Date().toISOString(),
      type: type === 'SL' ? 'SL_MODIFIED' : 'TARGET_MODIFIED',
      description: `${type} modified to ${data.new_sl || data.new_target || data.price || ''}`
    });
    if (events.length > 100) events.length = 100;
    this.state.set('events', events);
  }

  _handleBotStatus(data) {
    const running = data.running || data.status === 'running';
    this.state.update('connection', { status: running ? 'bot_running' : 'bot_stopped' });
  }

  _handleCandle(data) {
    this._fire('candle_update', data);
  }

  _handleEvent(data) {
    const events = this.state.get('events');
    events.unshift({
      time: data.time || new Date().toISOString(),
      type: data.event_type || data.type || 'EVENT',
      description: data.description || data.message || ''
    });
    if (events.length > 100) events.length = 100;
    this.state.set('events', events);
  }

  _handleTodaySummary(data) {
    const total = data.trades || data.total || 0;
    const winners = data.wins || data.winners || 0;
    this.state.set('today', {
      trades: total,
      wins: winners,
      pnl: data.pnl || data.total_pnl || 0,
      win_rate: data.win_rate || (total > 0 ? (winners / total) * 100 : 0)
    });
  }

  _handleOrderUpdate(data) {
    const events = this.state.get('events');
    events.unshift({
      time: data.time || new Date().toISOString(),
      type: 'ORDER',
      description: `Order ${data.status || ''}: ${data.symbol || ''} ${data.opt_type || ''} ${data.qty || ''} @ ${data.price || ''}`
    });
    if (events.length > 100) events.length = 100;
    this.state.set('events', events);
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else if (this.reconnectAttempts < this.maxReconnect) {
      if (this.pendingMessages.length < 50) {
        this.pendingMessages.push(data);
      }
    }
  }
}
