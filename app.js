'use strict';
// QueryRush · juego de preguntas en vivo sobre SQL.
// Tiempo real vía MQTT público: sin cuentas ni servidores propios; GitHub Pages solo sirve los archivos.
// ponytail: broker público sin autenticación; alguien con herramientas podría leer o falsificar mensajes de una sala.
// Si llega a pasar, migrar a un broker privado con usuario y clave.
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081', 'wss://broker.hivemq.com:8884/mqtt'];
const RAIZ = 'queryrush-vivo/';
const TEMAS = { 1: 'Fundamentos', 2: 'T-SQL y SELECT', 3: 'JOINs', 4: 'Agregación y GROUP BY', 5: 'Subconsultas e INSERT' };
const FIG = ['▲', '◆', '●', '■'];
const ANIMO = ['¡Sigue así!', 'La próxima es tuya 💪', 'Cada pregunta cuenta', '¡Vas muy bien!', 'Concéntrate, ¡tú puedes!'];

const $ = s => document.querySelector(s);
const app = $('#app');
const pinta = html => { app.innerHTML = html; window.scrollTo(0, 0); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const azar = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const titulo = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, m => m.toUpperCase());
const nombreOk = s => /^\p{L}[\p{L}' -]{1,29}$/u.test(s);
const sinTildes = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const leer = b => { try { return JSON.parse(b.toString()); } catch { return null; } };
const mandar = (cli, topico, obj, retain = false) => cli.publish(topico, JSON.stringify(obj), { qos: 1, retain });

function conectar(url) {
  return new Promise((ok, mal) => {
    const cli = mqtt.connect(url, { clientId: 'qr_' + rid(), connectTimeout: 7000, reconnectPeriod: 2000 });
    const t = setTimeout(() => { cli.end(true); mal(new Error('sin conexión')); }, 8000);
    cli.once('connect', () => { clearTimeout(t); ok(cli); });
  });
}

async function descifrar(clave) {
  const u = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
  const llave = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: u(BANCO.sal), iterations: 200000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u(BANCO.iv) }, llave, u(BANCO.d))));
}

const opciones = (o, extra = () => '', a = -1) => `<div class="ops">${o.map((t, k) =>
  `<div class="op op${k}${a < 0 ? '' : k === a ? ' ok' : ' no'}"><span class="fig">${FIG[k]}</span><span class="txt">${esc(t)}</span>${extra(k)}</div>`).join('')}</div>`;

const podioHtml = p => `<div class="podio">${[1, 0, 2].filter(k => p[k]).map(k =>
  `<div class="puesto p${k + 1}"><div class="quien">${esc(p[k][0])}<small>${p[k][1]} pts</small></div><div class="base">${k + 1}</div></div>`).join('')}</div>`;

function fiesta() {
  if (typeof confetti !== 'function') return;
  const fin = Date.now() + 3500;
  (function lluvia() {
    confetti({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0 } });
    confetti({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1 } });
    if (Date.now() < fin) requestAnimationFrame(lluvia);
  })();
}

// ───────────── Anfitrión (pantalla del proyector) ─────────────

async function anfitrion(clave) {
  let banco;
  try { banco = await descifrar(clave); } catch {
    sessionStorage.removeItem('qr-clave');
    return pinta('<section class="card centro"><h1>Clave del anfitrión incorrecta</h1><p>Vuelve a abrir tu enlace de anfitrión.</p></section>');
  }
  const cuantas = t => banco.filter(p => p.t === +t).length;
  pinta(`<section class="card config">
    <h1>Nueva partida</h1><p class="suave">Elige los temas y el número de preguntas.</p>
    <div class="temas">${Object.entries(TEMAS).map(([t, n]) =>
      `<label class="chk"><input type="checkbox" value="${t}" checked> ${n} <small>(${cuantas(t)})</small></label>`).join('')}</div>
    <label class="campo">Preguntas<select id="cant">${[10, 15, 20, 25, 30].map(n =>
      `<option ${n === 20 ? 'selected' : ''}>${n}</option>`).join('')}<option value="999">Todas</option></select></label>
    <button id="crear" class="btn grande">Crear sala ⚡</button><p id="msg" class="aviso"></p></section>`);

  $('#crear').onclick = async () => {
    const temas = [...document.querySelectorAll('.temas input:checked')].map(x => +x.value);
    const pool = azar(banco.filter(p => temas.includes(p.t)));
    if (!pool.length) return ($('#msg').textContent = 'Elige al menos un tema.');
    $('#crear').disabled = true;
    $('#msg').textContent = 'Conectando…';
    const preguntas = pool.slice(0, +$('#cant').value).map(barajar);
    for (let b = 0; b < BROKERS.length; b++) {
      try { return sala(await conectar(BROKERS[b]), b, preguntas); } catch { /* probar el siguiente */ }
    }
    $('#crear').disabled = false;
    $('#msg').textContent = 'No hay conexión con el servidor de tiempo real. Revisa tu internet e inténtalo de nuevo.';
  };
}

