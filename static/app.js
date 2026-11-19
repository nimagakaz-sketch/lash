/**
 * Beauty Studio Mini App & Liquid Glass Engine
 * Features: Soft Glassmorphism, Liquid Tab Bar Physics, Online Booking, Portfolio, Visits, Admin Cabinet
 */

// ------------------- GLOBAL STATE -------------------
const state = {
  config: null,
  services: [],
  portfolio: [],
  visits: [],
  currentTab: 0,
  activeCategory: "Все",
  isAdmin: false,
  currentUser: null,
  // Booking state
  booking: {
    service: null,
    date: null,
    slot: null,
    needsRemoval: false,
    hasAllergy: false,
    comment: "",
    clientName: "",
    clientPhone: ""
  },
  admin: {
    selectedDate: new Date().toISOString().split("T")[0],
    subTab: "schedule"
  }
};

const $ = (id) => document.getElementById(id);
const tg = window.Telegram?.WebApp;

// ------------------- TELEGRAM WEBAPP INIT -------------------
if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor("#0d0a12");
    if (tg.setBackgroundColor) tg.setBackgroundColor("#0d0a12");
  } catch (e) {
    console.warn("Telegram WebApp initialization error:", e);
  }
}

function haptic(type = "light") {
  try {
    if (!tg?.HapticFeedback) return;
    if (type === "light" || type === "medium" || type === "heavy") {
      tg.HapticFeedback.impactOccurred(type);
    } else if (type === "selection") {
      tg.HapticFeedback.selectionChanged();
    } else if (type === "success" || type === "error" || type === "warning") {
      tg.HapticFeedback.notificationOccurred(type);
    }
  } catch (e) {}
}

function showToast(message, duration = 3000) {
  const t = $("toast");
  if (!t) return;
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), duration);
}

// Helper to make API requests with Telegram initData header
async function apiRequest(url, options = {}) {
  const headers = options.headers || {};
  if (tg?.initData) {
    headers["X-Telegram-Init-Data"] = tg.initData;
  }
  // Fallback for browser testing
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("admin") === "1") {
    headers["X-Dev-User-Id"] = "6573422629";
  }
  options.headers = headers;
  return fetch(url, options);
}

// ------------------- LIQUID GLASS TAB BAR ENGINE -------------------
const isChromium = /Chrome\//.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
const surf = (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25);

function profile(T, B, ior, N = 128) {
  const eta = 1 / ior, p = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const x = i / N, y = surf(x), dx = x < 1 ? 1e-4 : -1e-4;
    const d = (surf(x + dx) - y) / dx, m = Math.hypot(d, 1), nx = -d / m, ny = -1 / m;
    const k = 1 - eta * eta * (1 - ny * ny);
    if (k < 0) continue;
    const s = Math.sqrt(k);
    p[i] = -(eta * ny + s) * nx * ((y * B + T) / (eta - (eta * ny + s) * ny));
  }
  return p;
}

const k0 = (x, y, w) => (y * w + x) * 4 + 3;

function maps(w, h, r, B, p, mx) {
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    return [c, x, x.createImageData(w, h)];
  };
  const [c1, x1, i1] = mk(), [c2, x2, i2] = mk(), a = i1.data, b = i2.data;
  const N = p.length, wB = w - 2 * r, hB = h - 2 * r, Bs = B * 2.5, sx = Math.cos(Math.PI / 3), sy = Math.sin(Math.PI / 3);
  for (let i = 0; i < a.length; i += 4) { a[i] = a[i + 1] = 128; a[i + 3] = 255; }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = x < r ? x - r : x >= w - r ? x - r - wB : 0;
      const Y = y < r ? y - r : y >= h - r ? y - r - hB : 0;
      const d2 = X * X + Y * Y;
      if (d2 > (r + 1) ** 2) continue;
      const d = Math.sqrt(d2);
      if (!d) { b[k0(x, y, w)] = 0; continue; }
      const op = d < r ? 1 : 1 - (d - r), k = (y * w + x) * 4, cs = X / d, sn = Y / d, fs = r - d;
      if (op <= 0) continue;
      if (d2 >= Math.max(r - B, 0) ** 2) {
        const disp = p[Math.min(Math.max((fs / B * N) | 0, 0), N - 1)] || 0;
        a[k] = (128 + (-cs * disp / mx) * 127 * op + 0.5) | 0;
        a[k + 1] = (128 + (-sn * disp / mx) * 127 * op + 0.5) | 0;
      }
      if (d2 >= Math.max(r - Bs, 0) ** 2) {
        const dot = Math.abs(cs * sx + (-sn) * sy), edge = Math.sqrt(Math.max(0, 1 - (1 - fs) ** 2)), co = dot * edge, col = (255 * co) | 0;
        b[k] = b[k + 1] = b[k + 2] = col;
        b[k + 3] = (col * co * op) | 0;
      }
    }
  }
  x1.putImageData(i1, 0, 0);
  x2.putImageData(i2, 0, 0);
  return [c1.toDataURL(), c2.toDataURL()];
}

function filterFor(el, id) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (w < 2 || h < 2) return "";
  const soft = !!el.dataset.soft, r = h / 2, B = Math.min(h * (soft ? 0.15 : 0.34), r - 1);
  const p = profile(h * (soft ? 0.2 : 0.42), B, soft ? 1.5 : 1.9);
  const mx = Math.max(...Array.from(p, Math.abs)) || 1;
  const [disp, spec] = maps(w, h, r, B, p, mx);
  return `<filter id="${id}" x="0%" y="0%" width="100%" height="100%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="0.2" result="bl"/>
    <feImage href="${disp}" x="0" y="0" width="${w}" height="${h}" result="dm"/>
    <feDisplacementMap in="bl" in2="dm" scale="${mx * (soft ? 0.1 : id === 'lg-thumb' ? 0.45 : 0.4)}" xChannelSelector="R" yChannelSelector="G" result="dp"/>
    <feColorMatrix in="dp" type="saturate" values="5" result="ds"/>
    <feImage href="${spec}" x="0" y="0" width="${w}" height="${h}" result="sl"/>
    <feComposite in="ds" in2="sl" operator="in" result="sm"/>
    <feComponentTransfer in="sl" result="sf"><feFuncA type="linear" slope="${soft ? 0 : id === 'lg-thumb' ? 0.22 : 1}"/></feComponentTransfer>
    <feBlend in="sm" in2="dp" mode="normal" result="ws"/>
    <feBlend in="sf" in2="ws" mode="normal"/>
  </filter>`;
}

