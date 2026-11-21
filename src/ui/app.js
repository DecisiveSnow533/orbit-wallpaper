/* Spotify Orbit — interfaccia */
(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const WALL = /[?&]wall/.test(location.search);          // sfondo del desktop (nessun mouse, nessun pannello)
const SETWIN = /[?&]settings/.test(location.search);    // finestra impostazioni
const CID = Math.random().toString(36).slice(2);        // identifica questa pagina nella sincronizzazione
const MON = (location.search.match(/[?&]mon=(\d+)/) || [])[1];     // indice del monitor (solo per lo sfondo del desktop)
let paused = false;
let monPrimary = true;                                   // questo sfondo sta sul monitor principale? (lo chiede init)
let prevLyrics = null;                                   // per scaricare i testi quando vengono riaccesi

/* ====================================================================== *
 *  Impostazioni
 * ====================================================================== */
const DEFAULTS = {
  bg: 'aurora', palette: 'auto', customColor: '#ff3d8b', bgIntensity: 100, bgSpeed: 100, bgQuality: 'medium',
  layout: 'classic',
  showClock: true, clock24: true, showSeconds: false, clockPos: 'tr', clockSize: 100, showDate: true, dateFormat: 'long',
  showLyrics: true, lyricsOffset: 0, lyricsSize: 100,
  showCaption: true, showProgress: true, sideWidget: 'vinyl', lyricsFont: 'condensed',
  ringStyle: 'bars', ringSize: 100, ringRotate: true, sensitivity: 100, spectrumBottom: true,
  pulseArt: true, rotateArt: false, showStars: true, showParticles: true, showShocks: true, drift: true,
  monitor: '0', fps: '60', pauseCovered: true, onlySpotify: false, autostart: false,
  wScale: 100, wCount: 4, wSide: 'left', wX: 0, wY: 0, wOpacity: 100, wStyle: 'glass', wFont: 'default', wUpper: false, wNumbers: false,
  wThumbs: true, wArtist: true, wNow: true, queueEvery: '7', qLayout: 'list', wVert: 'bottom', showCenter: true, lastWidget: 'queue',
  secCustom: false, secondary: {},
  artX: 0, artY: 0, captionSize: 100, glowStrength: 100, specHeight: 100,
  profiles: [], profile: '', monitorProfiles: {}, checkUpdates: true, skipVersion: '',
};
let cfg = { ...DEFAULTS };
/* Un profilo salva solo l'aspetto: le scelte legate al PC (monitor, avvio con Windows…) restano fuori. */
const PROFILE_SKIP = new Set(['monitor', 'fps', 'pauseCovered', 'onlySpotify', 'autostart', 'profiles', 'profile', 'monitorProfiles', 'checkUpdates', 'skipVersion', 'secCustom', 'secondary']);
/* Schermi secondari (con «tutti i monitor» e «Personalizza»): cosa mostrare e dove. Di base solo lo sfondo. */
const SEC_DEFAULTS = {
  showCenter: false, ringSize: 100, artX: 0, artY: 0, captionSize: 100,
  showLyrics: false, layout: 'classic', lyricsSize: 100,
  sideWidget: 'none', lastWidget: 'queue', qLayout: 'list', wStyle: 'glass', wCount: 4, wScale: 100, wSide: 'left', wVert: 'bottom', wX: 0, wY: 0,
  showClock: false, showDate: false, clockPos: 'tr', clockSize: 100,
  spectrumBottom: false, specHeight: 100,
};
const secOf = (c) => ({ ...SEC_DEFAULTS, ...(c.secondary || {}) });
/* Con «tutti i monitor» ogni schermo può avere il suo profilo: la pagina dello sfondo lo applica sopra le impostazioni;
 * sugli schermi secondari personalizzati valgono poi le scelte della sezione «Schermi secondari». */
function effective(c) {
  if (!WALL || MON === undefined || c.monitor !== 'all') return c;
  const name = (c.monitorProfiles || {})[MON];
  const p = name && (Array.isArray(c.profiles) ? c.profiles : []).find((x) => x && x.name === name);
  let r = p && p.v ? { ...c, ...p.v } : c;
  if (!monPrimary && c.secCustom) r = { ...r, ...secOf(c) };
  return r;
}

const SCHEMA = [
  { t: 'Profili', custom: 'profiles' },
  { t: 'Cosa mostrare', items: [                         // un interruttore per ogni cosa: spenta sparisce del tutto
    { k: 'showCenter', type: 'toggle', label: 'Copertina e anello al centro' },
    { k: 'showCaption', type: 'toggle', label: 'Titolo e artista sotto la copertina', when: (c) => c.showCenter },
    { k: 'showProgress', type: 'toggle', label: 'Barra di avanzamento del brano', when: (c) => c.showCenter && c.showCaption },
    { k: 'showLyrics', type: 'toggle', label: 'Testi sincronizzati' },
    { k: 'showWidget', type: 'toggle', label: 'Brani recenti o coda di Spotify' },
    { k: 'showClock', type: 'toggle', label: 'Ora' },
    { k: 'showDate', type: 'toggle', label: 'Giorno' },
    { k: 'spectrumBottom', type: 'toggle', label: 'Spettro in basso' },
    { k: 'showStars', type: 'toggle', label: 'Stelle' },
    { k: 'showParticles', type: 'toggle', label: 'Particelle intorno alla copertina', when: (c) => c.showCenter },
    { k: 'showShocks', type: 'toggle', label: 'Onde d\'urto sui colpi di basso', when: (c) => c.showCenter },
  ] },
  { t: 'Sfondo', items: [
    { k: 'bg', type: 'select', label: 'Stile', opts: [
      ['aurora', 'Aurora (fumo di colore)'], ['mesh', 'Sfumature morbide'], ['waves', 'Onde musicali'], ['warp', 'Viaggio nello spazio'],
      ['synth', 'Synthwave'], ['bokeh', 'Luci sfocate (bokeh)'], ['blur', 'Copertina sfocata'], ['stars', 'Cielo di stelle'], ['black', 'Nero']] },
    { k: 'palette', type: 'select', label: 'Colori', opts: [['auto', 'Dalla copertina'], ['custom', 'Personalizzato']] },
    { k: 'customColor', type: 'color', label: 'Colore personalizzato', when: (c) => c.palette === 'custom' },
    { k: 'bgIntensity', type: 'range', label: 'Luminosità', min: 40, max: 170, step: 5, unit: '%' },
    { k: 'bgSpeed', type: 'range', label: 'Velocità del movimento', min: 0, max: 300, step: 10, unit: '%' },
    { k: 'bgQuality', type: 'select', label: 'Qualità', opts: [['low', 'Bassa (più leggera)'], ['medium', 'Media'], ['high', 'Alta']] },
  ] },
  { t: 'Disposizione', items: [
    { k: 'layout', type: 'select', label: 'Layout', opts: [['classic', 'Classico (testi a sinistra)'], ['center', 'Centrato (testi sotto)']] },
    { k: 'artX', type: 'range', label: 'Sposta la copertina in orizzontale', min: -25, max: 25, step: 1, unit: '%' },
    { k: 'artY', type: 'range', label: 'Sposta la copertina in verticale', min: -25, max: 25, step: 1, unit: '%' },
  ] },
  { t: 'Brani recenti e coda', when: (c) => c.sideWidget !== 'none', items: [
    { k: 'sideWidget', type: 'select', label: 'Cosa mostrare', opts: [
      ['vinyl', 'Disco che gira (recenti)'], ['cards', 'Carte con copertine (recenti)'], ['timeline', 'Linea del tempo (recenti)'], ['queue', 'Coda di Spotify (prossimi brani)']] },
    { k: 'wCount', type: 'range', label: 'Quanti brani mostrare', min: 1, max: 8, step: 1, unit: '', when: (c) => c.sideWidget !== 'none' },
    { k: 'wScale', type: 'range', label: 'Dimensione', min: 50, max: 250, step: 5, unit: '%', when: (c) => c.sideWidget !== 'none' },
    { k: 'wOpacity', type: 'range', label: 'Trasparenza', min: 30, max: 100, step: 5, unit: '%', when: (c) => c.sideWidget !== 'none' },
    { k: 'qLayout', type: 'select', label: 'Aspetto della coda', opts: [
      ['list', 'Elenco con «Subito dopo»'], ['covers', 'Copertine in fila'], ['stack', 'Pila di copertine'], ['timeline', 'Linea del tempo'], ['ticker', 'Una riga sola']],
      when: (c) => c.sideWidget === 'queue' },
    { k: 'wSide', type: 'select', label: 'Lato dello schermo', opts: [['left', 'Sinistra'], ['right', 'Destra']], when: (c) => ['cards', 'timeline', 'queue'].includes(c.sideWidget) },
    { k: 'wVert', type: 'select', label: 'Altezza', opts: [['bottom', 'In basso'], ['top', 'In alto']], when: (c) => ['cards', 'timeline', 'queue'].includes(c.sideWidget) },
    { k: 'wX', type: 'range', label: 'Sposta in orizzontale', min: -100, max: 100, step: 5, unit: '', when: (c) => c.sideWidget !== 'none' },
    { k: 'wY', type: 'range', label: 'Sposta in verticale', min: -100, max: 100, step: 5, unit: '', when: (c) => c.sideWidget !== 'none' },
    { k: 'wNow', type: 'toggle', label: 'Mostra anche il brano in corso', when: (c) => c.sideWidget !== 'none' },
    { k: 'wArtist', type: 'toggle', label: 'Mostra gli artisti', when: (c) => c.sideWidget !== 'none' },
    { k: 'wStyle', type: 'select', label: 'Stile delle carte', opts: [
      ['glass', 'Vetro'], ['solid', 'Pieno scuro'], ['neon', 'Neon (colore del brano)'], ['minimal', 'Minimale (solo testo)'],
      ['compact', 'Compatto'], ['big', 'Copertine grandi']], when: (c) => c.sideWidget === 'cards' || c.sideWidget === 'queue' },
    { k: 'wFont', type: 'select', label: 'Carattere', opts: [
      ['default', 'Predefinito'], ['condensed', 'Stretto'], ['bold', 'Pesante'], ['serif', 'Serif elegante'], ['mono', 'Monospazio'], ['modern', 'Moderno']],
      when: (c) => c.sideWidget !== 'none' },
    { k: 'wUpper', type: 'toggle', label: 'Testo in maiuscolo', when: (c) => c.sideWidget === 'cards' || c.sideWidget === 'queue' },
    { k: 'wNumbers', type: 'toggle', label: 'Numera i prossimi brani', when: (c) => c.sideWidget === 'queue' },
    { k: 'wThumbs', type: 'toggle', label: 'Mostra le copertine', when: (c) => c.sideWidget === 'cards' || c.sideWidget === 'queue' },
    { k: 'queueEvery', type: 'select', label: 'Aggiorna la coda ogni', opts: [['5', '5 secondi'], ['7', '7 secondi'], ['15', '15 secondi'], ['30', '30 secondi']], when: (c) => c.sideWidget === 'queue' },
  ] },
  { t: 'Orologio e data', when: (c) => c.showClock || c.showDate, items: [
    { k: 'clock24', type: 'toggle', label: 'Formato 24 ore', when: (c) => c.showClock },
    { k: 'showSeconds', type: 'toggle', label: 'Mostra i secondi', when: (c) => c.showClock },
    { k: 'dateFormat', type: 'select', label: 'Formato giorno', opts: [['long', 'venerdì 21 novembre'], ['short', '21/11/2026'], ['full', 'venerdì 21 novembre 2026']], when: (c) => c.showDate },
    { k: 'clockPos', type: 'select', label: 'Posizione', opts: [['tr', 'In alto a destra'], ['tl', 'In alto a sinistra'], ['tc', 'In alto al centro'], ['br', 'In basso a destra'], ['bl', 'In basso a sinistra']] },
    { k: 'clockSize', type: 'range', label: 'Dimensione', min: 60, max: 220, step: 10, unit: '%' },
  ] },
  { t: 'Brano e testi', when: (c) => (c.showCenter && c.showCaption) || c.showLyrics, items: [
    { k: 'captionSize', type: 'range', label: 'Dimensione titolo e artista', min: 60, max: 200, step: 5, unit: '%', when: (c) => c.showCenter && c.showCaption },
    { k: 'lyricsFont', type: 'select', label: 'Carattere dei testi', opts: [['condensed', 'Condensato'], ['bold', 'Pesante'], ['serif', 'Serif elegante'], ['mono', 'Monospazio']], when: (c) => c.showLyrics },
    { k: 'lyricsSize', type: 'range', label: 'Dimensione testi', min: 60, max: 160, step: 5, unit: '%', when: (c) => c.showLyrics },
    { k: 'lyricsOffset', type: 'range', label: 'Anticipo testi', min: -3000, max: 3000, step: 50, unit: ' ms', when: (c) => c.showLyrics },
  ] },
  { t: 'Anello e musica', items: [
    { k: 'ringStyle', type: 'select', label: 'Stile anello', opts: [['bars', 'Barre'], ['wave', 'Onda liscia'], ['dots', 'Punti']], when: (c) => c.showCenter },
    { k: 'ringSize', type: 'range', label: 'Dimensione copertina e anello', min: 60, max: 150, step: 5, unit: '%', when: (c) => c.showCenter },
    { k: 'glowStrength', type: 'range', label: 'Intensità dell\'alone', min: 0, max: 200, step: 10, unit: '%', when: (c) => c.showCenter },
    { k: 'specHeight', type: 'range', label: 'Altezza dello spettro in basso', min: 40, max: 250, step: 10, unit: '%', when: (c) => c.spectrumBottom },
    { k: 'sensitivity', type: 'range', label: 'Sensibilità audio', min: 40, max: 250, step: 5, unit: '%' },
    { k: 'ringRotate', type: 'toggle', label: 'Anello che ruota', when: (c) => c.showCenter },
    { k: 'pulseArt', type: 'toggle', label: 'Copertina che pulsa', when: (c) => c.showCenter },
    { k: 'rotateArt', type: 'toggle', label: 'Copertina che gira come un vinile', when: (c) => c.showCenter },
  ] },
  { t: 'Atmosfera', items: [
    { k: 'drift', type: 'toggle', label: 'Movimento della camera' },
  ] },
  { t: 'Coda di Spotify', custom: 'spotify' },
  { t: 'Sfondo del desktop', items: [
    { k: 'monitor', type: 'select', label: 'Monitor', opts: [['0', 'Principale']] },
    { k: 'fps', type: 'select', label: 'Fluidità', opts: [['30', '30 FPS (più leggero)'], ['60', '60 FPS']] },
    { k: 'pauseCovered', type: 'toggle', label: 'Pausa quando una finestra copre il desktop' },
    { k: 'onlySpotify', type: 'toggle', label: 'Ascolta solo Spotify' },
    { k: 'autostart', type: 'toggle', label: 'Avvia con Windows' },
    { k: 'checkUpdates', type: 'toggle', label: 'Avvisami quando esce una nuova versione' },
  ] },
];

/* sezione «Schermi secondari»: le stesse voci del principale, salvate a parte in cfg.secondary («secondary.chiave») */
(() => {
  const base = (k) => { for (const s of SCHEMA) for (const it of s.items || []) if (it.k === k) return it; throw new Error(k); };
  const on = (c) => c.monitor === 'all' && !!c.secCustom;
  const wid = (s) => s.sideWidget !== 'none', side = (s) => ['cards', 'timeline', 'queue'].includes(s.sideWidget);
  const S = (k, label, w) => ({ ...base(k), k: 'secondary.' + k, label: label || base(k).label, when: (c) => on(c) && (!w || !!w(secOf(c))) });
  SCHEMA.push({ t: 'Schermi secondari', when: (c) => c.monitor === 'all', items: [
    { k: 'secCustom', type: 'toggle', label: 'Scegli cosa mostrare sugli schermi secondari (spento: uguali al principale)' },
    // cosa mostrare: un interruttore per ogni cosa
    S('showCenter'), S('showLyrics'), S('showWidget'), S('showClock'), S('showDate'), S('spectrumBottom'),
    // posizione e dimensione di ciò che è acceso
    S('ringSize', null, (s) => s.showCenter), S('artX', null, (s) => s.showCenter), S('artY', null, (s) => s.showCenter),
    S('captionSize', null, (s) => s.showCenter),
    S('layout', 'Posizione dei testi', (s) => s.showLyrics), S('lyricsSize', null, (s) => s.showLyrics),
    S('sideWidget', 'Brani recenti o coda: cosa mostrare', wid),
    S('qLayout', null, (s) => s.sideWidget === 'queue'), S('wStyle', null, (s) => s.sideWidget === 'cards' || s.sideWidget === 'queue'),
    S('wCount', null, wid), S('wScale', 'Dimensione dei brani', wid), S('wSide', null, side), S('wVert', null, side),
    S('wX', 'Sposta i brani in orizzontale', wid), S('wY', 'Sposta i brani in verticale', wid),
    S('clockPos', 'Posizione di ora e data', (s) => s.showClock || s.showDate), S('clockSize', 'Dimensione di ora e data', (s) => s.showClock || s.showDate),
    S('specHeight', null, (s) => s.spectrumBottom),
  ].map((it) => (it.k === 'secCustom' ? { ...it, when: (c) => c.monitor === 'all' } : it)) });
})();
/* lettura/scrittura di una voce del pannello, anche annidata («secondary.chiave») */
/* «showWidget» non è salvato: acceso/spento vuol dire sideWidget diverso da 'none'; spegnendo si ricorda il tipo (lastWidget) */
function getK(k) {
  const sec = k.startsWith('secondary.'), o = sec ? secOf(cfg) : cfg, key = sec ? k.slice(10) : k;
  return key === 'showWidget' ? o.sideWidget !== 'none' : o[key];
}
function setK(k, v) {
  const sec = k.startsWith('secondary.'), o = sec ? secOf(cfg) : cfg, key = sec ? k.slice(10) : k;
  if (key === 'showWidget') {
    if (v) { if (o.sideWidget === 'none') o.sideWidget = o.lastWidget && o.lastWidget !== 'none' ? o.lastWidget : 'queue'; }
    else { if (o.sideWidget !== 'none') o.lastWidget = o.sideWidget; o.sideWidget = 'none'; }
  } else o[key] = v;
  if (sec) cfg.secondary = o;
}

let saveT = 0;
function scheduleSave() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    fetch('/api/settings?cid=' + CID, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }).catch(() => {});
  }, 400);
}

