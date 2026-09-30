/**
 * preload-intro.js — full-screen video splash that doubles as a
 * preloader gate.
 * -----------------------------------------------------------------------
 * Drop your clip in as /video-animation.mp4 (same folder as index.html).
 * While it plays, this script quietly preloads every image/video URL it
 * can find in window.KC_CONTENT (the site's text+photo config, set by
 * config.js and any Telegram admin overrides from live-content.js) and
 * waits for the React app to actually mount into #root. Only once the
 * video has finished AND those assets have settled AND the app has
 * mounted does the overlay fade out — so by the time a visitor sees the
 * home page, its images are already in the browser cache and every
 * button/section is already live, not still loading in.
 *
 * Fails safe on every axis: a missing/broken video, a slow network, or
 * an asset that never loads will never trap a visitor on this screen —
 * MAX_WAIT_MS below is a hard ceiling that reveals the site regardless.
 *
 * This file must be loaded WITHOUT `defer`, and the markup it controls
 * (#kc-intro-overlay) must already exist in the HTML above the point
 * where this <script> tag sits — see index.html.
 */
(function () {
  "use strict";

  // ---- 0. "Site opened" ping to the admin (Telegram) — unconditional.
  // This page has no booking form and collects no personal data, so
  // unlike krem-chympe/ and wilderness-expedition/ (which gate their
  // visit ping on the consent banner, since that consent also covers
  // real booking data there), this one fires every time, no consent
  // check. Fire-and-forget, never blocks or shows anything to the
  // visitor, and never throws if it fails.
  (function sendVisitPing() {
    try {
      var API_BASE = "https://teamexploera-backend.book-and-explore.workers.dev";
      var sessionId;
      try {
        sessionId = sessionStorage.getItem("kc_session");
        if (!sessionId) {
          sessionId = (crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : String(Date.now());
          sessionStorage.setItem("kc_session", sessionId);
        }
      } catch (e) { sessionId = ""; }

      fetch(API_BASE + "/api/visit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId,
          siteId: window.KC_SITE_ID || "root",
          path: location.pathname,
          referrer: document.referrer || "",
        }),
      }).catch(function () {});
    } catch (e) { /* never let a notification failure affect the page */ }
  })();

  var overlay = document.getElementById("kc-intro-overlay");
  if (!overlay) return; // markup missing — never block the page for this

  var video = document.getElementById("kc-intro-video");
  var skipBtn = document.getElementById("kc-intro-skip");

  // Show the intro once per browser tab (sessionStorage, not
  // localStorage — a fresh tab/visit tomorrow sees it again, but a
  // visitor clicking around the same tab today only sees it once).
  // Set SHOW_EVERY_TIME to true below if you'd rather it play on every
  // single page load, with no "seen it" memory at all.
  var SHOW_EVERY_TIME = false;
  var alreadySeen = false;
  if (!SHOW_EVERY_TIME) {
    try { alreadySeen = sessionStorage.getItem("kc_intro_seen") === "1"; } catch (e) {}
  }
  if (alreadySeen) {
    overlay.parentNode && overlay.parentNode.removeChild(overlay);
    return;
  }
  try { sessionStorage.setItem("kc_intro_seen", "1"); } catch (e) {}

  var MAX_WAIT_MS = 9000; // absolute ceiling — reveal the site no matter what past this
  var MIN_SHOW_MS = 1200; // avoid an instant flash-and-gone on a very fast connection
  var startTime = Date.now();

  var videoDone = false;
  var assetsDone = false;
  var appMounted = false;
  var revealed = false;

  function reveal() {
    if (revealed) return;
    revealed = true;
    var wait = Math.max(0, MIN_SHOW_MS - (Date.now() - startTime));
    setTimeout(function () {
      overlay.classList.add("kc-hide");
      try { video && video.pause(); } catch (e) {}
      setTimeout(function () {
        overlay.parentNode && overlay.parentNode.removeChild(overlay);
      }, 700); // matches the CSS opacity transition duration
    }, wait);
  }

  function maybeReveal() {
    if (videoDone && assetsDone && appMounted) reveal();
  }

  // ---- 1. The video itself -------------------------------------------
  if (video) {
    video.addEventListener("ended", function () { videoDone = true; maybeReveal(); });
    // Missing file, unsupported codec, etc. — never hold the site hostage.
    video.addEventListener("error", function () { videoDone = true; maybeReveal(); });
    // Some browsers/visitors block autoplay outright; if playback never
    // actually starts, don't wait on an "ended" event that will never fire.
    setTimeout(function () {
      if (video.paused && !videoDone) { videoDone = true; maybeReveal(); }
    }, 2500);
  } else {
    videoDone = true;
  }

  if (skipBtn) {
    skipBtn.addEventListener("click", function () {
      videoDone = true; assetsDone = true; appMounted = true; reveal();
    });
  }

  // ---- 2. Preload every image/video URL this page's content uses ----
  function collectUrls(value, out, depth) {
    if (value == null || depth > 6) return;
    if (typeof value === "string") {
      if (/\.(jpe?g|png|webp|gif|mp4|webm)(\?.*)?$/i.test(value)) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) collectUrls(value[i], out, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (var k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k)) collectUrls(value[k], out, depth + 1);
      }
    }
  }

  function preloadAssets() {
    var urls = [];
    try { collectUrls(window.KC_CONTENT, urls, 0); } catch (e) {}
    // De-dupe, and cap it — this is a fast splash-screen warm-up, not a
    // full offline cache, so it only chases a sane number of files.
    urls = urls.filter(function (u, i) { return urls.indexOf(u) === i; }).slice(0, 60);

    if (!urls.length) { assetsDone = true; maybeReveal(); return; }

    var remaining = urls.length;
    function settle() {
      remaining--;
      if (remaining <= 0) { assetsDone = true; maybeReveal(); }
    }
    urls.forEach(function (url) {
      if (/\.(mp4|webm)$/i.test(url)) {
        var v = document.createElement("video");
        v.preload = "auto"; v.muted = true; v.src = url;
        v.addEventListener("loadeddata", settle);
        v.addEventListener("error", settle);
      } else {
        var img = new Image();
        img.onload = settle; img.onerror = settle;
        img.src = url;
      }
    });
  }

  // config.js (and live-content.js's admin overrides right after it)
  // load with `defer`, so KC_CONTENT may not exist the instant this
  // script runs — poll briefly instead of assuming it's ready.
  function waitForContent(triesLeft) {
    if (window.KC_CONTENT || triesLeft <= 0) { preloadAssets(); return; }
    setTimeout(function () { waitForContent(triesLeft - 1); }, 100);
  }
  waitForContent(40); // ~4s ceiling before preloading with whatever exists

  // ---- 3. Wait for the React app to actually mount into #root -------
  var root = document.getElementById("root");
  if (root && root.children.length === 0) {
    var mo = new MutationObserver(function () {
      if (root.children.length > 0) {
        appMounted = true;
        mo.disconnect();
        maybeReveal();
      }
    });
    mo.observe(root, { childList: true });
  } else {
    appMounted = true;
  }

  // ---- Safety net ------------------------------------------------------
  setTimeout(function () {
    videoDone = true; assetsDone = true; appMounted = true; reveal();
  }, MAX_WAIT_MS);
})();
