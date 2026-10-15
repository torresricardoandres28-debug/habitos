(function () {
  "use strict";
  var COLORS = ["--h1", "--h2", "--h3", "--h4", "--h5", "--h6"];
  var SUGG = [
    { name: "Tomar agua", type: "count", target: 8, unit: "vasos" },
    { name: "Caminar 20 minutos" },
    { name: "Leer 10 páginas" },
    { name: "Meditar 5 minutos" },
    { name: "Estirar 5 minutos" },
    { name: "Dormir antes de las 11 pm" }
  ];
  var INIT = ["D", "L", "M", "M", "J", "V", "S"];
  var DAYNAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  var DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
  var GROUPS = [["mañana", "Mañana"], ["tarde", "Tarde"], ["noche", "Noche"], ["", "Sin horario"]];
  var state = { habits: [], tombs: {}, loaded: false, tab: "hoy", date: null, followToday: true, modal: null, year: {}, undo: null };

  /* ---------- utilidades ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function today() { var t = new Date(); t.setHours(0, 0, 0, 0); return t; }
  function weekStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function daysBetween(a, b) { return Math.round((b - a) / 864e5); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtLong(d) { return d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function $(id) { return document.getElementById(id); }

  function toast(msg, action) {
    var t = $("toast");
    t.innerHTML = "<span>" + esc(msg) + "</span>" + (action ? ' <button class="toast-btn" data-act="' + action.act + '">' + esc(action.label) + "</button>" : "");
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, action ? 7000 : 2600);
  }

  /* ---------- modelo de datos ---------- */
  function normalize(h) {
    if (!h.freq) h.freq = (h.goal || 7) >= 7 ? { t: "daily" } : { t: "weekly", n: h.goal || 7 };
    if (h.freq.t === "days" && !Array.isArray(h.freq.days)) h.freq.days = [1, 2, 3, 4, 5];
    if (h.freq.t === "weekly" && !h.freq.n) h.freq.n = 3;
    h.type = h.type === "count" ? "count" : "check";
    h.target = h.type === "count" ? Math.max(1, Number(h.target) || 1) : 1;
    h.unit = h.unit || "";
    h.group = h.group || "";
    h.days = Array.isArray(h.days) ? h.days : [];
    h.counts = h.counts && typeof h.counts === "object" ? h.counts : {};
    h.notes = h.notes && typeof h.notes === "object" ? h.notes : {};
    h.order = h.order || 0;
    h.updatedAt = h.updatedAt || 0;
    h.archived = !!h.archived;
    h.goal = weeklyTarget(h);
    return h;
  }
  function weeklyTarget(h) {
    var f = h.freq || { t: "daily" };
    return f.t === "days" ? f.days.length : f.t === "weekly" ? f.n : 7;
  }
  function isScheduled(h, d) { return h.freq.t !== "days" || h.freq.days.indexOf(d.getDay()) >= 0; }
  function daySet(h) { return new Set(h.days); }
  function countOn(h, key) { return h.counts[key] || 0; }
  function isDone(h, key) { return h.days.indexOf(key) >= 0; }
  function hcolor(h) { return "var(" + (COLORS.indexOf(h.color) >= 0 ? h.color : "--h1") + ")"; }
  function active() { return state.habits.filter(function (h) { return !h.archived; }); }
  function archived() { return state.habits.filter(function (h) { return h.archived; }); }
  function sortHabits(a) { return a.sort(function (x, y) { return x.order - y.order; }); }
  function byId(id) { return state.habits.find(function (h) { return h.id === id; }); }

  function touch(h) { h.updatedAt = Date.now(); }
  function persistLocal() { lsSet("habitos.v1", JSON.stringify(state.habits)); lsSet("habitos.tomb", JSON.stringify(state.tombs)); }
  function save() { persistLocal(); scheduleSync(); }
  function pushUndo(label) { state.undo = clone(state.habits); toast(label, { act: "undo", label: "Deshacer" }); }
  function weekCount(h, d) {
    var s = daySet(h), w = weekStart(d), n = 0;
    for (var i = 0; i < 7; i++) if (s.has(ymd(addDays(w, i)))) n++;
    return n;
  }

  /* Racha: días seguidos (hábitos diarios y de días específicos) con un día de gracia
     por cada 7 días, o semanas seguidas que cumplen la meta (hábitos semanales). */
  function streakInfo(h) {
    var f = h.freq, s = daySet(h), t = today(), run = 0, best = 0, i;
    var unit = f.t === "weekly" ? "semanas" : "días";
    if (!h.days.length) return { cur: 0, best: 0, unit: unit };
    var first = parse(h.days.slice().sort()[0]);
    if (f.t === "weekly") {
      var end = weekStart(t);
      for (var w = weekStart(first); w <= end; w = addDays(w, 7)) {
        var c = 0;
        for (i = 0; i < 7; i++) if (s.has(ymd(addDays(w, i)))) c++;
        if (c >= f.n) run++;
        else if (w.getTime() !== end.getTime()) run = 0;
        if (run > best) best = run;
      }
      return { cur: run, best: best, unit: unit };
    }
    var lastForgive = null, tk = ymd(t);
    for (var d = first; d <= t; d = addDays(d, 1)) {
      var k = ymd(d);
      if (s.has(k)) { run++; if (run > best) best = run; continue; }
      if (k === tk || !isScheduled(h, d)) continue;
      if (run > 0 && (lastForgive === null || daysBetween(lastForgive, d) > 7)) lastForgive = d;
      else run = 0;
    }
    return { cur: run, best: best, unit: unit };
  }
  function streakText(h) {
    var st = streakInfo(h);
    if (!st.cur) return "Sin racha";
    var one = st.cur === 1;
    return st.cur + (st.unit === "semanas" ? (one ? " semana seguida" : " semanas seguidas") : (one ? " día seguido" : " días seguidos"));
  }
  function rate30(h) {
    var s = daySet(h), t = today(), lim = addDays(t, -29);
    var start = h.createdAt ? parse(h.createdAt) : lim;
    if (start < lim) start = lim;
    var span = Math.max(1, daysBetween(start, t) + 1), done = 0, expected = 0;
    for (var i = 0; i < span; i++) {
      var d = addDays(start, i), k = ymd(d);
      if (h.freq.t === "weekly") { if (s.has(k)) done++; }
      else if (isScheduled(h, d)) { expected++; if (s.has(k)) done++; }
    }
    if (h.freq.t === "weekly") expected = h.freq.n * span / 7;
    return expected ? Math.min(100, Math.round(100 * done / expected)) : 0;
  }
  function weekPct(h, ws) {
    if (h.createdAt && parse(h.createdAt) > addDays(ws, 6)) return null;
    return Math.min(1, weekCount(h, ws) / Math.max(1, weeklyTarget(h)));
  }

  /* ---------- cambios de datos ---------- */
  function addHabit(data) {
    var maxOrder = state.habits.reduce(function (m, h) { return Math.max(m, h.order || 0); }, 0);
    var h = normalize(Object.assign({
      id: "h" + Date.now() + Math.floor(Math.random() * 1000), color: COLORS[active().length % COLORS.length],
      days: [], counts: {}, notes: {}, createdAt: ymd(today()), archived: false, order: maxOrder + 1, updatedAt: Date.now()
    }, data));
    state.habits.push(h); save(); render();
  }
  function patchHabit(id, patch) { var h = byId(id); if (!h) return; Object.assign(h, patch); normalize(h); touch(h); save(); render(); }
  function deleteHabit(id) { state.habits = state.habits.filter(function (h) { return h.id !== id; }); state.tombs[id] = Date.now(); save(); render(); }
  function setCount(id, key, n) {
    var h = byId(id); if (!h) return;
    n = Math.max(0, Math.min(999, n));
    if (n > 0) h.counts[key] = n; else delete h.counts[key];
    var i = h.days.indexOf(key);
    if (n >= h.target && i < 0) { h.days.push(key); h.days.sort(); }
    if (n < h.target && i >= 0) h.days.splice(i, 1);
    touch(h); save(); render();
  }
  function toggleDay(id, key) {
    var h = byId(id); if (!h) return;
    if (h.type === "count") { setCount(id, key, isDone(h, key) ? 0 : h.target); return; }
    var i = h.days.indexOf(key);
    if (i >= 0) h.days.splice(i, 1); else { h.days.push(key); h.days.sort(); }
    touch(h); save(); render();
  }
  function moveHabit(id, dir) {
    var list = sortHabits(active().slice()), i = list.findIndex(function (h) { return h.id === id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    list.forEach(function (h, n) { h.order = n + 1; touch(h); });
    var tmp = list[i].order; list[i].order = list[j].order; list[j].order = tmp;
    sortHabits(state.habits); save(); render(); renderModal();
  }

  /* ---------- vistas ---------- */
  var CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function renderHeader() {
    var d = state.date, key = ymd(d);
    var list = active().filter(function (h) { return isScheduled(h, d); });
    var done = list.filter(function (h) { return isDone(h, key); }).length;
    $("sub").textContent = fmtLong(d);
    $("ringnum").innerHTML = list.length ? done + " de " + list.length + "<small>completados</small>" : "";
    $("ringbar").setAttribute("stroke-dashoffset", String(138.2 * (1 - (list.length ? done / list.length : 0))));
    $("archbtn").textContent = "Archivados (" + archived().length + ")";
    var ab = $("accbtn");
    ab.hidden = !sync.client;
    ab.textContent = !sync.user ? "Iniciar sesión" : sync.status === "syncing" ? "Sincronizando…" : sync.status === "error" ? "Sin sincronizar" : "Sincronizado";
    document.querySelectorAll(".tabs button").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)); });
  }

  function emptyState() {
    return '<div class="empty"><h2>Empieza con pocos hábitos</h2>' +
      '<p>Lo que mejor funciona es arrancar con dos o tres hábitos pequeños y subirlos con el tiempo. Toca uno para agregarlo o crea el tuyo.</p>' +
      '<div class="sugg">' + SUGG.map(function (s, i) { return '<button class="chip-btn" data-act="sugg" data-i="' + i + '">+ ' + esc(s.name) + "</button>"; }).join("") + "</div>" +
      '<button class="btn primary" data-act="new">Crear mi propio hábito</button></div>';
  }

  function rowHtml(h, sel) {
    var selKey = ymd(sel), set = daySet(h), on = isDone(h, selKey), n = countOn(h, selKey), t = today();
    var ws = weekStart(sel), strip = "";
    for (var i = 0; i < 7; i++) {
      var d = addDays(ws, i), k = ymd(d);
      strip += '<button data-act="day" data-id="' + h.id + '" data-key="' + k + '" aria-pressed="' + set.has(k) + '" aria-label="' + esc(d.toLocaleDateString("es", { weekday: "long", day: "numeric" })) + '"' +
        ' class="' + (k === selKey ? "sel " : "") + (!isScheduled(h, d) ? "off" : "") + '"' + (d > t ? " disabled" : "") + ">" + INIT[d.getDay()] + "</button>";
    }
    var main = h.type === "count"
      ? '<button class="check count" data-act="inc" data-id="' + h.id + '" aria-pressed="' + on + '" aria-label="Sumar 1 a ' + esc(h.name) + '"><span>' + n + "/" + h.target + "</span></button>"
      : '<button class="check" data-act="toggle" data-id="' + h.id + '" aria-pressed="' + on + '" aria-label="Marcar ' + esc(h.name) + '">' + CHECK + "</button>";
    var hasNote = !!h.notes[selKey];
    return '<div class="habit" style="--c:' + hcolor(h) + '">' + main +
      '<div class="name">' + esc(h.name) + "</div>" +
      '<button class="edit" data-act="edit" data-id="' + h.id + '" aria-label="Editar ' + esc(h.name) + '">···</button>' +
      '<div class="meta"><span class="streak">' + streakText(h) + "</span>" +
      "<span>Semana " + weekCount(h, sel) + "/" + weeklyTarget(h) + "</span>" +
      (h.type === "count" ? "<span>" + n + " de " + h.target + (h.unit ? " " + esc(h.unit) : "") + "</span>" + (n > 0 ? '<button class="mini" data-act="dec" data-id="' + h.id + '">−1</button>' : "") : "") +
      '<button class="mini" data-act="note" data-id="' + h.id + '" aria-label="Nota del día">' + (hasNote ? "Nota ●" : "Nota") + "</button></div>" +
      '<div class="strip">' + strip + "</div></div>";
  }

  function renderToday() {
    var t = today(), sel = state.date, isToday = ymd(sel) === ymd(t);
    var html = '<div class="daynav"><button class="icon-btn" data-act="prev" aria-label="Día anterior">‹</button>' +
      '<div class="lbl">' + (isToday ? "Hoy" : esc(sel.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "short" }))) + "</div>" +
      (isToday ? "" : '<button class="chip-btn" data-act="today">Ir a hoy</button>') +
      '<button class="icon-btn" data-act="next" aria-label="Día siguiente"' + (isToday ? " disabled" : "") + ">›</button></div>";
    if (!state.loaded) return html + '<div class="empty"><p>Cargando tus hábitos…</p></div>';
    var list = active();
    if (!list.length) return html + emptyState();
    var sched = list.filter(function (h) { return isScheduled(h, sel); });
    var rest = list.filter(function (h) { return !isScheduled(h, sel); });
    if (!sched.length) html += '<div class="empty"><p>No tienes hábitos programados para este día.</p></div>';
    else if (!sched.some(function (h) { return h.group; })) html += '<div class="list">' + sched.map(function (h) { return rowHtml(h, sel); }).join("") + "</div>";
    else GROUPS.forEach(function (g) {
      var items = sched.filter(function (h) { return h.group === g[0]; });
      if (items.length) html += '<h2 class="group-h">' + g[1] + '</h2><div class="list">' + items.map(function (h) { return rowHtml(h, sel); }).join("") + "</div>";
    });
    if (rest.length) html += '<p class="rest">No programados este día: ' + rest.map(function (h) { return esc(h.name); }).join(", ") + ".</p>";
    return html + '<button class="add" data-act="new">+ Nuevo hábito</button>';
  }

  function weeklySummary(list) {
    var t = today(), thisW = weekStart(t), lastW = addDays(thisW, -7);
    function avg(ws) {
      var v = list.map(function (h) { return weekPct(h, ws); }).filter(function (x) { return x !== null; });
      return v.length ? Math.round(100 * v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null;
    }
    var cur = avg(thisW), prev = avg(lastW);
    var base = prev !== null ? lastW : thisW;
    var ranked = list.map(function (h) { return { h: h, p: weekPct(h, base) }; }).filter(function (x) { return x.p !== null; }).sort(function (a, b) { return b.p - a.p; });
    var lines = [];
    if (ranked.length) {
      var label = prev !== null ? "la semana pasada" : "esta semana";
      lines.push("Mejor hábito " + label + ": " + esc(ranked[0].h.name) + " (" + Math.round(ranked[0].p * 100) + "%).");
      var low = ranked[ranked.length - 1];
      if (ranked.length > 1 && low.p < 1) lines.push("A reforzar: " + esc(low.h.name) + " (" + Math.round(low.p * 100) + "%).");
    }
    var opp = [0, 0, 0, 0, 0, 0, 0], miss = [0, 0, 0, 0, 0, 0, 0];
    for (var i = 1; i <= 56; i++) {
      var d = addDays(t, -i), k = ymd(d);
      list.forEach(function (h) {
        if (h.freq.t === "weekly" || !isScheduled(h, d) || (h.createdAt && h.createdAt > k)) return;
        opp[d.getDay()]++; if (!isDone(h, k)) miss[d.getDay()]++;
      });
    }
    var worst = -1, wr = 0;
    for (var j = 0; j < 7; j++) if (opp[j] >= 4 && miss[j] / opp[j] > wr) { wr = miss[j] / opp[j]; worst = j; }
    if (worst >= 0 && wr >= 0.25) lines.push("Día más flojo en las últimas 8 semanas: " + DAYNAMES[worst] + " (" + Math.round(wr * 100) + "% sin cumplir).");
    return '<div class="panel"><h2>Resumen semanal</h2><div class="stats two">' +
      '<div class="stat"><b>' + (cur === null ? "–" : cur + "%") + "</b><small>Esta semana (en curso)</small></div>" +
      '<div class="stat"><b>' + (prev === null ? "–" : prev + "%") + "</b><small>Semana pasada</small></div></div>" +
      (lines.length ? '<ul class="insights">' + lines.map(function (l) { return "<li>" + l + "</li>"; }).join("") + "</ul>" : "") + "</div>";
  }

  function renderProgress() {
    if (!state.loaded) return '<div class="empty"><p>Cargando…</p></div>';
    var list = active(), t = today();
    if (!list.length) return emptyState();
    var bars = "";
    for (var i = 13; i >= 0; i--) {
      var d = addDays(t, -i), k = ymd(d), act = 0, done = 0;
      list.forEach(function (h) {
        if (h.createdAt && h.createdAt > k && !isDone(h, k)) return;
        if (!isScheduled(h, d) && !isDone(h, k)) return;
        act++; if (isDone(h, k)) done++;
      });
      var pct = act ? Math.round(100 * done / act) : 0;
      bars += '<div class="col" title="' + pct + '%"><div class="b' + (pct ? "" : " zero") + '" style="height:' + Math.max(pct, 3) + '%"></div><span>' + INIT[d.getDay()] + "</span></div>";
    }
    var html = weeklySummary(list) + '<div class="panel"><h2>Últimos 14 días</h2><div class="bars">' + bars + "</div>" +
      '<div class="heat-legend">Cada barra es el porcentaje de hábitos programados que completaste ese día.</div></div>';
    list.forEach(function (h) {
      var set = daySet(h), year = !!state.year[h.id], weeks = year ? 53 : 18;
      var start = weekStart(addDays(t, -7 * (weeks - 1))), cells = "";
      for (var w = 0; w < weeks; w++) for (var dd = 0; dd < 7; dd++) {
        var day = addDays(start, w * 7 + dd), k = ymd(day);
        cells += '<i class="' + (day > t ? "fut" : set.has(k) ? "on" : "") + '" title="' + k + '"></i>';
      }
      var st = streakInfo(h);
      var notes = Object.keys(h.notes).sort().reverse().slice(0, 3).map(function (k) {
        return "<li><b>" + esc(parse(k).toLocaleDateString("es", { day: "numeric", month: "short" })) + "</b> " + esc(h.notes[k]) + "</li>";
      }).join("");
      html += '<div class="panel" style="--c:' + hcolor(h) + '"><div class="phead"><span class="dot"></span><h3>' + esc(h.name) + "</h3>" +
        '<span class="wk">Esta semana ' + weekCount(h, t) + "/" + weeklyTarget(h) + "</span></div>" +
        '<div class="stats"><div class="stat"><b>' + st.cur + "</b><small>Racha actual (" + st.unit + ")</small></div>" +
        '<div class="stat"><b>' + st.best + "</b><small>Mejor racha (" + st.unit + ")</small></div>" +
        '<div class="stat"><b>' + rate30(h) + "%</b><small>Últimos 30 días</small></div>" +
        '<div class="stat"><b>' + h.days.length + "</b><small>Días en total</small></div></div>" +
        '<div class="heat-scroll"><div class="heat">' + cells + "</div></div>" +
        '<div class="row between"><div class="heat-legend">' + (year ? "Último año" : "Últimas 18 semanas") + ", de lunes a domingo.</div>" +
        '<button class="chip-btn" data-act="year" data-id="' + h.id + '">' + (year ? "Ver menos" : "Ver año completo") + "</button></div>" +
        (notes ? '<ul class="notes">' + notes + "</ul>" : "") + "</div>";
    });
    return html;
  }

  /* ---------- ventanas ---------- */
  function renderModal() {
    var m = $("modal"), md = state.modal;
    if (!md) { m.innerHTML = ""; return; }
    var body = "";
    if (md.type === "habit") {
      var e = md;
      var sw = COLORS.map(function (c) { return '<button type="button" data-act="color" data-color="' + c + '" style="--c:var(' + c + ')" aria-pressed="' + (e.color === c) + '" aria-label="Color"></button>'; }).join("");
      var dows = DOW_ORDER.map(function (d) { return '<button type="button" data-act="dow" data-d="' + d + '" aria-pressed="' + (e.days.indexOf(d) >= 0) + '">' + INIT[d] + "</button>"; }).join("");
      var nOpts = [1, 2, 3, 4, 5, 6].map(function (n) { return '<option value="' + n + '"' + (n === e.n ? " selected" : "") + ">" + n + (n === 1 ? " vez" : " veces") + " por semana</option>"; }).join("");
      var gOpts = GROUPS.slice().reverse().map(function (g) { return '<option value="' + g[0] + '"' + (g[0] === e.group ? " selected" : "") + ">" + g[1] + "</option>"; }).join("");
      body = "<h2>" + (e.id ? "Editar hábito" : "Nuevo hábito") + "</h2>" +
        '<label class="f" for="f-name">Nombre<input type="text" id="f-name" maxlength="60" value="' + esc(e.name) + '" placeholder="Ej: Leer 10 páginas"></label>' +
        '<label class="f" for="f-type">Tipo<select id="f-type" data-rr="1"><option value="check"' + (e.kind === "check" ? " selected" : "") + '>Sí o no</option><option value="count"' + (e.kind === "count" ? " selected" : "") + ">Con cantidad</option></select></label>" +
        (e.kind === "count" ? '<div class="row"><label class="f grow" for="f-target">Meta diaria<input type="number" id="f-target" min="1" max="999" value="' + e.target + '"></label>' +
          '<label class="f grow" for="f-unit">Unidad<input type="text" id="f-unit" maxlength="20" value="' + esc(e.unit) + '" placeholder="vasos, minutos…"></label></div>' : "") +
        '<label class="f" for="f-freq">Frecuencia<select id="f-freq" data-rr="1"><option value="daily"' + (e.freq === "daily" ? " selected" : "") + '>Todos los días</option><option value="days"' + (e.freq === "days" ? " selected" : "") + '>Días específicos</option><option value="weekly"' + (e.freq === "weekly" ? " selected" : "") + ">Varias veces por semana</option></select></label>" +
        (e.freq === "days" ? '<div class="f">Días<div class="dows">' + dows + "</div></div>" : "") +
        (e.freq === "weekly" ? '<label class="f" for="f-n">Meta semanal<select id="f-n">' + nOpts + "</select></label>" : "") +
        '<label class="f" for="f-group">Momento del día<select id="f-group">' + gOpts + "</select></label>" +
        '<div class="f">Color<div class="swatches">' + sw + "</div></div>" +
        '<div class="row"><button class="btn primary" data-act="save">Guardar</button><button class="btn" data-act="close">Cancelar</button></div>' +
        (e.id ? '<div class="row"><button class="btn" data-act="up">Subir</button><button class="btn" data-act="down">Bajar</button><button class="btn" data-act="archive">Archivar</button></div>' +
          '<div class="row"><button class="btn danger" data-act="delete">' + (md.confirmDel ? "Toca otra vez para borrar" : "Borrar hábito") + "</button></div>" : "");
    } else if (md.type === "note") {
      var h = byId(md.id);
      body = "<h2>Nota del día</h2><p class='muted'>" + esc(h ? h.name : "") + " · " + esc(parse(md.key).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })) + "</p>" +
        '<label class="f" for="f-note">Nota<textarea id="f-note" rows="4" maxlength="500" placeholder="Cómo te fue, por qué no pudiste, qué ayudó…">' + esc(md.text) + "</textarea></label>" +
        '<div class="row"><button class="btn primary" data-act="savenote">Guardar</button><button class="btn" data-act="close">Cancelar</button>' +
        (md.text ? '<button class="btn danger" data-act="delnote">Borrar nota</button>' : "") + "</div>";
    } else if (md.type === "account") {
      if (sync.user) {
        body = "<h2>Tu cuenta</h2><p class='muted'>Sesión iniciada como <b>" + esc(sync.user.email || "") + "</b></p>" +
          "<p class='muted'>" + (sync.status === "syncing" ? "Sincronizando…" : sync.status === "error" ? "No se pudo sincronizar: " + esc(sync.err) : sync.last ? "Última sincronización: " + esc(new Date(sync.last).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })) : "Aún no se ha sincronizado.") + "</p>" +
          '<div class="row"><button class="btn primary" data-act="syncnow">Sincronizar ahora</button><button class="btn" data-act="close">Cerrar</button></div>' +
          '<div class="row"><button class="btn" data-act="signout">Cerrar sesión</button></div>' +
          "<p class='muted'>Al cerrar sesión, tus hábitos siguen guardados en este dispositivo.</p>";
      } else {
        body = "<h2>Iniciar sesión</h2><p class='muted'>Con tu cuenta, tus hábitos se sincronizan entre tu celular y tu computador.</p>" +
          '<label class="f" for="f-email">Correo<input type="email" id="f-email" autocomplete="email" value="' + esc(md.email || "") + '"></label>' +
          '<label class="f" for="f-pass">Contraseña (mínimo 6 caracteres)<input type="password" id="f-pass" autocomplete="current-password"></label>' +
          (md.msg ? '<p class="msg">' + esc(md.msg) + "</p>" : "") +
          '<div class="row"><button class="btn primary" data-act="signin"' + (md.busy ? " disabled" : "") + '>Iniciar sesión</button><button class="btn" data-act="signup"' + (md.busy ? " disabled" : "") + '>Crear cuenta</button></div>' +
          '<div class="row"><button class="btn" data-act="close">Cerrar</button></div>';
      }
    } else if (md.type === "archived") {
      var list = archived();
      body = "<h2>Hábitos archivados</h2>" + (list.length ? '<div class="list">' + list.map(function (h) {
        return '<div class="arch-row"><span class="dot" style="--c:' + hcolor(h) + '"></span><span class="grow">' + esc(h.name) + "</span>" +
          '<button class="chip-btn" data-act="restore" data-id="' + h.id + '">Restaurar</button><button class="chip-btn danger" data-act="delarch" data-id="' + h.id + '">Borrar</button></div>';
      }).join("") + "</div>" : "<p class='muted'>No tienes hábitos archivados.</p>") +
        '<div class="row"><button class="btn" data-act="close">Cerrar</button></div>';
    }
    m.innerHTML = '<div class="overlay" data-act="close"><div class="sheet" role="dialog" aria-modal="true" aria-label="Ventana">' + body + "</div></div>";
  }

  function openHabitModal(h) {
    var f = h ? h.freq : { t: "daily" };
    state.modal = {
      type: "habit", id: h ? h.id : null, name: h ? h.name : "", color: h ? h.color || "--h1" : COLORS[active().length % COLORS.length],
      kind: h ? h.type : "check", target: h ? h.target : 8, unit: h ? h.unit : "", freq: f.t, days: f.t === "days" ? f.days.slice() : [1, 2, 3, 4, 5],
      n: f.t === "weekly" ? f.n : 3, group: h ? h.group : "", confirmDel: false
    };
    renderModal();
    if (!h) { var el = $("f-name"); if (el) el.focus(); }
  }
  function captureForm() {
    var md = state.modal; if (!md || md.type !== "habit") return;
    var g = function (id) { var el = $(id); return el ? el.value : null; };
    if (g("f-name") !== null) md.name = g("f-name");
    if (g("f-type") !== null) md.kind = g("f-type");
    if (g("f-target") !== null) md.target = Number(g("f-target")) || 1;
    if (g("f-unit") !== null) md.unit = g("f-unit");
    if (g("f-freq") !== null) md.freq = g("f-freq");
    if (g("f-n") !== null) md.n = Number(g("f-n"));
    if (g("f-group") !== null) md.group = g("f-group");
  }
  function closeModal() { state.modal = null; renderModal(); }

  function render() {
    renderHeader();
    $("view").innerHTML = state.tab === "hoy" ? renderToday() : renderProgress();
    if (state.tab === "prog") document.querySelectorAll(".heat-scroll").forEach(function (el) { el.scrollLeft = el.scrollWidth; });
  }
  function goDate(d) { state.date = d; state.followToday = ymd(d) === ymd(today()); render(); }

  /* ---------- copia de seguridad ---------- */
  function exportData() {
    var blob = new Blob([JSON.stringify({ app: "mis-habitos", version: 2, exportedAt: new Date().toISOString(), habits: state.habits }, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "mis-habitos-" + ymd(today()) + ".json";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("Copia de seguridad descargada");
  }
  function importData(text) {
    var data = JSON.parse(text), list = Array.isArray(data) ? data : data.habits;
    if (!Array.isArray(list)) throw new Error("formato");
    pushUndo("Copia restaurada");
    var ids = {}; state.habits.forEach(function (h) { ids[h.id] = h; });
    list.forEach(function (h) {
      if (!h || !h.id || !h.name) return;
      var cur = ids[h.id];
      if (cur) {
        cur.days = Array.from(new Set(cur.days.concat(h.days || []))).sort();
        cur.counts = Object.assign({}, h.counts || {}, cur.counts);
        cur.notes = Object.assign({}, h.notes || {}, cur.notes);
        touch(cur);
      } else {
        h.id = String(h.id); h.createdAt = h.createdAt || ymd(today());
        state.habits.push(normalize(h)); touch(h);
      }
    });
    sortHabits(state.habits); save(); render();
  }
  $("importfile").addEventListener("change", function (ev) {
    var f = ev.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () { try { importData(r.result); } catch (e) { toast("El archivo no es una copia válida"); } ev.target.value = ""; };
    r.readAsText(f);
  });

  /* ---------- eventos ---------- */
  document.addEventListener("change", function (ev) {
    if (ev.target.dataset && ev.target.dataset.rr) { captureForm(); renderModal(); }
  });
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-act],[data-tab]");
    if (!el) return;
    if (el.dataset.tab) { state.tab = el.dataset.tab; lsSet("habitos.tab", state.tab); render(); return; }
    var act = el.dataset.act, id = el.dataset.id, md = state.modal, selKey = ymd(state.date), h;
    if (act === "close") { if (el.classList.contains("overlay") && ev.target !== el) return; closeModal(); return; }
    switch (act) {
      case "toggle": toggleDay(id, selKey); break;
      case "day": toggleDay(id, el.dataset.key); break;
      case "inc": h = byId(id); setCount(id, selKey, countOn(h, selKey) + 1); break;
      case "dec": h = byId(id); setCount(id, selKey, countOn(h, selKey) - 1); break;
      case "prev": goDate(addDays(state.date, -1)); break;
      case "next": if (selKey < ymd(today())) goDate(addDays(state.date, 1)); break;
      case "today": goDate(today()); break;
      case "new": openHabitModal(null); break;
      case "edit": openHabitModal(byId(id)); break;
      case "sugg": var s = SUGG[Number(el.dataset.i)]; addHabit(Object.assign({}, s)); toast("Hábito agregado"); break;
      case "export": exportData(); break;
      case "import": $("importfile").click(); break;
      case "account": state.modal = { type: "account", email: "", msg: "", busy: false }; renderModal(); break;
      case "syncnow": runSync(); break;
      case "signin": case "signup": doAuth(act); break;
      case "signout": sync.client.auth.signOut().then(function () { closeModal(); toast("Sesión cerrada"); }); break;
      case "archived": state.modal = { type: "archived" }; renderModal(); break;
      case "year": state.year[id] = !state.year[id]; render(); break;
      case "note": h = byId(id); state.modal = { type: "note", id: id, key: selKey, text: h.notes[selKey] || "" }; renderModal(); $("f-note").focus(); break;
      case "savenote":
        h = byId(md.id); var txt = $("f-note").value.trim();
        if (txt) h.notes[md.key] = txt; else delete h.notes[md.key];
        touch(h); save(); closeModal(); render(); break;
      case "delnote": h = byId(md.id); delete h.notes[md.key]; touch(h); save(); closeModal(); render(); break;
      case "color": captureForm(); md.color = el.dataset.color; renderModal(); break;
      case "dow":
        captureForm(); var d = Number(el.dataset.d), i = md.days.indexOf(d);
        if (i >= 0) md.days.splice(i, 1); else md.days.push(d);
        renderModal(); break;
      case "up": moveHabit(md.id, -1); break;
      case "down": moveHabit(md.id, 1); break;
      case "save":
        captureForm();
        var name = md.name.trim();
        if (!name) { toast("Escribe un nombre para el hábito"); return; }
        if (md.freq === "days" && !md.days.length) { toast("Elige al menos un día de la semana"); return; }
        var freq = md.freq === "days" ? { t: "days", days: md.days.slice() } : md.freq === "weekly" ? { t: "weekly", n: md.n || 3 } : { t: "daily" };
        var data = { name: name, color: md.color, type: md.kind, target: md.kind === "count" ? Math.max(1, md.target) : 1, unit: md.kind === "count" ? md.unit.trim() : "", freq: freq, group: md.group };
        if (md.id) patchHabit(md.id, data); else addHabit(data);
        closeModal(); break;
      case "archive": pushUndo("Hábito archivado"); patchHabit(md.id, { archived: true }); closeModal(); break;
      case "delete":
        if (!md.confirmDel) { md.confirmDel = true; renderModal(); return; }
        pushUndo("Hábito borrado"); deleteHabit(md.id); closeModal(); break;
      case "restore": patchHabit(id, { archived: false }); renderModal(); toast("Hábito restaurado"); break;
      case "delarch": pushUndo("Hábito borrado"); deleteHabit(id); renderModal(); break;
      case "undo":
        if (state.undo) { state.habits = sortHabits(state.undo.map(normalize)); state.habits.forEach(touch); state.undo = null; save(); render(); renderModal(); $("toast").hidden = true; }
        break;
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && state.modal) closeModal();
    if (ev.key === "Enter" && state.modal && state.modal.type === "habit" && ev.target.id === "f-name") document.querySelector('[data-act="save"]').click();
  });

  /* ---------- sincronización (Supabase) ---------- */
  var cfg = window.HABITOS_CONFIG || {};
  var sync = { client: null, user: null, status: "off", last: 0, err: "", timer: null, running: false, again: false };
  function initSync() {
    if (!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase)) return;
    sync.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    sync.client.auth.getSession().then(function (r) { setUser(r.data && r.data.session ? r.data.session.user : null); });
    sync.client.auth.onAuthStateChange(function (ev, session) { setUser(session ? session.user : null); });
    setInterval(function () { if (!document.hidden) runSync(); }, 120000);
    window.addEventListener("online", runSync);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) runSync(); });
  }
  function setUser(u) {
    var changed = (u ? u.id : null) !== (sync.user ? sync.user.id : null);
    sync.user = u || null;
    sync.status = u ? "idle" : "out";
    render();
    if (state.modal && state.modal.type === "account" && changed) renderModal();
    if (u && changed) runSync();
  }
  function scheduleSync() {
    if (!sync.user) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(runSync, 1500);
  }
  async function runSync() {
    if (!sync.client || !sync.user) return;
    if (sync.running) { sync.again = true; return; }
    sync.running = true; sync.status = "syncing"; sync.err = ""; renderHeader();
    try {
      var uid = sync.user.id;
      var res = await sync.client.from("habits").select("id,data,updated_at,deleted").eq("user_id", uid);
      if (res.error) throw res.error;
      var remote = {};
      res.data.forEach(function (r) { remote[r.id] = r; });
      res.data.forEach(function (r) {
        var local = byId(r.id), tomb = state.tombs[r.id] || 0, lu = local ? local.updatedAt : 0;
        if (r.deleted) {
          if (local && lu <= r.updated_at) state.habits = state.habits.filter(function (h) { return h.id !== r.id; });
          return;
        }
        if (!local && tomb >= r.updated_at) return;
        if (!local || r.updated_at > lu) {
          var h = normalize(r.data || {}); h.id = r.id; h.updatedAt = r.updated_at;
          state.habits = state.habits.filter(function (x) { return x.id !== r.id; }); state.habits.push(h);
          delete state.tombs[r.id];
        }
      });
      var rows = [];
      state.habits.forEach(function (h) {
        var r = remote[h.id];
        if (!h.updatedAt) touch(h);
        if (!r || h.updatedAt > r.updated_at) rows.push({ user_id: uid, id: h.id, data: h, updated_at: h.updatedAt, deleted: false });
      });
      Object.keys(state.tombs).forEach(function (id) {
        var r = remote[id], local = byId(id), ts = state.tombs[id];
        if (local && local.updatedAt > ts) { delete state.tombs[id]; return; }
        if (!r || (!r.deleted && r.updated_at < ts)) rows.push({ user_id: uid, id: id, data: {}, updated_at: ts, deleted: true });
      });
      if (rows.length) {
        var up = await sync.client.from("habits").upsert(rows, { onConflict: "user_id,id" });
        if (up.error) throw up.error;
      }
      sortHabits(state.habits); persistLocal();
      sync.status = "ok"; sync.last = Date.now();
    } catch (e) {
      sync.status = "error"; sync.err = (e && e.message) || "sin conexión";
    }
    sync.running = false;
    render();
    if (state.modal && state.modal.type === "account") renderModal();
    if (sync.again) { sync.again = false; runSync(); }
  }
  async function doAuth(kind) {
    var md = state.modal, email = $("f-email").value.trim(), pass = $("f-pass").value;
    md.email = email;
    if (!email || pass.length < 6) { md.msg = "Escribe tu correo y una contraseña de al menos 6 caracteres."; renderModal(); return; }
    md.busy = true; md.msg = ""; renderModal();
    try {
      var r = kind === "signin" ? await sync.client.auth.signInWithPassword({ email: email, password: pass }) : await sync.client.auth.signUp({ email: email, password: pass });
      if (r.error) throw r.error;
      if (kind === "signup" && !(r.data && r.data.session)) { md.busy = false; md.msg = "Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión."; renderModal(); return; }
      closeModal(); toast("Sesión iniciada");
    } catch (e) {
      var m = (e && e.message) || "";
      md.busy = false;
      md.msg = /invalid login/i.test(m) ? "Correo o contraseña incorrectos." : /already registered/i.test(m) ? "Ese correo ya tiene cuenta. Toca Iniciar sesión." : /email not confirmed/i.test(m) ? "Confirma tu correo con el enlace que te enviamos." : "No se pudo completar: " + m;
      renderModal();
    }
  }

  /* ---------- arranque ---------- */
  function syncToday() {
    if (state.followToday && ymd(state.date) !== ymd(today())) { state.date = today(); render(); }
  }
  var savedTab = lsGet("habitos.tab"); if (savedTab === "hoy" || savedTab === "prog") state.tab = savedTab;
  state.date = today();
  try { state.habits = sortHabits((JSON.parse(lsGet("habitos.v1") || "[]")).map(normalize)); } catch (e) { state.habits = []; }
  try { state.tombs = JSON.parse(lsGet("habitos.tomb") || "{}"); } catch (e) { state.tombs = {}; }
  state.loaded = true;
  render();
  initSync();
  setInterval(syncToday, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) syncToday(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
})();