let bar = $("bar"), base = $("base"), fil = $("fil"), thumb = $("thumb"), lens = $("lens");
let bdEls = [[base, "bd-base"]], glassEls = [[lens, "lg-thumb"]];
bdEls.forEach(([el]) => (el.dataset.soft = "1"));

function rebuildFilters() {
  const defs = $("defs");
  if (!defs) return;
  defs.innerHTML = glassEls.concat(isChromium ? bdEls : []).map(([el, id]) => filterFor(el, id)).join("");
  glassEls.forEach(([el, id]) => (el.style.filter = `url(#${id})`));
  if (isChromium) {
    bdEls.forEach(([el, id]) => {
      const v = `url(#${id}) blur(4px) saturate(1.8)`;
      el.style.backdropFilter = v;
      el.style.webkitBackdropFilter = v;
    });
  }
}

let rt;
const ro = new ResizeObserver(() => {
  clearTimeout(rt);
  rt = setTimeout(rebuildFilters, 80);
});
glassEls.concat(bdEls).forEach(([el]) => ro.observe(el));
rebuildFilters();

// Tab Bar Physics Setup
let tabs = [...$("tabs").children];
let tabsEl = $("tabs");
let cloneTabs = [];

function setupTabBarClone() {
  lens.innerHTML = "";
  const clone = tabsEl.cloneNode(true);
  clone.removeAttribute("id");
  clone.setAttribute("aria-hidden", "true");
  clone.querySelectorAll("button").forEach((b) => (b.tabIndex = -1));
  lens.appendChild(clone);
  cloneTabs = [...clone.children];
  tabs = [...tabsEl.children];
}
setupTabBarClone();

let dirv = 1, cur = 0, vel = 0, target = 0, press = 0, pvel = 0, down = false, grab = 0, active = 0;
let pRaw = 0, pT = 0, pV = 0, mv = 0, mvv = 0, zz = 0, zzv = 0, wasMoving = false, lag = 0, lagv = 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let hi = 0;

function highlight(i) {
  if (i === hi) return;
  hi = i;
  [tabs, cloneTabs].forEach((arr) => arr.forEach((el, n) => el.classList.toggle("on", n === i)));
}

function setActiveTab(i) {
  highlight(i);
  if (i === active) return;
  active = i;
  state.currentTab = i;
  haptic("selection");
  switchView(i);
}

function switchView(i) {
  const viewIds = ["v-services", "v-portfolio", "v-visits", "v-admin"];
  viewIds.forEach((id, idx) => {
    const el = $(id);
    if (!el) return;
    if (idx === i) {
      el.classList.add("on");
      el.scrollTop = 0;
    } else {
      el.classList.remove("on");
    }
  });

  // Reload data for specific tabs
  if (i === 1) renderPortfolio();
  if (i === 2) loadClientVisits();
  if (i === 3) loadAdminSchedule();
}

function ptr(e) {
  const rc = tabsEl.getBoundingClientRect();
  const count = tabs.length;
  const w = tabs[0].offsetWidth;
  const pad = (rc.width - w * count) / 2;
  return (e.clientX - rc.left - pad) / w;
}

function place(p, now) {
  const maxIdx = tabs.length - 1;
  const raw = p - 0.5 - grab;
  target = raw < 0 ? raw * 0.3 : raw > maxIdx ? maxIdx + (raw - maxIdx) * 0.3 : raw;
  if (pT) {
    const dt = Math.max(0.008, (now - pT) / 1000);
    pV += ((raw - pRaw) / dt - pV) * 0.35;
  }
  pRaw = raw;
  pT = now;
  highlight(clamp(Math.round(raw), 0, maxIdx));
}

bar.addEventListener("pointerdown", (e) => {
  bar.setPointerCapture(e.pointerId);
  down = true;
  bar.classList.add("down");
  pV = 0;
  pT = 0;
  const p = ptr(e);
  grab = Math.abs(p - (cur + 0.5)) < 0.5 ? p - (cur + 0.5) : 0;
  place(p, e.timeStamp);
});

bar.addEventListener("pointermove", (e) => {
  if (down) place(ptr(e), e.timeStamp);
});

["pointerup", "pointercancel"].forEach((n) =>
  bar.addEventListener(n, (e) => {
    if (!down) return;
    down = false;
    bar.classList.remove("down");
    const maxIdx = tabs.length - 1;
    if (e.timeStamp - pT > 90) pV = 0;
    pV = clamp(pV, -9, 9);
    const dest = clamp(Math.round(pRaw + pV * 0.1), 0, maxIdx);
    target = dest;
    setActiveTab(dest);
    vel += pV * 0.22;
  })
);

function attachTabClickListeners() {
  tabs.forEach((el, n) => {
    el.onclick = () => {
      target = n;
      setActiveTab(n);
    };
  });
}
attachTabClickListeners();