function barajar(p) {
  if (p.f) return p; // opciones con orden propio ("ninguna de las anteriores", listas acumulativas)
  const orden = azar([0, 1, 2, 3]);
  return { ...p, o: orden.map(k => p.o[k]), a: orden.indexOf(p.a) };
}

function sala(cli, b, preguntas) {
  // El primer dígito del PIN dice a qué broker se conectan los jugadores.
  const pin = String(b + 1) + String(Math.floor(Math.random() * 1e4)).padStart(4, '0');
  const base = RAIZ + pin + '/';
  const enlace = location.origin + location.pathname + '?pin=' + pin;
  const J = new Map(); // id secreto → jugador
  const fuera = new Set();
  const S = { i: -1, fase: 'lobby', abierta: false, t0: 0, d: 20, reloj: null };
  const pub = (t, o, r) => mandar(cli, base + t, o, r);
  const ranking = () => [...J.values()].sort((x, y) => y.total - x.total || x.tiempo - y.tiempo);
  const contador = () => { const e = $('#cont'); if (e) e.textContent = `${[...J.values()].filter(j => j.resp).length}/${J.size} respondieron`; };

  cli.subscribe(base + 'a', { qos: 1 });
  pub('e', { t: 'lobby' }, true);

  cli.on('message', (_, buf) => {
    const m = leer(buf);
    if (!m || typeof m.id !== 'string' || m.id.length > 40) return;
    if (m.t === 'join') {
      const nombre = titulo(m.nombre || ''), apellido = titulo(m.apellido || '');
      const no = motivo => pub('p/' + m.id, { t: 'no', motivo });
      if (fuera.has(m.id)) return no('El anfitrión te retiró de la sala.');
      if (!nombreOk(nombre) || !nombreOk(apellido)) return no('Nombre o apellido no válido.');
      const k = sinTildes(nombre + ' ' + apellido);
      if ([...J.values()].some(j => j.id !== m.id && j.k === k))
        return no('Ya hay alguien con ese nombre y apellido en la sala. Agrega tu segundo nombre o apellido.');
      const j = J.get(m.id);
      if (j) Object.assign(j, { nombre, apellido, k }); // reconexión: conserva sus puntos
      else J.set(m.id, { id: m.id, nombre, apellido, k, total: 0, racha: 0, aciertos: 0, tiempo: 0, pts: 0, resp: null });
      pub('p/' + m.id, { t: 'ok' });
      if (S.fase === 'lobby') lobby(); else contador();
    } else if (m.t === 'ans') {
      const j = J.get(m.id);
      if (!S.abierta || m.i !== S.i || !j || j.resp || ![0, 1, 2, 3].includes(m.o)) return;
      j.resp = { o: m.o, ms: Date.now() - S.t0 };
      contador();
      if ([...J.values()].every(x => x.resp)) cerrar();
    }
  });

  function lobby() {
    const qr = qrcode(0, 'M');
    qr.addData(enlace);
    qr.make();
    pinta(`<section class="lobby">
      <div class="card unirse"><p>Entra en</p><div class="enlace">${esc(enlace.replace(/^https?:\/\//, '').replace(/\?.*/, ''))}</div>
        <p>PIN de la sala</p><div class="pin">${pin}</div>
        <div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
        <p class="suave">o escanea el código QR</p></div>
      <div class="card jugadores"><h2>${J.size} participante${J.size === 1 ? '' : 's'}</h2>
        <div class="chips">${[...J.values()].map(j =>
          `<button class="chip" data-id="${esc(j.id)}" title="Retirar de la sala">${esc(j.nombre)} ${esc(j.apellido)}</button>`).join('')
          || '<p class="suave">Esperando participantes…</p>'}</div>
        <button id="iniciar" class="btn grande" ${J.size ? '' : 'disabled'}>Iniciar partida ▶</button>
        <p class="suave">${preguntas.length} preguntas · toca un nombre para retirarlo de la sala</p></div></section>`);
    document.querySelectorAll('.chip').forEach(btn => btn.onclick = () => {
      const j = J.get(btn.dataset.id);
      if (!j || !confirm(`¿Retirar a ${j.nombre} ${j.apellido} de la sala?`)) return;
      J.delete(j.id);
      fuera.add(j.id);
      pub('p/' + j.id, { t: 'no', motivo: 'El anfitrión te retiró de la sala.' });
      lobby();
    });
    $('#iniciar').onclick = siguiente;
  }

  function siguiente() {
    S.i++;
    if (S.i >= preguntas.length) return fin();
    const p = preguntas[S.i], d = p.c ? 30 : 20;
    J.forEach(j => { j.resp = null; });
    Object.assign(S, { fase: 'q', abierta: true, t0: Date.now(), d });
    pub('e', { t: 'q', i: S.i, n: preguntas.length, tema: TEMAS[p.t], q: p.q, c: p.c, o: p.o, d }, true);
    pinta(`<section class="pregunta">
      <div class="barra"><span>Pregunta ${S.i + 1} de ${preguntas.length} · ${TEMAS[p.t]}</span><span id="cont"></span><span class="reloj" id="reloj">${d}</span></div>
      <h1 class="enunciado">${esc(p.q)}</h1>${p.c ? `<pre class="codigo">${esc(p.c)}</pre>` : ''}
      ${opciones(p.o)}<div class="acciones"><button id="cerrar" class="btn sec">Cerrar tiempo ⏹</button></div></section>`);
    contador();
    $('#cerrar').onclick = cerrar;
    clearInterval(S.reloj);
    S.reloj = setInterval(() => {
      const e = $('#reloj');
      if (e) e.textContent = Math.max(0, Math.ceil(d - (Date.now() - S.t0) / 1000));
      if (Date.now() - S.t0 > d * 1000 + 800) cerrar(); // margen para respuestas en tránsito
    }, 200);
  }

  function cerrar() {
    if (!S.abierta) return;
    S.abierta = false;
    clearInterval(S.reloj);
    const p = preguntas[S.i], dist = [0, 0, 0, 0], ms = S.d * 1000;
    J.forEach(j => {
      if (j.resp) dist[j.resp.o]++;
      if (j.resp && j.resp.o === p.a) {
        j.racha++;
        j.aciertos++;
        j.tiempo += j.resp.ms;
        // Kahoot: 500–1000 según rapidez, más racha (+100 por acierto seguido, tope +500). Errar no resta.
        j.pts = Math.round(1000 * (1 - Math.min(j.resp.ms, ms) / ms / 2)) + Math.min((j.racha - 1) * 100, 500);
        j.total += j.pts;
      } else { j.racha = 0; j.pts = 0; }
    });
    const rk = ranking(), r = {};
    rk.forEach((j, k) => { r[j.id] = [j.resp?.o === p.a ? 1 : 0, j.pts, j.total, k + 1, j.racha]; });
    const top = rk.slice(0, 5).map(j => [j.nombre + ' ' + j.apellido, j.total]);
    pub('e', { t: 'rev', i: S.i, a: p.a, r, n: J.size, top }, true);
    S.fase = 'rev';
    const ultima = S.i === preguntas.length - 1;
    pinta(`<section class="pregunta revelar">
      <div class="barra"><span>Pregunta ${S.i + 1} de ${preguntas.length} · ${TEMAS[p.t]}</span></div>
      <h1 class="enunciado">${esc(p.q)}</h1>${p.c ? `<pre class="codigo">${esc(p.c)}</pre>` : ''}
      ${opciones(p.o, k => `<b class="votos">${dist[k]}</b>`, p.a)}
      <div class="fila"><div><h2>Top 5</h2><ol class="ranking">${top.map(([n, t]) => `<li><span>${esc(n)}</span><b>${t}</b></li>`).join('')}</ol></div>
      <button id="sig" class="btn grande">${ultima ? 'Ver podio 🏆' : 'Siguiente pregunta ▶'}</button></div></section>`);
    $('#sig').onclick = siguiente;
  }

  function fin() {
    S.fase = 'fin';
    const rk = ranking(), r = {};
    rk.forEach((j, k) => { r[j.id] = [j.total, k + 1, j.aciertos]; });
    const podio = rk.slice(0, 3).map(j => [j.nombre + ' ' + j.apellido, j.total]);
    pub('e', { t: 'fin', podio, r, n: J.size, np: preguntas.length }, true);
    pinta(`<section class="final"><h1>🏆 Podio</h1>${podioHtml(podio)}
      <div class="acciones centrar"><button id="csv" class="btn sec">Descargar resultados (CSV)</button><button id="otra" class="btn">Nueva partida</button></div></section>`);
    $('#csv').onclick = () => descargarCSV(rk, preguntas.length, pin);
    $('#otra').onclick = () => cli.publish(base + 'e', '', { qos: 1, retain: true }, () => location.reload());
    setTimeout(fiesta, 2400); // cuando aparece el primer lugar
  }

  lobby();
}

