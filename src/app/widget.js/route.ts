/**
 * Виджет чата для сайта фонда. Подключение одной строкой:
 * <script src="https://<платформа>/widget.js" data-channel="<id канала>" async></script>
 */
const SCRIPT = String.raw`(function () {
  var me = document.currentScript || document.querySelector('script[data-channel][src*="widget.js"]');
  if (!me || window.__domWidget) return;
  window.__domWidget = true;
  var channel = me.getAttribute("data-channel");
  var base = new URL(me.src).origin;
  var api = base + "/api/public/widget/" + channel;
  var key = "dom-widget-visitor-" + channel;
  var visitor = localStorage.getItem(key);
  if (!visitor) { visitor = crypto.randomUUID(); localStorage.setItem(key, visitor); }
  var emailKey = key + "-email";
  var state = { open: false, messages: [], last: null, unread: 0, cfg: null };

  var host = document.createElement("div");
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483000";
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<style>' +
    ':host{all:initial}*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '.btn{width:58px;height:58px;border-radius:50%;border:0;color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.22);display:grid;place-items:center;position:relative}' +
    '.badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#dc2626;color:#fff;font-size:12px;display:none;place-items:center;padding:0 5px}' +
    '.panel{position:absolute;right:0;bottom:72px;width:min(370px,calc(100vw - 32px));height:min(540px,calc(100vh - 120px));background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;border:1px solid #e5e7eb}' +
    '.head{padding:16px 18px;color:#fff}.head b{display:block;font-size:16px}.head span{font-size:13px;opacity:.9}' +
    '.list{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:8px}' +
    '.m{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}' +
    '.file{display:block;margin-top:6px;color:inherit;text-decoration:underline;font-size:13px}.file img{display:block;max-width:100%;max-height:180px;border-radius:10px}' +
    '.q{border-left:2px solid rgba(10,125,158,.6);padding:1px 0 1px 7px;margin-bottom:5px;font-size:12px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.v{align-self:flex-end;color:#fff;border-bottom-right-radius:4px}.f{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;color:#111827;border-bottom-left-radius:4px}' +
    '.mail{display:flex;gap:6px;padding:8px 12px;border-top:1px solid #f1f5f9;font-size:12px;color:#64748b;align-items:center}' +
    '.mail input{flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font-size:12px}' +
    '.form{display:flex;gap:8px;padding:12px;border-top:1px solid #e5e7eb;background:#fff}' +
    'textarea{flex:1;resize:none;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;font-size:14px;height:44px;max-height:120px;outline:none}' +
    'textarea:focus{border-color:#94a3b8}.send{border:0;border-radius:12px;color:#fff;padding:0 14px;cursor:pointer;font-size:14px}' +
  '</style>' +
  '<div class="panel" part="panel"><div class="head"><b class="title"></b><span>Обычно отвечаем в течение дня</span></div>' +
  '<div class="list"></div><div class="mail"><span>Почта для ответа:</span><input type="email" placeholder="необязательно" /></div>' +
  '<form class="form"><textarea placeholder="Напишите сообщение…" aria-label="Сообщение"></textarea><button class="send" type="submit">→</button></form></div>' +
  '<button class="btn" aria-label="Написать в фонд"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="badge"></span></button>';
  var $ = function (s) { return root.querySelector(s); };
  var panel = $(".panel"), list = $(".list"), btn = $(".btn"), badge = $(".badge"), ta = $("textarea"), mail = $(".mail input");
  mail.value = localStorage.getItem(emailKey) || "";

  function paint() {
    var accent = (state.cfg && state.cfg.accent) || "#0a7d9e";
    btn.style.background = accent; $(".head").style.background = accent; $(".send").style.background = accent;
    list.innerHTML = "";
    var items = [{ from: "fund", text: (state.cfg && state.cfg.greeting) || "Здравствуйте!" }].concat(state.messages);
    items.forEach(function (m) {
      var d = document.createElement("div");
      d.className = "m " + (m.from === "visitor" ? "v" : "f");
      if (m.from === "visitor") d.style.background = accent;
      if (m.quote) {
        var q = document.createElement("div");
        q.className = "q";
        q.textContent = m.quote;
        d.appendChild(q);
      }
      if (m.text) d.appendChild(document.createTextNode(m.text));
      (m.files || []).forEach(function (f) {
        var a = document.createElement("a");
        a.href = f.url; a.target = "_blank"; a.rel = "noopener"; a.className = "file";
        if (f.image) {
          var img = document.createElement("img");
          img.src = f.url; img.alt = f.name; a.appendChild(img);
        } else {
          a.textContent = "📎 " + f.name;
        }
        d.appendChild(a);
      });
      list.appendChild(d);
    });
    list.scrollTop = list.scrollHeight;
    badge.style.display = state.unread && !state.open ? "grid" : "none";
    badge.textContent = state.unread;
  }

  function load() {
    var u = api + "/messages?visitorId=" + visitor + (state.last ? "&after=" + encodeURIComponent(state.last) : "");
    return fetch(u).then(function (r) { return r.json(); }).then(function (d) {
      (d.messages || []).forEach(function (m) {
        if (state.messages.some(function (x) { return x.id === m.id; })) return;
        state.messages = state.messages.filter(function (x) { return !(x.pending && x.from === m.from && x.text === m.text); });
        state.messages.push(m); state.last = m.at;
        if (m.from === "fund" && !state.open) state.unread++;
      });
      paint();
    }).catch(function () {});
  }

  btn.onclick = function () {
    state.open = !state.open; state.unread = 0;
    panel.style.display = state.open ? "flex" : "none";
    paint(); if (state.open) { ta.focus(); load(); }
  };
  mail.onchange = function () { localStorage.setItem(emailKey, mail.value.trim()); };
  $(".form").onsubmit = function (e) {
    e.preventDefault();
    var text = ta.value.trim(); if (!text) return;
    ta.value = "";
    state.messages.push({ id: "p" + Date.now(), from: "visitor", text: text, pending: true }); paint();
    fetch(api + "/messages", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId: visitor, text: text, email: mail.value.trim() || undefined }) })
      .then(function () { return load(); });
  };
  ta.onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $(".form").requestSubmit(); } };

  fetch(api).then(function (r) { return r.json(); }).then(function (cfg) {
    if (cfg.error) return;
    state.cfg = cfg; $(".title").textContent = cfg.title;
    document.body.appendChild(host); paint(); load();
    setInterval(function () { if (state.open || document.visibilityState === "visible") load(); }, 5000);
  });
})();`

export function GET() {
  return new Response(SCRIPT, {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  })
}
