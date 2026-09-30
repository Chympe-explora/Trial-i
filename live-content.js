/* ============================================================
   live-content.js — pulls in whatever the Telegram admin bot has
   changed (text, photos, prices, discounts, highlights) and merges it
   on top of the static config.js defaults, BEFORE app.js renders the
   page. If this fails for any reason (offline, backend down), it
   fails silently and the site just shows the static config.js content
   — nothing ever breaks because of this file.

   Load order matters:
     config.js  →  live-content.js  →  app.js

   ⚠️ Update API_BASE below to match the URL in booking-bridge.js.
   ============================================================ */
(function () {
  "use strict";

  var API_BASE = "https://teamexploera-backend.book-and-explore.workers.dev";
  var SITE = window.KC_SITE_ID || "root";

  function getJSON(path) {
    try {
      var xhr = new XMLHttpRequest();
      // Synchronous on purpose: this has to finish before app.js reads
      // window.KC_CONTENT a few lines below in the page. Keep whatever
      // this returns tiny (it only ever contains admin edits, not the
      // whole site) so this stays fast.
      xhr.open("GET", API_BASE + path, false);
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        var data = JSON.parse(xhr.responseText);
        return data.ok ? data : null;
      }
    } catch (e) {
      /* offline / backend down — fall back to static config.js content */
    }
    return null;
  }

  // A "block array" is what experiences.blocks / about.blocks are made
  // of — ordered lists of { type: "heading"|"paragraph"|"image"|... }.
  // Telegram text edits round-trip the WHOLE array back to the backend,
  // so an edit made before an "image" block existed (or a bot bug that
  // only understands text blocks) can silently save a copy with the
  // image blocks missing — and every visitor then gets that copy
  // instead of the real config.js content. This guards against that:
  // any "image" block present in the static config.js defaults but
  // missing from the backend's version is spliced back in, so a
  // content edit can only ever ADD/CHANGE text, never delete a photo
  // it didn't touch.
  function looksLikeBlockArray(arr) {
    return arr.length > 0 && arr.every(function (b) {
      return b && typeof b === "object" && typeof b.type === "string";
    });
  }

  function restoreMissingImageBlocks(baseArr, overrideArr) {
    if (!looksLikeBlockArray(baseArr) || !looksLikeBlockArray(overrideArr)) return overrideArr;
    var baseImages = baseArr.filter(function (b) { return b.type === "image"; });
    if (!baseImages.length) return overrideArr;
    var overrideKeys = {};
    overrideArr.forEach(function (b) { if (b.type === "image") overrideKeys[b.key] = true; });
    var missing = baseImages.filter(function (b) { return !overrideKeys[b.key]; });
    if (!missing.length) return overrideArr;
    var result = overrideArr.slice();
    // Multiple missing images can share the same text anchor (two photos
    // back-to-back in base) — track the last insertion point per anchor
    // so a second photo lands right after the first, not back at the
    // anchor position (which would reverse their order).
    var lastInsertAt = {};
    missing.forEach(function (imgBlock) {
      var idxInBase = baseArr.indexOf(imgBlock);
      // Walk back past any other image blocks — an image can't be
      // text-matched against override, so the real anchor is the
      // nearest preceding block that actually carries text.
      var anchorIdx = idxInBase - 1;
      while (anchorIdx >= 0 && baseArr[anchorIdx].type === "image") anchorIdx--;
      var anchor = anchorIdx >= 0 ? baseArr[anchorIdx] : null;
      var anchorKey = anchor ? (anchor.type + "::" + anchor.text) : "__start__";
      var insertAt;
      if (Object.prototype.hasOwnProperty.call(lastInsertAt, anchorKey)) {
        insertAt = lastInsertAt[anchorKey] + 1;
      } else if (anchor) {
        insertAt = result.length;
        for (var i = 0; i < result.length; i++) {
          if (result[i].type === anchor.type && result[i].text === anchor.text) {
            insertAt = i + 1;
            break;
          }
        }
      } else {
        insertAt = 0;
      }
      result.splice(insertAt, 0, imgBlock);
      lastInsertAt[anchorKey] = insertAt;
      for (var k in lastInsertAt) {
        if (k !== anchorKey && lastInsertAt[k] >= insertAt) lastInsertAt[k] += 1;
      }
    });
    return result;
  }

  // Some arrays (e.g. whyVisit.journeys) aren't "blocks" — each item is
  // its own card carrying its photo directly — either as an "imageSlot"
  // object (whyVisit.journeys) or as an "images" array (destinationDetails
  // .highlights, waterfalls.locations, etc). Same failure mode as above:
  // an admin text edit to the title/description round-trips the whole
  // array, and if whatever saved it doesn't preserve that photo field,
  // it silently vanishes for everyone. Match items by "label" (or
  // "number"/"key"/"id"/"title" as fallbacks) and restore whichever
  // photo field the override version dropped.
  function restoreMissingEmbeddedImages(baseArr, overrideArr) {
    if (!baseArr.length || !overrideArr.length) return overrideArr;
    var sample = baseArr[0];
    if (!sample || typeof sample !== "object") return overrideArr;
    var hasImageSlot = !!sample.imageSlot;
    var hasImagesArr = Array.isArray(sample.images);
    if (!hasImageSlot && !hasImagesArr) return overrideArr;
    var idFields = ["number", "key", "id", "label", "title"];
    function idOf(item) {
      for (var i = 0; i < idFields.length; i++) {
        if (item && item[idFields[i]] != null) return idFields[i] + ":" + item[idFields[i]];
      }
      return null;
    }
    return overrideArr.map(function (overrideItem) {
      var id = idOf(overrideItem);
      if (!id) return overrideItem;
      var baseItem = baseArr.filter(function (b) { return idOf(b) === id; })[0];
      if (!baseItem) return overrideItem;
      var restored = null;
      if (hasImageSlot && baseItem.imageSlot && baseItem.imageSlot.image) {
        var hasImage = overrideItem.imageSlot && overrideItem.imageSlot.enabled !== false && overrideItem.imageSlot.image;
        if (!hasImage) {
          restored = restored || copy(overrideItem);
          restored.imageSlot = baseItem.imageSlot;
        }
      }
      if (hasImagesArr && Array.isArray(baseItem.images) && baseItem.images.filter(Boolean).length) {
        var overrideHasImages = Array.isArray(overrideItem.images) && overrideItem.images.filter(Boolean).length
          && overrideItem.imagesEnabled !== false;
        if (!overrideHasImages) {
          restored = restored || copy(overrideItem);
          restored.images = baseItem.images;
          if (restored.imagesEnabled === false) restored.imagesEnabled = baseItem.imagesEnabled !== false;
        }
      }
      return restored || overrideItem;
    });
    function copy(item) {
      var out = {};
      for (var k in item) out[k] = item[k];
      return out;
    }
  }

  function protectArrayImages(baseArr, overrideArr) {
    if (looksLikeBlockArray(baseArr)) return restoreMissingImageBlocks(baseArr, overrideArr);
    return restoreMissingEmbeddedImages(baseArr, overrideArr);
  }

  function deepMerge(base, override) {
    if (override === undefined || override === null) return base;
    if (Array.isArray(override)) {
      return Array.isArray(base) ? protectArrayImages(base, override) : override;
    }
    if (typeof override !== "object") return override;
    if (typeof base !== "object" || base === null || Array.isArray(base)) base = {};
    var out = {};
    for (var k in base) out[k] = base[k];
    for (var k2 in override) out[k2] = deepMerge(base[k2], override[k2]);
    return out;
  }

  // ---- ONE combined round trip instead of three sequential ones ----
  // This used to be three separate synchronous XHR calls back to back
  // (content, prices, images) — each one blocking the page until it
  // finished, one after another, before app.js could even start
  // rendering. /api/bootstrap returns all of it in one response
  // (computed with parallel KV reads server-side), so this is now a
  // single blocking round trip instead of three.
  var bootstrapRes = getJSON("/api/bootstrap?site=" + SITE);

  // ---- text content ----
  if (bootstrapRes && bootstrapRes.content) {
    window.KC_CONTENT = deepMerge(window.KC_CONTENT || {}, bootstrapRes.content);
  }

  // ---- prices ----
  if (bootstrapRes && bootstrapRes.prices && window.KC_PRICES) {
    window.KC_PRICES = deepMerge(window.KC_PRICES, bootstrapRes.prices);
  }

  // ---- images (only keys the admin has actually changed) ----
  // config.js copies each KC_IMAGES filename into KC_CONTENT by value
  // at parse time (e.g. destinations.items[0].image = KC_IMAGES.card),
  // so simply overwriting KC_IMAGES here wouldn't update anything
  // already baked into KC_CONTENT. Instead: remember each key's OLD
  // filename, then swap every matching string found anywhere in
  // KC_CONTENT for the new photo URL.
  if (bootstrapRes && bootstrapRes.images) {
    var oldFilenames = {}; // oldFilename -> newUrl
    window.KC_IMAGES = window.KC_IMAGES || {};
    for (var key in bootstrapRes.images) {
      var newUrl = bootstrapRes.images[key];
      var oldFilename = window.KC_IMAGES[key];
      if (oldFilename) oldFilenames[oldFilename] = newUrl;
      window.KC_IMAGES[key] = newUrl;
    }
    if (window.KC_CONTENT) replaceStringsDeep(window.KC_CONTENT, oldFilenames);
  }

  function replaceStringsDeep(obj, replacements) {
    if (!obj || typeof obj !== "object") return;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = obj[k];
      if (typeof v === "string" && Object.prototype.hasOwnProperty.call(replacements, v)) {
        obj[k] = replacements[v];
      } else if (v && typeof v === "object") {
        replaceStringsDeep(v, replacements);
      }
    }
  }

  // ---- expose a price calculator the booking UI can call ----
  // Usage: KC_calculatePrice({ packageKey, unitPrice, persons, addons,
  // code }, function (result) { ... })   — result: { subtotal, breakdown, total, savings }
  window.KC_calculatePrice = function (params, callback) {
    fetch(API_BASE + "/api/calculate-price", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ site: SITE, dateISO: new Date().toISOString() }, params)),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) { callback(data.ok ? data : null); })
      .catch(function () { callback(null); });
  };

  // ---- highlight banner (site-wide announcement bar set from Telegram) ----
  document.addEventListener("DOMContentLoaded", function () {
    fetch(API_BASE + "/api/highlights?site=" + SITE)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok || !data.highlights || !data.highlights.length) return;
        var bar = document.createElement("div");
        bar.style.cssText =
          "position:sticky;top:0;z-index:9998;background:#111827;color:#fff;" +
          "padding:8px 14px;text-align:center;font:600 13px/1.5 system-ui,-apple-system,sans-serif;";
        bar.textContent = "🌟 " + data.highlights.map(function (h) { return h.text; }).join("   •   ");
        document.body.insertBefore(bar, document.body.firstChild);
      })
      .catch(function () {});
  });
})();
