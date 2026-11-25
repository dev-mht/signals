/* CED Signals — alertes sonores (patch 16, étape 1 : bougies vectorielles)
 *
 * Fichier autonome, chargé APRÈS le script de index.html (une seule ligne ajoutée dans index.html).
 * Il réutilise les fonctions déjà présentes dans la page : SYMBOL, SPOT_HOSTS, PERP_HOST, getJSON,
 * toBars, CED, TFS, LABEL, storageGet, storageSet. Il fait ses propres lectures Binance,
 * donc il ne dépend ni du timeframe affiché ni de l'onglet visible.
 */
(() => {
  'use strict'
  if (window.__cedAlerts) return
  window.__cedAlerts = true

  const KEY = 'ced.alerts.v1'
  const TF_LIST = TFS.filter(d => !d.noVec).map(d => d.tf)
  const INTERVAL = { '1m': 10e3, '5m': 15e3, '15m': 20e3, '1h': 30e3, '4h': 60e3, '1d': 120e3, '1w': 300e3 }

  // ── Réglages ──────────────────────────────────────────────────────────────
  function defaults() {
    return {
      master: true,
      vec: {
        on: true, filter: 'power', sound: 'bell', vol: 0.7, soft: true, valid: true,
        tfs: { '1m': false, '5m': false, '15m': true, '1h': true, '4h': true, '1d': true, '1w': false }
      }
    }
  }
  function load() {
    const d = defaults()
    try {
      const s = JSON.parse(storageGet(KEY))
      if (s) {
        d.master = s.master !== false
        if (s.vec) {
          const tfs = Object.assign({}, d.vec.tfs, s.vec.tfs || {})
          Object.assign(d.vec, s.vec)
          d.vec.tfs = tfs
        }
      }
    } catch (e) { /* réglages illisibles : valeurs par défaut */ }
    return d
  }
  const S = load()
  const save = () => storageSet(KEY, JSON.stringify(S))

  const FILTERS = [
    ['all', 'Toutes les vectorielles (150 % et plus)'],
    ['power', 'Les puissantes seulement (200 % et plus)'],
    ['extreme', 'Les extrêmes seulement (300 % et plus)'],
    ['pink', 'Roses et oranges : vendeur fort (200 % et plus)'],
    ['rev', 'Retournement : delta contre le sens de la bougie (200 % et plus)']
  ]

  // ── Sons (générés par le navigateur, aucun fichier) ───────────────────────
  // note = [fréquence Hz, début s, durée s, forme d'onde, volume relatif]
  const SOUNDS = {
    bell: { label: 'Cloche', notes: [[880, 0, 0.9, 'sine', 1], [1320, 0, 0.6, 'sine', 0.4]] },
    ping: { label: 'Bip court', notes: [[1200, 0, 0.18, 'sine', 1]] },
    double: { label: 'Double bip', notes: [[1000, 0, 0.14, 'sine', 1], [1000, 0.2, 0.14, 'sine', 1]] },
    chime: { label: 'Montée', notes: [[660, 0, 0.25, 'sine', 1], [880, 0.18, 0.25, 'sine', 1], [1100, 0.36, 0.5, 'sine', 1]] },
    low: { label: 'Grave', notes: [[220, 0, 0.7, 'triangle', 1], [330, 0.05, 0.5, 'sine', 0.5]] },
    alarm: { label: 'Alarme', notes: [[700, 0, 0.18, 'square', 0.5], [900, 0.2, 0.18, 'square', 0.5], [700, 0.4, 0.18, 'square', 0.5], [900, 0.6, 0.18, 'square', 0.5]] }
  }
  let ctx = null
  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      try { ctx = new AC() } catch (e) { return null }
    }
    return ctx
  }
  const audioOn = () => !!ctx && ctx.state === 'running'
  function unlock() {
    const c = ensureCtx()
    if (c && c.state === 'suspended') c.resume().then(refreshUi, () => {})
    refreshUi()
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, unlock, true)

  function tone(c, out, f, t0, dur, type, g) {
    const o = c.createOscillator(), a = c.createGain()
    o.type = type
    o.frequency.setValueAtTime(f, t0)
    a.gain.setValueAtTime(0.0001, t0)
    a.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), t0 + 0.012)
    a.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(a); a.connect(out)
    o.start(t0); o.stop(t0 + dur + 0.05)
  }
  // joue un son ; renvoie sa durée en secondes, ou -1 si le son est bloqué par le navigateur
  function play(name, vol, pitch, strong) {
    const c = ensureCtx()
    if (!c || c.state !== 'running') return -1
    const s = SOUNDS[name] || SOUNDS.bell
    const master = c.createGain()
    master.gain.value = Math.max(0, Math.min(1, vol)) * 0.5
    master.connect(c.destination)
    const reps = strong ? 2 : 1
    const span = Math.max(...s.notes.map(n => n[1] + n[2])) + 0.15
    const t = c.currentTime + 0.02
    for (let r = 0; r < reps; r++) {
      for (const [f, off, dur, type, g] of s.notes) tone(c, master, f * pitch, t + r * span + off, dur, type, g * (strong ? 1 : 0.5))
    }
    return reps * span
  }
  const queue = []
  let draining = false
  function enqueue(item) { queue.push(item); if (!draining) drain() }
  function drain() {
    const it = queue.shift()
    if (!it) { draining = false; return }
    draining = true
    const d = play(it.sound, it.vol, it.pitch, it.strong)
    setTimeout(drain, d > 0 ? d * 1000 + 120 : 0)
  }
  const PITCH_BULL = 1.1, PITCH_BEAR = 0.82

  // ── Détection ─────────────────────────────────────────────────────────────
  function evalVec(prev10, bar) {
    const v = CED.vector(prev10, bar)
    // retournement : le delta (qui a frappé au marché) va contre le sens de la bougie
    return { tier: v.tier, ratio: v.ratio, dir: v.dir, rev: bar ? (bar.c >= bar.o) !== (v.dir > 0) : false }
  }
  function vecMatch(v, f) {
    if (!v.tier) return false
    switch (f) {
      case 'all': return true
      case 'power': return v.tier >= 2
      case 'extreme': return v.tier >= 3
      case 'pink': return v.dir < 0 && v.tier >= 2
      case 'rev': return v.tier >= 2 && v.rev
    }
    return false
  }
  async function fetchBars(tf, n) {
    const q = `symbol=${SYMBOL}&interval=${tf}&limit=${n}`
    let spot, err
    for (const h of SPOT_HOSTS) {
      try { spot = await getJSON(`${h}/api/v3/klines?${q}`); break } catch (e) { err = e }
    }
    if (!spot) throw err || new Error('spot injoignable')
    let perp = null
    try { perp = await getJSON(`${PERP_HOST}/fapi/v1/klines?${q}`) } catch (e) { /* spot seul */ }
    return toBars(spot, perp)
  }

  const ST = {}
  let lastOk = 0, lastErr = ''
  function prune(set) { while (set.size > 60) set.delete(set.values().next().value) }

  async function poll(tf) {
    const s = ST[tf] || (ST[tf] = { last: 0, busy: false, base: false, soft: new Set(), valid: new Set() })
    if (s.busy) return
    s.busy = true; s.last = Date.now()
    try {
      const bars = await fetchBars(tf, 16)
      if (bars.length < 13) return
      // le dernier élément renvoyé par Binance est toujours la bougie en cours
      const forming = bars[bars.length - 1]
      const closed = bars.slice(0, -1)
      const lc = closed[closed.length - 1]
      const f = S.vec.filter

      const rf = evalVec(closed.slice(-10), forming)
      if (vecMatch(rf, f) && !s.soft.has(forming.t)) {
        s.soft.add(forming.t); prune(s.soft)
        if (s.base && S.vec.soft) fire('soft', tf, rf)
      }
      if (!s.valid.has(lc.t)) {
        s.valid.add(lc.t); prune(s.valid)
        const rc = evalVec(closed.slice(-11, -1), lc)
        if (vecMatch(rc, f) && s.base && S.vec.valid) fire('valid', tf, rc)
      }
      s.base = true
      lastOk = Date.now(); lastErr = ''
    } catch (e) {
      lastErr = e.message || String(e)
    } finally {
      s.busy = false
      refreshStatus()
    }
  }

  const LOG = []
  let flashTimer = null
  function fire(kind, tf, v) {
    const strong = kind === 'valid'
    const bull = v.dir > 0
    const played = audioOn()
    enqueue({ sound: S.vec.sound, vol: S.vec.vol, pitch: bull ? PITCH_BULL : PITCH_BEAR, strong })
    const name = (bull ? 'BULL ' : 'BEAR ') + ['', 'MID', 'HIGH', 'EXTREME'][v.tier]
    LOG.unshift({ ts: Date.now(), tf, kind, bull, text: `${LABEL[tf]} · ${name} · ${Math.round(v.ratio * 100)} %${v.rev ? ' · retournement' : ''}`, muted: !played })
    if (LOG.length > 12) LOG.pop()
    const btn = document.getElementById('alBtn')
    if (btn) {
      const lbl = document.getElementById('alLbl')
      btn.classList.add('flash'); lbl.textContent = `🔔 ${LABEL[tf]} ${bull ? '▲' : '▼'} ${strong ? 'validé' : 'en cours'}`
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => { btn.classList.remove('flash'); lbl.textContent = '🔔 Alertes' }, 20e3)
    }
    renderLog()
  }

  function tick(force) {
    if (!S.master || !S.vec.on) return
    const now = Date.now()
    for (const tf of TF_LIST) {
      if (!S.vec.tfs[tf]) continue
      const s = ST[tf]
      if (force || !s || now - s.last >= (INTERVAL[tf] || 30e3)) poll(tf)
    }
  }
  // le minuteur tourne dans un worker : il n'est pas ralenti quand l'onglet est en arrière-plan
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},4000)'], { type: 'text/javascript' }))
    const w = new Worker(url)
    let fallback = null
    w.onmessage = () => tick(false)
    w.onerror = () => { if (!fallback) fallback = setInterval(() => tick(false), 4000) }
  } catch (e) { setInterval(() => tick(false), 4000) }

  // ── Interface ─────────────────────────────────────────────────────────────
  const css = document.createElement('style')
  css.textContent = `
  .al-btn { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); border-radius: 5px; font: 600 12px var(--mono); padding: 3px 9px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .al-btn i { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); display: inline-block; }
  .al-btn.ok i { background: var(--bull); } .al-btn.warn i { background: var(--gold); }
  .al-btn.flash { border-color: var(--gold); color: var(--gold); }
  .al-over { position: fixed; inset: 0; background: rgba(8, 10, 18, 0.65); display: none; align-items: flex-start; justify-content: center; z-index: 50; overflow: auto; padding: 14px 8px; }
  .al-over.open { display: flex; }
  .al-card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; width: min(560px, 100%); padding: 12px 14px 14px; }
  .al-h { display: flex; justify-content: space-between; align-items: center; font-weight: 700; letter-spacing: 0.06em; font-size: 13px; }
  .al-x { background: transparent; border: 0; color: var(--muted); font-size: 16px; cursor: pointer; }
  .al-card h3 { margin: 14px 0 6px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .al-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 6px 0; }
  .al-row label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .al-card select, .al-card input[type=range] { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); border-radius: 4px; font: 12px var(--mono); padding: 3px 6px; max-width: 100%; }
  .al-card input[type=range] { padding: 0; width: 150px; }
  .al-tfs { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }
  .al-tfs label { background: var(--panel-2); border: 1px solid var(--line); border-radius: 4px; padding: 3px 9px; font: 600 12px var(--mono); cursor: pointer; display: inline-flex; gap: 5px; align-items: center; }
  .al-b { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); border-radius: 5px; font: 600 12px var(--mono); padding: 4px 10px; cursor: pointer; }
  .al-b.good { color: var(--bull); } .al-b.bad { color: var(--gold); }
  .al-note { font-size: 11.5px; color: var(--muted); margin: 6px 0; }
  .al-log div { display: flex; gap: 10px; font-size: 12px; padding: 2px 0; border-top: 1px solid rgba(44, 52, 80, 0.6); }
  .al-log div:first-child { border-top: 0; }
  .al-log .t { color: var(--faint); font-family: var(--mono); }
  `
  document.head.appendChild(css)

  const over = document.createElement('div')
  over.className = 'al-over'
  over.innerHTML = `<div class="al-card" id="alCard"></div>`
  document.body.appendChild(over)

  const hdr = document.querySelector('header')
  const btn = document.createElement('button')
  btn.id = 'alBtn'; btn.className = 'al-btn'; btn.innerHTML = '<i></i><span id="alLbl">🔔 Alertes</span>'
  if (hdr) hdr.appendChild(btn)
  btn.addEventListener('click', () => { unlock(); openModal() })

  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')
  function renderModal() {
    const v = S.vec
    document.getElementById('alCard').innerHTML = `
      <div class="al-h"><span>ALERTES SONORES</span><button class="al-x" data-act="close">✕</button></div>
      <div class="al-row">
        <label><input type="checkbox" data-k="master" ${S.master ? 'checked' : ''}> Alertes activées</label>
        <button class="al-b" id="alAudio" data-act="unlock"></button>
      </div>
      <p class="al-note">Son plus aigu = acheteur, plus grave = vendeur. Un son simple et discret = la bougie vient d'atteindre le niveau. Un son double et plus fort = validé à la clôture de la bougie. La page lit Binance toute seule : elle peut rester en arrière-plan, mais l'onglet doit rester ouvert.</p>

      <h3>Bougies vectorielles</h3>
      <div class="al-row"><label><input type="checkbox" data-k="vec.on" ${v.on ? 'checked' : ''}> Alerter sur les bougies vectorielles</label></div>
      <div class="al-row"><span>Lesquelles</span><select data-k="vec.filter">${opt(FILTERS, v.filter)}</select></div>
      <div class="al-note">Unités de temps surveillées :</div>
      <div class="al-tfs">${TF_LIST.map(tf => `<label><input type="checkbox" data-tf="${tf}" ${v.tfs[tf] ? 'checked' : ''}> ${LABEL[tf]}</label>`).join('')}</div>
      <div class="al-row"><label><input type="checkbox" data-k="vec.soft" ${v.soft ? 'checked' : ''}> Quand la bougie atteint le niveau (discret)</label></div>
      <div class="al-row"><label><input type="checkbox" data-k="vec.valid" ${v.valid ? 'checked' : ''}> À la clôture, si elle est validée (double, fort)</label></div>
      <div class="al-row"><span>Son</span><select data-k="vec.sound">${opt(Object.keys(SOUNDS).map(k => [k, SOUNDS[k].label]), v.sound)}</select></div>
      <div class="al-row"><span>Volume</span><input type="range" min="0.05" max="1" step="0.05" data-k="vec.vol" value="${v.vol}"></div>
      <div class="al-row">
        <button class="al-b" data-act="test-soft">Tester : discret ▲ puis ▼</button>
        <button class="al-b" data-act="test-valid">Tester : fort ▲ puis ▼</button>
      </div>

      <h3>Dernières alertes</h3>
      <div class="al-log" id="alLog"></div>
      <p class="al-note" id="alStatus"></p>`
    refreshUi(); renderLog(); refreshStatus()
  }
  function renderLog() {
    const el = document.getElementById('alLog')
    if (!el) return
    el.innerHTML = LOG.length
      ? LOG.map(e => `<div><span class="t">${new Date(e.ts).toLocaleTimeString('fr-FR')}</span><span class="${e.bull ? 'up' : 'down'}">${e.bull ? '▲' : '▼'}</span><span>${e.text}</span><span class="muted">${e.kind === 'valid' ? 'validé' : 'en cours'}${e.muted ? ' · son bloqué' : ''}</span></div>`).join('')
      : '<span class="muted">Aucune alerte depuis l\'ouverture de la page.</span>'
  }
  function refreshStatus() {
    const el = document.getElementById('alStatus')
    if (!el) return
    el.textContent = lastErr ? 'Binance injoignable : ' + lastErr : lastOk ? 'Dernière lecture : ' + new Date(lastOk).toLocaleTimeString('fr-FR') : 'En attente de la première lecture…'
  }
  function refreshUi() {
    const on = audioOn()
    const armed = S.master && S.vec.on && TF_LIST.some(tf => S.vec.tfs[tf])
    btn.classList.toggle('ok', armed && on)
    btn.classList.toggle('warn', armed && !on)
    const a = document.getElementById('alAudio')
    if (a) { a.textContent = on ? '🔊 Son activé' : '🔇 Cliquer pour activer le son'; a.className = 'al-b ' + (on ? 'good' : 'bad') }
  }
  function openModal() { renderModal(); over.classList.add('open') }
  function closeModal() { over.classList.remove('open') }
  over.addEventListener('click', e => { if (e.target === over) closeModal() })

  function setPath(path, value) {
    const k = path.split('.')
    let o = S
    for (let i = 0; i < k.length - 1; i++) o = o[k[i]]
    o[k[k.length - 1]] = value
  }
  over.addEventListener('change', e => {
    const t = e.target
    if (t.dataset.tf) S.vec.tfs[t.dataset.tf] = t.checked
    else if (t.dataset.k) setPath(t.dataset.k, t.type === 'checkbox' ? t.checked : t.type === 'range' ? +t.value : t.value)
    else return
    save(); refreshUi(); tick(true)
    if (t.dataset.k === 'vec.sound') testSound(false)
  })
  function testSound(strong) {
    const v = S.vec
    enqueue({ sound: v.sound, vol: v.vol, pitch: PITCH_BULL, strong })
    enqueue({ sound: v.sound, vol: v.vol, pitch: PITCH_BEAR, strong })
  }
  over.addEventListener('click', e => {
    const a = e.target.closest('[data-act]')
    if (!a) return
    const act = a.dataset.act
    if (act === 'close') closeModal()
    else if (act === 'unlock') { unlock(); setTimeout(() => testSound(false), 150) }
    else if (act === 'test-soft') { unlock(); testSound(false) }
    else if (act === 'test-valid') { unlock(); testSound(true) }
  })

  refreshUi()
  setInterval(refreshUi, 2000)
  tick(true)
})()