// Tab Bar Physics Animation Loop
let lastTime = performance.now();
(function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
  lastTime = now;

  const k = down ? 210 : 230, c = down ? 22 : 1.6 * Math.sqrt(230), pk = 200, pc = 11;
  const n = 4, h = dt / n;
  for (let i = 0; i < n; i++) {
    vel += (-k * (cur - target) - c * vel) * h;
    cur += vel * h;
    pvel += (-pk * (press - (down ? 1 : 0)) - pc * pvel) * h;
    press += pvel * h;
    lagv += (-180 * (lag - cur) - 2 * Math.sqrt(180) * lagv) * h;
    lag += lagv * h;
  }

  const moving = Math.abs(cur - target) > 0.1 || Math.abs(vel) > 0.9;
  if (wasMoving && !moving && !down) zzv -= 2.4;
  if (!wasMoving && moving) zzv += 1.4;
  wasMoving = moving;

  const mk = moving ? 380 : 900, mc = 2 * Math.sqrt(mk);
  for (let i = 0; i < 4; i++) {
    mvv += (-mk * (mv - (moving ? 1 : 0)) - mc * mvv) * (dt / 4);
    mv += mvv * (dt / 4);
  }
  mv = clamp(mv, -0.2, 1.6);

  const zt = 0.02 * clamp(Math.abs(vel) / 6, 0, 1) + 0.04 * press;
  for (let i = 0; i < 4; i++) {
    zzv += (-170 * (zz - zt) - 1.2 * Math.sqrt(170) * zzv) * (dt / 4);
    zz += zzv * (dt / 4);
  }
  zz = clamp(zz, -0.3, 0.3);

  const g = mv < 0 && press < 0.02 ? mv : Math.max(mv, press);
  const st = clamp(Math.abs(vel) * 0.055, 0, 0.26) * (down ? 1 : 0.6);
  const s = 1 + 0.05 * g + 0.06 * press, sy = 1 + 0.24 * g + 0.16 * press;

  bar.style.setProperty("--x", cur.toFixed(4));

  const tabCount = tabs.length;
  const tabW = tabCount === 4 ? 210 : 273;
  const barW = tabCount * tabW + 24;
  const thumbBaseW = tabW - 21;

  const sm = (v, m, K) => (v <= m - K ? v : m - K * Math.exp(-(v - (m - K)) / K));
  const cx = 12 + cur * tabW + tabW / 2;
  const horiz = (w) => [-sm(-(cx - w / 2), 48, 30), sm(cx + w / 2, barW + 48, 30)];

  if (Math.abs(vel) > 0.6) dirv = Math.sign(vel);
  const jel = clamp((cur - lag) * dirv, -0.55, 0.55);

  let sxv = s * (1 + st) * (1 + 0.48 * jel) * (1 - 0.45 * zz);
  let syv = sy * (1 + zz);
  sxv = Math.min(sxv, 1.38);

  let [Lc, Rc] = horiz(thumbBaseW * sxv);
  const cmp = Math.max(0, 1 - (Rc - Lc) / (thumbBaseW * sxv));
  vel *= 1 - Math.min(0.3, cmp * 4 * dt);
  syv *= 1 + 0.45 * cmp;

  const h0 = 165 * syv, h1 = sm(h0, 214, 14);
  sxv *= Math.sqrt(h0 / h1);
  syv = h1 / 165;
  [Lc, Rc] = horiz(thumbBaseW * sxv);

  bar.style.setProperty("--tx", ((Lc + Rc) / 2 - cx).toFixed(3));
  bar.style.setProperty("--sx", ((Rc - Lc) / thumbBaseW).toFixed(4));
  bar.style.setProperty("--sy", syv.toFixed(4));
  bar.style.setProperty("--p", clamp(g, 0, 1).toFixed(3));

  // Liquid droplet blend into bar edge
  const U = bar.offsetWidth / barW;
  const r = 82.5 * syv, cy = 95, ex = r - cy;
  let d = "";
  if (ex > 1.5) {
    const OX = 60, OY = 40;
    const f = (x, y) => ((x + OX) * U).toFixed(1) + " " + ((y + OY) * U).toFixed(1);
    const FLAT0 = 95, FLAT1 = barW - 95;
    const phi0 = Math.asin(Math.min(1, cy / r)), hc = Math.sqrt(Math.max(0, r * r - cy * cy));
    const build = (k, side, vert) => {
      const phi1 = Math.asin(Math.min(1, (cy + k * ex) / r));
      const cc = side > 0 ? Rc - r : Lc + r;
      const px = cc + side * r * Math.cos(phi1);
      const py = -(r * Math.sin(phi1) - cy);
      const tt = -py / Math.cos(phi1);
      const Cx = px + side * tt * Math.sin(phi1);
      const P0x = Cx + side * Math.abs(Cx - px) * 2;
      const xi = cc + side * hc;
      if (side > 0 ? P0x > FLAT1 : P0x < FLAT0) return null;
      const Y = (y) => (vert > 0 ? y : 190 - y);
      let pth = `M${f(xi, Y(0))} L${f(P0x, Y(0))} Q${f(Cx, Y(0))} ${f(px, Y(py))}`;
      for (let a = 1; a <= 8; a++) {
        const ph = phi1 + ((phi0 - phi1) * a) / 8;
        pth += ` L${f(cc + side * r * Math.cos(ph), Y(-(r * Math.sin(ph) - cy)))}`;
      }
      return pth + " Z";
    };
    for (const side of [1, -1]) {
      for (const vert of [1, -1]) {
        for (const k of [0.95, 0.65, 0.4]) {
          const q = build(k, side, vert);
          if (q) {
            d += q;
            break;
          }
        }
      }
    }
  }
  fil.style.clipPath = fil.style.webkitClipPath = d ? `path('${d}')` : 'path("M0 0 Z")';

  requestAnimationFrame(loop);
})(performance.now());


// ------------------- APP INITIALIZATION & REBRANDING -------------------

