class PositionPanel {
  constructor(state, ws) {
    this.state = state;
    this.ws = ws;

    this.state.on('position', pos => this._updatePosition(pos));
    this.state.on('strategy', strat => this._updateStrategy(strat));
    this.state.on('today', today => this._updateToday(today));
    this.state.on('spot', spot => this._onSpotUpdate(spot));
    this.state.on('trade', trade => this._updateTradeStatus(trade));

    this._bindEvents();
    this._pnlThrottleTimer = null;
    this._modalActive = false;
  }

  _updatePosition(pos) {
    const g = (id) => document.getElementById(id);
    if (!g('pd-qty')) return;

    g('pd-qty').textContent = pos.qty || '—';
    g('pd-entry').textContent = pos.entry_price ? '\u20B9' + Number(pos.entry_price).toFixed(2) : '—';
    g('pd-curr').textContent = pos.current_price ? '\u20B9' + Number(pos.current_price).toFixed(2) : '—';
    g('pd-strategy').textContent = pos.strategy || this.state.get('strategy').name || '—';
    g('pd-exec-mode').textContent = pos.mode || '—';

    const pnlEl = g('pd-pnl');
    const roiEl = g('pd-roi');

    if (pos.active) {
      const pnl = pos.pnl || 0;
      pnlEl.textContent = (pnl >= 0 ? '+' : '') + '\u20B9' + Number(pnl).toFixed(2);
      pnlEl.className = 'pd-val pd-pnl ' + (pnl >= 0 ? 'pos' : 'neg');
      roiEl.textContent = (pos.roi >= 0 ? '+' : '') + Number(pos.roi).toFixed(2) + '%';
      roiEl.className = 'pd-val ' + (pos.roi >= 0 ? 'pos' : 'neg');

      g('pd-holding').textContent = (pos.holding_time || 0) ? pos.holding_time + 'm' : '—';
      g('pd-strategy').textContent = pos.strategy || this.state.get('strategy').name || '—';
      g('pd-exec-mode').textContent = pos.mode || '—';

      this._updateSLTarget(pos);
      this._updateFloatingPnL(pos);
      this._updatePositionOverlay(pos);

      g('btn-exit-position').disabled = false;
    } else {
      pnlEl.textContent = '\u20B9' + '0.00';
      pnlEl.className = 'pd-val pd-pnl';
      roiEl.textContent = '0.00%';
      g('pd-holding').textContent = '—';
      g('pd-strategy').textContent = this.state.get('strategy').name || '—';
      g('pd-exec-mode').textContent = this.state.get('trade').mode || '—';

      this._updateSLTarget(null);
      this._updateFloatingPnL(null);
      this._updatePositionOverlay(null);

      g('btn-exit-position').disabled = true;
    }
  }

  _updateSLTarget(pos) {
    const slEl = document.getElementById('st-sl-price');
    const tpEl = document.getElementById('st-tp-price');
    const slPoints = document.getElementById('st-sl-points');
    const tpPoints = document.getElementById('st-tp-points');
    const rrEl = document.getElementById('st-rr');
    if (!slEl) return;

    if (pos && pos.active) {
      const entry = pos.entry_price || 0;
      const sl = pos.sl;
      const target = pos.target;

      slEl.textContent = sl ? '\u20B9' + Number(sl).toFixed(2) : '—';
      tpEl.textContent = target ? '\u20B9' + Number(target).toFixed(2) : '—';

      if (sl && entry) {
        slPoints.textContent = Math.abs(entry - sl).toFixed(2) + ' pts';
      } else {
        slPoints.textContent = '—';
      }
      if (target && entry) {
        tpPoints.textContent = Math.abs(target - entry).toFixed(2) + ' pts';
      } else {
        tpPoints.textContent = '—';
      }

      if (sl && target && entry) {
        const risk = Math.abs(entry - sl);
        const reward = Math.abs(target - entry);
        rrEl.textContent = '1:' + (risk > 0 ? (reward / risk).toFixed(2) : '\u221E');
      } else {
        rrEl.textContent = '—';
      }
    } else {
      slEl.textContent = '—';
      tpEl.textContent = '—';
      slPoints.textContent = '—';
      tpPoints.textContent = '—';
      rrEl.textContent = '—';
    }
  }

  _updateFloatingPnL(pos) {
    const el = document.getElementById('pnl-float');
    if (!el) return;
    if (pos && pos.active) {
      const pnl = pos.pnl || 0;
      el.textContent = (pnl >= 0 ? '+' : '') + '\u20B9' + Number(pnl).toFixed(2);
      el.className = 'pnl-float ' + (pnl >= 0 ? 'pos' : 'neg');
    } else {
      el.textContent = '+\u20B9' + '0.00';
      el.className = 'pnl-float';
    }
  }

  _updatePositionOverlay(pos) {
    const overlay = document.getElementById('pos-overlay');
    if (!overlay) return;
    if (pos && pos.active) {
      overlay.style.display = 'block';
      document.getElementById('po-entry').textContent = '\u20B9' + Number(pos.entry_price).toFixed(2);
      document.getElementById('po-qty').textContent = pos.qty || 0;
      document.getElementById('po-sl').textContent = pos.sl ? '\u20B9' + Number(pos.sl).toFixed(2) : '—';
      document.getElementById('po-target').textContent = pos.target ? '\u20B9' + Number(pos.target).toFixed(2) : '—';
    } else {
      overlay.style.display = 'none';
    }
  }

  _onSpotUpdate(spot) {
    if (this._pnlThrottleTimer) return;
    this._pnlThrottleTimer = setTimeout(() => {
      this._pnlThrottleTimer = null;
      this._updatePnL();
    }, 100);
  }

