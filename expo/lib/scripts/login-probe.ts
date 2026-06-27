// ── Focused login-form probe used by the PhishletGen-Automator mode ──
// Injected into a WebView to detect login forms and extract their structure.

export const LOGIN_PROBE_SCRIPT = `
(function() {
  'use strict';
  function visibleArea(el) {
    var rect = el.getBoundingClientRect();
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }
  function isHttps(action) {
    try { return new URL(action, location.href).protocol === 'https:'; } catch(e) { return false; }
  }
  function hasPassword(form) { return !!form.querySelector('input[type="password"]'); }
  function findBestLoginForm() {
    var forms = Array.from(document.querySelectorAll('form')).filter(hasPassword);
    if (forms.length === 0) return null;
    var scored = forms.map(function(f) {
      var action = f.action || location.href;
      return { form: f, https: isHttps(action) ? 1 : 0, area: visibleArea(f), action: action };
    });
    scored.sort(function(a, b) {
      if (b.https !== a.https) return b.https - a.https;
      return b.area - a.area;
    });
    return scored[0].form;
  }
  function getLoginPath(form) {
    try {
      var action = form.action || location.href;
      return new URL(action, location.href).pathname || '/';
    } catch(e) { return '/'; }
  }
  function getSubmitSelector(form) {
    if (form.id) return 'form#' + form.id;
    if (form.name) return 'form[name="' + form.name + '"]';
    if (form.className) {
      var cls = form.className.split(/\\s+/).filter(Boolean)[0];
      if (cls) return 'form.' + cls + ':has(> input[type="password"])';
    }
    return 'form:has(> input[type="password"])';
  }
  function getPasswordInput(form) { return form.querySelector('input[type="password"]'); }
  function getUsernameInput(form, passwordInput) {
    var inputs = Array.from(form.querySelectorAll('input'));
    var pwIndex = passwordInput ? inputs.indexOf(passwordInput) : -1;
    for (var i = pwIndex - 1; i >= 0; i--) {
      var t = (inputs[i].type || 'text').toLowerCase();
      if (t === 'text' || t === 'email' || t === 'tel') return inputs[i];
    }
    for (var j = 0; j < inputs.length; j++) {
      var t2 = (inputs[j].type || 'text').toLowerCase();
      if (t2 === 'text' || t2 === 'email' || t2 === 'tel') return inputs[j];
    }
    return null;
  }
  function extractLoginForm() {
    var form = findBestLoginForm();
    if (!form) return null;
    var pw = getPasswordInput(form);
    var user = getUsernameInput(form, pw);
    var hidden = Array.from(form.querySelectorAll('input[type="hidden"]')).map(function(h) {
      return { name: h.name || h.id || '', value: h.value || '' };
    }).filter(function(h) { return h.name; });
    return {
      domain: location.hostname,
      loginPath: getLoginPath(form),
      submitSelector: getSubmitSelector(form),
      usernameField: user ? (user.name || user.id || 'username') : 'username',
      passwordField: pw ? (pw.name || pw.id || 'password') : 'password',
      hiddenInputs: hidden
    };
  }
  function send() {
    var data = extractLoginForm();
    if (data && window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ loginForm: data }));
    }
  }
  send();
  setTimeout(send, 1000);
  setTimeout(send, 2500);
})();
`;
