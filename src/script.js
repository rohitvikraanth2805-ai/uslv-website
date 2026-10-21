(() => {
  'use strict';

  /* ---- Config ---------------------------------------------------------
     Where the form is sent:
       - Page served by the Node server (http://localhost:8080 or your live domain):
         the same address (API_BASE = '').
       - Page opened from VS Code Live Server (e.g. :5500) or as a file:
         the Node server on http://localhost:8080 is used instead.
     Override anything by defining window.USLV_CONFIG before this script:
       window.USLV_CONFIG = { API_BASE: 'http://localhost:5000' };            // other port
       window.USLV_CONFIG = { FORM_ENDPOINT: 'https://example.com/api/x' };   // one exact URL
     FORM_ROUTES are tried in order; a route the server doesn't have is skipped
     and the next one is used.                                               */
  const isLocalDev =
    location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

  const CONFIG = Object.assign(
    {
      API_BASE: isLocalDev && location.port !== '8080' ? 'http://localhost:8080' : '',
      FORM_ROUTES: ['/api/book-appointment', '/api/contact'],
      FORM_ENDPOINT: '',             // optional: one full URL, used on its own when set
      PHONE_DISPLAY: '+91 93803 76767',
      REQUEST_TIMEOUT_MS: 15000,
      RETRY_DELAY_MS: 1500,          // wait before the single retry after a temporary server error
      SPLASH_HOLD_MS: 2200,          // how long the logo and name stay centred
      AUTO_SCROLL_DWELL_MS: 5000,    // time spent on each section
      AUTO_SCROLL_RESUME_MS: 10000,  // idle time after the visitor takes control
    },
    window.USLV_CONFIG || {}
  );

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const docEl = document.documentElement;

  /* ---- Shared page measurements ---- */
  const sections = $$('main > section');
  const header = $('.navbar');
  const headerH = () => (header ? header.offsetHeight : 0);
  const topOf = (s) => Math.max(0, Math.round(s.getBoundingClientRect().top + window.scrollY - headerH()));
  const maxY = () => docEl.scrollHeight - window.innerHeight;

  /* Index of the section the visitor is currently on */
  const indexAt = (y) => {
    if (!sections.length) return 0;
    if (y >= maxY() - 4) return sections.length - 1;
    let idx = 0;
    sections.forEach((s, i) => { if (topOf(s) <= y + 24) idx = i; });
    return idx;
  };

  /* ---- Mobile navigation ---- */
  const toggle = $('#mobileToggle, #navToggle');
  const nav = $('#navLinks');
  const isNavOpen = () => !!nav && (nav.classList.contains('active') || nav.classList.contains('open'));

  if (toggle && nav) {
    toggle.setAttribute('aria-controls', 'navLinks');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');

    const setNav = (open) => {
      nav.classList.toggle('active', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };

    toggle.addEventListener('click', () => setNav(!isNavOpen()));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });

    document.addEventListener('click', (e) => {
      if (isNavOpen() && !nav.contains(e.target) && !toggle.contains(e.target)) setNav(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isNavOpen()) { setNav(false); toggle.focus(); }
    });

    window.matchMedia('(min-width: 1181px)').addEventListener('change', (e) => { if (e.matches) setNav(false); });
  }

  /* ---- Footer year ---- */
  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();

  /* ---- Highlight the current section in the menu ---- */
  (() => {
    const links = $$('.nav-links a[href^="#"]').filter((a) => !a.classList.contains('btn'));
    if (!links.length || !sections.length) return;
    let queued = false;

    const update = () => {
      queued = false;
      const id = sections[indexAt(window.scrollY)].id;
      links.forEach((a) => {
        if (a.getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    };

    window.addEventListener('scroll', () => {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  })();

  /* =====================================================================
     MOTION
     ===================================================================== */
  const motionOK =
    !reduceMotion &&
    'IntersectionObserver' in window &&
    !!(window.CSS && CSS.supports && CSS.supports('translate', '0 10px'));

  const motion = { io: null, targets: [], started: false };

  /* Split a plain-text heading into words so each can rise out of a mask */
  const splitWords = (el) => {
    const text = el.textContent.trim().replace(/\s+/g, ' ');
    if (!text || el.children.length) return false;
    el.setAttribute('aria-label', text);
    el.textContent = '';
    text.split(' ').forEach((word, i, all) => {
      const w = document.createElement('span');
      w.className = 'w';
      w.setAttribute('aria-hidden', 'true');
      const wi = document.createElement('span');
      wi.className = 'wi';
      wi.style.setProperty('--i', i);
      wi.textContent = word;
      w.append(wi);
      el.append(w);
      if (i < all.length - 1) el.append(' ');
    });
    el.classList.add('split');
    return true;
  };

  /* Elements that fade and rise as they enter the screen */
  const REVEAL_SELECTORS = [
    'main h1', 'main h2',
    '.hero-copy .kicker', '.hero-copy .lead', '.hero-points li', '.hero-copy .actions', '.hero-note',
    '.pillars .lead', '.pillar-grid article',
    '.narrow > .lead', '.narrow > p', '.about-copy > *',
    '.section > .container > .lead', '.section > .container > p', '.book-title',
    '.stack > *', '.prose > *', '.gallery-card', '.contact-info', '#contactForm', '.disclaimer',
  ];

  /* Get everything ready while the splash still covers the page. Nothing animates yet. */
  const prepareMotion = () => {
    if (!motionOK) return;
    try {
      $$('main h1, main h2').forEach(splitWords);

      // Collect targets in page order and stagger siblings (--d is the delay)
      const all = [...new Set(REVEAL_SELECTORS.flatMap((s) => $$(s)))].sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      );
      const perParent = new Map();
      all.forEach((el) => {
        const n = perParent.get(el.parentElement) || 0;
        perParent.set(el.parentElement, n + 1);
        const base = el.closest('.hero') ? 0.25 : 0;
        el.style.setProperty('--d', `${(Math.min(n, 6) * 0.09 + base).toFixed(2)}s`);
        if (!el.classList.contains('split')) el.dataset.r = '';
        motion.targets.push(el);
      });

      // Pictures: wipe reveal
      $$('.hero-banner, .about-image-wrapper, .gallery-image-box').forEach((el) => {
        el.classList.add('reveal-img');
        const host = el.closest('[data-r]');
        const base = host ? host.style.getPropertyValue('--d') : el.classList.contains('hero-banner') ? '0.1s' : '0s';
        el.style.setProperty('--d', `calc(${base || '0s'} + .15s)`);
        motion.targets.push(el);
      });

      // Pictures that drift slightly as you scroll
      const hb = $('.hero-banner'); if (hb) hb.dataset.parallax = '0.07';
      const ab = $('.about-image-wrapper'); if (ab) ab.dataset.parallax = '0.05';

      motion.io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('in');
            motion.io.unobserve(entry.target);
          });
        },
        { rootMargin: '0px 0px -6% 0px', threshold: 0 }
      );

      docEl.classList.add('motion');
    } catch (err) {
      // If anything goes wrong, fall back to a fully visible page
      docEl.classList.remove('motion');
      motion.targets = [];
      console.warn('Motion disabled:', err);
    }
  };

  /* Called as the splash starts to leave: the hero animates in underneath it */
  const startMotion = () => {
    if (motion.started) return;
    motion.started = true;
    docEl.classList.add('ready');
    if (motion.io) motion.targets.forEach((el) => motion.io.observe(el));
  };

  /* ---- Scroll effects: progress bar, header shadow, parallax ---- */
  (() => {
    const bar = document.createElement('div');
    bar.className = 'progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.append(bar);

    const parallax = () => {
      $$('[data-parallax]').forEach((el) => {
        const host = el.parentElement.getBoundingClientRect(); // the parent isn't moved, so no feedback loop
        const offset = host.top + host.height / 2 - window.innerHeight / 2;
        el.style.setProperty('--py', `${(-offset * parseFloat(el.dataset.parallax)).toFixed(1)}px`);
      });
    };

    let queued = false;
    const update = () => {
      queued = false;
      const y = window.scrollY;
      const m = maxY();
      bar.style.setProperty('--p', m > 0 ? Math.min(1, y / m).toFixed(4) : 0);
      if (header) header.classList.toggle('is-scrolled', y > 10);
      if (motionOK) parallax();
    };

    window.addEventListener('scroll', () => {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  })();

  /* ---- Pointer effects: 3D tilt on pictures and cards, magnetic buttons ---- */
  if (motionOK && finePointer) {
    $$('.gallery-card, .about-image-wrapper').forEach((el) => {
      el.classList.add('tilt');
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--ry', `${(px * 8).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${(-py * 8).toFixed(2)}deg`);
      });
      el.addEventListener('pointerleave', () => {
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      });
    });

    $$('.actions .btn, form .btn-primary').forEach((btn) => {
      let cx = 0;
      let cy = 0; // current pull, so the button's own movement doesn't affect the maths
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        cx = (e.clientX - (r.left + r.width / 2 - cx)) * 0.22;
        cy = (e.clientY - (r.top + r.height / 2 - cy)) * 0.3;
        btn.style.setProperty('--mx', `${cx.toFixed(1)}px`);
        btn.style.setProperty('--my', `${cy.toFixed(1)}px`);
      });
      btn.addEventListener('pointerleave', () => {
        cx = 0; cy = 0;
        btn.style.setProperty('--mx', '0px');
        btn.style.setProperty('--my', '0px');
      });
    });
  }

  /* ---- Intro splash --------------------------------------------------
     Logo and company name appear in the centre with a loading counter, then
     the logo glides into its place in the header while the page is revealed. */
  const runSplash = (onLeave) => new Promise((resolve) => {
    const splash = $('#splash');
    if (!splash) return resolve();

    // Hidden by CSS for visitors who prefer reduced motion
    if (getComputedStyle(splash).display === 'none') { splash.remove(); return resolve(); }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onLeave();
      splash.remove();
      docEl.classList.remove('splash-on');
      resolve();
    };

    try {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      if (!location.hash) window.scrollTo(0, 0);
      docEl.classList.add('splash-on');

      const wrap = $('.splash-logo-wrap', splash);
      const logo = $('img', wrap);
      const textBox = $('.splash-text', splash);

      const counter = document.createElement('span');
      counter.className = 'splash-count';
      counter.setAttribute('aria-hidden', 'true');
      counter.textContent = '0%';
      if (textBox) textBox.append(counter);

      const countUp = (ms) => {
        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          counter.textContent = `${Math.round(p * 100)}%`;
          if (p < 1 && !finished) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };

      const flyToHeader = () => {
        const target = $('.brand-img');
        if (!target || !wrap) return;
        const from = wrap.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        if (!to.width || !from.width) return;
        splash.style.setProperty('--fx', `${to.left + to.width / 2 - (from.left + from.width / 2)}px`);
        splash.style.setProperty('--fy', `${to.top + to.height / 2 - (from.top + from.height / 2)}px`);
        splash.style.setProperty('--fs', String(to.width / from.width));
      };

      const leave = () => {
        counter.textContent = '100%';
        flyToHeader();
        splash.classList.add('is-leaving');
        onLeave(); // the hero starts animating in underneath the fading splash
        setTimeout(finish, 1150);
      };

      // Wait for the logo and fonts (but never longer than 1.5 s) so the intro starts clean
      const assets = Promise.all([
        logo && logo.decode ? logo.decode().catch(() => {}) : Promise.resolve(),
        document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
      ]);
      Promise.race([assets, new Promise((r) => setTimeout(r, 1500))]).then(() => {
        splash.classList.add('is-in');
        countUp(CONFIG.SPLASH_HOLD_MS);
        setTimeout(leave, CONFIG.SPLASH_HOLD_MS);
      });

      setTimeout(finish, 6500); // safety net
    } catch (err) {
      finish();
    }
  });

  /* ---- Automatic section-by-section scrolling ------------------------
     Every 5 seconds the page glides to the next section and starts again
     from the top after the last one. It never fights the visitor:
       - any scroll, touch, click or key press pauses it for 10 seconds
       - it holds while a form field is focused, the menu is open or the tab is hidden
       - pressing Escape switches it off for the rest of the visit
       - it is off for visitors who prefer reduced motion                  */
  const startAutoScroll = () => {
    if (reduceMotion || sections.length < 2) return;

    let stopped = false;
    let timer = 0;
    let raf = 0;
    let pausedUntil = 0;
    let fieldFocused = false;

    const cancel = () => {
      cancelAnimationFrame(raf);
      docEl.style.scrollBehavior = '';
    };

    const nextY = () => {
      const y = window.scrollY;
      const max = maxY();
      if (y >= max - 4) return 0; // reached the bottom: back to the top
      const next = sections[indexAt(y) + 1];
      return next ? Math.min(topOf(next), max) : 0;
    };

    const animateTo = (to, done) => {
      cancel();
      const from = window.scrollY;
      const dist = to - from;
      if (Math.abs(dist) < 2) { done(); return; }

      const duration = Math.min(1800, Math.max(900, Math.abs(dist) * 0.4));
      const t0 = performance.now();
      docEl.style.scrollBehavior = 'auto'; // our own easing replaces the browser's

      const step = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // ease in-out cubic
        window.scrollTo(0, from + dist * eased);
        if (p < 1) raf = requestAnimationFrame(step);
        else { docEl.style.scrollBehavior = ''; done(); }
      };
      raf = requestAnimationFrame(step);
    };

    const schedule = (ms = CONFIG.AUTO_SCROLL_DWELL_MS) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, ms);
    };

    const canRun = () =>
      !stopped && !document.hidden && !fieldFocused && !isNavOpen() && Date.now() >= pausedUntil - 50;

    const tick = () => {
      if (!canRun()) { schedule(); return; }
      animateTo(nextY(), () => schedule());
    };

    /* Anything the visitor does hands control to them for a while */
    const takeControl = () => {
      cancel();
      pausedUntil = Date.now() + CONFIG.AUTO_SCROLL_RESUME_MS;
      schedule(CONFIG.AUTO_SCROLL_RESUME_MS);
    };

    ['wheel', 'touchstart', 'pointerdown'].forEach((type) =>
      window.addEventListener(type, takeControl, { passive: true, capture: true })
    );

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !isNavOpen()) { // Escape closes the menu first; otherwise it stops auto-scroll
        stopped = true;
        clearTimeout(timer);
        cancel();
        return;
      }
      takeControl();
    }, { capture: true });

    document.addEventListener('focusin', (e) => {
      if (e.target.matches('input, select, textarea')) fieldFocused = true;
    });
    document.addEventListener('focusout', (e) => {
      if (e.target.matches('input, select, textarea')) { fieldFocused = false; takeControl(); }
    });

    schedule();
  };

  prepareMotion();
  runSplash(startMotion).catch(() => {}).then(() => { startMotion(); startAutoScroll(); });

  /* ---- Validation (mirrors the rules in server.js) ---- */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const FIELD_WRAP = '.field, .form-group';

  const rules = {
    name: (v) => (v.trim().length >= 2 && v.trim().length <= 80) || 'Enter your full name.',
    phone: (v) =>
      /^[6-9]\d{9}$/.test(v.replace(/[\s-]/g, '').replace(/^(\+91|0)/, '')) ||
      'Enter a valid 10-digit Indian mobile number.',
    email: (v) => EMAIL_RE.test(v.trim()) || 'Enter a valid email address.',
    age: (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 120) || 'Enter an age between 1 and 120.',
    service: (v) => !!v || 'Choose a service.',
    message: (v) => (v.trim().length >= 10 && v.trim().length <= 1000) || 'Write between 10 and 1000 characters.',
  };

  const showError = (field, message) => {
    const group = field.closest(FIELD_WRAP);
    if (!group) return;
    let el = $('.field-error', group);

    if (!message) {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
      if (el) el.remove();
      return;
    }

    if (!el) {
      el = document.createElement('span');
      el.className = 'field-error';
      el.id = `${field.id}-err`;
      group.append(el);
    }
    el.textContent = message;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', el.id);
  };

  const validateField = (field) => {
    const rule = rules[field.name];
    if (!rule) return true;
    const result = rule(field.value);
    showError(field, result === true ? '' : result);
    return result === true;
  };

  /* Give every field an id and an accessible name, even if the HTML has none. */
  const prepareFields = (form) => {
    $$(FIELD_WRAP, form).forEach((group, i) => {
      const input = $('input:not([type="hidden"]), select, textarea', group);
      if (!input) return;
      if (!input.id) input.id = `${form.id || 'form'}-${input.name || i}`;

      const label = $('label', group);
      if (label && !label.htmlFor) label.htmlFor = input.id;
      else if (!label && !input.getAttribute('aria-label')) {
        input.setAttribute('aria-label', (input.placeholder || input.name).replace(/\s*\*$/, ''));
      }
    });

    const trap = $('input[name="website"]', form);
    if (trap) {
      trap.tabIndex = -1;
      trap.setAttribute('aria-hidden', 'true');
      trap.setAttribute('autocomplete', 'off');
    }
  };

  /* ---- Submission ---- */
  const setStatus = (el, type, text) => {
    if (!el) return;
    el.className = 'form-status' + (type ? ` ${type}` : '');
    el.textContent = text;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
  };

  /* Servers answer with either { message } or { error }; accept both */
  const serverMessage = (body) => (body && (body.message || body.error)) || '';

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const formUrls = () =>
    CONFIG.FORM_ENDPOINT ? [CONFIG.FORM_ENDPOINT] : CONFIG.FORM_ROUTES.map((route) => CONFIG.API_BASE + route);

  let workingUrl = null; // remembered after the first route that really answers

  async function postTo(url, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      // Only a JSON reply counts as an answer from the booking API. An HTML page
      // (Live Server's 404, or a catch-all that returns index.html) is NOT a booking.
      const isApi = (res.headers.get('content-type') || '').includes('application/json');
      const body = isApi ? await res.json().catch(() => ({})) : {};
      return { ok: res.ok && body.success === true, status: res.status, body, isApi };
    } finally {
      clearTimeout(timer);
    }
  }

  /* One try per route. A route that doesn't exist (404, 405 or an HTML page) is skipped.
     A temporary server error (502, 503, 504) gets a single retry: it means nothing was
     recorded, so a retry cannot create a duplicate booking. */
  async function postBooking(payload) {
    const urls = workingUrl ? [workingUrl] : formUrls();
    let result;
    for (const url of urls) {
      result = await postTo(url, payload); // a network error or timeout throws to the caller

      if ([502, 503, 504].includes(result.status)) {
        await sleep(CONFIG.RETRY_DELAY_MS);
        result = await postTo(url, payload);
        workingUrl = url;
        return result;
      }

      const routeMissing = result.status === 404 || result.status === 405 || (result.status < 400 && !result.isApi);
      if (routeMissing) continue;

      workingUrl = url;
      return result;
    }
    return { ...result, ok: false, routeMissing: true }; // none of the routes exist on this server
  }

  const DEV_HINT = isLocalDev ? ' (Developer note: start the server with "node src/server.js" and keep it running.)' : '';

  $$('form[data-form]').forEach((form) => {
    form.noValidate = true; // our messages replace the browser's pop-ups
    prepareFields(form);

    const status = $('.form-status', form);
    const button = $('button[type="submit"]', form);
    const fields = $$('input[name], select, textarea', form).filter((f) => rules[f.name]);
    let sending = false;

    fields.forEach((field) => {
      field.addEventListener('blur', () => validateField(field));
      field.addEventListener('input', () => { if (field.hasAttribute('aria-invalid')) validateField(field); });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (sending) return; // ignore double clicks

      setStatus(status, '', '');
      const invalid = fields.filter((f) => !validateField(f));
      if (invalid.length) {
        invalid[0].focus();
        setStatus(status, 'err', 'Please correct the highlighted fields.');
        return;
      }

      if (navigator.onLine === false) {
        setStatus(status, 'err', `You appear to be offline. Please reconnect and try again, or call ${CONFIG.PHONE_DISPLAY}.`);
        return;
      }

      const payload = Object.fromEntries(
        [...new FormData(form)].map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
      );
      payload.source = payload.source || form.dataset.form || 'contact';

      // Honeypot: real visitors never fill this hidden field. Pretend success so bots learn nothing.
      if (payload.website) {
        form.reset();
        setStatus(status, 'success', 'Thank you. Your appointment request has been received.');
        return;
      }
      delete payload.website;

      sending = true;
      const label = button ? button.textContent : '';
      if (button) { button.disabled = true; button.textContent = 'Submitting…'; }
      setStatus(status, '', 'Sending your appointment details…');

      try {
        const { ok, status: code, body, routeMissing } = await postBooking(payload);

        if (ok) {
          form.reset();
          fields.forEach((f) => showError(f, ''));
          setStatus(status, 'success', 'Thank you. We have received your request and will contact you within one business day.');
        } else if (code === 400 && body.errors) {
          fields.forEach((f) => showError(f, body.errors[f.name] || ''));
          const first = fields.find((f) => body.errors[f.name]);
          if (first) first.focus();
          setStatus(status, 'err', serverMessage(body) || 'Please correct the highlighted fields.');
        } else if (code === 429) {
          setStatus(status, 'err', serverMessage(body) || 'Too many requests. Please try again in a few minutes.');
        } else {
          setStatus(
            status,
            'err',
            `We could not send your request. Please call ${CONFIG.PHONE_DISPLAY} instead.${routeMissing ? DEV_HINT : ''}`
          );
        }
      } catch (err) {
        const timedOut = err && err.name === 'AbortError';
        setStatus(
          status,
          'err',
          timedOut
            ? `The request took too long. Please try again or call ${CONFIG.PHONE_DISPLAY}.`
            : `We could not reach the server. Please check your connection or call ${CONFIG.PHONE_DISPLAY}.${DEV_HINT}`
        );
      } finally {
        sending = false;
        if (button) { button.disabled = false; button.textContent = label; }
      }
    });
  });
})();
