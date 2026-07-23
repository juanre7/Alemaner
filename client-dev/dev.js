// Modo Dev: Consola de Telemetría (§4.6). Este módulo SOLO se sirve en
// desarrollo (/dev/*); en producción no existe y la app lo ignora.
// Todas las métricas son reales: bus de eventos de la app + Performance API.

export function initDevMode(devApi) {
  const { bus } = devApi;

  // Hoja de estilos propia del Modo Dev.
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/dev/dev.css';
  document.head.append(link);

  // ---------------------------------------------------------------------
  // Estado de telemetría (de la consulta actual/última)
  // ---------------------------------------------------------------------
  const tl = {
    phases: [],        // [{name, t}] ms acumulados desde t0
    logs: [],
    requestBody: null,
    responseJson: null,
    elapsed: null,
    ttft: null,
    direction: null,
    stream: false,
    status: 'idle',    // idle | busy | ok | error
  };

  // ---------------------------------------------------------------------
  // DOM de la consola
  // ---------------------------------------------------------------------
  const slot = document.getElementById('telemetry-slot');
  const wrap = document.createElement('div');
  wrap.className = 'telemetry-wrap';
  const inner = document.createElement('div');
  inner.className = 'telemetry-inner';
  const panel = document.createElement('div');
  panel.className = 'telemetry';
  inner.append(panel);
  wrap.append(inner);
  slot.append(wrap);

  // -- Cabecera
  const head = div('tl-head');
  const light = div('tl-light idle');
  const title = span('tl-title', 'TELEMETRÍA');
  const directionEl = span('tl-direction', '—');
  head.append(light, title, directionEl);
  panel.append(head);

  // -- Controles: streaming, modelo, limpiar
  const controls = div('tl-controls');

  const streamControl = document.createElement('label');
  streamControl.className = 'tl-control';
  const switchWrap = document.createElement('span');
  switchWrap.className = 'tl-switch';
  const streamInput = document.createElement('input');
  streamInput.type = 'checkbox';
  streamInput.checked = devApi.getStreaming();
  const slider = span('tl-slider', '');
  switchWrap.append(streamInput, slider);
  const streamLabel = span('', 'Streaming OFF');
  streamControl.append(switchWrap, streamLabel);
  streamInput.addEventListener('change', () => {
    devApi.setStreaming(streamInput.checked);
    streamLabel.textContent = `Streaming ${streamInput.checked ? 'ON' : 'OFF'}`;
    pushLog('client', `Modo de entrega: ${streamInput.checked ? 'streaming (SSE)' : 'buffer'}`);
    renderLogs();
  });
  controls.append(streamControl);

  const modelControl = document.createElement('label');
  modelControl.className = 'tl-control';
  modelControl.append(span('', 'Modelo:'));
  const modelSelect = document.createElement('select');
  modelSelect.className = 'tl-select';
  modelControl.append(modelSelect);
  controls.append(modelControl);
  modelSelect.addEventListener('change', () => {
    devApi.setModel(modelSelect.value);
    pushLog('client', `Modelo seleccionado: ${modelSelect.value}`);
    renderLogs();
  });

  // Selector poblado por GET /api/models (solo existe en dev).
  fetch('/api/models')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(({ models, default: def }) => {
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        if (m === def) opt.selected = true;
        modelSelect.append(opt);
      }
      devApi.setModel(modelSelect.value);
    })
    .catch(() => {
      modelControl.hidden = true;
    });

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'tl-clear';
  clearBtn.textContent = 'Limpiar consola';
  clearBtn.addEventListener('click', () => {
    tl.phases = [];
    tl.logs = [];
    tl.requestBody = null;
    tl.responseJson = null;
    tl.elapsed = null;
    tl.ttft = null;
    tl.direction = null;
    tl.status = 'idle';
    renderAll();
  });
  controls.append(clearBtn);
  panel.append(controls);

  // -- Medidores de latencia
  const meters = div('tl-meters');
  const totalMeter = makeMeter('Tiempo total');
  const ttftMeter = makeMeter('TTFT (primer token)');
  meters.append(totalMeter.root, ttftMeter.root);
  panel.append(meters);

  // -- Gráfico de fases
  panel.append(sectionTitle('Fases del fetch'));
  const chart = div('tl-chart');
  const chips = div('tl-chips');
  panel.append(chart, chips);

  // -- Logs
  panel.append(sectionTitle('Logs de eventos'));
  const logsEl = div('tl-logs');
  panel.append(logsEl);

  // -- Payloads
  const payloads = div('tl-payloads');
  const reqPayload = makePayload('Request Body');
  const resPayload = makePayload('Response JSON');
  payloads.append(reqPayload.root, resPayload.root);
  panel.append(payloads);

  // ---------------------------------------------------------------------
  // Toggle Modo Dev en la cabecera (§4.1)
  // ---------------------------------------------------------------------
  const toggle = document.getElementById('dev-toggle');
  toggle.hidden = false;
  let devActive = false;
  toggle.addEventListener('click', () => {
    devActive = !devActive;
    toggle.classList.toggle('active', devActive);
    toggle.setAttribute('aria-pressed', String(devActive));
    wrap.classList.toggle('open', devActive);
  });

  // ---------------------------------------------------------------------
  // Suscripción al bus de la app
  // ---------------------------------------------------------------------
  bus.on((type, data) => {
    switch (type) {
      case 'start':
        tl.phases = [];
        tl.responseJson = null;
        tl.elapsed = null;
        tl.ttft = null;
        tl.direction = data.direction === 'direct' ? 'DE→ES' : 'ES/EN/FR→DE';
        tl.stream = data.stream;
        tl.requestBody = data.requestBody;
        tl.status = 'busy';
        break;
      case 'phase':
        if (data.t !== null) tl.phases.push({ name: data.name, t: data.t });
        break;
      case 'ttft':
        tl.ttft = data.ttft;
        break;
      case 'log':
        pushLog(data.kind, data.msg);
        break;
      case 'response':
        tl.responseJson = data.json;
        break;
      case 'complete':
        tl.elapsed = data.elapsed;
        tl.status = 'ok';
        mergeResourcePhases(data.resource);
        tl.phases.push({ name: 'Render', t: data.elapsed });
        break;
      case 'fail':
        // El gráfico corta la curva en el punto de fallo con la latencia real (§7).
        tl.elapsed = data.elapsed;
        tl.status = 'error';
        tl.phases.push({ name: 'Error', t: data.elapsed, error: true });
        break;
      default:
        return;
    }
    renderAll();
  });

  function mergeResourcePhases(entry) {
    if (!entry) return;
    const rel = (v) => (v > 0 ? v - entry.startTime : 0);
    const resourcePhases = [
      { name: 'DNS', t: rel(entry.domainLookupEnd) },
      { name: 'TLS', t: rel(entry.connectEnd) },
      { name: 'TTFB', t: rel(entry.responseStart) },
      { name: 'Descarga', t: rel(entry.responseEnd) },
    ].filter((p) => p.t > 0);
    tl.phases.push(...resourcePhases);
  }

  function pushLog(kind, msg) {
    tl.logs.push({ kind, msg, ts: new Date() });
    if (tl.logs.length > 200) tl.logs.shift();
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  function renderAll() {
    // Luz de estado y dirección
    light.className = `tl-light ${tl.status}`;
    directionEl.textContent = tl.direction || '—';

    // Medidores: verde rápido / ámbar moderado (§4.6)
    if (tl.elapsed !== null) {
      const secs = (tl.elapsed / 1000).toFixed(2);
      const speedClass = tl.status === 'error' ? 'error' : (tl.elapsed < 2500 ? 'fast' : 'slow');
      totalMeter.set(`${secs}s`, speedClass);
    } else {
      totalMeter.set(tl.status === 'busy' ? '...' : '—', '');
    }
    if (tl.ttft !== null) {
      ttftMeter.set(`${Math.round(tl.ttft)}ms`, tl.ttft < 1200 ? 'fast' : 'slow');
    } else {
      ttftMeter.set(tl.stream && tl.status === 'busy' ? '...' : '—', '');
    }

    renderChart();
    renderLogs();
    reqPayload.set(tl.requestBody);
    resPayload.set(tl.responseJson);
  }

  function renderChart() {
    chart.textContent = '';
    chips.textContent = '';
    const phases = [...tl.phases].sort((a, b) => a.t - b.t);
    if (!phases.length) {
      chart.append(spanC('tl-empty', 'Sin datos: lanza una consulta.'));
      return;
    }

    // Gráfico lineal SVG de tiempo acumulado por fase, generado a mano (§8).
    const W = 560, H = 120, PAD = 14;
    const maxT = Math.max(...phases.map((p) => p.t), 1);
    const x = (i) => PAD + (i * (W - 2 * PAD)) / Math.max(phases.length - 1, 1);
    const y = (t) => H - PAD - (t / maxT) * (H - 2 * PAD);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const points = phases.map((p, i) => `${x(i)},${y(p.t)}`).join(' ');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', points);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', tl.status === 'error' ? '#f87171' : '#4ade80');
    line.setAttribute('stroke-width', '2');
    svg.append(line);

    phases.forEach((p, i) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', x(i));
      dot.setAttribute('cy', y(p.t));
      dot.setAttribute('r', '3.5');
      dot.setAttribute('fill', p.error ? '#f87171' : '#fbbf24');
      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titleEl.textContent = `${p.name}: ${Math.round(p.t)}ms`;
      dot.append(titleEl);
      svg.append(dot);
    });
    chart.append(svg);

    // Chips de delta bajo el gráfico: "TTFB: 850ms · Δ +620ms"
    phases.forEach((p, i) => {
      const chip = spanC(`tl-chip${p.error ? ' error' : ''}`, '');
      chip.append(document.createTextNode(`${p.name}: ${Math.round(p.t)}ms`));
      if (i > 0) {
        const delta = spanC('tl-delta', ` · Δ +${Math.round(p.t - phases[i - 1].t)}ms`);
        chip.append(delta);
      }
      chips.append(chip);
    });
  }

  function renderLogs() {
    logsEl.textContent = '';
    if (!tl.logs.length) {
      logsEl.append(spanC('tl-empty', 'Consola vacía.'));
      return;
    }
    for (const log of tl.logs) {
      const row = div(`tl-log ${log.kind}`);
      const time = log.ts.toLocaleTimeString('es-ES', { hour12: false }) +
        '.' + String(log.ts.getMilliseconds()).padStart(3, '0');
      row.append(spanC('tl-log-time', time), spanC('tl-log-msg', log.msg));
      logsEl.append(row);
    }
    logsEl.scrollTop = logsEl.scrollHeight;
  }

  renderAll();

  // ---------------------------------------------------------------------
  // Helpers DOM (todo texto plano; sin innerHTML con datos dinámicos)
  // ---------------------------------------------------------------------
  function div(className) { const n = document.createElement('div'); n.className = className; return n; }
  function span(className, text) { const n = document.createElement('span'); if (className) n.className = className; n.textContent = text; return n; }
  function spanC(className, text) { return span(className, text); }
  function sectionTitle(text) { return Object.assign(div('tl-section-title'), { textContent: text }); }

  function makeMeter(label) {
    const root = div('tl-meter');
    root.append(spanC('tl-meter-label', label));
    const value = spanC('tl-meter-value', '—');
    root.append(value);
    return {
      root,
      set(text, cls) { value.textContent = text; value.className = `tl-meter-value ${cls}`; },
    };
  }

  function makePayload(label) {
    const root = document.createElement('details');
    root.className = 'tl-payload';
    const summary = document.createElement('summary');
    summary.textContent = label;
    const pre = document.createElement('pre');
    root.append(summary, pre);
    return {
      root,
      set(obj) {
        pre.textContent = '';
        if (obj === null || obj === undefined) { pre.append(spanC('tl-empty', '(vacío)')); return; }
        highlightJson(pre, JSON.stringify(obj, null, 2));
      },
    };
  }

  // Resaltado de sintaxis JSON construyendo spans (nunca innerHTML).
  function highlightJson(pre, jsonText) {
    const regex = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(jsonText)) !== null) {
      if (match.index > lastIndex) {
        pre.append(spanC('tl-json-punct', jsonText.slice(lastIndex, match.index)));
      }
      if (match[1] !== undefined) {
        pre.append(spanC(match[2] ? 'tl-json-key' : 'tl-json-str', match[1]));
        if (match[2]) pre.append(spanC('tl-json-punct', match[2]));
      } else if (match[3] !== undefined) {
        pre.append(spanC('tl-json-num', match[3]));
      } else if (match[4] !== undefined) {
        pre.append(spanC('tl-json-bool', match[4]));
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < jsonText.length) {
      pre.append(spanC('tl-json-punct', jsonText.slice(lastIndex)));
    }
  }
}
