/* ==========================================================================
   Poop Savvy CRM v2 — Shared app runtime
   Include on every page (after Supabase UMD script).

   Exposes on window:
     PS.sb       — supabase client (after init)
     PS.api      — REST helpers bound with the auth token
     PS.auth     — auth helpers (signOut, requireSession)
     PS.fmt      — formatters
     PS.toast(msg, type)
     PS.nav(active)
     PS.cmdk.open()
     PS.pricing.calcPrice(dogs, freq)

   ========================================================================== */

(function () {
  // Same-origin — requests go through Netlify's _redirects proxy to Supabase.
  // Browser never calls supabase.co directly, so no network blocks ever stop us.
  const SUPA_URL  = window.location.origin;
  const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoam90ZWxwdnhvbmt2a3ljc2dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1Mjk1MDksImV4cCI6MjA5MTEwNTUwOX0.gp4L2V21UEckjniXYM10p4s_VEiuysa-XOOIasKnH3Y";
  const ALLOWED   = ["poopsavvydfw@gmail.com", "joshjreed1@gmail.com", "info@poop-savvy.com"];
  const BUSINESS_TIME_ZONE = "America/Chicago";

  /* --------------------------- Supabase init -------------------------- */

  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase UMD is not loaded yet. Include supabase-js before app.js.");
    return;
  }
  const sb = window.supabase.createClient(SUPA_URL, SUPA_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });

  /* --------------------------- Auth state ----------------------------- */

  let currentSession = null;
  let currentUser = null;

  function isAuthorized(email) {
    return !!email && ALLOWED.includes(email.toLowerCase());
  }

  async function getFreshToken() {
    const { data: { session } } = await sb.auth.getSession();
    return session?.access_token || null;
  }

  function apiHeaders(tokenOverride) {
    const token = tokenOverride || currentSession?.access_token || SUPA_ANON;
    return {
      apikey: SUPA_ANON,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    };
  }

  /* ---------------------------- API helpers --------------------------- */

  async function api(path, { method = "GET", body, prefer, signal } = {}) {
    const url = SUPA_URL + "/rest/v1" + path;
    const headers = apiHeaders();
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  const api_ = {
    select: (table, q = "") => api(`/${table}${q ? (q.startsWith("?") ? q : "?" + q) : ""}`),
    insert: (table, rows) =>
      api(`/${table}`, { method: "POST", body: rows, prefer: "return=representation" }),
    insertMinimal: (table, rows) =>
      api(`/${table}`, { method: "POST", body: rows, prefer: "return=minimal" }),
    patch: (table, filter, patch) =>
      api(`/${table}?${filter}`, { method: "PATCH", body: patch, prefer: "return=minimal" }),
    delete: (table, filter) =>
      api(`/${table}?${filter}`, { method: "DELETE" }),
  };

  /* ---------------------------- Formatters ---------------------------- */

  function dateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function parseDateKey(key) {
    const [year, month, day] = String(key || "").split("-").map(Number);
    return { year, month, day };
  }

  function formatDateKey(year, month, day) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function addDateDays(key, days) {
    const { year, month, day } = parseDateKey(key);
    const dt = new Date(Date.UTC(year, month - 1, day + days));
    return formatDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  function addDateMonths(key, months) {
    const { year, month, day } = parseDateKey(key);
    const dt = new Date(Date.UTC(year, month - 1 + months, day));
    return formatDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  function monthEndKey(key) {
    const { year, month } = parseDateKey(key);
    const dt = new Date(Date.UTC(year, month, 0));
    return formatDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  function weekStartKey(key) {
    const { year, month, day } = parseDateKey(key);
    const dt = new Date(Date.UTC(year, month - 1, day));
    return addDateDays(key, -dt.getUTCDay());
  }

  const fmt = {
    dateKey,
    addDateDays,
    addDateMonths,
    monthEndKey,
    weekStartKey,
    date(d) {
      if (!d) return "—";
      const dt = typeof d === "string" ? new Date(d.length <= 10 ? d + "T00:00:00" : d) : d;
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    },
    dateLong(d) {
      if (!d) return "—";
      const dt = typeof d === "string" ? new Date(d.length <= 10 ? d + "T00:00:00" : d) : d;
      return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    },
    time(d) {
      if (!d) return "—";
      const dt = typeof d === "string" ? new Date(d) : d;
      return dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    },
    dateTime(d) {
      if (!d) return "—";
      const dt = typeof d === "string" ? new Date(d) : d;
      return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    },
    money(n, withCents = true) {
      const v = Number(n || 0);
      return "$" + (withCents ? v.toFixed(2) : Math.round(v).toLocaleString());
    },
    phone(p) {
      if (!p) return "";
      const d = String(p).replace(/\D/g, "");
      if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
      if (d.length === 11 && d[0] === "1") return `${d.slice(1,4)}-${d.slice(4,7)}-${d.slice(7)}`;
      return p;
    },
    initials(name) {
      if (!name) return "?";
      return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join("").toUpperCase();
    },
    today() { return dateKey(); },
    today_() { return fmt.today(); },
    escape(s) {
      if (s == null) return "";
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
    // Safe to drop inside single-quoted JS strings inside HTML attributes.
    // e.g. onclick="foo('${PS.fmt.jsAttr(name)}')"
    jsAttr(s) {
      if (s == null) return "";
      return String(s)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, "&quot;")
        .replace(/</g, "\\u003c")
        .replace(/\r?\n/g, "\\n");
    },
  };

  /* ---------------------------- Pricing ------------------------------- */

  const BASE_RATES = { "Weekly": 72, "Every Other Week": 56, "Monthly": 32 };
  const pricing = {
    BASE_RATES,
    calcPrice(dogs, freq) {
      const d = Math.max(1, parseInt(dogs) || 1);
      const base = BASE_RATES[freq] || 72;
      return base + (d - 1) * 5;
    },
    generateScheduleDates(startDate, freq, months = 12) {
      const dates = [];
      const end = addDateMonths(startDate, months);
      const interval = freq === "Weekly" ? 7 : freq === "Every Other Week" ? 14 : 28;
      let cur = startDate;
      while (cur <= end) {
        dates.push(cur);
        cur = addDateDays(cur, interval);
      }
      return dates;
    },
  };

  /* ---------------------------- Toast --------------------------------- */

  function toast(msg, type = "success") {
    let el = document.getElementById("ps-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ps-toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = "toast show" + (type === "error" ? " error" : type === "info" ? " info" : "");
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = "toast"), 3200);
  }

  /* ---------------------------- View mode ----------------------------- */
  // Admin = full CRM. Tech = trimmed view focused on Schedule + Routes.
  // Single shared login; device-level state via localStorage.
  // Centrally managed PIN + roster in admin_config.

  const VIEW_KEY = "ps_view_mode";   // 'admin' | 'tech'
  const TECH_KEY = "ps_tech_name";
  const DEFAULT_ROSTER = ["Josh", "Dee", "Drake"];
  const DEFAULT_PIN = "1234";

  const view = {
    _roster: DEFAULT_ROSTER.slice(),
    _pin: DEFAULT_PIN,
    _loaded: false,

    mode() { return localStorage.getItem(VIEW_KEY) === "tech" ? "tech" : "admin"; },
    isTech() { return this.mode() === "tech"; },
    tech() { return localStorage.getItem(TECH_KEY) || ""; },
    roster() { return this._roster.slice(); },

    async load() {
      if (this._loaded) return;
      try {
        const rows = await api_.select(
          "admin_config",
          "select=key,value&key=in.(admin_pin,tech_roster)"
        );
        for (const r of rows || []) {
          if (r.key === "admin_pin" && r.value) this._pin = r.value;
          if (r.key === "tech_roster" && r.value) {
            const parts = String(r.value).split(",").map(s => s.trim()).filter(Boolean);
            if (parts.length) this._roster = parts;
          }
        }
      } catch (_) { /* fall back to defaults */ }
      this._loaded = true;
    },

    _setMode(m) {
      if (m === "tech") localStorage.setItem(VIEW_KEY, "tech");
      else localStorage.removeItem(VIEW_KEY);
    },
    setTech(name) {
      if (name) localStorage.setItem(TECH_KEY, name);
      else localStorage.removeItem(TECH_KEY);
    },

    _matchTech(input) {
      if (!input) return null;
      const q = String(input).trim().toLowerCase();
      return this._roster.find(n => n.toLowerCase() === q) || null;
    },

    // From admin → tech: no PIN (dropping privileges). Ask which tech is on this phone.
    switchToTech() {
      let t = this.tech();
      if (!t || !this._roster.includes(t)) {
        const pick = prompt("Which tech is using this phone?\n\n" + this._roster.join(", "));
        if (pick == null) return;
        const match = this._matchTech(pick);
        if (!match) { toast("Not on the roster: " + pick, "error"); return; }
        this.setTech(match);
      }
      this._setMode("tech");
      toast("Tech mode — " + this.tech());
      window.location.href = "schedule.html";
    },

    // From tech → admin: require PIN.
    switchToAdmin() {
      const pin = prompt("Enter admin PIN:");
      if (pin == null) return;
      if (String(pin).trim() !== String(this._pin).trim()) {
        toast("Wrong PIN", "error");
        return;
      }
      this._setMode("admin");
      toast("Admin mode");
      window.location.href = "index.html";
    },

    // Swap to a different tech while staying in tech mode.
    changeTech() {
      if (!this._roster.length) { toast("No techs configured", "error"); return; }
      const cur = this.tech();
      const pick = prompt(
        "Tech using this phone (" + this._roster.join(", ") + "):",
        cur || this._roster[0]
      );
      if (pick == null) return;
      const match = this._matchTech(pick);
      if (!match) { toast("Not on the roster: " + pick, "error"); return; }
      this.setTech(match);
      toast("Switched to " + match);
      window.location.reload();
    },
  };

  /* ---------------------------- Nav ----------------------------------- */

  const NAV_ITEMS = [
    { id: "index",     href: "index.html",     label: "Dashboard", icon: "📊" },
    { id: "leads",     href: "leads.html",     label: "Leads",     icon: "🎯" },
    { id: "customers", href: "customers.html", label: "Customers", icon: "👥" },
    { id: "invoices",  href: "invoices.html",  label: "Invoices",  icon: "🧾" },
    { id: "schedule",  href: "schedule.html",  label: "Schedule",  icon: "📅" },
    { id: "routes",    href: "routes.html",    label: "Routes",    icon: "🗺️" },
  ];

  // Pages allowed in tech mode (everything else redirects to Schedule).
  const TECH_PAGES = new Set(["schedule", "routes"]);

  function renderNav(active) {
    const container = document.getElementById("app-nav");
    if (!container) return;
    const user = currentUser || {};
    const initials = fmt.initials(user.user_metadata?.full_name || user.email || "?");
    const avatar = user.user_metadata?.avatar_url
      ? `<img src="${fmt.escape(user.user_metadata.avatar_url)}" alt="" referrerpolicy="no-referrer">`
      : initials;
    const name = user.user_metadata?.full_name || (user.email ? user.email.split("@")[0] : "Staff");

    const techMode = view.isTech();
    const techName = view.tech();
    const visibleItems = techMode
      ? NAV_ITEMS.filter(n => TECH_PAGES.has(n.id))
      : NAV_ITEMS;

    const btnStyle = "background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.22);color:#fff;";
    const modeBtn = techMode
      ? `<button class="btn btn-sm" style="${btnStyle}" onclick="PS.view.switchToAdmin()" title="Switch to Admin mode (PIN required)">🔒 Admin</button>`
      : `<button class="btn btn-sm" style="${btnStyle}" onclick="PS.view.switchToTech()" title="Switch to Tech mode">👷 Tech Mode</button>`;
    const techBtn = techMode
      ? `<button class="btn btn-sm" style="${btnStyle}" onclick="PS.view.changeTech()" title="Switch tech">👤 ${fmt.escape(techName || "Pick tech")}</button>`
      : "";
    const cmdkBtn = techMode
      ? "" // ⌘K only surfaces admin-wide data; hide in tech mode
      : `<button class="btn btn-sm" style="${btnStyle}" onclick="PS.cmdk.open()" title="Quick find (⌘K)">⌘K</button>`;

    container.innerHTML = `
      <a href="${techMode ? "schedule.html" : "index.html"}" class="brand" style="text-decoration:none;">
        <span class="brand-mark">🐾</span>
        <span>Poop Savvy${techMode ? " · Tech" : ""}</span>
      </a>
      <div class="app-nav-links">
        ${visibleItems.map(n => `
          <a href="${n.href}" class="${n.id === active ? "active" : ""}">${n.label}</a>
        `).join("")}
      </div>
      <div class="app-nav-right">
        ${techBtn}
        ${modeBtn}
        ${cmdkBtn}
        <div class="nav-user" title="${fmt.escape(user.email || "")}">
          <div class="nav-user-avatar">${avatar}</div>
          <span class="name">${fmt.escape(techMode ? (techName || name) : name)}</span>
        </div>
        <button class="signout-btn" onclick="PS.auth.signOut()">Sign Out</button>
      </div>
    `;

    // Bottom tab bar (mobile)
    const tabs = document.getElementById("tab-bar");
    if (tabs) {
      tabs.innerHTML = visibleItems.map(n => `
        <a href="${n.href}" class="${n.id === active ? "active" : ""}">
          <span class="ic">${n.icon}</span>
          <span>${n.label}</span>
        </a>
      `).join("");
    }
  }

  /* ----------------------- Command palette ---------------------------- */

  const cmdk = (function () {
    let overlay = null, input = null, list = null;
    let items = [];
    let focusedIdx = 0;
    let customerCache = null, leadCache = null;

    async function hydrate() {
      if (customerCache && leadCache) return;
      try {
        const [custs, leads] = await Promise.all([
          api_.select("customers", "select=id,name,address,city,phone,service_status&order=name.asc"),
          api_.select("leads", "select=id,first_name,last_name,phone,city,status&order=created_at.desc"),
        ]);
        customerCache = custs || [];
        leadCache = leads || [];
      } catch (e) {
        customerCache = []; leadCache = [];
      }
    }

    function ensureUI() {
      if (overlay) return;
      overlay = document.createElement("div");
      overlay.className = "cmdk-overlay";
      overlay.innerHTML = `
        <div class="cmdk" role="dialog" aria-label="Quick find">
          <input type="text" placeholder="Search customers, leads, or jump to a page..." autocomplete="off">
          <div class="cmdk-list"></div>
        </div>
      `;
      document.body.appendChild(overlay);
      input = overlay.querySelector("input");
      list = overlay.querySelector(".cmdk-list");

      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      input.addEventListener("input", render);
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); focusedIdx = Math.min(items.length - 1, focusedIdx + 1); paintFocus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); focusedIdx = Math.max(0, focusedIdx - 1); paintFocus(); }
        else if (e.key === "Enter") { e.preventDefault(); const it = items[focusedIdx]; if (it) { window.location.href = it.href; } }
        else if (e.key === "Escape") { close(); }
      });
    }

    function paintFocus() {
      const rows = list.querySelectorAll(".cmdk-item");
      rows.forEach((r, i) => r.classList.toggle("focused", i === focusedIdx));
      const focused = rows[focusedIdx];
      if (focused) focused.scrollIntoView({ block: "nearest" });
    }

    function render() {
      const q = input.value.trim().toLowerCase();
      const pages = NAV_ITEMS.map(n => ({
        icon: n.icon, title: n.label, sub: "Go to " + n.label.toLowerCase(),
        type: "Page", href: n.href, keyword: n.label + " " + n.id,
      }));
      const custs = (customerCache || []).map(c => ({
        icon: "👤", title: c.name || "Unnamed",
        sub: [c.address, c.city].filter(Boolean).join(", ") || (c.phone || ""),
        type: "Customer", href: `customer-detail.html?id=${c.id}`,
        keyword: [c.name, c.phone, c.city, c.address].filter(Boolean).join(" "),
      }));
      const lds = (leadCache || []).map(l => ({
        icon: "🎯", title: [l.first_name, l.last_name].filter(Boolean).join(" ") || "Unnamed lead",
        sub: (l.phone || l.city || "") + (l.status ? " · " + l.status : ""),
        type: "Lead", href: `lead-detail.html?id=${l.id}`,
        keyword: [l.first_name, l.last_name, l.phone, l.city, l.status].filter(Boolean).join(" "),
      }));
      const all = [...pages, ...custs, ...lds];
      items = q
        ? all.filter(it => it.keyword.toLowerCase().includes(q)).slice(0, 25)
        : pages.concat(custs.slice(0, 8)).concat(lds.slice(0, 5));
      focusedIdx = 0;

      if (!items.length) {
        list.innerHTML = `<div class="cmdk-empty">No matches.</div>`;
        return;
      }
      list.innerHTML = items.map((it, i) => `
        <div class="cmdk-item ${i === 0 ? "focused" : ""}" data-href="${fmt.escape(it.href)}">
          <span class="ic">${it.icon}</span>
          <div>
            <div style="font-weight:600;">${fmt.escape(it.title)}</div>
            <div class="text-sm muted">${fmt.escape(it.sub || "")}</div>
          </div>
          <span class="type">${it.type}</span>
        </div>
      `).join("");
      list.querySelectorAll(".cmdk-item").forEach((el) => {
        el.addEventListener("click", () => { window.location.href = el.getAttribute("data-href"); });
      });
    }

    function open() {
      ensureUI();
      hydrate().then(render);
      overlay.classList.add("open");
      setTimeout(() => input.focus(), 20);
    }
    function close() {
      if (overlay) overlay.classList.remove("open");
    }

    // Global shortcut: ⌘K / Ctrl+K
    document.addEventListener("keydown", (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); open();
      } else if (e.key === "/" && document.activeElement === document.body) {
        e.preventDefault(); open();
      }
    });

    return { open, close };
  })();

  /* ---------------------------- Auth flow ----------------------------- */

  function signOut() {
    sb.auth.signOut().finally(() => window.location.replace("login.html"));
  }

  function redirectToLogin() {
    if (!/login\.html$/.test(window.location.pathname)) {
      window.location.replace("login.html");
    }
  }

  // Fire callback once we have a valid, authorized session.
  async function requireSession(onReady) {
    // Try up to ~8 seconds for the session to hydrate from storage
    const deadline = Date.now() + 8000;
    const params = new URLSearchParams(window.location.search);
    // Edge case: pages opened directly with ?code= — handle like login did
    if (params.get("code")) {
      try { await sb.auth.exchangeCodeForSession(window.location.href); } catch (_) {}
      // Clean the URL
      const clean = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, clean);
    }
    while (Date.now() < deadline) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user) {
          if (!isAuthorized(session.user.email)) {
            await sb.auth.signOut();
            redirectToLogin();
            return;
          }
          currentSession = session;
          currentUser = session.user;
          try { onReady && onReady(session); } catch (e) { console.error(e); }
          return;
        }
      } catch (_) { /* ignore */ }
      await new Promise(r => setTimeout(r, 120));
    }
    redirectToLogin();
  }

  // React to sign-out events in another tab
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      if (!/login\.html$/.test(window.location.pathname)) redirectToLogin();
    } else if (session?.access_token) {
      currentSession = session;
      currentUser = session.user;
    }
  });

  /* ---------------------------- Boot ---------------------------------- */

  // Auto-bootstrap any page that opts in via <body data-page="leads">
  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body?.dataset?.page;
    if (page === "login") return;  // login page handles its own flow
    requireSession(async () => {
      // Hydrate view config (PIN, roster) before nav + page guard
      await view.load();
      // Tech mode can only access Schedule + Routes — redirect anything else
      if (view.isTech() && page && !TECH_PAGES.has(page)) {
        window.location.replace("schedule.html");
        return;
      }
      renderNav(page);
      if (typeof window.onAuthReady === "function") window.onAuthReady();
    });
  });

  /* --------------------------- Expose --------------------------------- */

  window.PS = {
    sb,
    api: api_,
    auth: { signOut, requireSession, isAuthorized, getUser: () => currentUser, getSession: () => currentSession },
    fmt,
    toast,
    nav: renderNav,
    cmdk,
    pricing,
    view,
    SUPA_URL, SUPA_ANON, ALLOWED,
  };
})();