const rows = [], secHeads = [];
function buildPanel() {
  const p = $('#panel');
  p.innerHTML = '<h1>Spotify Orbit</h1><div class="sub">Le modifiche si salvano da sole</div>';
  for (const sec of SCHEMA) {
    const h = document.createElement('h2'); h.textContent = sec.t; p.appendChild(h);
    if (sec.when) secHeads.push({ when: sec.when, h });
    if (sec.custom === 'spotify') { buildSpotify(p); continue; }
    if (sec.custom === 'profiles') { buildProfiles(p); continue; }
    for (const it of sec.items) {
      const row = document.createElement('div'); row.className = 'row' + (it.type === 'range' ? ' col' : '');
      const lab = document.createElement('label'); lab.textContent = it.label;
      let input;
      if (it.type === 'toggle') {
        const w = document.createElement('div'); w.className = 'sw';
        input = document.createElement('input'); input.type = 'checkbox';
        const s = document.createElement('span'); w.append(input, s);
        row.append(lab, w);
        input.onchange = () => setCfg(it.k, input.checked);
      } else if (it.type === 'select') {
        input = document.createElement('select');
        it.opts.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; input.appendChild(o); });
        row.append(lab, input);
        input.onchange = () => setCfg(it.k, input.value);
      } else if (it.type === 'color') {
        input = document.createElement('input'); input.type = 'color';
        row.append(lab, input);
        input.oninput = () => setCfg(it.k, input.value);
      } else {
        const top = document.createElement('div'); top.style.display = 'flex';
        const val = document.createElement('span'); val.className = 'val';
        top.append(lab, val);
        input = document.createElement('input'); input.type = 'range'; input.min = it.min; input.max = it.max; input.step = it.step;
        row.append(top, input);
        input.oninput = () => { val.textContent = input.value + (it.unit || ''); setCfg(it.k, Number(input.value)); };
        it._val = val;
      }
      p.appendChild(row);
      rows.push({ it, row, input });
    }
  }
  const btns = document.createElement('div'); btns.className = 'btns';
  const mk = (txt, fn, cls) => { const b = document.createElement('button'); b.textContent = txt; if (cls) b.className = cls; b.onclick = fn; btns.appendChild(b); };
  if (!SETWIN) mk('Schermo intero', toggleFS);
  mk('Anteprima con musica finta', () => (demo.on ? stopDemo() : startDemo()));
  mk('Cerca aggiornamenti', () => {
    toast('Controllo…');
    fetch('/api/update/check', { method: 'POST' }).then((r) => r.json()).then((d) => toast(d.msg)).catch(() => toast('Il programma non risponde'));
  });
  mk('Ripristina', () => { cfg = { ...DEFAULTS, profiles: cfg.profiles || [], monitorProfiles: cfg.monitorProfiles || {} }; refreshPanel(); applyCfg(); scheduleSave(); toast('Impostazioni ripristinate (i profili salvati restano)'); });
  mk('Chiudi il programma', quitApp, 'danger');
  p.appendChild(btns);
  const hint = document.createElement('div'); hint.className = 'hint';
  hint.innerHTML = SETWIN
    ? 'Le modifiche si vedono subito sullo sfondo del desktop. Puoi richiamare questa finestra con clic sull\'icona di Spotify Orbit vicino all\'orologio. <kbd>Spazio</kbd> play/pausa · <kbd>←</kbd> <kbd>→</kbd> cambia brano · <kbd>[</kbd> <kbd>]</kbd> sincronia testi'
    : '<kbd>S</kbd> impostazioni · <kbd>F</kbd> schermo intero · <kbd>Spazio</kbd> play/pausa · <kbd>←</kbd> <kbd>→</kbd> brano precedente/successivo · <kbd>[</kbd> <kbd>]</kbd> sincronia testi · clic sulla copertina = play/pausa';
  p.appendChild(hint);
  const ver = el('div', 'ver', 'Spotify Orbit'); p.appendChild(ver);      // versione attuale, in fondo alle impostazioni
  refreshPanel();
  fetch('/api/update').then((r) => r.json()).then((d) => { if (d.current) ver.textContent = 'Spotify Orbit · versione ' + d.current; }).catch(() => {});
  fetch('/api/monitors').then((r) => r.json()).then((list) => {          // elenco reale dei monitor
    prof.mons = list;
    const row = rows.find((x) => x.it.k === 'monitor'); if (!row || !list.length) return;
    row.input.textContent = '';
    list.forEach((m) => { const o = document.createElement('option'); o.value = String(m.i); o.textContent = (m.primary ? 'Principale' : 'Monitor ' + (m.i + 1)) + ' — ' + m.w + '×' + m.h; row.input.appendChild(o); });
    if (list.length > 1) { const o = document.createElement('option'); o.value = 'all'; o.textContent = 'Tutti i monitor'; row.input.appendChild(o); }
    refreshPanel();
  }).catch(() => {});
}

/* --- barra di aggiornamento --- */
const upd = { available: false, later: false, mode: 'portable', state: 'idle', progress: 0, msg: '', current: '', latest: '', skipped: false };

function renderUpdate() {
  const bar = $('#updbar'); if (!bar || WALL) return;
  const show = upd.available && !upd.skipped && !upd.later;
  bar.hidden = !show; document.body.classList.toggle('has-upd', show);
  if (!show) return;
  const busy = upd.state === 'downloading' || upd.state === 'installing';
  const msg = bar.querySelector('.msg'), go = bar.querySelector('.go'), later = bar.querySelector('.later'), skip = bar.querySelector('.skip');
  msg.textContent = '';
  const b = (t) => { const e = document.createElement('b'); e.textContent = t; return e; };
  if (upd.state === 'downloading') msg.append('Scarico la versione ', b(upd.latest), '… ' + upd.progress + '%');
  else if (upd.state === 'installing') msg.append('Installo la versione ', b(upd.latest), ': Spotify Orbit si chiude e riparte da solo tra qualche secondo…');
  else if (upd.state === 'error') msg.append(upd.msg || 'Aggiornamento non riuscito.');
  else if (upd.mode === 'installer') msg.append('È disponibile la versione ', b(upd.latest), ' (hai la ' + upd.current + '). Vuoi aggiornare adesso? Si installa da sola e il programma riparte.');
  else msg.append('È disponibile la versione ', b(upd.latest), ' (hai la ' + upd.current + '). Usi la versione portatile: scarica il nuovo zip dalla pagina della release.');
  go.textContent = upd.state === 'error' ? 'Riprova' : upd.mode === 'installer' ? 'Aggiorna ora' : 'Apri la pagina';
  go.disabled = busy; later.hidden = skip.hidden = busy;
  bar.classList.toggle('busy', busy);
  bar.querySelector('.prog i').style.width = (upd.state === 'installing' ? 100 : upd.progress) + '%';
}

function initUpdateBar() {
  const bar = $('#updbar'); if (!bar || WALL) return;
  bar.querySelector('.go').onclick = () => {
    if (upd.mode === 'installer') fetch('/api/update/install', { method: 'POST' }).catch(() => {});
    else fetch('/api/update/open', { method: 'POST' }).catch(() => {});
  };
  bar.querySelector('.later').onclick = () => { upd.later = true; renderUpdate(); };
  bar.querySelector('.skip').onclick = () => { fetch('/api/update/skip', { method: 'POST' }).catch(() => {}); };
}