async function initApp() {
  try {
    const res = await apiRequest("/api/config");
    if (!res.ok) throw new Error("Failed to load config");
    const config = await res.json();
    state.config = config;
    state.isAdmin = !!config.is_admin;
    state.currentUser = config.current_user;

    // Apply Rebranding to DOM
    $("p-studio-name").textContent = config.studio_name || "Студия красоты";
    $("p-tagline").textContent = config.tagline || "";
    $("p-avatar").src = config.avatar_url || "https://images.unsplash.com/photo-1594744803329-e58b31de8bf5?w=400&q=80";
    $("p-address").textContent = config.address + (config.address_hint ? ` (${config.address_hint})` : "");

    const schedule = config.work_schedule || {};
    $("p-hours-badge").textContent = `🕒 ${schedule.start || "09:00"} – ${schedule.end || "21:00"}`;

    if (config.instagram_or_channel) {
      const ch = $("p-channel-link");
      ch.href = config.instagram_or_channel;
      ch.style.display = "inline-flex";
    }

    // Apply dynamic theme colors from config
    if (config.theme) {
      if (config.theme.primary_color) {
        document.documentElement.style.setProperty("--primary", config.theme.primary_color);
        document.documentElement.style.setProperty("--primary-glow", `${config.theme.primary_color}55`);
      }
      if (config.theme.accent_color) {
        document.documentElement.style.setProperty("--accent", config.theme.accent_color);
        document.documentElement.style.setProperty("--accent-glow", `${config.theme.accent_color}44`);
      }
    }

    // Prefill client name if Telegram user is known
    if (config.current_user?.first_name) {
      $("client-name-input").value = config.current_user.first_name;
    }

    // Wire header master cabinet shortcut button
    const btnMaster = $("btn-master-view");
    if (btnMaster) {
      btnMaster.onclick = () => {
        haptic("medium");
        target = 3;
        setActiveTab(3);
      };
    }

    // Load initial data
    renderCategories(config.categories || ["Все"]);
    await loadServices();
    await loadPortfolio();

    // Check URL params for deep linking (e.g. ?tab=2 for visits)
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = parseInt(urlParams.get("tab"));
    if (!isNaN(tabParam) && tabParam >= 0 && tabParam < tabs.length) {
      target = tabParam;
      setActiveTab(tabParam);
    }

  } catch (e) {
    console.error("Error initializing app:", e);
    showToast("Ошибка загрузки данных. Проверьте подключение.");
  }
}

function enableAdminTab() {
  if (tabs.length >= 4) return;
  const adminBtn = document.createElement("button");
  adminBtn.className = "tab";
  adminBtn.setAttribute("aria-label", "Кабинет");
  adminBtn.innerHTML = `
    <span class="ico">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2l3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z"></path>
      </svg>
    </span>
    <span>Кабинет</span>
  `;
  tabsEl.appendChild(adminBtn);

  // Update styles for 4 tabs
  document.documentElement.style.setProperty("--tab-count", "4");
  document.documentElement.style.setProperty("--tab-w", "210");
  document.documentElement.style.setProperty("--bar-w", "864");

  setupTabBarClone();
  attachTabClickListeners();
  rebuildFilters();
}


// ------------------- CATEGORIES & SERVICES -------------------

function renderCategories(categories) {
  const bar = $("categories-bar");
  bar.innerHTML = "";
  categories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = `category-chip ${cat === state.activeCategory ? "active" : ""}`;
    btn.textContent = cat;
    btn.onclick = () => {
      haptic("selection");
      state.activeCategory = cat;
      [...bar.children].forEach((c) => c.classList.toggle("active", c === btn));
      renderServicesList();
    };
    bar.appendChild(btn);
  });
}

async function loadServices() {
  try {
    const res = await apiRequest("/api/services");
    if (!res.ok) throw new Error("Failed to load services");
    state.services = await res.json();
    renderServicesList();
  } catch (e) {
    console.error("Error loading services:", e);
  }
}

