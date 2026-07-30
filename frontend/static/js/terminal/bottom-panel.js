function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class BottomPanel {
  constructor(state, ws) {
    this.state = state;
    this.ws = ws;

    this.state.on('trades', trades => this._updateTradeLog(trades));
    this.state.on('signals', signals => this._updateSignalHistory(signals));
    this.state.on('events', events => this._updateEventTimeline(events));

    this._bindTabs();
  }

  _bindTabs() {
    document.querySelectorAll('.bt-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.bt-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.bc-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.getElementById('panel-' + tab.dataset.tab);
        if (panel) panel.classList.add('active');
      });
    });
  }

  _updateTradeLog(trades) {
    const body = document.getElementById('trade-log-body');
    if (!body) return;
    if (!trades || !trades.length) {
      body.innerHTML = '<tr><td colspan="8" class="muted center" style="padding:20px">No trades yet</td></tr>';
      return;
    }
    body.innerHTML = trades.slice(0, 50).map(t => {
      const pnl = t.pnl || 0;
      return '<tr>' +
        '<td>' + escHtml(t.entry_ts ? new Date(t.entry_ts).toLocaleTimeString() : '—') + '</td>' +
        '<td>' + escHtml(t.trading_symbol || t.symbol || '—') + '</td>' +
        '<td class="' + (t.opt_type === 'CE' ? 'green' : 'red') + '">' + escHtml(t.opt_type || '—') + '</td>' +
        '<td>' + (t.entry_price ? escHtml('\u20B9' + Number(t.entry_price).toFixed(2)) : '—') + '</td>' +
        '<td>' + (t.exit_price ? escHtml('\u20B9' + Number(t.exit_price).toFixed(2)) : '—') + '</td>' +
        '<td class="' + (pnl >= 0 ? 'green' : 'red') + '">' + escHtml((pnl >= 0 ? '+' : '') + '\u20B9' + Number(pnl).toFixed(2)) + '</td>' +
        '<td>' + escHtml(t.status || '—') + '</td>' +
        '<td>' + escHtml(t.strategy || '—') + '</td>' +
        '</tr>';
    }).join('');
  }

  _updateSignalHistory(signals) {
    const body = document.getElementById('signal-history-body');
    if (!body) return;
    if (!signals || !signals.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted center" style="padding:20px">No signals yet</td></tr>';
      return;
    }
    body.innerHTML = signals.slice(0, 50).map(s => {
      const sigType = s.signal_type || '';
      const isCE = sigType.includes('CE') || sigType.includes('BUY');
      return '<tr>' +
        '<td>' + escHtml(s.time ? new Date(s.time).toLocaleTimeString() : '—') + '</td>' +
        '<td>' + escHtml(s.strategy || '—') + '</td>' +
        '<td class="' + (isCE ? 'green' : 'red') + '">' + escHtml(sigType) + '</td>' +
        '<td>' + escHtml(s.symbol || '—') + '</td>' +
        '<td>' + (s.price ? escHtml('\u20B9' + Number(s.price).toFixed(2)) : '—') + '</td>' +
        '<td>' + (s.confidence ? escHtml(s.confidence + '%') : '—') + '</td>' +
        '<td>' + escHtml(s.status || '—') + '</td>' +
        '</tr>';
    }).join('');
  }

  _updateEventTimeline(events) {
    const container = document.getElementById('event-timeline');
    if (!container) return;
    if (!events || !events.length) {
      container.innerHTML = '<div class="muted center" style="padding:20px">No events yet</div>';
      return;
    }
    container.innerHTML = events.slice(0, 100).map(e => {
      const typeClass = (e.type || '').toLowerCase().replace(/_/g, '-');
      const time = e.time ? new Date(e.time).toLocaleTimeString() : '—';
      const type = e.type || 'EVENT';
      const desc = e.description || '';
      return '<div class="event-item event-' + escHtml(typeClass) + '">' +
        '<span class="event-time">' + escHtml(time) + '</span>' +
        '<span class="event-type">' + escHtml(type) + '</span>' +
        '<span class="event-desc">' + escHtml(desc) + '</span>' +
        '</div>';
    }).join('');
  }

  addTrade(trade) {
    const trades = this.state.get('trades');
    trades.unshift(trade);
    if (trades.length > 200) trades.length = 200;
    this.state.set('trades', trades);
  }

  addSignal(signal) {
    const signals = this.state.get('signals');
    signals.unshift(signal);
    if (signals.length > 200) signals.length = 200;
    this.state.set('signals', signals);
  }

  addEvent(event) {
    const events = this.state.get('events');
    events.unshift(event);
    if (events.length > 200) events.length = 200;
    this.state.set('events', events);
  }
}