/* --- profili --- */
const prof = { ui: null, mons: [] };
const profList = () => (Array.isArray(cfg.profiles) ? cfg.profiles.filter((x) => x && typeof x.name === 'string' && x.v) : []);
function snapshot() { const v = {}; for (const k of Object.keys(DEFAULTS)) if (!PROFILE_SKIP.has(k)) v[k] = cfg[k]; return v; }

function applyProfile(name) {
  const p = profList().find((x) => x.name === name); if (!p) return;
  cfg = { ...cfg, ...p.v, profile: name };
  refreshPanel(); applyCfg(); scheduleSave(); toast('Profilo «' + name + '» applicato');
}
function saveProfile(name) {
  name = (name || '').trim().slice(0, 40);
  if (!name) { toast('Scrivi un nome per il profilo'); return false; }
  const list = profList().filter((x) => x.name !== name);
  if (list.length >= 30) { toast('Troppi profili: eliminane qualcuno'); return false; }
  const old = profList().findIndex((x) => x.name === name);
  const entry = { name, v: snapshot() };
  if (old >= 0) list.splice(old, 0, entry); else list.push(entry);
  cfg.profiles = list; cfg.profile = name;
  refreshPanel(); scheduleSave(); toast('Profilo «' + name + '» salvato');
  return true;
}
function deleteProfile(name) {
  cfg.profiles = profList().filter((x) => x.name !== name);
  const mp = { ...(cfg.monitorProfiles || {}) };
  for (const k of Object.keys(mp)) if (mp[k] === name) delete mp[k];
  cfg.monitorProfiles = mp;
  if (cfg.profile === name) cfg.profile = '';
  refreshPanel(); applyCfg(); scheduleSave(); toast('Profilo eliminato');
}

function buildProfiles(p) {
  const box = el('div', 'spbox');
  box.appendChild(el('div', 'sphelp', 'Un profilo ricorda l\'aspetto (sfondo, widget, orologio, testi…). Lo cambi anche con un clic dall\'icona vicino all\'orologio → Profili.'));
  const selRow = el('div', 'row'); selRow.appendChild(el('label', '', 'Profilo attivo'));
  const sel = document.createElement('select'); selRow.appendChild(sel);
  sel.onchange = () => { if (sel.value) applyProfile(sel.value); else { cfg.profile = ''; refreshPanel(); scheduleSave(); } };
  const input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Nome del profilo (es. Serata)'; input.maxLength = 40;
  const btns = el('div', 'btns');
  const save = el('button', '', 'Salva come profilo'); save.onclick = () => { if (saveProfile(input.value)) input.value = ''; };
  const upd = el('button', '', 'Aggiorna'); upd.onclick = () => { if (cfg.profile) saveProfile(cfg.profile); };
  const del = el('button', 'danger', 'Elimina'); del.onclick = () => { if (cfg.profile) deleteProfile(cfg.profile); };
  btns.append(save, upd, del);
  const status = el('div', 'spstatus');
  const mon = el('div', 'profmon');
  box.append(selRow, input, btns, status, mon);
  p.appendChild(box);
  prof.ui = { sel, upd, del, status, mon, monKey: '' };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  updateProfilesUI();
}

function updateProfilesUI() {
  const u = prof.ui; if (!u) return;
  const list = profList(), cur = list.find((x) => x.name === cfg.profile);
  if (document.activeElement !== u.sel || u.sel.options.length !== list.length + 1) {
    u.sel.textContent = '';
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = list.length ? '— nessuno —' : '— nessun profilo salvato —'; u.sel.appendChild(o0);
    list.forEach((x) => { const o = document.createElement('option'); o.value = x.name; o.textContent = x.name; u.sel.appendChild(o); });
  }
  u.sel.value = cur ? cur.name : '';
  u.upd.disabled = u.del.disabled = !cur;
  u.upd.textContent = cur ? 'Aggiorna «' + cur.name.slice(0, 14) + '»' : 'Aggiorna';
  let dirty = false;
  if (cur) for (const k of Object.keys(cur.v)) if (JSON.stringify(cur.v[k]) !== JSON.stringify(cfg[k])) { dirty = true; break; }
  u.status.className = 'spstatus' + (dirty ? '' : cur ? ' good' : '');
  u.status.textContent = !cur ? '' : dirty ? 'Hai modificato le impostazioni dopo aver scelto il profilo: premi «Aggiorna» per salvarle nel profilo.' : 'Profilo «' + cur.name + '» attivo.';
  // un profilo diverso per ogni monitor (solo con «Tutti i monitor»)
  const multi = cfg.monitor === 'all' && prof.mons.length > 1;
  const key = multi ? JSON.stringify([prof.mons.map((m) => m.i), list.map((x) => x.name), cfg.monitorProfiles]) : '';
  u.mon.style.display = multi ? '' : 'none';
  if (multi && key !== u.monKey) {
    u.monKey = key; u.mon.textContent = '';
    u.mon.appendChild(el('div', 'sphelp', 'Un profilo diverso per ogni monitor:'));
    prof.mons.forEach((m) => {
      const r = el('div', 'row'); r.appendChild(el('label', '', (m.primary ? 'Principale' : 'Monitor ' + (m.i + 1)) + ' — ' + m.w + '×' + m.h));
      const s = document.createElement('select');
      const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Impostazioni attuali'; s.appendChild(o0);
      list.forEach((x) => { const o = document.createElement('option'); o.value = x.name; o.textContent = x.name; s.appendChild(o); });
      s.value = (cfg.monitorProfiles || {})[String(m.i)] || '';
      s.onchange = () => { const mp = { ...(cfg.monitorProfiles || {}) }; if (s.value) mp[String(m.i)] = s.value; else delete mp[String(m.i)]; cfg.monitorProfiles = mp; scheduleSave(); };
      r.appendChild(s); u.mon.appendChild(r);
    });
  }
}

/* --- collegamento a Spotify (coda) --- */
const sp = { state: 'nocid', msg: '', items: [], cid: '', redirect: 'http://127.0.0.1:8777/callback', ui: null };

function buildSpotify(p) {
  const box = el('div', 'spbox');
  const help = el('div', 'sphelp');
  help.innerHTML = 'Spotify non dice a Windows quali brani arrivano dopo, quindi la coda vera si legge dal tuo account. Si fa una volta sola:' +
    '<ol><li>Apri il sito per sviluppatori di Spotify (pulsante «Apri» qui sotto), accedi e crea un\'app: nome a piacere, scegli «Web API».</li>' +
    '<li>Nelle impostazioni dell\'app, in <b>Redirect URIs</b>, incolla il secondo indirizzo (usa «Copia»: <b>non va aperto</b>, serve solo a Spotify) e salva.</li>' +
    '<li>Copia il <b>Client ID</b> dell\'app e incollalo nel campo qui sotto.</li></ol>';
  const copyText = (txt) => {
    const fallback = () => { const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { /* niente */ } t.remove(); };
    (navigator.clipboard ? navigator.clipboard.writeText(txt).catch(fallback) : Promise.resolve(fallback())).then(() => toast('Copiato'));
  };
  const mkRow = (label, text, withOpen) => {
    const wrap = el('div', 'spuri');
    wrap.appendChild(el('div', 'splabel', label));
    const line = el('div', 'spline');
    const code = el('code', '', text);
    const copy = el('button', '', 'Copia'); copy.onclick = () => copyText(code.textContent);
    line.append(code, copy);
    if (withOpen) { const open = el('button', '', 'Apri'); open.onclick = () => fetch('/api/spotify/dashboard', { method: 'POST' }).catch(() => {}); line.appendChild(open); }
    wrap.appendChild(line);
    return { wrap, code };
  };
  const dash = mkRow('1 · Sito di Spotify per sviluppatori', 'https://developer.spotify.com/dashboard', true);
  const uri = mkRow('2 · Redirect URI da incollare nell\'app', sp.redirect, false);
  const uriRow = el('div'); uriRow.append(dash.wrap, uri.wrap);
  const code = uri.code;
  const input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Client ID'; input.spellcheck = false; input.autocomplete = 'off';
  const status = el('div', 'spstatus');
  const btns = el('div', 'btns');
  const go = el('button', '', 'Collega Spotify');
  const off = el('button', '', 'Scollega');
  go.onclick = async () => {
    status.textContent = 'Apro Spotify nel browser…';
    try {
      const r = await fetch('/api/spotify/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: input.value }) });
      const d = await r.json();
      status.textContent = d.ok ? 'Si è aperta una pagina nel browser: accedi e conferma, poi torna qui.' : (d.error || 'Errore');
      status.className = 'spstatus' + (d.ok ? '' : ' bad');
    } catch (e) { status.textContent = 'Il programma non risponde.'; }
  };
  off.onclick = () => { fetch('/api/spotify/logout', { method: 'POST' }).catch(() => {}); };
  btns.append(go, off);
  box.append(help, uriRow, input, btns, status);
  p.appendChild(box);
  sp.ui = { input, status, go, off };
  fetch('/api/spotify/status').then((r) => r.json()).then((d) => { sp.cid = d.cid || ''; sp.redirect = d.redirect || sp.redirect; code.textContent = sp.redirect; if (!input.value) input.value = sp.cid; }).catch(() => {});
  updateSpotifyUI();
}

function updateSpotifyUI() {
  const u = sp.ui; if (!u) return;
  const ok = sp.state === 'ok';
  u.off.style.display = (sp.state === 'off' || sp.state === 'nocid') && !sp.msg ? 'none' : '';
  u.go.textContent = ok ? 'Ricollega' : 'Collega Spotify';
  u.status.className = 'spstatus' + (sp.state === 'error' ? ' bad' : ok ? ' good' : '');
  u.status.textContent = sp.state === 'ok' ? (cfg.sideWidget === 'queue' ? `Collegato ✓ — ${sp.items.length} ${sp.items.length === 1 ? 'brano' : 'brani'} in coda` : 'Collegato ✓ — scegli «Coda di Spotify» in Disposizione → Brani recenti')
    : sp.state === 'error' ? sp.msg : sp.msg || (sp.state === 'off' ? 'Client ID salvato, non ancora collegato.' : 'Non collegato.');
}

function refreshPanel() {
  updateSpotifyUI();
  updateProfilesUI();
  for (const { it, row, input } of rows) {
    const v = getK(it.k);
    if (it.type === 'toggle') input.checked = !!v;
    else if (it.type === 'range') { input.value = v; it._val.textContent = v + (it.unit || ''); }
    else input.value = v;
    row.classList.toggle('hidden', !!(it.when && !it.when(cfg)));
  }
  for (const s of secHeads) s.h.classList.toggle('hidden', !s.when(cfg));
}

function setCfg(k, v) {
  setK(k, v);
  refreshPanel();
  applyCfg(k);
  scheduleSave();
}

function applyCfg() {
  const b = document.body.classList;
  BG_LIST.forEach((n) => b.toggle('bg-' + n, cfg.bg === n));
  ['vinyl', 'cards', 'timeline', 'queue', 'none'].forEach((n) => b.toggle('sw-' + n, cfg.sideWidget === n));
  document.documentElement.style.setProperty('--lfont', LFONTS[cfg.lyricsFont] || LFONTS.condensed);
  b.toggle('layout-center', cfg.layout === 'center');
  b.toggle('no-lyrics', !cfg.showLyrics);
  b.toggle('no-clock', !cfg.showClock);
  b.toggle('no-date', !cfg.showDate);
  b.toggle('no-caption', !cfg.showCaption);
  b.toggle('no-progress', !cfg.showProgress);
  const r = document.documentElement.style;
  r.setProperty('--rs', cfg.ringSize / 100);
  r.setProperty('--ls', cfg.lyricsSize / 100);
  r.setProperty('--cs', cfg.clockSize / 100);
  r.setProperty('--ws', cfg.wScale / 100);
  r.setProperty('--wo', cfg.wOpacity / 100);
  r.setProperty('--wx', cfg.wX);
  r.setProperty('--wy', cfg.wY);
  r.setProperty('--ox', cfg.artX + '%');
  r.setProperty('--oy', cfg.artY + '%');
  r.setProperty('--cps', cfg.captionSize / 100);
  b.toggle('w-right', cfg.wSide === 'right');
  b.toggle('w-top', cfg.wVert === 'top');
  b.toggle('no-center', !cfg.showCenter);
  // testi riaccesi (es. su uno schermo secondario): scarica quelli del brano in corso
  if (cfg.showLyrics && prevLyrics === false && state.title && !state.lyrics && !demo.on) fetchLyrics(++state.lyricReq);
  prevLyrics = !!cfg.showLyrics;
  W_STYLES.forEach((n) => b.toggle('ws-' + n, (cfg.wStyle || 'glass') === n));
  b.toggle('w-upper', !!cfg.wUpper);
  b.toggle('w-num', !!cfg.wNumbers);
  const wf = WFONTS[cfg.wFont] || WFONTS.default;
  r.setProperty('--wfont', wf[0]);
  r.setProperty('--wstretch', wf[1]);
  b.toggle('no-wthumbs', !cfg.wThumbs);
  b.toggle('no-wartist', !cfg.wArtist);
  $('#clock').className = 'pos-' + cfg.clockPos;
  recomputePalette();
  resizeGL();
  sizeBg2d();
  renderList();
  tickClock();
  setTimeout(layout, 60);
}
const W_STYLES = ['glass', 'solid', 'neon', 'minimal', 'compact', 'big'];
const WFONTS = {                                   // [famiglia, larghezza]
  default: ['var(--font)', '100%'],
  condensed: ['"Bahnschrift", "Arial Narrow", "Segoe UI", sans-serif', '75%'],
  bold: ['"Segoe UI Black", "Segoe UI", system-ui, sans-serif', '100%'],
  serif: ['Georgia, "Palatino Linotype", "Times New Roman", serif', '100%'],
  mono: ['Consolas, "Cascadia Mono", monospace', '100%'],
  modern: ['"Trebuchet MS", "Segoe UI", system-ui, sans-serif', '100%'],
};
/* impostazioni di versioni precedenti */
function migrate(c, raw) {
  if (raw && raw.wGlass === false && !raw.wStyle) c.wStyle = 'minimal';
  if (raw && raw.extraBgOnly && raw.secCustom === undefined) c.secCustom = true;   // 2.1.0: «solo lo sfondo» = schermi secondari di base
  return c;
}
const BG_LIST = ['aurora', 'mesh', 'waves', 'warp', 'synth', 'bokeh', 'blur', 'stars', 'black'];
const BG2D = new Set(['mesh', 'waves', 'warp', 'synth', 'bokeh']);
const LFONTS = {
  condensed: '"Bahnschrift", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
  bold: '"Segoe UI Black", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Palatino Linotype", "Times New Roman", serif',
  mono: 'Consolas, "Cascadia Mono", monospace',
};

async function loadCfg() {
  try {
    const r = await fetch('/api/settings');
    const d = await r.json();
    cfg = { ...DEFAULTS, ...d };
    if (d.showRecent === false && !d.sideWidget) cfg.sideWidget = 'none';     // impostazione della versione precedente
    cfg = effective(migrate(cfg, d));
  } catch (e) { /* valori predefiniti */ }
}

/* ====================================================================== *
 *  Stato
 * ====================================================================== */
const state = {
  title: '', artist: '', album: '', key: '', playing: false,
  pos: 0, posT: 0, duration: 0,
  lyrics: null, lyricIdx: -2, lyricReq: 0, candidates: null,
};
const demo = { on: false, t0: 0 };
let history = [];
try { history = JSON.parse(localStorage.getItem('orbit.history') || '[]'); } catch (e) { history = []; }
const saveHistory = () => { try { localStorage.setItem('orbit.history', JSON.stringify(history.slice(0, 10))); } catch (e) {} };
const getPos = () => state.pos + (state.playing ? (performance.now() - state.posT) / 1000 : 0);

/* ====================================================================== *
 *  Palette dalla copertina + sfondo "aurora" (WebGL)
 * ====================================================================== */
const DEF_PAL = [[0.55, 0.25, 1.0], [0.1, 0.55, 1.0], [1.0, 0.25, 0.65]];
let palTarget = DEF_PAL.map((c) => c.slice());
let palCur = DEF_PAL.map((c) => c.slice());
let artPal = null;
let accent = [214, 84, 255];

function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}
function vivid(rgb) {
  const [h, s, v] = rgb2hsv(rgb[0], rgb[1], rgb[2]);
  return hsv2rgb(h, clamp(s * 1.15 + 0.1, 0.5, 1), clamp(v * 1.1, 0.62, 1));
}