function renderServicesList() {
  const container = $("services-list");
  container.innerHTML = "";

  const filtered = state.activeCategory === "Все"
    ? state.services
    : state.services.filter((s) => s.category === state.activeCategory);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>В этой категории пока нет услуг.</p></div>`;
    return;
  }

  filtered.forEach((s) => {
    const card = document.createElement("div");
    card.className = "service-card";
    const badgeHtml = s.badge ? `<span class="service-badge">${s.badge}</span>` : "";

    card.innerHTML = `
      <div class="service-header">
        <div class="service-title-box">
          <h3 class="service-title">${s.title}</h3>
          ${badgeHtml}
        </div>
        <span class="service-price">${s.price.toLocaleString("ru-RU")} ₽</span>
      </div>
      <p class="service-desc">${s.description || ""}</p>
      <div class="service-footer">
        <span class="service-duration">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          ${s.duration_minutes} мин
        </span>
        <button class="btn-book">Записаться</button>
      </div>
    `;

    card.querySelector(".btn-book").onclick = (e) => {
      e.stopPropagation();
      openBookingDrawer(s);
    };

    container.appendChild(card);
  });
}


// ------------------- PORTFOLIO -------------------

async function loadPortfolio() {
  try {
    const res = await apiRequest("/api/portfolio");
    if (!res.ok) throw new Error("Failed to load portfolio");
    state.portfolio = await res.json();
    renderPortfolio();
  } catch (e) {
    console.error("Error loading portfolio:", e);
  }
}

function renderPortfolio() {
  const grid = $("portfolio-grid");
  grid.innerHTML = "";

  state.portfolio.forEach((p) => {
    const card = document.createElement("div");
    card.className = "portfolio-card";
    card.innerHTML = `
      <img class="portfolio-img" src="${p.url}" alt="${p.title}" loading="lazy">
      <div class="portfolio-overlay">
        <span class="portfolio-item-title">${p.title}</span>
        <span class="portfolio-item-tag">${p.service}</span>
      </div>
    `;
    card.onclick = () => openLightbox(p);
    grid.appendChild(card);
  });
}

function openLightbox(photo) {
  haptic("light");
  $("lightbox-img").src = photo.url;
  $("lightbox-title").textContent = photo.title;
  $("lightbox-category").textContent = photo.service;
  $("lightbox-overlay").classList.add("open");

  $("lightbox-btn-book").onclick = () => {
    $("lightbox-overlay").classList.remove("open");
    // Find matching or relevant service
    const match = state.services.find((s) => s.category.toLowerCase().includes(photo.service.toLowerCase()) || photo.title.toLowerCase().includes(s.title.toLowerCase())) || state.services[0];
    if (match) openBookingDrawer(match);
  };
}

$("lightbox-overlay").onclick = (e) => {
  if (e.target === $("lightbox-overlay")) {
    $("lightbox-overlay").classList.remove("open");
  }
};


// ------------------- BOOKING DRAWER -------------------

function openBookingDrawer(service) {
  haptic("medium");
  state.booking.service = service;
  state.booking.needsRemoval = false;
  state.booking.hasAllergy = false;
  $("check-needs-removal").checked = false;
  $("check-has-allergy").checked = false;

  updateBookingSummary();
  generate14DaysCarousel();

  $("booking-sheet-overlay").classList.add("open");
  if (tg?.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(closeBookingDrawer);
  }
}

function closeBookingDrawer() {
  $("booking-sheet-overlay").classList.remove("open");
  if (tg?.BackButton) tg.BackButton.hide();
}

$("booking-sheet-close").onclick = closeBookingDrawer;
$("booking-sheet-overlay").onclick = (e) => {
  if (e.target === $("booking-sheet-overlay")) closeBookingDrawer();
};

function updateBookingSummary() {
  const s = state.booking.service;
  if (!s) return;
  const removal = $("check-needs-removal").checked;
  const dur = s.duration_minutes + (removal ? 30 : 0);
  const prc = s.price + (removal ? 500 : 0);

  $("summary-service-title").textContent = s.title;
  $("summary-service-duration").textContent = `${dur} минут${removal ? " (включая снятие)" : ""}`;
  $("summary-service-price").textContent = `${prc.toLocaleString("ru-RU")} ₽`;

  $("btn-submit-booking").querySelector("span").textContent = state.booking.slot
    ? `Записаться на ${state.booking.slot} • ${prc} ₽`
    : "Выберите время визита";
}

$("check-needs-removal").onchange = () => {
  state.booking.needsRemoval = $("check-needs-removal").checked;
  updateBookingSummary();
  if (state.booking.date) loadSlotsForDate(state.booking.date);
};

$("check-has-allergy").onchange = () => {
  state.booking.hasAllergy = $("check-has-allergy").checked;
};

const weekdays = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function generate14DaysCarousel() {
  const container = $("booking-dates-carousel");
  container.innerHTML = "";
  const now = new Date();

  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(now.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];

    const card = document.createElement("button");
    card.className = "date-card";
    card.innerHTML = `
      <span class="date-card-weekday">${i === 0 ? "Сегодня" : weekdays[d.getDay()]}</span>
      <span class="date-card-day">${d.getDate()}</span>
      <span class="date-card-month">${months[d.getMonth()]}</span>
    `;

    card.onclick = () => {
      haptic("selection");
      state.booking.date = dateStr;
      [...container.children].forEach((c) => c.classList.toggle("active", c === card));
      loadSlotsForDate(dateStr);
    };

    container.appendChild(card);
    if (i === 0) {
      card.classList.add("active");
      state.booking.date = dateStr;
      loadSlotsForDate(dateStr);
    }
  }
}

async function loadSlotsForDate(dateStr) {
  const grid = $("booking-slots-grid");
  grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:10px;">Проверяем свободные окна...</div>`;

  try {
    const sId = state.booking.service.id;
    const removal = $("check-needs-removal").checked;
    const res = await apiRequest(`/api/available-slots?date=${dateStr}&service_id=${sId}&needs_removal=${removal}`);
    if (!res.ok) throw new Error("Failed to get slots");
    const data = await res.json();

    grid.innerHTML = "";
    state.booking.slot = null;
    updateBookingSummary();

    if (!data.slots || data.slots.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:#f87171; padding:12px;">На этот день нет свободных окон (выходной или всё занято).</div>`;
      return;
    }

    const availableSlots = data.slots.filter((s) => s.available);
    if (availableSlots.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:#f87171; padding:12px;">Все окошки на эту дату уже заняты.</div>`;
      return;
    }

    data.slots.forEach((s) => {
      const btn = document.createElement("button");
      btn.className = `slot-btn ${s.available ? "" : "disabled"}`;
      btn.textContent = s.time;
      btn.disabled = !s.available;

      if (s.available) {
        btn.onclick = () => {
          haptic("selection");
          state.booking.slot = s.time;
          [...grid.children].forEach((c) => c.classList.toggle("active", c === btn));
          updateBookingSummary();
        };
      }
      grid.appendChild(btn);
    });

  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:#f87171; padding:10px;">Ошибка загрузки времени.</div>`;
  }
}

// Submit Booking
$("btn-submit-booking").onclick = async () => {
  const s = state.booking.service;
  const date = state.booking.date;
  const slot = state.booking.slot;
  const name = $("client-name-input").value.trim();
  const phone = $("client-phone-input").value.trim();

  if (!slot) {
    haptic("error");
    showToast("Пожалуйста, выберите удобное время визита!");
    return;
  }
  if (!name) {
    haptic("error");
    showToast("Пожалуйста, укажите ваше имя");
    return;
  }
  if (!phone || phone.length < 6) {
    haptic("error");
    showToast("Пожалуйста, укажите корректный номер телефона");
    return;
  }

  const payload = {
    service_id: s.id,
    date: date,
    time: slot,
    client_name: name,
    client_phone: phone,
    client_id: state.currentUser?.id || 0,
    client_username: state.currentUser?.username || "",
    comment: $("client-comment-input").value.trim(),
    needs_removal: $("check-needs-removal").checked,
    has_allergy: $("check-has-allergy").checked
  };

  const submitBtn = $("btn-submit-booking");
  submitBtn.disabled = true;
  submitBtn.style.opacity = "0.7";
  submitBtn.querySelector("span").textContent = "Оформляем запись...";

  try {
    const res = await apiRequest("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Не удалось оформить запись");
    }

    const app = await res.json();
    haptic("success");
    showBookingSuccess(app);
  } catch (e) {
    haptic("error");
    showToast(e.message || "Ошибка при создании записи");
    submitBtn.disabled = false;
    submitBtn.style.opacity = "1";
    updateBookingSummary();
  }
};

function showBookingSuccess(app) {
  const body = $("booking-sheet-body");
  const config = state.config || {};

  body.innerHTML = `
    <div class="booking-success-view">
      <div class="success-check-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <h3 style="font-size:22px; font-weight:700;">Вы успешно записаны!</h3>
      <p style="font-size:14px; color:var(--text-sub); line-height:1.4;">
        Мастер уже получил уведомление о вашей записи. Мы пришлём напоминание перед визитом!
      </p>

      <div class="sheet-service-summary" style="width:100%; text-align:left; flex-direction:column; gap:8px;">
        <div style="font-size:16px; font-weight:700; color:#fff;">${app.service_title}</div>
        <div style="font-size:14px; color:var(--primary); font-weight:600;">🗓 ${app.date} в ${app.time}</div>
        <div style="font-size:13px; color:var(--text-muted);">📍 ${config.address || ""}</div>
      </div>

      <div style="display:flex; flex-direction:column; width:100%; gap:10px; margin-top:8px;">
        <button id="btn-add-calendar" class="btn-primary-large" style="height:48px;">
          📅 Добавить в календарь (.ics)
        </button>
        ${config.instagram_or_channel ? `
          <a href="${config.instagram_or_channel}" target="_blank" class="btn-secondary" style="height:46px; text-decoration:none;">
            💬 Написать мастеру в Telegram
          </a>
        ` : ""}
        <button id="btn-goto-visits" class="btn-secondary" style="height:46px;">
          Посмотреть мои визиты
        </button>
      </div>
    </div>
  `;

  $("btn-add-calendar").onclick = () => downloadICS(app);
  $("btn-goto-visits").onclick = () => {
    closeBookingDrawer();
    target = 2;
    setActiveTab(2);
  };
}

