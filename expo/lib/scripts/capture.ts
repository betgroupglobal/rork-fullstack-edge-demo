// ── Injected capture script — enhanced probe for modern auth flows ──
// Runs inside a WebView on target pages to collect form fields, cookies,
// API endpoints, auth links, and other reconnaissance data.

export const CAPTURE_SCRIPT = `
(function() {
  'use strict';
  var PH = window.__phishletCapture || (window.__phishletCapture = {
    domains: [], urls: [], cookies: [], formFields: [], hiddenInputs: [],
    csrfFields: [], authLinks: [], apiEndpoints: [], scripts: [], forms: [],
    redirects: [], pageTitle: '', formAction: '', formMethod: '',
  });

  function findBestForm() {
    var forms = Array.from(document.querySelectorAll('form'));
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('input[type=password]')) return forms[i];
    }
    for (var j = 0; j < forms.length; j++) {
      var inputs = forms[j].querySelectorAll('input');
      for (var k = 0; k < inputs.length; k++) {
        var n = (inputs[k].name || inputs[k].id || '').toLowerCase();
        if (/user|email|login|username|account|identifier/.test(n)) return forms[j];
      }
    }
    return forms[0] || null;
  }

  function recordUnique(key, value) {
    if (!PH._seen) PH._seen = {};
    if (!PH._seen[key]) PH._seen[key] = {};
    var s = typeof value === 'string' ? value : JSON.stringify(value);
    if (PH._seen[key][s]) return false;
    PH._seen[key][s] = true;
    if (!Array.isArray(PH[key])) PH[key] = [];
    PH[key].push(value);
    return true;
  }

  function absoluteUrl(href) {
    try { return new URL(href, location.href).href; } catch(e) { return ''; }
  }

  function isAuthUrl(href) {
    return /login|signin|sign-in|auth|register|signup|account|oauth|sso|saml|openid|password|forgot|token|/i.test(href);
  }

  function isApiUrl(href) {
    return /\\/(api|graphql|oauth|token|auth|session|sessions|saml|login)\\b|\\.(api|graphql)$/i.test(href);
  }

  function collect() {
    var payload = {};
    payload.pageTitle = document.title || '';
    var bestForm = findBestForm();
    if (bestForm) {
      payload.formAction = bestForm.action || location.href;
      payload.formMethod = (bestForm.method || 'get').toLowerCase();
    }

    var allInputs = Array.from(document.querySelectorAll('input, select, textarea'));
    var seen = {};
    var fields = [];
    var hidden = [];
    var csrf = [];
    allInputs.forEach(function(el) {
      var key = el.name || el.id || el.placeholder || el.type;
      if (!key || seen[key]) return;
      seen[key] = true;
      var type = (el.type || 'text').toLowerCase();
      var entry = {
        name: el.name || '',
        type: type,
        id: el.id || '',
        placeholder: el.placeholder || '',
        required: !!el.required,
        autocomplete: el.autocomplete || '',
      };
      fields.push(entry);
      if (type === 'hidden') {
        hidden.push({ name: el.name || '', value: el.value || '', id: el.id || '' });
      }
      var keyLower = key.toLowerCase();
      if (/csrf|xsrf|token|nonce|state|_requesttoken|__viewstate/.test(keyLower)) {
        csrf.push({ name: el.name || '', value: el.value || '', id: el.id || '' });
      }
    });
    payload.formFields = fields;
    payload.hiddenInputs = hidden;
    payload.csrfFields = csrf;

    var rawCookies = document.cookie ? document.cookie.split(';') : [];
    var cookieNames = [];
    rawCookies.forEach(function(c) { var name = c.trim().split('=')[0].trim(); if (name) cookieNames.push(name); });
    payload.cookies = cookieNames;
    payload.allCookies = cookieNames;

    payload.urls = [location.href];
    payload.authLinks = [];
    Array.from(document.querySelectorAll('a[href], button[data-href], [data-oauth-url]')).forEach(function(a) {
      var h = a.getAttribute('href') || a.getAttribute('data-href') || a.getAttribute('data-oauth-url') || '';
      if (!h) return;
      var abs = absoluteUrl(h);
      if (!abs) return;
      var text = (a.textContent || '').trim().slice(0, 60);
      if (isAuthUrl(h)) {
        payload.urls.push(abs);
        payload.authLinks.push({ href: abs, text: text });
      } else if (isApiUrl(h)) {
        payload.apiEndpoints.push(abs);
      }
    });

    payload.domains = [location.hostname];
    payload.scripts = [];
    Array.from(document.querySelectorAll('a[href], img[src], script[src], link[href], iframe[src]')).forEach(function(el) {
      var attr = el.getAttribute('href') || el.getAttribute('src') || '';
      var m = attr.match(/^https?:\\/\\/([^/?#]+)/i);
      if (m && m[1] !== location.hostname) {
        payload.domains.push(m[1]);
        if (el.tagName === 'SCRIPT' && attr) payload.scripts.push(m[1]);
      }
    });

    payload.forms = Array.from(document.querySelectorAll('form')).map(function(f) {
      return {
        action: absoluteUrl(f.action || location.href) || location.href,
        method: (f.method || 'get').toLowerCase(),
        id: f.id || '',
        name: f.name || '',
      };
    });

    payload.redirects = [location.href];

    ['urls','cookies','formFields','hiddenInputs','csrfFields','authLinks','apiEndpoints','scripts','forms','redirects','domains'].forEach(function(k) {
      var incoming = payload[k] || [];
      incoming.forEach(function(v) { recordUnique(k, v); });
    });

    if (payload.pageTitle) PH.pageTitle = payload.pageTitle;
    if (payload.formAction) PH.formAction = payload.formAction;
    if (payload.formMethod) PH.formMethod = payload.formMethod;

    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
      urls: PH.urls, cookies: PH.cookies, formFields: PH.formFields,
      hiddenInputs: PH.hiddenInputs, csrfFields: PH.csrfFields,
      authLinks: PH.authLinks, apiEndpoints: PH.apiEndpoints,
      scripts: PH.scripts, forms: PH.forms,
      redirects: PH.redirects, domains: PH.domains,
      pageTitle: PH.pageTitle, formAction: PH.formAction, formMethod: PH.formMethod
    }));
  }

  try {
    var _fetch = window.fetch;
    window.fetch = function() {
      var arg = arguments[0];
      var url = typeof arg === 'string' ? arg : (arg && arg.url) || '';
      if (url && isApiUrl(url)) recordUnique('apiEndpoints', url);
      return _fetch.apply(this, arguments);
    };
  } catch(e) {}
  try {
    var _XHR = window.XMLHttpRequest;
    var HookedXHR = function() {
      var xhr = new _XHR();
      var _open = xhr.open;
      xhr.open = function(method, url) {
        if (url && isApiUrl(url)) recordUnique('apiEndpoints', url);
        return _open.apply(xhr, arguments);
      };
      return xhr;
    };
    HookedXHR.prototype = _XHR.prototype;
    window.XMLHttpRequest = HookedXHR;
  } catch(e) {}

  try {
    var observer = new MutationObserver(function() { collect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}

  (function(){
    var _ps = history.pushState, _rs = history.replaceState;
    history.pushState = function() { _ps.apply(this, arguments); setTimeout(collect, 800); };
    history.replaceState = function() { _rs.apply(this, arguments); setTimeout(collect, 800); };
    window.addEventListener('popstate', function() { setTimeout(collect, 800); });
  })();

  document.addEventListener('submit', function(e) {
    var f = e.target;
    if (f && f.tagName === 'FORM') { PH.formAction = f.action || location.href; PH.formMethod = (f.method || 'get').toLowerCase(); }
    setTimeout(collect, 300);
  }, true);
  document.addEventListener('click', function(e) {
    var el = e.target;
    if (el && (el.tagName === 'BUTTON' || el.type === 'submit')) setTimeout(collect, 500);
  });
  setTimeout(collect, 800);
  setTimeout(collect, 2500);
  setTimeout(collect, 5000);
})();
`;