function extractPalette(img) {
  const N = 40, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, N, N);
  let d; try { d = x.getImageData(0, 0, N, N).data; } catch (e) { return null; }
  const bins = Array.from({ length: 12 }, () => ({ r: 0, g: 0, b: 0, w: 0 }));
  let tot = 0, avg = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    avg[0] += r; avg[1] += g; avg[2] += b;
    const [h, s, v] = rgb2hsv(r, g, b);
    const w = s * s * (0.15 + v) * (v > 0.12 ? 1 : 0.1);
    if (w <= 0.001) continue;
    const bi = Math.floor(h / 30) % 12;
    bins[bi].r += r * w; bins[bi].g += g * w; bins[bi].b += b * w; bins[bi].w += w; tot += w;
  }
  const n = d.length / 4; avg = avg.map((v) => v / n);
  if (tot < 1.2) {                       // copertina quasi in bianco e nero: tinta dalla luminosità media
    const base = [0.35 + avg[0] * 0.4, 0.4 + avg[1] * 0.4, 0.7 + avg[2] * 0.3];
    return [vivid(base), vivid([base[2], base[0], base[1]]), vivid([base[1], base[2], base[0]])];
  }
  const order = bins.map((b, i) => ({ i, w: b.w })).sort((a, b) => b.w - a.w);
  const pick = [];
  for (const o of order) {
    if (o.w < tot * 0.04) break;
    if (pick.every((p) => { const dh = Math.abs(p.i - o.i); return Math.min(dh, 12 - dh) >= 2; })) pick.push(o);
    if (pick.length === 3) break;
  }
  const cols = pick.map((p) => { const b = bins[p.i]; return vivid([b.r / b.w, b.g / b.w, b.b / b.w]); });
  const [h0] = rgb2hsv(...cols[0]);
  while (cols.length < 3) cols.push(hsv2rgb(h0 + (cols.length === 1 ? 38 : -42), 0.85, 0.95));
  return cols;
}

function customPalette() {
  const h = cfg.customColor || '#ff3d8b';
  const r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255, b = parseInt(h.slice(5, 7), 16) / 255;
  const [hh, , ] = rgb2hsv(r, g, b);
  return [vivid([r, g, b]), hsv2rgb(hh + 38, 0.8, 0.95), hsv2rgb(hh - 42, 0.85, 0.9)];
}

function recomputePalette() {
  let pal = cfg.palette === 'custom' ? customPalette() : (artPal || DEF_PAL);
  palTarget = pal.map((c) => c.slice());
  accent = palTarget[0].map((v) => Math.round(clamp(v, 0, 1) * 255));
  document.documentElement.style.setProperty('--accent', accent.join(','));
}

const glc = $('#aurora');
let gl = null, glProg = null, glU = {}, glOk = false;
const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
const FS = `
precision highp float;
uniform vec2 uR; uniform float uT, uBass, uEn, uInt; uniform vec3 uC1, uC2, uC3; uniform vec2 uCenter;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++) { s += a * noise(p); p = m * p; a *= .5; } return s; }
void main(){
  vec2 uv = gl_FragCoord.xy / uR;
  vec2 p = (uv - .5) * vec2(uR.x / uR.y, 1.);
  float t = uT * .05;
  vec2 q = vec2(fbm(p * 1.2 + vec2(0., t)), fbm(p * 1.2 + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p * 1.5 + 3. * q + vec2(1.7, 9.2) + t * 1.2), fbm(p * 1.5 + 3. * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * .9 + 2.2 * r);
  float g = fbm(p * 1.25 + r * 2.6 + vec2(3.1, 1.7) - t);
  vec3 col = vec3(.006, .006, .016);
  col += uC1 * pow(smoothstep(.28, .78, f), 1.6) * 1.35;
  col += uC2 * pow(smoothstep(.42, .92, g), 1.8) * 1.15;
  float vein = pow(max(0., 1. - abs(f - .5) * 7.), 2.);            // venature luminose
  col += mix(uC3, vec3(1.), .22) * vein * (.5 + uBass * .9);
  col += uC3 * pow(smoothstep(.5, 1., r.y), 2.) * .55;
  float d = length((uv - uCenter) * vec2(uR.x / uR.y, 1.));
  col += mix(uC1, uC2, .4) * exp(-d * 2.1) * (.2 + uBass * .65);
  col *= uInt * (.82 + uEn * .6);
  col = col / (1. + col * .5);
  col += (hash(gl_FragCoord.xy + fract(uT)) - .5) * .028;
  gl_FragColor = vec4(col, 1.);
}`;