// Generate & Download .ICS Calendar File
function downloadICS(app) {
  haptic("light");
  const config = state.config || {};
  const [year, month, day] = app.date.split("-").map(Number);
  const [hours, mins] = app.time.split(":").map(Number);

  const start = new Date(Date.UTC(year, month - 1, day, hours - 3, mins)); // approx UTC
  const end = new Date(start.getTime() + (app.duration_minutes || 60) * 60000);

  const formatICSDate = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Beauty Studio//Appointment//RU",
    "BEGIN:VEVENT",
    `UID:beauty-${app.id}@studio`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(start)}`,
    `DTEND:${formatICSDate(end)}`,
    `SUMMARY:${config.studio_name || "Студия красоты"}: ${app.service_title}`,
    `DESCRIPTION:Запись на процедуру ${app.service_title}. Стоимость: ${app.service_price} ₽. Телефон студии: ${config.phone || ""}`,
    `LOCATION:${config.address || ""}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = window.URL.createObjectURL(blob);
  link.setAttribute("download", `appointment_${app.date}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("Файл календаря скачан");
}


// ------------------- MY VISITS TAB -------------------

async function loadClientVisits() {
  const container = $("visits-list");
  container.innerHTML = `<div class="empty-state"><p>Загрузка ваших записей...</p></div>`;

  try {
    const res = await apiRequest("/api/my-appointments");
    if (!res.ok) throw new Error("Failed to load visits");
    state.visits = await res.json();
    renderClientVisits();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>Не удалось загрузить записи.</p></div>`;
  }
}

