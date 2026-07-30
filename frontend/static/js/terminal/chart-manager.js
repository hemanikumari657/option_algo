class ChartManager {
  constructor(state, ws) {
    this.state = state;
    this.ws = ws;
    this.chart = null;
    this.candleSeries = null;
    this.entryLine = null;
    this.slLine = null;
    this.targetLine = null;
    this.emaLine = null;
    this.vwapLine = null;
    this.supertrendLine = null;
    this.timeframe = '1m';
    this.candles = [];
    this._destroyed = false;
    this._init();
  }

  _init() {
    const container = document.getElementById('tv-chart');
    if (!container) {
      console.error('[Chart] #tv-chart container not found');
      return;
    }

    try {
      this.chart = LightweightCharts.createChart(container, {
        layout: {
          background: { type: 'solid', color: '#080d1a' },
          textColor: '#64748b',
          fontSize: 11,
          fontFamily: "'Segoe UI', system-ui, sans-serif"
        },
        grid: {
          vertLines: { color: '#1a2332', style: 1 },
          horzLines: { color: '#1a2332', style: 1 }
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: { color: '#3b82f6', width: 1, style: 2, labelBackgroundColor: '#1e3a5f' },
          horzLine: { color: '#3b82f6', width: 1, style: 2, labelBackgroundColor: '#1e3a5f' }
        },
        rightPriceScale: {
          borderColor: '#1a2332',
          scaleMargins: { top: 0.05, bottom: 0.15 }
        },
        timeScale: {
          borderColor: '#1a2332',
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 8,
          barSpacing: 6,
          shiftVisibleRangeOnNewBar: true
        },
        handleScroll: { vertTouchDrag: false },
        handleScale: { pinch: true, mouseWheel: true }
      });
    } catch (e) {
      console.error('[Chart] Failed to create chart:', e);
      return;
    }

    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#10b981',
      wickDownColor: '#ef4444',
      wickUpColor: '#10b981',
      priceFormat: { type: 'price', precision: 2, minMove: 0.05 }
    });

    this.chart.timeScale().fitContent();

    this._resizeHandler = () => {
      if (this._destroyed || !this.chart) return;
      const container = document.getElementById('tv-chart');
      if (container) {
        this.chart.resize(container.clientWidth, container.clientHeight);
      }
    };

    window.addEventListener('resize', this._resizeHandler);

    this.state.on('position', pos => this._updateOverlays(pos));
    this.ws.on('candle_update', data => this._onCandleUpdate(data));
    this.ws.on('tick', data => this._onTick(data));
  }

  setTimeframe(tf) {
    this.timeframe = tf;
    if (this._destroyed) return;
    document.querySelectorAll('.tf-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tf === tf);
    });
  }

  setCandles(candles) {
    if (this._destroyed || !this.chart || !this.candleSeries) return;
    if (!candles || !candles.length) return;
    this.candles = candles;
    const mapped = candles.map(c => ({
      time: Math.floor(new Date(c.time || c.timestamp || c.ts).getTime() / 1000),
      open: c.open || c.o,
      high: c.high || c.h,
      low: c.low || c.l,
      close: c.close || c.c
    })).filter(c => c.time && c.open && c.close);

    if (mapped.length > 0) {
      try { this.candleSeries.setData(mapped); } catch (e) { console.error('[Chart] setData error:', e); }
    }
  }

  addCandle(candle) {
    if (this._destroyed || !this.chart || !this.candleSeries) return;
    if (!candle) return;
    const mapped = {
      time: Math.floor(new Date(candle.time || candle.timestamp).getTime() / 1000),
      open: candle.open || candle.o,
      high: candle.high || candle.h,
      low: candle.low || candle.l,
      close: candle.close || candle.c
    };
    if (!mapped.time || !mapped.open) return;
    try { this.candleSeries.update(mapped); } catch (e) { /* candle may already exist */ }
  }

  _onCandleUpdate(data) {
    this.addCandle(data);
  }

  _onTick(data) {
    if (this._destroyed || !this.chart || !this.candleSeries) return;
    const candles = this.candles;
    if (!candles || candles.length === 0) return;
    const last = candles[candles.length - 1];
    if (!last || !last.close) return;

    const ltp = data.ltp || data.price || 0;
    if (ltp <= 0) return;

    const open = last.open || last.o || 0;
    const high = Math.max((last.high || last.h || 0), ltp);
    const low = Math.min((last.low || last.l || Infinity), ltp);

    if (open > 0) {
      try {
        this.candleSeries.update({
          time: Math.floor(new Date(last.time || last.timestamp).getTime() / 1000),
          open: open,
          high: high,
          low: low,
          close: ltp
        });
      } catch (e) { /* ignore update errors on tick */ }
    }
  }

  setIndicators(data) {
    if (this._destroyed || !this.chart) return;

    const ema = data.ema || data.ema9 || data.ema_9;
    if (ema && Array.isArray(ema) && ema.length > 0) {
      if (!this.emaLine) {
        this.emaLine = this.chart.addLineSeries({
          color: '#f59e0b',
          lineWidth: 1,
          priceFormat: { type: 'price', precision: 2, minMove: 0.05 },
          title: 'EMA'
        });
      }
      this.emaLine.setData(ema.map(d => ({
        time: Math.floor(new Date(d.time || d.timestamp).getTime() / 1000),
        value: d.value || d.ema || d
      })));
    }

    const vwap = data.vwap;
    if (vwap && Array.isArray(vwap) && vwap.length > 0) {
      if (!this.vwapLine) {
        this.vwapLine = this.chart.addLineSeries({
          color: '#8b5cf6',
          lineWidth: 1,
          priceFormat: { type: 'price', precision: 2, minMove: 0.05 },
          title: 'VWAP'
        });
      }
      this.vwapLine.setData(vwap.map(d => ({
        time: Math.floor(new Date(d.time || d.timestamp).getTime() / 1000),
        value: d.value || d.vwap || d
      })));
    }
  }

  _updateOverlays(pos) {
    if (this._destroyed || !this.chart) return;
    this._removeLines();

    if (!pos || !pos.active) return;

    const entry = pos.entry_price;
    const sl = pos.sl;
    const target = pos.target;
    const candleTime = this._getLastCandleTime();

    if (entry) {
      this.entryLine = this.chart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        priceFormat: { type: 'price', precision: 2, minMove: 0.05 },
        title: `Entry ${entry}`
      });
      this.entryLine.setData([{ time: candleTime, value: entry }]);
    }

    if (sl) {
      this.slLine = this.chart.addLineSeries({
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid,
        priceFormat: { type: 'price', precision: 2, minMove: 0.05 },
        title: `SL ${sl}`
      });
      this.slLine.setData([{ time: candleTime, value: sl }]);
    }

    if (target) {
      this.targetLine = this.chart.addLineSeries({
        color: '#10b981',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid,
        priceFormat: { type: 'price', precision: 2, minMove: 0.05 },
        title: `Target ${target}`
      });
      this.targetLine.setData([{ time: candleTime, value: target }]);
    }
  }

  _getLastCandleTime() {
    const candles = this.candles;
    if (candles && candles.length > 0) {
      const ts = candles[candles.length - 1].time || candles[candles.length - 1].timestamp;
      if (ts) return Math.floor(new Date(ts).getTime() / 1000);
    }
    return Math.floor(Date.now() / 1000);
  }

  _removeLines() {
    if (!this.chart) return;
    if (this.entryLine) { try { this.chart.removeSeries(this.entryLine); } catch(e) {} this.entryLine = null; }
    if (this.slLine) { try { this.chart.removeSeries(this.slLine); } catch(e) {} this.slLine = null; }
    if (this.targetLine) { try { this.chart.removeSeries(this.targetLine); } catch(e) {} this.targetLine = null; }
  }

  destroy() {
    this._destroyed = true;
    window.removeEventListener('resize', this._resizeHandler);
    this._removeLines();
    if (this.emaLine) { try { this.chart.removeSeries(this.emaLine); } catch(e) {} this.emaLine = null; }
    if (this.vwapLine) { try { this.chart.removeSeries(this.vwapLine); } catch(e) {} this.vwapLine = null; }
    if (this.chart) {
      try { this.chart.remove(); } catch(e) {}
      this.chart = null;
    }
    this.candleSeries = null;
    this.candles = [];
  }
}