function descargarCSV(rk, np, pin) {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const filas = [['Puesto', 'Nombre', 'Apellido', 'Puntos', 'Aciertos', 'Preguntas'],
    ...rk.map((j, k) => [k + 1, j.nombre, j.apellido, j.total, j.aciertos, np])];
  const blob = new Blob(['﻿' + filas.map(f => f.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: `queryrush-${pin}-${new Date().toISOString().slice(0, 10)}.csv`,
  }).click();
}

// ───────────── Jugador (celular o PC) ─────────────

function jugador() {
  const g = JSON.parse(localStorage.getItem('qr-jugador') || 'null');
  const pinUrl = new URLSearchParams(location.search).get('pin') || '';
  const mismo = g && (!pinUrl || pinUrl === g.pin) && Date.now() - g.ts < 3 * 3600e3;
  pinta(`<section class="card entrar">
    <h1>¡Únete a la partida!</h1>
    <form id="f" autocomplete="off">
      <label class="campo">PIN de la sala<input id="pin" inputmode="numeric" maxlength="5" required placeholder="12345" value="${esc(pinUrl || (mismo ? g.pin : ''))}"></label>
      <label class="campo">Nombre<input id="nom" required maxlength="30" placeholder="Ej.: Ana" value="${esc(mismo ? g.nombre : '')}"></label>
      <label class="campo">Apellido<input id="ape" required maxlength="30" placeholder="Ej.: Paredes" value="${esc(mismo ? g.apellido : '')}"></label>
      <button class="btn grande">Entrar ⚡</button><p id="msg" class="aviso"></p>
    </form></section>`);
  $('#f').onsubmit = e => { e.preventDefault(); entrar(mismo ? g.id : rid()); };
  if (mismo) entrar(g.id); // recargó la página: vuelve a entrar con sus puntos
}

async function entrar(id) {
  const pin = $('#pin').value.trim(), nombre = titulo($('#nom').value), apellido = titulo($('#ape').value);
  const aviso = t => { $('#msg').textContent = t; };
  if (!/^[1-3]\d{4}$/.test(pin)) return aviso('El PIN tiene 5 dígitos. Míralo en la pantalla del anfitrión.');
  if (!nombreOk(nombre) || !nombreOk(apellido)) return aviso('Escribe tu nombre y tu apellido (solo letras, mínimo 2).');
  $('#f button').disabled = true;
  aviso('Conectando…');
  let cli;
  for (let k = 0; k < 3 && !cli; k++) { // reintenta: los brokers públicos a veces tardan
    try { cli = await conectar(BROKERS[pin[0] - 1]); } catch { /* otro intento */ }
  }
  if (!cli) {
    $('#f button').disabled = false;
    return aviso('No hay conexión. Revisa tu internet e inténtalo de nuevo.');
  }
  const base = RAIZ + pin + '/';
  const yo = { dentro: false, ultimo: null, q: null, resp: -1, tic: null };
  const pedir = () => mandar(cli, base + 'a', { t: 'join', id, nombre, apellido });
  let intentos = 0;
  const espera = setInterval(() => { // si el anfitrión no responde, vuelve a pedir entrada (3 veces)
    if (++intentos < 4) return pedir();
    clearInterval(espera);
    cli.end(true);
    $('#f button').disabled = false;
    aviso('No encontramos esa sala. Revisa el PIN.');
  }, 4000);

  cli.on('message', (topico, buf) => {
    const m = leer(buf);
    if (!m) return;
    if (topico === base + 'p/' + id) {
      clearInterval(espera);
      if (m.t === 'ok') {
        yo.dentro = true;
        localStorage.setItem('qr-jugador', JSON.stringify({ id, pin, nombre, apellido, ts: Date.now() }));
        estado(yo.ultimo || { t: 'lobby' });
      } else if (m.t === 'no') {
        cli.end(true);
        localStorage.removeItem('qr-jugador');
        pinta(`<section class="card centro"><h1>No puedes entrar</h1><p>${esc(m.motivo)}</p><button class="btn" onclick="location.reload()">Volver</button></section>`);
      }
      return;
    }
    yo.ultimo = m;
    if (yo.dentro) estado(m);
  });
  cli.subscribe([base + 'e', base + 'p/' + id], { qos: 1 }, pedir);

  function estado(m) {
    clearInterval(yo.tic);
    if (m.t === 'lobby') pinta(`<section class="card centro"><div class="pulso">⚡</div><h1>¡Estás dentro, ${esc(nombre)}!</h1><p>Mira la pantalla del anfitrión: la partida empieza pronto.</p></section>`);
    else if (m.t === 'q') pregunta(m);
    else if (m.t === 'rev') resultado(m);
    else if (m.t === 'fin') final(m);
  }

  const enviado = () => pinta('<section class="card centro"><div class="pulso">✓</div><h1>¡Respuesta enviada!</h1><p>Esperando al resto del grupo…</p></section>');

  function pregunta(m) {
    yo.q = m;
    if (yo.resp === m.i) return enviado();
    const t0 = Date.now();
    pinta(`<section class="jugar"><div class="barra"><span>${m.i + 1}/${m.n} · ${esc(m.tema)}</span><span class="reloj" id="reloj">${m.d}</span></div>
      <h2 class="enunciado">${esc(m.q)}</h2>${m.c ? `<pre class="codigo">${esc(m.c)}</pre>` : ''}
      <div class="ops">${m.o.map((t, k) => `<button class="op op${k}" data-k="${k}"><span class="fig">${FIG[k]}</span><span class="txt">${esc(t)}</span></button>`).join('')}</div></section>`);
    document.querySelectorAll('.jugar .op').forEach(btn => btn.onclick = () => {
      yo.resp = m.i;
      clearInterval(yo.tic);
      mandar(cli, base + 'a', { t: 'ans', id, i: m.i, o: +btn.dataset.k });
      enviado();
    });
    yo.tic = setInterval(() => {
      const r = Math.max(0, Math.ceil(m.d - (Date.now() - t0) / 1000));
      $('#reloj').textContent = r;
      if (r) return;
      clearInterval(yo.tic);
      pinta('<section class="card centro"><div class="grande-icono">⏰</div><h1>¡Se acabó el tiempo!</h1><p>Espera el resultado…</p></section>');
    }, 200);
  }

  function resultado(m) {
    const r = m.r[id];
    if (!r) return pinta('<section class="card centro"><div class="pulso">⚡</div><h1>¡Ya estás en la partida!</h1><p>Juegas desde la próxima pregunta.</p></section>');
    const [ok, pts, total, pos, racha] = r;
    const correcta = yo.q?.i === m.i ? yo.q.o[m.a] : null;
    pinta(`<section class="card centro res ${ok ? 'bien' : 'mal'}">
      <div class="grande-icono">${ok ? '✔' : '✘'}</div>
      <h1>${ok ? '¡Correcto!' : yo.resp === m.i ? 'Incorrecto' : 'Sin respuesta'}</h1>
      ${ok ? `<p class="pts">+${pts}</p>${racha > 1 ? `<p class="racha">🔥 Racha de ${racha}</p>` : ''}`
        : correcta ? `<p>La respuesta era: <b>${esc(correcta)}</b></p>` : ''}
      <p class="total">${total} pts · puesto <b>${pos}</b> de ${m.n}</p>
      <p class="suave">${pos <= 3 && total > 0 ? '¡Estás en el podio! 🏆' : ANIMO[m.i % ANIMO.length]}</p></section>`);
  }

  function final(m) {
    const [total, pos, aciertos] = m.r[id] || [0, '–', 0];
    pinta(`<section class="final jugador"><h1>¡Partida terminada!</h1>
      <p class="total">Quedaste en el puesto <b>${pos}</b> de ${m.n}</p><p>${total} pts · ${aciertos} de ${m.np} aciertos</p>
      ${podioHtml(m.podio)}<p class="suave">¡Gracias por jugar limpio! 🙌</p></section>`);
    if (pos <= 3 && total > 0) setTimeout(fiesta, 2400);
    localStorage.removeItem('qr-jugador');
  }
}

// ───────────── Arranque ─────────────
// El anfitrión entra con su enlace personal (…/#docente=CLAVE). La clave se guarda en la pestaña
// y se borra de la barra de direcciones para que no se vea en el proyector.
const h = new URLSearchParams(location.hash.slice(1));
if (h.get('docente')) {
  sessionStorage.setItem('qr-clave', h.get('docente'));
  history.replaceState(null, '', location.pathname + location.search);
}
if (typeof mqtt === 'undefined') pinta('<section class="card centro"><h1>Sin conexión</h1><p>No se pudo cargar el juego. Revisa tu internet y recarga la página.</p></section>');
else if (sessionStorage.getItem('qr-clave')) anfitrion(sessionStorage.getItem('qr-clave'));
else jugador();
