(function() {
  'use strict';

  const token = getToken();
  const userId = getUserId();

  if (!token || !userId) {
    window.location.href = '/login';
    return;
  }

  document.getElementById('terminal-user-id').value = userId;
  document.getElementById('terminal-token').value = token;

  const state = terminalState;
  const ws = new TerminalWebSocket(state);
  const chart = new ChartManager(state, ws);
  const positionPanel = new PositionPanel(state, ws);
  const bottomPanel = new BottomPanel(state, ws);

  let intervals = [];

  function safeInterval(fn, ms) {
    const id = setInterval(fn, ms);
    intervals.push(id);
    return id;
  }

  function clearAllIntervals() {
    intervals.forEach(clearInterval);
    intervals = [];
  }

  // ── WebSocket Event Wiring ──
  ws.on('new_signal', signal => {
    bottomPanel.addSignal(signal);
    const chartState = state.get('chart');
    const strat = state.get('strategy');
    const symbol = strat.symbol || chartState.symbol || 'NIFTY';
    if (strat.signal_type) {
      const isCE = strat.signal_type.includes('CE') || strat.signal_type === 'BUY';
      document.getElementById('chart-symbol').textContent = symbol + ' ' + (isCE ? 'CE' : 'PE');
      state.update('chart', { activeOption: isCE ? 'CE' : 'PE' });
    }
  });

  ws.on('position_update', pos => {
    bottomPanel.addEvent({
      time: new Date().toISOString(),
      type: 'POSITION_UPDATE',
      description: 'Position: ' + (pos.symbol || '') + ' ' + (pos.opt_type || '') + ' Qty: ' + (pos.qty || 0)
    });
  });

  ws.on('position_closed', () => {
    bottomPanel.addEvent({
      time: new Date().toISOString(),
      type: 'POSITION_CLOSED',
      description: 'Position closed'
    });
  });

  ws.on('connected', () => {
    bottomPanel.addEvent({
      time: new Date().toISOString(),
      type: 'WS_CONNECTED',
      description: 'WebSocket connected'
    });
    _fetchInitialData();
  });

  ws.on('disconnected', () => {
    bottomPanel.addEvent({
      time: new Date().toISOString(),
      type: 'WS_DISCONNECTED',
      description: 'WebSocket disconnected'
    });
  });

  // ── Timeframe Buttons ──
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tf = btn.dataset.tf;
      chart.setTimeframe(tf);
      _fetchCandles(tf);
    });
  });

  // ── Watchlist Selection ──
  document.querySelectorAll('.wl-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.wl-item').forEach(i => i.classList.remove('wl-active'));
      item.classList.add('wl-active');
      const symbol = item.dataset.symbol;
      state.update('chart', { symbol });
      document.getElementById('chart-symbol').textContent = symbol;
      _fetchCandles(state.get('chart').timeframe);
    });
  });

  // ── Chart Reset ──
  document.getElementById('btn-reset-chart').addEventListener('click', () => {
    if (chart.chart) chart.chart.timeScale().fitContent();
  });

  // ── Connect WebSocket ──
  ws.connect(userId, token);

  // ── Fetch Initial Data ──
  async function _fetchInitialData() {
    try {
      const results = await Promise.allSettled([
        _safeFetch('/api/users/config'),
        _safeFetch('/api/trades?limit=25'),
        _safeFetch('/api/trades/summary?today=true')
      ]);

      const config = results[0].status === 'fulfilled' ? results[0].value : null;
      const trades = results[1].status === 'fulfilled' ? results[1].value : null;
      const today = results[2].status === 'fulfilled' ? results[2].value : null;

      if (config) {
        state.update('trade', {
          mode: config.execution_mode || (config.paper_mode ? 'PAPER' : 'AUTO')
        });
        state.update('chart', { symbol: config.underlying_symbol || 'NIFTY' });
        if (config.strategy) {
          state.update('strategy', { name: config.strategy, badge: config.strategy });
        }
      }

      if (trades && Array.isArray(trades)) {
        state.set('trades', trades);
      }

      if (today) {
        state.set('today', today);
      }

      await Promise.all([
        _fetchCandles(state.get('chart').timeframe),
        _fetchPositions(),
        _fetchOCAnalysis()
      ]);

    } catch (e) {
      console.error('[Terminal] Initial data fetch error:', e);
    }
  }

  async function _fetchCandles(tf) {
    const symbol = state.get('chart').symbol || 'NIFTY';
    try {
      const resp = await _safeFetch('/api/terminal/candles?symbol=' + encodeURIComponent(symbol) + '&timeframe=' + encodeURIComponent(tf || '1m') + '&limit=200');
      if (resp && resp.candles) {
        chart.setCandles(resp.candles);
        if (resp.indicators) {
          chart.setIndicators(resp.indicators);
        }
      }
    } catch (e) {
      console.error('[Terminal] Candle fetch error:', e);
    }
  }

  async function _fetchPositions() {
    try {
      const resp = await _safeFetch('/api/position');
      if (resp && resp.positions !== undefined) {
        ws._handlePosition({ positions: resp.positions, count: resp.count || 0 });
      }
    } catch (e) {
      console.error('[Terminal] Position fetch error:', e);
    }
  }

  async function _fetchOCAnalysis() {
    try {
      const resp = await _safeFetch('/api/oc/analysis');
      if (resp && resp.analysis) {
        const a = resp.analysis;
        document.getElementById('atm-ce').textContent = a.atm_ce || '—';
        document.getElementById('atm-pe').textContent = a.atm_pe || '—';
        document.getElementById('atm-spot-badge').textContent = 'Spot: ' + (a.spot_price || '—');
        if (a.itm_strikes) {
          document.getElementById('itm-ce').textContent = a.itm_strikes.ce || '—';
          document.getElementById('itm-pe').textContent = a.itm_strikes.pe || '—';
        }
      }
    } catch (e) {
      console.error('[Terminal] OC fetch error:', e);
    }
  }

  async function _safeFetch(url) {
    try {
      const resp = await apiFetch(url);
      if (resp && resp.ok) return await resp.json();
      return null;
    } catch (e) {
      return null;
    }
  }

  // ── Polling fallback for positions (supplements WS) ──
  safeInterval(() => {
    if (!state.get('wsConnected')) {
      _fetchPositions();
    }
  }, 5000);

  safeInterval(() => {
    _fetchOCAnalysis();
  }, 30000);

  // ── Drag & Drop SL/Target ──
  let dragState = null;
  let clickHandler = null;

  function initDragLines() {
    if (!chart.chart) {
      setTimeout(initDragLines, 500);
      return;
    }

    chart.chart.subscribeCrosshairMove(param => {
      if (!dragState || !param.point || !param.price) return;
      const pos = state.get('position');
      if (!pos || !pos.active) return;

      const newPrice = Math.round(param.price * 100) / 100;
      const updatedPos = { ...pos };

      if (dragState.type === 'sl') {
        updatedPos.sl = newPrice;
      } else if (dragState.type === 'target') {
        updatedPos.target = newPrice;
      }
      state.set('position', updatedPos);
      positionPanel._updateSLTarget(updatedPos);
    });

    chart.chart.subscribeClick(param => {
      if (!param.point || !param.time) {
        if (dragState) { dragState = null; }
        return;
      }

      const price = param.price;
      const pos = state.get('position');

      if (dragState) {
        if (pos && pos.active) {
          const label = dragState.type === 'sl' ? 'Stop Loss' : 'Target';
          const newVal = dragState.type === 'sl' ? pos.sl : pos.target;
          const endpoint = dragState.type === 'sl' ? '/api/position/sl' : '/api/position/target';
          const payload = dragState.type === 'sl' ? { new_sl: newVal } : { new_target: newVal };

          positionPanel._showModal(
            'Modify ' + label + '?',
            'Change ' + label + ' to \u20B9' + (newVal ? newVal.toFixed(2) : '—') + '?',
            async () => {
              try {
                const resp = await apiFetch(endpoint, {
                  method: 'POST',
                  body: JSON.stringify(payload)
                });
                if (resp && resp.ok) {
                  positionPanel._showMsg(label + ' modified to \u20B9' + (newVal ? newVal.toFixed(2) : '—'), 'success');
                } else {
                  positionPanel._showMsg('Failed to modify ' + label, 'error');
                }
              } catch (e) {
                positionPanel._showMsg('Failed to modify ' + label, 'error');
              }
            }
          );
        }
        dragState = null;
        return;
      }

      if (!pos || !pos.active) return;
      if (!pos.entry_price) return;

      const slDist = pos.sl ? Math.abs(price - pos.sl) : Infinity;
      const tpDist = pos.target ? Math.abs(price - pos.target) : Infinity;
      const threshold = 5;

      if (slDist < threshold) {
        dragState = { type: 'sl', startPrice: pos.sl };
      } else if (tpDist < threshold) {
        dragState = { type: 'target', startPrice: pos.target };
      }
    });
  }

  setTimeout(initDragLines, 1000);

  // ── Auto Chart Symbol Based on Position ──
  function autoDetectChartSymbol() {
    const pos = state.get('position');
    if (pos && pos.active) {
      const symbol = pos.symbol || 'NIFTY';
      const strike = pos.strike || '';
      const optType = pos.opt_type || '';
      document.getElementById('chart-symbol').textContent = symbol + ' ' + strike + ' ' + optType;
    }
  }

  state.on('position', autoDetectChartSymbol);

  // ── Window Resize ──
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (chart.chart) {
        const container = document.getElementById('tv-chart');
        if (container) {
          chart.chart.resize(container.clientWidth, container.clientHeight);
        }
      }
    }, 100);
  });

  // ── Cleanup on page unload ──
  window.addEventListener('beforeunload', () => {
    clearAllIntervals();
    chart.destroy();
    ws.disconnect();
  });

  console.log('[Terminal] Advanced Trading Terminal initialized');
})();