function renderClientVisits() {
  const container = $("visits-list");
  container.innerHTML = "";

  if (!state.visits || state.visits.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </div>
        <h3 class="empty-title">У вас пока нет записей</h3>
        <p class="empty-desc">Выберите процедуру из каталога и запишитесь в удобное время онлайн.</p>
        <button class="btn-book" onclick="target=0; setActiveTab(0);" style="margin-top:8px;">
          Выбрать услугу
        </button>
      </div>
    `;
    return;
  }

  const now = new Date();
  const upcoming = [];
  const past = [];

  state.visits.forEach((v) => {
    const vDate = new Date(`${v.date}T${v.time}:00`);
    if (vDate >= now && v.status !== "cancelled") upcoming.push(v);
    else past.push(v);
  });

  if (upcoming.length > 0) {
    const h = document.createElement("div");
    h.className = "visits-section-title";
    h.textContent = "Предстоящие визиты";
    container.appendChild(h);
    upcoming.forEach((v) => container.appendChild(createVisitCard(v, true)));
  }

  if (past.length > 0) {
    const h = document.createElement("div");
    h.className = "visits-section-title";
    h.textContent = "Прошедшие и отмененные";
    container.appendChild(h);
    past.forEach((v) => container.appendChild(createVisitCard(v, false)));
  }
}

function createVisitCard(v, isUpcoming) {
  const card = document.createElement("div");
  card.className = "visit-card";

  const statusMap = {
    pending: { label: "⏳ Ожидает подтверждения", cls: "pending" },
    confirmed: { label: "✅ Подтверждена мастером", cls: "confirmed" },
    cancelled: { label: "❌ Отменена", cls: "cancelled" },
    completed: { label: "✨ Завершена", cls: "completed" }
  };
  const st = statusMap[v.status] || { label: v.status, cls: "pending" };

  card.innerHTML = `
    <div class="visit-header">
      <h4 class="visit-title">${v.service_title}</h4>
      <span class="visit-status ${st.cls}">${st.label}</span>
    </div>
    <div class="visit-details">
      <div class="visit-time-highlight">
        🗓 ${v.date} в ${v.time} (${v.duration_minutes} мин)
      </div>
      <div>💰 Стоимость: <b>${v.service_price} ₽</b></div>
      ${v.needs_removal ? "<div>✂️ Со снятием ресниц</div>" : ""}
      ${v.comment ? `<div>💬 Комментарий: ${v.comment}</div>` : ""}
    </div>
    ${isUpcoming ? `
      <div class="visit-actions">
        <button class="btn-danger-outline btn-cancel-visit">Отменить запись</button>
      </div>
    ` : ""}
  `;

  if (isUpcoming) {
    card.querySelector(".btn-cancel-visit").onclick = () => cancelAppointment(v.id, `${v.date} ${v.time}`);
  }

  return card;
}

async function cancelAppointment(appId, dateTimeStr) {
  // Check 3-hour rule client side
  const appDate = new Date(dateTimeStr);
  const now = new Date();
  const diffHours = (appDate - now) / 3600000;

  if (diffHours < 3) {
    haptic("error");
    alert("Отмена онлайн возможна не позднее чем за 3 часа до начала процедуры. Пожалуйста, напишите мастеру напрямую.");
    return;
  }

  if (!confirm("Вы действительно хотите отменить запись? Слот сразу освободится для других клиентов.")) return;

  try {
    const res = await apiRequest(`/api/appointments/${appId}/cancel`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Не удалось отменить запись");
    }
    haptic("success");
    showToast("Запись успешно отменена");
    loadClientVisits();
  } catch (e) {
    haptic("error");
    showToast(e.message || "Ошибка отмены");
  }
}


// ------------------- ADMIN CABINET -------------------

$("admin-refresh-btn").onclick = () => loadAdminSchedule();
$("admin-schedule-date").value = state.admin.selectedDate;
$("admin-block-date").value = state.admin.selectedDate;

$("admin-schedule-date").onchange = (e) => {
  state.admin.selectedDate = e.target.value;
  $("admin-block-date").value = e.target.value;
  loadAdminSchedule();
};

// Admin subnav switching
document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
  btn.onclick = () => {
    haptic("selection");
    document.querySelectorAll(".admin-tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.atab;
    state.admin.subTab = target;

    $("admin-sec-schedule").style.display = target === "schedule" ? "block" : "none";
    $("admin-sec-slots").style.display = target === "slots" ? "block" : "none";
    $("admin-sec-services").style.display = target === "services" ? "block" : "none";
    $("admin-sec-portfolio").style.display = target === "portfolio" ? "block" : "none";

    if (target === "schedule") loadAdminSchedule();
    if (target === "slots") loadAdminBlockedSlots();
    if (target === "services") renderAdminServices();
    if (target === "portfolio") renderAdminPortfolio();
  };
});

async function loadAdminSchedule() {
  loadAdminStats();
  const list = $("admin-schedule-list");
  list.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding:12px;">Загрузка расписания...</p>`;

  try {
    const res = await apiRequest(`/api/admin/schedule?date=${state.admin.selectedDate}`);
    if (!res.ok) throw new Error("Failed to load schedule");
    const data = await res.json();

    list.innerHTML = "";
    if (!data.appointments || data.appointments.length === 0) {
      list.innerHTML = `<div class="empty-state" style="padding:20px 0;"><p>На выбранную дату нет записей.</p></div>`;
      return;
    }

    data.appointments.forEach((app) => {
      const card = document.createElement("div");
      card.className = "admin-app-card";
      card.innerHTML = `
        <div class="admin-app-top">
          <span style="font-size:16px; font-weight:700; color:var(--primary);">${app.time} — ${app.service_title}</span>
          <span class="visit-status ${app.status}">${app.status}</span>
        </div>
        <div style="font-size:13px; color:var(--text-sub);">
          👤 <b>${app.client_name}</b> ${app.client_username ? `(@${app.client_username})` : ""}<br>
          📞 <a href="tel:${app.client_phone}" style="color:#60a5fa;">${app.client_phone}</a><br>
          💰 ${app.service_price} ₽ (${app.duration_minutes} мин)
          ${app.comment ? `<br>💬 ${app.comment}` : ""}
        </div>
        <div class="admin-app-actions">
          ${app.status === "pending" ? `
            <button class="btn-book btn-adm-confirm" style="padding:4px 12px; font-size:12px;">✅ Подтвердить</button>
            <button class="btn-danger-outline btn-adm-cancel" style="padding:4px 12px; font-size:12px;">❌ Отклонить</button>
          ` : ""}
          ${app.status === "confirmed" ? `
            <button class="btn-secondary btn-adm-complete" style="padding:4px 12px; font-size:12px;">✨ Завершить</button>
            <button class="btn-danger-outline btn-adm-cancel" style="padding:4px 12px; font-size:12px;">Отменить</button>
          ` : ""}
          ${app.client_username ? `
            <a href="https://t.me/${app.client_username}" target="_blank" class="btn-secondary" style="padding:4px 12px; font-size:12px; text-decoration:none;">💬 Чат</a>
          ` : ""}
        </div>
      `;

      if (card.querySelector(".btn-adm-confirm")) {
        card.querySelector(".btn-adm-confirm").onclick = () => updateAppStatus(app.id, "confirmed");
      }
      if (card.querySelector(".btn-adm-cancel")) {
        card.querySelector(".btn-adm-cancel").onclick = () => updateAppStatus(app.id, "cancelled");
      }
      if (card.querySelector(".btn-adm-complete")) {
        card.querySelector(".btn-adm-complete").onclick = () => updateAppStatus(app.id, "completed");
      }

      list.appendChild(card);
    });

  } catch (e) {
    list.innerHTML = `<p style="color:#f87171; text-align:center;">Ошибка загрузки расписания.</p>`;
  }
}

async function updateAppStatus(appId, status) {
  try {
    const res = await apiRequest(`/api/admin/appointments/${appId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error("Failed");
    haptic("success");
    showToast(`Статус обновлен: ${status}`);
    loadAdminSchedule();
  } catch (e) {
    haptic("error");
    showToast("Ошибка обновления статуса");
  }
}

async function loadAdminStats() {
  try {
    const res = await apiRequest("/api/admin/stats");
    if (!res.ok) return;
    const stats = await res.json();
    $("stat-revenue").textContent = `${stats.revenue.toLocaleString("ru-RU")} ₽`;
    $("stat-confirmed").textContent = stats.confirmed_count;
    $("stat-clients").textContent = stats.unique_clients;
    $("stat-total").textContent = stats.total_bookings;
  } catch (e) {}
}

// Block slots
$("admin-block-slot-btn").onclick = async () => {
  const d = $("admin-block-date").value;
  const t = $("admin-block-time").value;
  const reason = $("admin-block-reason").value.trim() || "Перерыв";
  if (!d || !t) return showToast("Укажите дату и время");

  try {
    await apiRequest("/api/admin/slots/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: d, time: t, is_full_day: false, reason })
    });
    haptic("success");
    showToast("Слот заблокирован");
    loadAdminBlockedSlots();
  } catch (e) {
    showToast("Ошибка блокировки");
  }
};

$("admin-block-day-btn").onclick = async () => {
  const d = $("admin-block-date").value;
  if (!d) return showToast("Укажите дату");
  if (!confirm(`Закрыть весь день ${d} как выходной?`)) return;

  try {
    await apiRequest("/api/admin/slots/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: d, is_full_day: true, reason: "Выходной" })
    });
    haptic("success");
    showToast("День закрыт для записи");
    loadAdminBlockedSlots();
  } catch (e) {
    showToast("Ошибка блокировки дня");
  }
};

async function loadAdminBlockedSlots() {
  const container = $("admin-blocked-list");
  container.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">Загрузка...</p>`;

  try {
    const res = await apiRequest(`/api/admin/schedule?date=${$("admin-block-date").value}`);
    const data = await res.json();
    container.innerHTML = "";

    if (!data.blocked_slots || data.blocked_slots.length === 0) {
      container.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">На эту дату нет заблокированных слотов.</p>`;
      return;
    }

    data.blocked_slots.forEach((b) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.06); padding:8px 12px; border-radius:12px; margin-bottom:6px; font-size:13px;";
      row.innerHTML = `
        <span>${b.is_full_day ? "🚫 Весь день (выходной)" : `🕒 ${b.time}`} — ${b.reason || "Заблокировано"}</span>
        <button class="btn-danger-outline" style="padding:2px 8px; font-size:11px;">Разблокировать</button>
      `;
      row.querySelector("button").onclick = async () => {
        await apiRequest(`/api/admin/slots/${b.id}`, { method: "DELETE" });
        haptic("light");
        loadAdminBlockedSlots();
      };
      container.appendChild(row);
    });
  } catch (e) {}
}

// Admin Services Manager
function renderAdminServices() {
  const list = $("admin-services-list");
  list.innerHTML = "";

  state.services.forEach((s) => {
    const card = document.createElement("div");
    card.className = "service-card";
    card.innerHTML = `
      <div class="service-header">
        <div>
          <h4 style="font-size:15px; font-weight:700;">${s.title}</h4>
          <span style="font-size:12px; color:var(--text-muted);">${s.category} • ${s.duration_minutes} мин</span>
        </div>
        <span style="font-size:16px; font-weight:700; color:var(--primary);">${s.price} ₽</span>
      </div>
      <div style="display:flex; gap:8px; margin-top:6px;">
        <button class="btn-secondary btn-edit-srv" style="padding:4px 10px; font-size:12px;">Редактировать</button>
        <button class="btn-danger-outline btn-del-srv" style="padding:4px 10px; font-size:12px;">Удалить</button>
      </div>
    `;

    card.querySelector(".btn-edit-srv").onclick = () => openServiceModal(s);
    card.querySelector(".btn-del-srv").onclick = async () => {
      if (!confirm(`Удалить услугу "${s.title}"?`)) return;
      await apiRequest(`/api/admin/services/${s.id}`, { method: "DELETE" });
      haptic("light");
      await loadServices();
      renderAdminServices();
    };

    list.appendChild(card);
  });
}

$("admin-add-service-btn").onclick = () => openServiceModal(null);
$("admin-close-srv-modal").onclick = () => $("service-modal-overlay").classList.remove("open");

function openServiceModal(s) {
  $("admin-srv-id").value = s ? s.id : "";
  $("admin-srv-title").value = s ? s.title : "";
  $("admin-srv-category").value = s ? s.category : "Ресницы";
  $("admin-srv-price").value = s ? s.price : 2500;
  $("admin-srv-duration").value = s ? s.duration_minutes : 90;
  $("admin-srv-desc").value = s ? s.description : "";
  $("admin-srv-badge").value = s ? s.badge : "";
  $("service-modal-title").textContent = s ? "Редактировать услугу" : "Добавить новую услугу";
  $("service-modal-overlay").classList.add("open");
}

$("admin-save-srv-btn").onclick = async () => {
  const id = $("admin-srv-id").value;
  const payload = {
    title: $("admin-srv-title").value.trim(),
    category: $("admin-srv-category").value.trim(),
    price: parseInt($("admin-srv-price").value),
    duration_minutes: parseInt($("admin-srv-duration").value),
    description: $("admin-srv-desc").value.trim(),
    badge: $("admin-srv-badge").value.trim(),
    is_popular: $("admin-srv-badge").value.trim().length > 0
  };

  if (!payload.title || isNaN(payload.price)) return showToast("Заполните обязательные поля");

  const url = id ? `/api/admin/services/${id}` : "/api/admin/services";
  const method = id ? "PUT" : "POST";

  try {
    const res = await apiRequest(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed");
    haptic("success");
    $("service-modal-overlay").classList.remove("open");
    showToast(id ? "Услуга обновлена" : "Услуга добавлена");
    await loadServices();
    renderAdminServices();
  } catch (e) {
    showToast("Ошибка сохранения услуги");
  }
};

// Admin Portfolio Manager
function renderAdminPortfolio() {
  const grid = $("admin-portfolio-grid");
  grid.innerHTML = "";

  state.portfolio.forEach((p) => {
    const card = document.createElement("div");
    card.className = "portfolio-card";
    card.innerHTML = `
      <img class="portfolio-img" src="${p.url}" alt="${p.title}">
      <button class="btn-danger-outline" style="position:absolute; top:8px; right:8px; padding:4px 8px; font-size:11px; background:rgba(0,0,0,0.7);">Удалить</button>
      <div class="portfolio-overlay">
        <span class="portfolio-item-title">${p.title}</span>
      </div>
    `;
    card.querySelector("button").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Удалить фото "${p.title}"?`)) return;
      await apiRequest(`/api/admin/portfolio/${p.id}`, { method: "DELETE" });
      haptic("light");
      await loadPortfolio();
      renderAdminPortfolio();
    };
    grid.appendChild(card);
  });
}

$("admin-add-photo-btn").onclick = () => $("photo-modal-overlay").classList.add("open");
$("admin-close-photo-modal").onclick = () => $("photo-modal-overlay").classList.remove("open");

$("admin-save-photo-btn").onclick = async () => {
  const url = $("admin-photo-url").value.trim();
  const title = $("admin-photo-title").value.trim() || "Работа мастера";
  const service = $("admin-photo-service").value.trim() || "Ресницы";

  if (!url) return showToast("Укажите ссылку на фото");

  try {
    const res = await apiRequest("/api/admin/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title, service })
    });
    if (!res.ok) throw new Error("Failed");
    haptic("success");
    $("photo-modal-overlay").classList.remove("open");
    $("admin-photo-url").value = "";
    showToast("Фото добавлено в портфолио");
    await loadPortfolio();
    renderAdminPortfolio();
  } catch (e) {
    showToast("Ошибка добавления фото");
  }
};


// ------------------- BOOTSTRAP -------------------
window.addEventListener("DOMContentLoaded", () => {
  initApp();
});