function initGL() {
  try {
    gl = glc.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl');
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    glProg = gl.createProgram();
    gl.attachShader(glProg, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(glProg, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(glProg);
    if (!gl.getProgramParameter(glProg, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(glProg);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(glProg, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['uR', 'uT', 'uBass', 'uEn', 'uInt', 'uC1', 'uC2', 'uC3', 'uCenter'].forEach((n) => { glU[n] = gl.getUniformLocation(glProg, n); });
    glOk = true;
  } catch (e) {
    glOk = false; document.body.classList.add('no-webgl');
  }
}

function resizeGL() {
  if (!glOk) return;
  const q = { low: 0.32, medium: 0.5, high: 0.85 }[cfg.bgQuality] || 0.5, on = cfg.bg === 'aurora';   // spenta: tela minima, niente memoria
  const w = on ? Math.max(2, Math.round(window.innerWidth * q)) : 2, h = on ? Math.max(2, Math.round(window.innerHeight * q)) : 2;
  if (glc.width !== w || glc.height !== h) { glc.width = w; glc.height = h; gl.viewport(0, 0, w, h); }
}

let tAcc = 0;
function drawAurora(dt) {
  const k = 1 - Math.exp(-dt * 1.4);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) palCur[i][j] += (palTarget[i][j] - palCur[i][j]) * k;
  if (!glOk || cfg.bg !== 'aurora') return;
  gl.uniform2f(glU.uR, glc.width, glc.height);
  gl.uniform1f(glU.uT, tAcc);
  gl.uniform1f(glU.uBass, clamp(bassSm * 1.1 + beatEnergy * 0.5, 0, 1.4));
  gl.uniform1f(glU.uEn, energySm);
  gl.uniform1f(glU.uInt, cfg.bgIntensity / 100 * 0.9);
  gl.uniform3fv(glU.uC1, palCur[0]); gl.uniform3fv(glU.uC2, palCur[1]); gl.uniform3fv(glU.uC3, palCur[2]);
  gl.uniform2f(glU.uCenter, artCx / window.innerWidth, 1 - artCy / window.innerHeight);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/* ---------- sfondi 2D: sfumature, onde, spazio, synthwave, bokeh ---------- */
const b2 = $('#bg2d'), b2c = b2.getContext('2d');
function sizeBg2d() {
  const q = { low: 0.5, medium: 0.75, high: 1 }[cfg.bgQuality] || 0.75, d = Math.min(window.devicePixelRatio || 1, 1.5) * q;
  const W = window.innerWidth, H = window.innerHeight, on = BG2D.has(cfg.bg);   // spenta: tela minima, niente memoria
  const w = on ? Math.max(2, Math.round(W * d)) : 2, h = on ? Math.max(2, Math.round(H * d)) : 2;
  if (b2.width !== w || b2.height !== h) { b2.width = w; b2.height = h; }
  b2c.setTransform(b2.width / W, 0, 0, b2.height / H, 0, 0);
}
// spettro in basso: la tela copre solo la striscia dove disegna (prima era grande come lo schermo)
function sizeSpec() {
  const d = Math.min(dpr, 1.5), W = window.innerWidth, H = window.innerHeight, on = cfg.spectrumBottom;
  const hc = on ? Math.min(H, Math.ceil(H * 0.2 * cfg.specHeight / 100) + 2) : 2;
  spec.style.top = 'auto'; spec.style.bottom = '0'; spec.style.height = hc + 'px';
  const w = on ? Math.round(W * d) : 2, h = on ? Math.round(hc * d) : 2;
  if (spec.width !== w || spec.height !== h) { spec.width = w; spec.height = h; }
  sc.setTransform(d, 0, 0, d, 0, -(H - hc) * d);             // si disegna con le coordinate dello schermo
}
const warpStars = Array.from({ length: 560 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random(), ci: Math.floor(Math.random() * 3) }));
const bokeh = Array.from({ length: 52 }, () => ({ x: Math.random(), y: Math.random(), r: 0.025 + Math.random() * 0.11, s: 0.008 + Math.random() * 0.03, ci: Math.floor(Math.random() * 3), a: 0.1 + Math.random() * 0.28, ph: Math.random() * 6.28, layer: Math.random() }));

function drawBg2d(dt, now) {
  if (!BG2D.has(cfg.bg)) return;
  const c = b2c, W = window.innerWidth, H = window.innerHeight, I = cfg.bgIntensity / 100;
  const P = palCur.map((p) => p.map((v) => Math.round(clamp(v, 0, 1) * 255)).join(','));
  const t = tAcc, sp = cfg.bgSpeed / 100;
  c.globalCompositeOperation = 'source-over';
  const base = c.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, `rgb(${palCur[0].map((v) => Math.round(v * 22)).join(',')})`); base.addColorStop(1, '#03030a');
  c.fillStyle = base; c.fillRect(0, 0, W, H);

  if (cfg.bg === 'mesh') {
    const blobs = [[0.2, 0.3, 0, 1.0], [0.8, 0.25, 1, 0.9], [0.5, 0.8, 2, 1.0], [0.12, 0.85, 1, 0.8], [0.88, 0.8, 0, 0.85], [0.5, 0.45, 2, 0.6]];
    c.globalCompositeOperation = 'lighter';
    blobs.forEach(([bx, by, ci, sz], i) => {
      const x = (bx + 0.2 * Math.sin(t * 0.12 * (0.7 + i * 0.23) + i * 2)) * W, y = (by + 0.17 * Math.cos(t * 0.12 * (0.6 + i * 0.19) + i * 1.3)) * H;
      const r = Math.max(W, H) * (0.4 * sz + 0.06 * bassSm + 0.05 * beatEnergy);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${P[ci]},${(0.62 * I).toFixed(3)})`); g.addColorStop(0.55, `rgba(${P[ci]},${(0.2 * I).toFixed(3)})`); g.addColorStop(1, `rgba(${P[ci]},0)`);
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    });
  } else if (cfg.bg === 'waves') {
    c.globalCompositeOperation = 'lighter';
    for (let L = 0; L < 5; L++) {
      const baseY = H * (0.46 + 0.1 * L), amp = H * (0.12 + 0.025 * L) * (0.55 + energySm * 1.1);
      const grad = c.createLinearGradient(0, baseY - amp, 0, H);
      grad.addColorStop(0, `rgba(${P[L % 3]},${(0.42 * I).toFixed(3)})`); grad.addColorStop(1, `rgba(${P[(L + 1) % 3]},0)`);
      c.beginPath(); c.moveTo(0, H);
      const N = 120;
      for (let i = 0; i <= N; i++) {
        const u = i / N, f = Math.abs(u * 2 - 1) * (NB - 1), i0 = Math.floor(f), i1 = Math.min(NB - 1, i0 + 1), v = lerp(sm[i0], sm[i1], f - i0);
        const y = baseY - amp * Math.pow(v, 0.9) * (1 - 0.13 * L) + Math.sin(u * 6 + t * (0.5 + L * 0.22) * sp + L) * H * 0.022 + Math.sin(u * 15 - t * 0.7 * sp + L * 2) * H * 0.008;
        c.lineTo(u * W, y);
      }
      c.lineTo(W, H); c.closePath(); c.fillStyle = grad; c.fill();
      c.strokeStyle = `rgba(${accent.map((v) => Math.round(lerp(v, 255, 0.5))).join(',')},${(0.35 * I).toFixed(3)})`; c.lineWidth = 1.5; c.stroke();
    }
  } else if (cfg.bg === 'warp') {
    const cx = artCx || W / 2, cy = artCy || H / 2, k = Math.max(W, H) * 0.32;
    const speed = (0.16 + energySm * 0.95 + beatEnergy * 1.1) * sp;
    c.globalCompositeOperation = 'lighter';
    const gl0 = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.5);
    gl0.addColorStop(0, `rgba(${P[0]},${(0.2 + bassSm * 0.3).toFixed(3)})`); gl0.addColorStop(1, `rgba(${P[0]},0)`);
    c.fillStyle = gl0; c.fillRect(0, 0, W, H);
    c.lineCap = 'round';
    for (const s of warpStars) {
      const pz = s.z + speed * dt * 0.9 + 0.004;
      s.z -= speed * dt * 0.55;
      if (s.z <= 0.025) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; continue; }
      const x1 = cx + s.x / s.z * k * 0.5, y1 = cy + s.y / s.z * k * 0.5, x0 = cx + s.x / Math.min(pz, 1.2) * k * 0.5, y0 = cy + s.y / Math.min(pz, 1.2) * k * 0.5;
      if (x1 < -50 || x1 > W + 50 || y1 < -50 || y1 > H + 50) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; continue; }
      const a = clamp((1 - s.z) * 1.1, 0, 1) * I;
      c.strokeStyle = `rgba(${s.ci === 0 ? '255,255,255' : P[s.ci]},${a.toFixed(3)})`; c.lineWidth = 0.4 + (1 - s.z) * 2.2;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
  } else if (cfg.bg === 'synth') {
    const hz = H * 0.6, cx = W / 2;
    const sky = c.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#04020c'); sky.addColorStop(0.65, `rgba(${P[1]},${(0.28 * I).toFixed(3)})`); sky.addColorStop(1, `rgba(${P[0]},${(0.55 * I).toFixed(3)})`);
    c.fillStyle = sky; c.fillRect(0, 0, W, hz);
    const sr = H * 0.2 * (1 + bassSm * 0.12 + beatEnergy * 0.06), sy = hz - sr * 0.28;
    c.save(); c.beginPath(); c.arc(cx, sy, sr, 0, Math.PI * 2); c.clip();
    const sg = c.createLinearGradient(0, sy - sr, 0, sy + sr);
    sg.addColorStop(0, `rgb(${P[2]})`); sg.addColorStop(1, `rgb(${P[0]})`);
    c.fillStyle = sg; c.globalAlpha = clamp(0.95 * I, 0, 1); c.fillRect(cx - sr, sy - sr, sr * 2, sr * 2); c.globalAlpha = 1;
    c.fillStyle = '#04020c';
    for (let i = 0; i < 8; i++) { const yy = sy + sr * (0.02 + i * 0.12) - ((t * 0.02 * sp) % 0.12) * sr * 0; c.fillRect(cx - sr, yy, sr * 2, sr * (0.012 + i * 0.011)); }
    c.restore();
    const gnd = c.createLinearGradient(0, hz, 0, H); gnd.addColorStop(0, '#0a0418'); gnd.addColorStop(1, '#03020a');
    c.fillStyle = gnd; c.fillRect(0, hz, W, H - hz);
    const hg = c.createLinearGradient(0, hz - H * 0.05, 0, hz + H * 0.06);
    hg.addColorStop(0, `rgba(${P[0]},0)`); hg.addColorStop(0.5, `rgba(${P[0]},${(0.5 * I).toFixed(3)})`); hg.addColorStop(1, `rgba(${P[0]},0)`);
    c.globalCompositeOperation = 'lighter'; c.fillStyle = hg; c.fillRect(0, hz - H * 0.05, W, H * 0.11);
    const glow = 0.5 + beatEnergy * 0.5 + bassSm * 0.4;
    c.lineWidth = 1.2;
    for (let i = -14; i <= 14; i++) {                               // linee che convergono all'orizzonte
      c.strokeStyle = `rgba(${P[1]},${(0.5 * glow * I).toFixed(3)})`;
      c.beginPath(); c.moveTo(cx + i * W * 0.012, hz); c.lineTo(cx + i * W * 0.2, H); c.stroke();
    }
    const off = (t * 0.25 * sp) % 1;
    for (let j = 0; j < 16; j++) {                                  // linee orizzontali che scorrono verso di te
      const z = (j + off) / 16, y = hz + (H - hz) * Math.pow(z, 2.3);
      c.strokeStyle = `rgba(${P[1]},${(clamp(z * 1.3, 0, 1) * 0.7 * glow * I).toFixed(3)})`; c.lineWidth = 0.6 + z * 2.2;
      c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
    }
  } else if (cfg.bg === 'bokeh') {
    c.globalCompositeOperation = 'lighter';
    for (const b of bokeh) {
      b.y -= b.s * dt * (0.35 + energySm * 2.2) * sp * (0.5 + b.layer);
      if (b.y < -0.2) { b.y = 1.2; b.x = Math.random(); }
      const r = b.r * H * (1 + bassSm * 0.4 * b.layer + beatEnergy * 0.15), x = (b.x + Math.sin(t * 0.1 + b.ph) * 0.03) * W, y = b.y * H;
      const a = b.a * (0.65 + 0.35 * Math.sin(t * 0.5 + b.ph)) * I * (0.7 + beatEnergy * 0.7);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${P[b.ci]},${(a * 0.5).toFixed(3)})`); g.addColorStop(0.8, `rgba(${P[b.ci]},${(a * 0.75).toFixed(3)})`); g.addColorStop(1, `rgba(${P[b.ci]},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
    }
  }
  c.globalCompositeOperation = 'source-over';
}

const blurEl = $('#blur'), lyricsEl = $('#lyrics');
let lastBeatVar = -1;
// sfondo «copertina sfocata»: la sfocatura si calcola una volta sola per brano su un'immagine piccola
// (prima era un filtro CSS da 70 px sull'intero schermo, ricalcolato a ogni fotogramma)
function drawBlurredArt(im) {
  const N = 256;
  if (blurEl.width !== N) { blurEl.width = N; blurEl.height = N; }
  const x = blurEl.getContext('2d');
  x.filter = 'blur(5px) saturate(1.6) brightness(.55)';
  x.drawImage(im, -20, -20, N + 40, N + 40);                 // un po' più grande: niente bordi sfumati verso il trasparente
  x.filter = 'none';
}
function drawBlur(now) {
  if (cfg.bg !== 'blur' && !(document.body.classList.contains('no-webgl') && cfg.bg === 'aurora')) return;
  const t = now / 1000 * (cfg.bgSpeed / 100);
  blurEl.style.transform = `rotate(${(Math.sin(t * 0.05) * 6).toFixed(2)}deg) scale(${(1.12 + bassSm * 0.06 + beatEnergy * 0.03).toFixed(3)}) translate(${(Math.sin(t * 0.07) * 2).toFixed(2)}%, ${(Math.cos(t * 0.06) * 2).toFixed(2)}%)`;
  blurEl.style.opacity = clamp(cfg.bgIntensity / 100, 0.3, 1);
}

/* ====================================================================== *
 *  Layout
 * ====================================================================== */
const ring = $('#ring'), rc = ring.getContext('2d');
const fx = $('#fx'), fc = fx.getContext('2d');
const spec = $('#spec'), sc = spec.getContext('2d');
let ringCss = 0, artR = 0, dpr = 1, artCx = 0, artCy = 0;

function layout() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const a = $('#art');
  artR = a.offsetWidth / 2;                                   // misure di layout: non risentono di rotazione/scala
  artCx = a.offsetLeft + artR; artCy = a.offsetTop + artR;
  ringCss = Math.ceil(artR * 2 * 2.0);
  ring.style.width = ringCss + 'px'; ring.style.height = ringCss + 'px';
  ring.width = Math.round(ringCss * dpr); ring.height = Math.round(ringCss * dpr);
  const d = Math.min(dpr, 1.5), W = window.innerWidth, H = window.innerHeight;
  fx.width = Math.round(W * d); fx.height = Math.round(H * d); fc.setTransform(d, 0, 0, d, 0, 0);
  sizeSpec();
  sizeBg2d();
  layoutList();
}

function layoutList() {
  const disc = $('#disc'), D = disc.offsetWidth;                // misura di layout: non risente della scala del widget
  if (!D) return;
  const items = disc.querySelectorAll('.list .it');
  const base = D / 2 + Math.min(window.innerWidth * 0.0625, window.innerHeight * 0.1111) * 0.28;
  const start = -46, step = 30;
  items.forEach((el, i) => {
    const a = (start + i * step) * Math.PI / 180;
    el.style.left = (D / 2 + Math.cos(a) * base) + 'px';
    el.style.top = (D / 2 + Math.sin(a) * base) + 'px';
    el.style.transform = `translateY(-50%) rotate(${(start + i * step) * 0.5}deg)`;
    el.style.opacity = i === 0 ? 1 : Math.max(0.35, 1 - i * 0.18);
  });
}

const recent = (n) => history.filter((h) => h.key !== state.key).slice(0, n);
const ago = (t) => {
  if (!t) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  return m < 1 ? 'poco fa' : m < 60 ? m + ' min fa' : Math.floor(m / 60) + ' h fa';
};
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

function renderList() {
  const w = cfg.sideWidget;
  if (w === 'vinyl') renderVinyl(); else if (w === 'cards') renderCards(); else if (w === 'timeline') renderTimeline(); else if (w === 'queue') renderQueue();
}

function renderVinyl() {
  const list = $('#disc .list'); list.textContent = '';
  const mk = (cls, t, a) => {
    const it = el('div', 'it ' + cls); it.appendChild(el('b', '', t));
    if (a) it.appendChild(el('em', '', a));
    list.appendChild(it);
  };
  if (state.title && cfg.wNow) mk('now', state.title, state.artist);
  recent(Math.min(cfg.wCount, 5)).forEach((h) => mk('', h.title, h.artist));
  layoutList();
}

function addCard(box, title, artist, thumb, now, op) {
  const c = el('div', 'card' + (now ? ' now' : '')); c.style.opacity = now ? 1 : op;
  const th = el('div', 'th'); if (thumb) th.style.backgroundImage = `url("${thumb}")`; c.appendChild(th);
  const tx = el('div', 'tx'); tx.appendChild(el('b', '', title)); tx.appendChild(el('em', '', artist || '')); c.appendChild(tx);
  if (now) { const eq = el('div', 'eq'); for (let k = 0; k < 4; k++) eq.appendChild(el('i')); c.appendChild(eq); }
  box.appendChild(c);
}

function renderCards() {
  const box = $('#cards'); box.textContent = ''; box.classList.remove('q');
  if (state.title && cfg.wNow) addCard(box, state.title, state.artist, state.thumb, true, 1);
  recent(cfg.wCount).forEach((h, i) => addCard(box, h.title, h.artist + (h.t ? ' · ' + ago(h.t) : ''), h.thumb, false, Math.max(0.4, 0.9 - (i + 1) * 0.12)));
}

/* ---------- coda di Spotify ----------
 * intestazione · brano in corso (riga sottile) · «Subito dopo» in evidenza · elenco dei successivi con l'ora di partenza */
const mmss = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function qThumb(url) { const th = el('div', 'th'); if (url) th.style.backgroundImage = `url("${url}")`; return th; }
function qText(title, artist) { const tx = el('div', 'tx'); tx.appendChild(el('b', '', title)); if (artist) tx.appendChild(el('em', '', artist)); return tx; }
const Q_LAYOUTS = ['list', 'covers', 'stack', 'timeline', 'ticker'];
// orario di partenza («tra 3:20»): l'elemento porta i secondi dalla fine del brano in corso, il testo lo scrive updateQueueTimes
function qAt(off, pre) { const t = el('time', 'at'); t.dataset.off = off; if (pre !== undefined) t.dataset.pre = pre; return t; }
function qNowRow() {                                       // in riproduzione: riga sottile con equalizzatore, tempo che manca e barra
  const r = el('div', 'qnow'); const eq = el('div', 'eq'); for (let k = 0; k < 4; k++) eq.appendChild(el('i'));
  r.appendChild(eq); r.appendChild(qText(state.title, state.artist)); r.appendChild(el('time', 'rem'));
  const bar = el('div', 'bar'); bar.appendChild(el('i')); r.appendChild(bar);
  return r;
}
function renderQueue() {
  const box = $('#queue'); box.textContent = '';
  const lay = Q_LAYOUTS.includes(cfg.qLayout) ? cfg.qLayout : 'list';
  box.className = 'ql-' + lay;
  const ok = sp.state === 'ok';
  const next = ok ? sp.items.filter((q) => q.t !== state.title) : [];   // subito dopo un cambio brano la coda è ancora quella vecchia
  const shown = next.slice(0, cfg.wCount);
  const offs = []; let off = 0;                            // secondi tra la fine del brano in corso e l'inizio di ciascuno
  shown.forEach((q) => { offs.push(off); off = q.d ? off + q.d : NaN; });   // senza durata non si sa quando partono i successivi
  const msg = !ok ? (sp.state === 'error' ? 'Coda non disponibile · vedi Impostazioni' : 'Collega Spotify nelle impostazioni per vedere la coda')
    : (!next.length ? 'Nessun brano in coda' : '');

  if (lay === 'ticker') {                                  // una riga sola: «Dopo: titolo — artista · tra 1:23 · poi …»
    box.appendChild(el('i', 'dot'));
    if (msg) { box.appendChild(el('span', 'qmsg', msg)); updateQueueTimes(); return; }
    shown.forEach((q, i) => {
      const it = el('span', 'tk' + (i === 0 ? ' first' : '')); it.style.setProperty('--k', i);
      it.appendChild(el('span', 'lbl', i === 0 ? 'Dopo' : 'poi'));
      it.appendChild(el('b', '', q.t)); if (q.a) it.appendChild(el('em', '', q.a));
      if (i === 0) it.appendChild(qAt(offs[i]));
      box.appendChild(it);
    });
    updateQueueTimes(); return;
  }

  const hd = el('div', 'qhd'); hd.appendChild(el('i', 'dot')); hd.appendChild(el('span', '', 'In coda'));
  if (next.length) hd.appendChild(el('span', 'cnt', next.length === 1 ? '1 brano' : next.length + ' brani'));
  box.appendChild(hd);
  if (state.title && cfg.wNow && lay !== 'stack') box.appendChild(qNowRow());
  if (msg) { box.appendChild(el('div', 'qmsg', msg)); updateQueueTimes(); return; }

  if (lay === 'covers') {                                  // copertine in fila: la prima più grande
    const row = el('div', 'qcov');
    shown.forEach((q, i) => {
      const c = el('div', 'qc' + (i === 0 ? ' first' : '')); c.style.setProperty('--k', i);
      c.appendChild(qThumb(q.i));
      if (i === 0) c.appendChild(el('span', 'lbl', 'Subito dopo'));
      c.appendChild(qText(q.t, q.a)); c.appendChild(qAt(offs[i]));
      row.appendChild(c);
    });
    box.appendChild(row);
  } else if (lay === 'stack') {                            // pila di copertine: davanti la prossima, dietro le altre; sotto i titoli
    const wrap = el('div', 'qstk'), pile = el('div', 'pile');
    shown.slice(0, 5).forEach((q, i) => { const th = qThumb(q.i); th.style.setProperty('--k', i); pile.appendChild(th); });
    wrap.appendChild(pile);
    const tx = qText(shown[0].t, shown[0].a);
    const l = el('span', 'lbl'); l.appendChild(document.createTextNode('Subito dopo')); l.appendChild(qAt(offs[0], ' · tra ')); tx.prepend(l);
    if (shown.length > 1) tx.appendChild(el('span', 'then', 'poi ' + shown.slice(1, 4).map((q) => q.t).join(' · ')));
    wrap.appendChild(tx);
    box.appendChild(wrap);
  } else if (lay === 'timeline') {                         // linea del tempo: a sinistra quando parte, a destra cosa
    const tl = el('div', 'qtl');
    shown.forEach((q, i) => {
      const r = el('div', 'qt' + (i === 0 ? ' first' : '')); r.style.setProperty('--k', i);
      r.appendChild(qAt(offs[i]));
      if (i === 0) r.appendChild(qThumb(q.i));
      r.appendChild(qText(q.t, q.a));
      tl.appendChild(r);
    });
    box.appendChild(tl);
  } else {                                                 // elenco: «Subito dopo» in evidenza, poi gli altri
    shown.forEach((q, i) => {
      const hero = i === 0 && cfg.wStyle !== 'compact';
      const r = el('div', hero ? 'qnext' : 'qrow'); r.style.setProperty('--k', i);
      if (!hero) r.appendChild(el('span', 'n', String(i + 1)));
      r.appendChild(qThumb(q.i));
      const tx = qText(q.t, q.a);
      if (hero) { const l = el('span', 'lbl'); l.appendChild(document.createTextNode('Subito dopo')); l.appendChild(qAt(offs[i], ' · tra ')); tx.prepend(l); }
      r.appendChild(tx);
      if (!hero) { r.appendChild(qAt(offs[i])); r.style.opacity = Math.max(0.35, 1 - (i - 1) * 0.13).toFixed(2); }
      box.appendChild(r);
    });
  }
  updateQueueTimes();
}
// aggiorna ogni secondo «tra 3:20» e il tempo che manca al brano in corso, senza ridisegnare la coda
function updateQueueTimes() {
  if (cfg.sideWidget !== 'queue') return;
  const box = $('#queue'), d = state.duration, left = d ? Math.max(0, d - getPos()) : NaN;
  const rem = box.querySelector('.qnow .rem'); if (rem) rem.textContent = isNaN(left) ? '' : '−' + mmss(left);
  const bar = box.querySelector('.qnow .bar i'); if (bar) bar.style.width = d ? (getPos() / d * 100).toFixed(1) + '%' : '0%';
  box.querySelectorAll('time.at').forEach((t) => {
    const s = left + Number(t.dataset.off), pre = t.dataset.pre !== undefined ? t.dataset.pre : 'tra ';
    t.textContent = isNaN(s) ? '' : pre + mmss(s);
  });
}

function renderTimeline() {
  const box = $('#tl'); box.textContent = '';
  const add = (label, title, artist, now) => {
    const r = el('div', 'row' + (now ? ' now' : ''));
    r.appendChild(el('span', 'when', label)); r.appendChild(el('b', '', title)); r.appendChild(el('em', '', artist || ''));
    box.appendChild(r);
  };
  if (state.title && cfg.wNow) add('In riproduzione', state.title, state.artist, true);
  recent(cfg.wCount).forEach((h) => add(ago(h.t) || 'Prima', h.title, h.artist, false));
}

/* ====================================================================== *
 *  Audio, anello, effetti
 * ====================================================================== */
const NB = 64;
const target = new Float32Array(NB), sm = new Float32Array(NB);
let bassSm = 0, trebleSm = 0, energySm = 0, bassAvg = 0, beatEnergy = 0, lastBeat = 0, agcPeak = 0.3;
let audioSeen = 0, mxs = 0, mys = 0, mx = 0, my = 0, artAngle = 0;
const stars = Array.from({ length: 280 }, () => ({ x: Math.random(), y: Math.random(), z: 0.15 + Math.random() * 0.85, ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 2 }));
const parts = [], shocks = [];

function onAudio(arr) {           // arr: 64 valori 0..1
  let pk = 0, sum = 0;
  for (let i = 0; i < NB; i++) { const v = arr[i] || 0; sum += v; if (v > pk) pk = v; }
  if (sum < 0.4) return;           // silenzio
  agcPeak = Math.max(agcPeak * 0.9985, pk, 0.15);
  const gain = clamp(0.8 / agcPeak, 1, 3.5) * (cfg.sensitivity / 100);
  for (let i = 0; i < NB; i++) target[i] = clamp((arr[i] || 0) * (1 + 1.1 * i / (NB - 1)) * gain, 0, 1);
  audioSeen = performance.now();
}

function spawn(n, s) {
  for (let i = 0; i < n && parts.length < 340; i++) {
    const a = Math.random() * Math.PI * 2, r = artR * (1.15 + Math.random() * 0.6), sp = artR * (0.25 + Math.random() * 0.9) * (0.5 + s);
    parts.push({ x: artCx + Math.cos(a) * r, y: artCy + Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - artR * 0.08, life: 0, max: 1.4 + Math.random() * 2, size: 0.8 + Math.random() * 2.2 });
  }
}
function onBeat(s, now) {
  s = clamp(s, 0.35, 1);
  lastBeat = now; beatEnergy = Math.max(beatEnergy, s);
  if (!cfg.showCenter) return;                              // niente onde e particelle intorno a una copertina che non c'è
  if (cfg.showShocks) { shocks.push({ t: now, s }); if (shocks.length > 6) shocks.shift(); }
  if (cfg.showParticles) spawn(Math.round(8 + s * 18), s);
}

const BARS = 160;
function drawRing(dt, now) {
  const k1 = 1 - Math.exp(-dt * 32), k2 = 1 - Math.exp(-dt * 7);
  const live = now - audioSeen < 1200;
  let b = 0, bf = 0, tr = 0, en = 0;
  for (let i = 0; i < NB; i++) {
    let t = target[i];
    if (!live) { t = 0; target[i] *= 0.9; }
    if (!live && !state.playing) t = 0.05 + 0.035 * Math.sin(now / 1000 * 0.9 + i * 0.22);   // respiro a riposo
    sm[i] += (t - sm[i]) * (t > sm[i] ? k1 : k2);
    if (i < 6) { b += sm[i]; bf += target[i]; }
    if (i >= 28) tr += sm[i];
    en += sm[i];
  }
  bassSm += (b / 6 - bassSm) * (1 - Math.exp(-dt * 12));
  trebleSm += (tr / (NB - 28) - trebleSm) * (1 - Math.exp(-dt * 8));
  energySm += (en / NB - energySm) * (1 - Math.exp(-dt * 5));
  const bassFast = bf / 6;
  bassAvg += (bassFast - bassAvg) * (1 - Math.exp(-dt * 1.4));
  if (live && bassFast > bassAvg * 1.28 + 0.06 && now - lastBeat > 230) onBeat((bassFast - bassAvg) * 3.2, now);
  beatEnergy *= Math.exp(-dt * 4.2);

  const c = rc, S = ringCss;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2, r0 = artR * 1.14, maxLen = artR * 0.85;
  const acc = accent, light = acc.map((v) => Math.round(lerp(v, 255, 0.78)));
  const rot = cfg.ringRotate ? now / 1000 * 0.05 : 0;
  const val = (t) => {                         // t in [0,1): basso in basso, acuti in alto, specchiato
    const f = Math.abs(2 * t - 1) * (NB - 1), i0 = Math.floor(f), i1 = Math.min(NB - 1, i0 + 1);
    return lerp(sm[i0], sm[i1], f - i0);
  };
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = `rgb(${light.join(',')})`; c.shadowColor = `rgba(${acc.join(',')},.95)`; c.shadowBlur = artR * 0.2;
  if (cfg.ringStyle === 'wave') {
    const K = 120, pts = [], raw = [];
    for (let k = 0; k < K; k++) raw.push(val(k / K));
    for (let k = 0; k < K; k++) {
      const v = (raw[(k + K - 1) % K] + raw[k] * 2 + raw[(k + 1) % K]) / 4;
      const ang = k / K * Math.PI * 2 - Math.PI / 2 + rot, r = r0 + artR * 0.03 + Math.pow(v, 0.85) * maxLen * 0.8;
      pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
    }
    c.beginPath();
    const m0 = [(pts[K - 1][0] + pts[0][0]) / 2, (pts[K - 1][1] + pts[0][1]) / 2];
    c.moveTo(m0[0], m0[1]);
    for (let k = 0; k < K; k++) { const p = pts[k], q = pts[(k + 1) % K]; c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
    c.closePath();
    c.fillStyle = `rgba(${acc.join(',')},.1)`; c.fill();
    c.lineWidth = Math.max(2, artR * 0.035); c.stroke();
  } else if (cfg.ringStyle === 'dots') {
    c.fillStyle = `rgb(${light.join(',')})`;
    for (let k = 0; k < BARS; k++) {
      const ang = k / BARS * Math.PI * 2 - Math.PI / 2 + rot, len = artR * 0.05 + Math.pow(val(k / BARS), 0.8) * maxLen;
      c.beginPath(); c.arc(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len), Math.max(1.4, artR * 0.022), 0, 6.283); c.fill();
    }
  } else {
    c.lineWidth = Math.max(1.6, artR * 0.03);
    c.beginPath();
    for (let k = 0; k < BARS; k++) {
      const ang = k / BARS * Math.PI * 2 - Math.PI / 2 + rot, len = artR * 0.05 + Math.pow(val(k / BARS), 0.8) * maxLen;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      c.moveTo(cx + ca * r0, cy + sa * r0); c.lineTo(cx + ca * (r0 + len), cy + sa * (r0 + len));
    }
    c.stroke();
  }
  // filo + arco di avanzamento
  c.shadowBlur = 0; c.lineWidth = 1; c.strokeStyle = `rgba(${light.join(',')},.22)`;
  c.beginPath(); c.arc(cx, cy, artR * 1.07, 0, Math.PI * 2); c.stroke();
  if (state.duration && state.title) {
    const prog = clamp(getPos() / state.duration, 0, 1);
    c.shadowColor = `rgba(${acc.join(',')},1)`; c.shadowBlur = artR * 0.12;
    c.lineWidth = Math.max(2, artR * 0.022); c.strokeStyle = `rgb(${light.join(',')})`;
    c.beginPath(); c.arc(cx, cy, artR * 1.07, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); c.stroke();
  }

  const pulse = clamp(bassSm * 1.15 + beatEnergy * 0.35, 0, 1);
  if (cfg.rotateArt && state.playing) artAngle += dt * 7;
  $('#art').style.transform = `rotate(${artAngle.toFixed(2)}deg) scale(${(1 + (cfg.pulseArt ? pulse * 0.04 : 0)).toFixed(4)})`;
  const gl2 = $('#glow');
  gl2.style.opacity = clamp((0.45 + pulse * 0.5) * cfg.glowStrength / 100, 0, 1).toFixed(3);
  gl2.style.transform = `scale(${1 + pulse * 0.2})`;
  // solo sui testi e solo quando cambia davvero: aggiornarla su tutta la pagina a ogni fotogramma costa parecchio
  const bq = beatEnergy < 0.01 ? 0 : Math.round(beatEnergy * 50) / 50;
  if (bq !== lastBeatVar) { lastBeatVar = bq; lyricsEl.style.setProperty('--beat', bq); }
}

function drawFx(dt, now) {
  const W = window.innerWidth, H = window.innerHeight, t = now / 1000;
  mxs += (mx - mxs) * (1 - Math.exp(-dt * 2)); mys += (my - mys) * (1 - Math.exp(-dt * 2));
  fc.clearRect(0, 0, W, H);
  const dr = cfg.drift ? 1 : 0;
  if ((cfg.showStars || cfg.bg === 'stars') && cfg.bg !== 'warp') {
    const boost = 1 + trebleSm * 1.1, base = cfg.bg === 'stars' ? 1.35 : 0.8;
    for (const s of stars) {
      const px = (((s.x - t * 0.004 * s.z) % 1) + 1) % 1 * W + mxs * 14 * s.z * dr, py = s.y * H + mys * 9 * s.z * dr;
      const a = clamp((0.14 + 0.5 * s.z) * (0.65 + 0.35 * Math.sin(t * s.sp + s.ph)) * boost * base, 0, 0.95);
      fc.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      const sz = 0.6 + 1.3 * s.z; fc.fillRect(px, py, sz, sz);
    }
  }
  const light = accent.map((v) => Math.round(lerp(v, 255, 0.6)));
  fc.globalCompositeOperation = 'lighter';
  for (let i = shocks.length - 1; i >= 0; i--) {
    const sh = shocks[i], age = (now - sh.t) / 1500;
    if (age >= 1) { shocks.splice(i, 1); continue; }
    const r = artR * 1.25 + age * artR * (2.4 + sh.s * 1.6), a = Math.pow(1 - age, 2) * (0.3 + 0.4 * sh.s);
    fc.strokeStyle = `rgba(${light.join(',')},${a.toFixed(3)})`; fc.lineWidth = 0.6 + 2.4 * (1 - age);
    fc.beginPath(); fc.arc(artCx, artCy, r, 0, Math.PI * 2); fc.stroke();
  }
  if (cfg.showParticles && (state.playing || now - audioSeen < 1200) && Math.random() < (5 + energySm * 40) * dt) spawn(1, energySm);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life += dt;
    if (p.life >= p.max) { parts.splice(i, 1); continue; }
    p.vx *= 1 - 0.28 * dt; p.vy *= 1 - 0.28 * dt;
    p.x += p.vx * dt + Math.sin(t * 1.3 + p.max * 5) * 6 * dt; p.y += p.vy * dt;
    const f = p.life / p.max, a = Math.sin(f * Math.PI) * 0.75;
    fc.fillStyle = `rgba(${light.join(',')},${a.toFixed(3)})`;
    fc.beginPath(); fc.arc(p.x, p.y, p.size * (1 - f * 0.4), 0, 6.283); fc.fill();
  }
  fc.globalCompositeOperation = 'source-over';
}

function drawSpec() {
  const W = window.innerWidth, H = window.innerHeight;
  sc.clearRect(0, 0, W, H);
  if (!cfg.spectrumBottom) return;
  const N = 64, hMax = H * 0.2 * cfg.specHeight / 100, bw = W / 2 / N, gap = Math.max(1, bw * 0.28);
  const g = sc.createLinearGradient(0, H, 0, H - hMax);
  g.addColorStop(0, `rgba(${accent.join(',')},.55)`); g.addColorStop(1, `rgba(${accent.join(',')},0)`);
  sc.fillStyle = g; sc.globalCompositeOperation = 'lighter';
  for (let i = 0; i < N; i++) {
    const v = Math.pow(sm[Math.min(NB - 1, Math.floor(Math.pow(i / N, 1.15) * NB))], 1.1), h = Math.max(1.5, v * hMax);
    sc.fillRect(W / 2 + i * bw, H - h, bw - gap, h);
    sc.fillRect(W / 2 - (i + 1) * bw + gap, H - h, bw - gap, h);
  }
  sc.globalCompositeOperation = 'source-over';
}

/* ====================================================================== *
 *  Testi sincronizzati (LRCLIB)
 * ====================================================================== */
const STOP = new Set(('i,a,an,the,to,of,in,on,at,as,so,or,and,my,me,we,it,is,im,i\'m,i\'ve,i\'ll,i\'d,be,do,if,up,no,oh,' +
  'il,lo,la,gli,le,un,una,uno,di,da,in,con,su,per,tra,fra,e,è,ed,che,non,mi,ti,ci,si,ma,o,li,al,del,dei,nel,ho,ha,ne,vi').split(','));
const clean = (t) => t.replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').replace(/\s+-\s+.*$/, '').replace(/\s+/g, ' ').trim();
const firstArtist = (a) => a.split(/,|&| feat\.?| ft\.?| x | e /i)[0].trim();

async function jget(url) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 7000);
  try { const r = await fetch(url, { signal: ctl.signal }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(to); }
}
function parseLRC(txt) {
  const out = [];
  for (const raw of txt.split(/\r?\n/)) {
    const re = /\[(\d+):(\d+(?:[.,]\d+)?)\]/g; let m, last = 0; const ts = [];
    while ((m = re.exec(raw))) { ts.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(',', '.'))); last = re.lastIndex; }
    if (!ts.length) continue;
    const text = raw.slice(last).replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    ts.forEach((t) => out.push({ t, text }));
  }
  return out.sort((a, b) => a.t - b.t);
}
function pickLyrics() {
  const c = state.candidates; if (!c || !c.length) return null;
  const dur = state.duration, art = firstArtist(state.artist).toLowerCase();
  let best = null, bs = Infinity;
  for (const r of c) {
    if (!r.syncedLyrics) continue;
    let s = 0;
    if (dur && r.duration) s += Math.abs(r.duration - dur) * 2;
    if (r.artistName && !r.artistName.toLowerCase().includes(art)) s += 40;
    if (s < bs) { bs = s; best = r; }
  }
  if (!best || (dur && best.duration && Math.abs(best.duration - dur) > 12)) return null;
  const lines = parseLRC(best.syncedLyrics);
  return lines.length ? lines : null;
}
async function fetchLyrics(req) {
  const title = clean(state.title), artist = firstArtist(state.artist);
  const base = 'https://lrclib.net/api/search?';
  const qs = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  let res = await jget(base + qs({ track_name: title, artist_name: artist }));
  if (req !== state.lyricReq) return;
  if (!res || !res.length) { res = await jget(base + qs({ q: title + ' ' + artist })); if (req !== state.lyricReq) return; }
  state.candidates = res || [];
  const t0 = performance.now();
  while (!state.duration && performance.now() - t0 < 2500) { await new Promise((r) => setTimeout(r, 200)); if (req !== state.lyricReq) return; }
  state.lyrics = pickLyrics(); state.lyricIdx = -2;
}

const stack = $('#lyrics .stack'), nextEl = $('#lyrics .next');
function buildLine(text) {
  const el = document.createElement('div'); el.className = 'line';
  let words = text.split(/\s+/).filter(Boolean);
  if (words.length > 12) words = words.slice(0, 12).concat('…');
  const n = words.join(' ').length;
  el.style.fontSize = (n <= 26 ? 1 : clamp(26 / n + 0.2, 0.5, 1)).toFixed(3) + 'em';
  let longest = 0;
  words.forEach((w, i) => { if (w.replace(/\W/g, '').length >= words[longest].replace(/\W/g, '').length && !STOP.has(w.toLowerCase().replace(/[^\w'è]/g, ''))) longest = i; });
  words.forEach((w, i) => {
    const bare = w.toLowerCase().replace(/[^\w'è]/g, ''), s = document.createElement('span');
    let cls = 'l';
    if (STOP.has(bare)) cls = 's'; else if (bare.length <= 3) cls = 'm'; else if (i === longest && words.length > 1) cls = 'x';
    s.className = 'w ' + cls; s.textContent = w; s.style.setProperty('--i', i);
    el.appendChild(s);
  });
  return el;
}
function showLine(text, next) {
  stack.querySelectorAll('.line:not(.out)').forEach((old) => { old.classList.add('out'); setTimeout(() => old.remove(), 600); });
  if (text) stack.appendChild(buildLine(text));
  nextEl.classList.remove('on');
  if (next) { nextEl.textContent = next; requestAnimationFrame(() => nextEl.classList.add('on')); }
}
function updateLyrics() {
  const L = state.lyrics;
  if (!L) {
    if (state.lyricIdx !== -3) {
      state.lyricIdx = -3; showLine(state.title ? (clean(state.title) || state.title) : '', state.artist);
      document.body.classList.toggle('lyr-fb', !!state.title);   // senza testi: il titolo grande sostituisce la didascalia
    }
    return;
  }
  document.body.classList.remove('lyr-fb');
  const t = getPos() + cfg.lyricsOffset / 1000 + 0.12;
  let lo = 0, hi = L.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (L[mid].t <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx === state.lyricIdx) return;
  state.lyricIdx = idx;
  if (idx < 0) { showLine('', L[0] ? L[0].text : ''); return; }
  let nx = ''; for (let j = idx + 1; j < L.length && j <= idx + 2; j++) { if (L[j].text) { nx = L[j].text; break; } }
  showLine(L[idx].text, nx);
}

/* ====================================================================== *
 *  Brano
 * ====================================================================== */
function setTrack(title, artist, album) {
  title = (title || '').trim(); artist = (artist || '').trim();
  const key = title ? (artist + '|' + title + '|' + (album || '')) : '';
  if (key === state.key) return;
  if (state.key && state.title) {
    history = history.filter((h) => h.key !== state.key);
    history.unshift({ key: state.key, title: state.title, artist: state.artist, thumb: state.thumb || '', t: Date.now() }); history.length = Math.min(history.length, 10); saveHistory();
  }
  state.key = key; state.title = title; state.artist = artist; state.album = album || ''; state.thumb = '';
  state.lyrics = null; state.candidates = null; state.lyricIdx = -2; state.duration = 0;
  const req = ++state.lyricReq;
  document.body.classList.toggle('idle', !title);
  $('#caption .t').textContent = title; $('#caption .a').textContent = artist;
  if (!WALL && !SETWIN) document.title = title ? `${title} — ${artist}` : 'Spotify Orbit';
  renderList(); showLine('', '');
  if (title && !demo.on && cfg.showLyrics) fetchLyrics(req);   // testi spenti (es. schermo secondario): non servono
}

function setArt(url) {
  const im = new Image();
  im.onload = () => {
    document.querySelectorAll('.img').forEach((el) => { el.style.backgroundImage = `url("${url}")`; });
    try { drawBlurredArt(im); } catch (e) { /* resta lo sfondo scuro */ }
    const a = $('#art .img'); a.classList.remove('swap'); void a.offsetWidth; a.classList.add('swap');
    artPal = extractPalette(im); recomputePalette();
    try {                                                                   // miniatura per la cronologia
      const tc = document.createElement('canvas'); tc.width = tc.height = 72;
      const tx = tc.getContext('2d'); const s = Math.min(im.width, im.height);
      tx.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 72, 72);
      state.thumb = tc.toDataURL('image/jpeg', 0.72); renderList();
    } catch (e) { /* nessuna miniatura */ }
    if (artR) { onBeat(1, performance.now()); if (cfg.showParticles) spawn(40, 1); }
  };
  im.src = url;
}
function clearArt() {
  document.querySelectorAll('.img').forEach((el) => { el.style.backgroundImage = ''; });
  blurEl.width = 2; blurEl.height = 2; artPal = null; state.thumb = ''; recomputePalette();
}

/* ====================================================================== *
 *  Collegamento al motore
 * ====================================================================== */
let es = null;
function connect() {
  if (es) es.close();
  es = new EventSource('/stream' + (WALL && MON !== undefined ? '?mon=' + MON : ''));
  es.addEventListener('track', (e) => {
    if (demo.on) return;
    const m = JSON.parse(e.data);
    setTrack(m.title, m.artist, m.album);
    if (m.hasArt) setArt('/art?v=' + m.artv); else clearArt();
  });
  es.addEventListener('update', (e) => {
    Object.assign(upd, JSON.parse(e.data));
    renderUpdate();
  });
  es.addEventListener('queue', (e) => {
    const m = JSON.parse(e.data);
    sp.state = m.state; sp.msg = m.msg || ''; sp.items = m.items || [];
    updateSpotifyUI();
    if (cfg.sideWidget === 'queue' && !demo.on) renderQueue();
  });
  es.addEventListener('settings', (e) => {                 // modifiche fatte da un'altra finestra
    const m = JSON.parse(e.data);
    if (m.cid === CID) return;
    cfg = effective(migrate({ ...DEFAULTS, ...m.cfg }, m.cfg)); refreshPanel(); applyCfg();
  });
  es.onmessage = (e) => {
    const f = JSON.parse(e.data);
    paused = !!f.z;
    if (demo.on) return;
    state.pos = f.p; state.posT = performance.now(); state.playing = !!f.pl;
    if (f.d) state.duration = f.d;
    const a = f.a, arr = new Float32Array(NB);
    for (let i = 0; i < NB; i++) arr[i] = a[i] / 255;
    onAudio(arr);
  };
}

function api(cmd) { fetch('/api/cmd?c=' + cmd, { method: 'POST' }).catch(() => {}); }
function quitApp() { fetch('/api/quit', { method: 'POST' }).finally(() => window.close()); }

/* ====================================================================== *
 *  Anteprima demo
 * ====================================================================== */
function demoArt() {
  const c = document.createElement('canvas'); c.width = c.height = 400;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 400); g.addColorStop(0, '#2a0a6e'); g.addColorStop(1, '#ff4d8d');
  x.fillStyle = g; x.fillRect(0, 0, 400, 400);
  const sun = x.createRadialGradient(200, 220, 5, 200, 220, 130); sun.addColorStop(0, '#fff1c9'); sun.addColorStop(1, 'rgba(255,140,90,0)');
  x.fillStyle = sun; x.fillRect(0, 0, 400, 400);
  x.fillStyle = '#12082e'; x.beginPath(); x.moveTo(0, 400); x.lineTo(0, 300); x.quadraticCurveTo(100, 250, 200, 300); x.quadraticCurveTo(300, 350, 400, 280); x.lineTo(400, 400); x.fill();
  x.fillStyle = '#4ad6ff'; x.beginPath(); x.arc(290, 120, 22, 0, 7); x.fill();
  return c.toDataURL('image/png');
}
function startDemo() {
  demo.on = true; demo.t0 = performance.now();
  setArt(demoArt());
  setTrack('Orbita di prova', 'Spotify Orbit', 'Demo');
  state.duration = 214; state.playing = true;
  const now0 = Date.now();
  history = [{ key: 'a', title: 'Ultima notte', artist: 'Artista Uno', t: now0 - 4 * 60000 }, { key: 'b', title: 'Tra le stelle', artist: 'Artista Due', t: now0 - 9 * 60000 }, { key: 'c', title: 'Luci sul mare', artist: 'Artista Tre', t: now0 - 15 * 60000 }]; renderList();
  const lines = ['Questa è solo una demo', 'i testi veri arrivano da Spotify', 'in tempo con la canzone', 'e i colori seguono la copertina', 'ascolta come pulsa il cuore', 'dell\'universo intorno a te', 'non smettere di ascoltare', 'resta con me fino all\'alba'];
  state.lyricReq++; state.lyrics = lines.map((text, i) => ({ t: 6 + i * 4.2, text })); state.lyricIdx = -2;
}
function stopDemo() {
  demo.on = false; state.lyrics = null; state.playing = false;
  setTrack('', '', ''); clearArt(); connect();
  history = []; try { history = JSON.parse(localStorage.getItem('orbit.history') || '[]'); } catch (e) {}
}
function runDemo(now) {
  const t = (now - demo.t0) / 1000;
  state.pos = (t % 200) + 2; state.posT = now; state.playing = true;
  const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.95)), 6), off = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 3.9 + 1.1)), 8);
  const arr = new Float32Array(NB);
  for (let i = 0; i < NB; i++) {
    const env = Math.exp(-i / 40), n = 0.6 + 0.4 * Math.sin(t * 7.3 + i * 0.9) * Math.sin(t * 3.1 + i * 0.37);
    const hit = i < 18 ? beat : (i < 40 ? 0.45 * beat + 0.35 * off : 0.7 * off);
    arr[i] = clamp((0.2 + 0.7 * hit) * env * n * 1.4 + 0.05, 0, 1);
  }
  onAudio(arr);
}

/* ====================================================================== *
 *  Orologio, tastiera, mouse
 * ====================================================================== */
let lastMin = -1;
function tickClock() {
  const n = new Date();
  if (n.getMinutes() !== lastMin) { lastMin = n.getMinutes(); if (cfg.sideWidget === 'cards' || cfg.sideWidget === 'timeline') renderList(); }   // aggiorna "x min fa"
  updateQueueTimes();
  const o = { hour: '2-digit', minute: '2-digit', hour12: !cfg.clock24 };
  if (cfg.showSeconds) o.second = '2-digit';
  $('#clock .time').textContent = n.toLocaleTimeString('it-IT', o);
  const df = { long: { weekday: 'long', day: 'numeric', month: 'long' }, short: { day: '2-digit', month: '2-digit', year: 'numeric' }, full: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } }[cfg.dateFormat] || {};
  $('#clock .date').textContent = n.toLocaleDateString('it-IT', df);
}

let toastT = 0;
function toast(msg) {
  if (WALL) return;
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
}
function toggleFS() {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
}
function togglePanel(force) {
  const open = force !== undefined ? force : !document.body.classList.contains('panel-open');
  document.body.classList.toggle('panel-open', open);
  $('#panel').setAttribute('aria-hidden', String(!open));
}

let moveT = 0;
window.addEventListener('mousemove', (e) => {
  mx = e.clientX / window.innerWidth * 2 - 1; my = e.clientY / window.innerHeight * 2 - 1;
  document.body.classList.add('moving'); clearTimeout(moveT);
  moveT = setTimeout(() => document.body.classList.remove('moving'), 2800);
});
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== 'Escape') return;
  const k = e.key;
  if (k === 's' || k === 'S') togglePanel();
  else if (k === 'Escape') togglePanel(false);
  else if (k === 'f' || k === 'F') toggleFS();
  else if (k === ' ') { e.preventDefault(); api('playpause'); }
  else if (k === 'ArrowRight') api('next');
  else if (k === 'ArrowLeft') api('prev');
  else if (k === '[' || k === ']') {
    cfg.lyricsOffset += k === ']' ? 100 : -100; refreshPanel(); scheduleSave(); toast('Anticipo testi: ' + cfg.lyricsOffset + ' ms');
  }
});
$('#gear').onclick = () => togglePanel();
$('#art').onclick = () => api('playpause');
$('#stage').addEventListener('dblclick', (e) => { if (e.target.id === 'stage') toggleFS(); });
$('#vig').addEventListener('dblclick', toggleFS);
let rzT = 0;
window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { resizeGL(); layout(); }, 120); });

/* ====================================================================== *
 *  Ciclo di disegno
 * ====================================================================== */
let last = performance.now();
const capBar = $('#caption .p i'), capTime = $('#caption .tm');
let capW = '', capTm = null;
let lastMouse = 0;
window.addEventListener('mousemove', () => { lastMouse = performance.now(); });
function idleNow(now) {
  if (WALL) return paused && cfg.pauseCovered;                                     // desktop coperto
  // finestra delle impostazioni dietro ad altre o non usata: l'anteprima si ferma finché non ci torni
  return SETWIN && (document.hidden || (!document.hasFocus() && now - lastMouse > 3000));
}
function frame(now) {
  const idle = idleNow(now);
  document.body.classList.toggle('paused', idle);
  if (idle) { setTimeout(() => requestAnimationFrame(frame), 400); return; }     // niente disegno
  if (now - last < 1000 / (Number(cfg.fps) || 60) - 2.5) { requestAnimationFrame(frame); return; }          // limite di fotogrammi
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (demo.on) runDemo(now);
  tAcc += dt * (cfg.bgSpeed / 100) * (1 + energySm * 1.6);
  document.body.classList.toggle('is-playing', !!state.playing);
  drawRing(dt, now);
  drawAurora(dt);
  drawBg2d(dt, now);
  drawBlur(now);
  drawFx(dt, now);
  drawSpec();
  if (cfg.showCenter) {
    const p = getPos(), d = state.duration, fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const w = d ? (p / d * 100).toFixed(1) + '%' : '0%', tm = state.title && d ? fmt(p) + '  /  ' + fmt(d) : '';
    if (w !== capW) { capW = w; capBar.style.width = w; }               // solo quando cambia: niente lavoro di layout a ogni fotogramma
    if (tm !== capTm) { capTm = tm; capTime.textContent = tm; }
  }
  if (cfg.showLyrics) updateLyrics();
  if (cfg.drift && cfg.bg === 'blur') { /* il movimento è già nello sfondo */ }
  requestAnimationFrame(frame);
}

async function init() {
  if (WALL && MON !== undefined) {                         // su quale monitor sta questo sfondo: serve prima delle impostazioni (schermi secondari)
    try { const l = await (await fetch('/api/monitors')).json(); const m = l.find((x) => String(x.i) === MON); monPrimary = !m || !!m.primary; } catch (e) { /* principale */ }
  }
  await loadCfg();
  if (WALL) { document.body.classList.add('wall'); document.title = 'SpotifyOrbitWallpaper[' + (MON === undefined ? '0' : MON) + ']'; }
  if (SETWIN) document.title = 'Spotify Orbit — Impostazioni';
  initGL();
  buildPanel();
  initUpdateBar();
  applyCfg();
  layout();
  setInterval(tickClock, 1000);
  document.body.classList.add('idle');
  renderList();
  if (/[?&]demo/.test(location.search)) startDemo(); else connect();
  if (SETWIN || /[?&]panel/.test(location.search)) togglePanel(true);
  requestAnimationFrame(frame);
  if (!WALL && !SETWIN) setTimeout(() => toast('Premi S per le impostazioni · F per lo schermo intero'), 1500);
}
init();
})();