  _updatePnL() {
    const pos = this.state.get('position');
    if (!pos || !pos.active) return;

    const spot = this.state.get('spot');
    const optionType = (pos.opt_type || '').toUpperCase();
    const multiplier = optionType === 'PE' ? -1 : 1;
    const entry = pos.entry_price || 0;
    const ltp = spot.ltp || 0;

    if (entry <= 0 || ltp <= 0) return;

    const pnl = pos.qty * (ltp - entry) * multiplier;
    const roi = entry > 0 ? ((ltp - entry) / entry) * 100 * multiplier : 0;

    this.state.set('position', {
      ...pos,
      pnl: pnl,
      roi: roi,
      current_price: ltp
    });
  }

  _updateStrategy(strat) {
    const badge = document.getElementById('active-strategy-badge');
    const dot = document.getElementById('strategy-status-dot');
    if (!badge) return;

    if (strat && strat.name) {
      badge.textContent = strat.name;
      badge.style.background = 'linear-gradient(135deg, #3b82f6, #8b5cf6)';
      dot.style.color = '#22c55e';
    } else {
      badge.textContent = 'No Active Strategy';
      badge.style.background = 'rgba(100,116,139,0.2)';
      dot.style.color = '#64748b';
    }

    document.getElementById('sd-signal-type').textContent = strat.signal_type || '—';
    document.getElementById('sd-entry-price').textContent = strat.entry_price ? '\u20B9' + Number(strat.entry_price).toFixed(2) : '—';
    document.getElementById('sd-signal-time').textContent = strat.signal_time ? new Date(strat.signal_time).toLocaleTimeString() : '—';
    document.getElementById('sd-confidence').textContent = strat.confidence ? strat.confidence + '%' : '—';
    document.getElementById('sd-reason').textContent = strat.reason || '—';
  }

  _updateToday(today) {
    document.getElementById('td-trades').textContent = today.trades || 0;
    document.getElementById('td-wins').textContent = today.wins || 0;
    const pnlEl = document.getElementById('td-pnl');
    if (pnlEl) {
      const pnl = today.pnl || 0;
      pnlEl.textContent = (pnl >= 0 ? '+' : '') + '\u20B9' + Number(pnl).toFixed(2);
      pnlEl.className = 'td-val td-pnl ' + (pnl >= 0 ? 'pos' : 'neg');
    }
    document.getElementById('td-wr').textContent = today.win_rate ? Number(today.win_rate).toFixed(1) + '%' : '0%';
  }

  _updateTradeStatus(trade) {
    document.getElementById('ts-mode').textContent = trade.mode || '—';
    document.getElementById('ts-status').textContent = trade.status || 'No Position';
    document.getElementById('ts-direction').textContent = trade.direction || '—';
    document.getElementById('ts-quantity').textContent = trade.quantity || '—';
    document.getElementById('pos-mode-badge-terminal').textContent = trade.mode || '—';
  }

  _bindEvents() {
    document.getElementById('btn-exit-position').addEventListener('click', () => this._confirmExit());
    document.getElementById('btn-reset-sl').addEventListener('click', () => this._confirmReset('sl'));
    document.getElementById('btn-reset-target').addEventListener('click', () => this._confirmReset('target'));
    document.getElementById('btn-reset-both').addEventListener('click', () => this._confirmReset('both'));
  }

  _confirmExit() {
    this._showModal(
      'Exit Position',
      'Are you sure you want to exit this position?',
      () => this._executeExit()
    );
  }

  async _executeExit() {
    try {
      const resp = await apiFetch('/api/position/squareoff', {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (resp && resp.ok) {
        this._showMsg('Exit command sent', 'success');
      } else {
        const err = resp ? await resp.json().catch(() => ({})) : {};
        this._showMsg(err.detail || 'Failed to send exit command', 'error');
      }
    } catch (e) {
      this._showMsg('Error exiting position: ' + e.message, 'error');
    }
  }

  _confirmReset(type) {
    const labels = { sl: 'Stop Loss', target: 'Target', both: 'SL & Target' };
    this._showModal(
      'Reset ' + labels[type],
      'Reset ' + labels[type] + ' to strategy-calculated defaults?',
      () => this._executeReset(type)
    );
  }

  async _executeReset(type) {
    try {
      if (type === 'sl' || type === 'both') {
        await apiFetch('/api/position/sl', { method: 'POST', body: JSON.stringify({ new_sl: 0 }) });
      }
      if (type === 'target' || type === 'both') {
        await apiFetch('/api/position/target', { method: 'POST', body: JSON.stringify({ new_target: 0 }) });
      }
      this._showMsg(type.charAt(0).toUpperCase() + type.slice(1) + ' reset sent', 'success');
    } catch (e) {
      this._showMsg('Failed to reset', 'error');
    }
  }

  _showModal(title, message, onConfirm) {
    if (this._modalActive) return;
    this._modalActive = true;

    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').style.display = 'flex';

    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');

    const cleanup = () => {
      this._modalActive = false;
      document.getElementById('confirm-modal').style.display = 'none';
      cancelBtn.removeEventListener('click', cleanup);
      okBtn.removeEventListener('click', onOk);
    };

    const onOk = () => {
      cleanup();
      if (onConfirm) onConfirm();
    };

    cancelBtn.addEventListener('click', cleanup);
    okBtn.addEventListener('click', onOk);
  }

  _showMsg(text, type) {
    const el = document.getElementById('action-msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'msg ' + (type || 'info');
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
  }
}
