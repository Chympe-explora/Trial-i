/**
 * era-ai-widget.js — the visitor-facing help widget.
 *
 * By default this is a TAP-ONLY FAQ browser: visitors tap a topic, then
 * a question, and get an instant answer — entirely client-side, nothing
 * ever sent anywhere. It never contacts the team on its own.
 *
 * The only way a message ever reaches the team is if the visitor
 * explicitly taps "🙋 Still need help? Talk to our team" — that reveals
 * a normal text box, and from that point on it behaves like a direct
 * chat line to a real person: whatever they type is forwarded straight
 * to the admin's Telegram, and whatever the admin types back (or a
 * "🤖 AI" conversation explicitly switched on from Telegram) shows up
 * here. Nothing replies on its own unless the admin has turned the
 * optional AI assistant on for that specific conversation.
 *
 * FAQ_DATA below is organized as categories → questions, per site
 * (root / krem-chympe / wilderness-expedition). A few answers use
 * {{placeholders}} (minAdvance, childFreeAge, phone, etc.) filled in at
 * render time from window.KC_CONTENT / window.KC_PRICES — which already
 * include any live Telegram-admin overrides by the time this runs — so
 * numbers here can never go stale the way a hardcoded figure would.
 *
 * FIXES APPLIED (kept from the previous version):
 * 1. SessionID persists in localStorage across page reloads
 *    → Solves: Chat reset when visitor closes/reopens widget
 * 2. Polling frequency increases to 800ms for 30 seconds after sending
 *    → Solves: Slow admin reply delivery (KV eventual consistency)
 *
 * Drop this on any site (after booking-bridge.js, before app.js closes —
 * see index.html). Renders a small floating help bubble and, once a
 * visitor opts into chat, talks to the same Cloudflare Worker as
 * booking-bridge.js. No React, no build step — plain DOM, matches the
 * site's dark glassmorphism look.
 */
(function () {
  const API_BASE = "https://teamexploera-backend.book-and-explore.workers.dev";
  const SITE_ID = window.KC_SITE_ID || "root";

  // ===== Persistent Session ID =====
  function getOrCreateSessionId() {
    if (window.KCBridge && window.KCBridge.sessionId) {
      const kbSessionId = window.KCBridge.sessionId;
      try { localStorage.setItem("era_ai_session_id", kbSessionId); } catch (e) {}
      return kbSessionId;
    }
    try {
      const stored = localStorage.getItem("era_ai_session_id");
      if (stored && stored.length > 4) return stored;
    } catch (e) {}
    const newId = Math.random().toString(36).slice(2, 10);
    try {
      localStorage.setItem("era_ai_session_id", newId);
      localStorage.setItem("era_ai_created_at", Date.now().toString());
    } catch (e) {}
    return newId;
  }

  const sessionId = getOrCreateSessionId();

  const GREETING = "Hi 👋 Tap a topic below and I'll answer instantly — no waiting.";

  // =====================================================================
  // 🔤 TEMPLATE VARIABLES — live, current-at-render-time values pulled
  // from this page's own config (already merged with any Telegram-admin
  // overrides by the time this script runs). Answers below can use
  // {{minAdvance}} etc. instead of a hardcoded number that would go
  // stale the moment a price changes.
  // =====================================================================
  function faqVars() {
    const C = window.KC_CONTENT || {};
    const P = window.KC_PRICES || {};
    const footer = C.footer || {};
    const phone = footer.phone || "";
    return {
      phone: phone,
      phoneHref: phone.replace(/[^\d+]/g, ""),
      email: footer.email || "",
      whatsapp: C.whatsappNumber || "",
      instagram: C.instagram || "",
      minAdvance: P.minAdvance != null ? P.minAdvance : "—",
      childFreeAge: P.childFreeAge != null ? P.childFreeAge : "—",
      childJacketFee: P.childJacketFee != null ? P.childJacketFee : "—",
      childEntryFee: P.childEntryFee != null ? P.childEntryFee : "—",
      maxPeople: (P.sharedTour && P.sharedTour.maxPeople != null) ? P.sharedTour.maxPeople : "—",
      extraDayRate: (P.sharedTour && P.sharedTour.additionalDayPerPersonPerDay != null) ? P.sharedTour.additionalDayPerPersonPerDay : "—",
    };
  }
  function fillTemplate(str, vars) {
    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? vars[k] : ""));
  }

  // =====================================================================
  // 📚 FAQ_DATA — the tap-to-browse question tree, grouped by category,
  // per site. Every answer names the exact section/page and (where it
  // makes sense) offers a one-tap "📍 Take me there" button. Nothing
  // here is ever sent anywhere — it's pure client-side content.
  // Add more questions any time; no admin-bot round-trip needed since
  // this is just information, not content that changes hour to hour.
  // =====================================================================
  const FAQ_DATA = {
    root: [
      { id: "destinations", label: "🗺️ Destinations", questions: [
        { q: "Where do I see your destinations?", kw: "destination destinations trips places locations see view krem chympe wilderness expedition", a: "That's the <b>Destinations</b> section on this page — Krem Chympe Waterfall & Cave and Wilderness Expedition are both listed there. Scroll through both cards, then tap \u201cExplore Destination\u201d on whichever interests you.", href: "#destinations" },
        { q: "Which one should I pick?", kw: "which one pick choose compare difference between", a: "<b>Krem Chympe Waterfall &amp; Cave</b> is a single guided day out — a forest trek, a waterfall, and one of Meghalaya's longest cave systems. <b>Wilderness Expedition</b> is a full 6-day journey deep into the backcountry, with multi-day trekking and camping. Compare both in the Destinations section.", href: "#destinations" },
        { q: "How long does each trip take?", kw: "how long duration days time trip take", a: "Krem Chympe is a single-day guided trip. Wilderness Expedition runs over <b>6 days</b>. Full itineraries are on each destination's own site.", href: "#destinations" },
        { q: "Is this suitable for beginners?", kw: "beginner first time fitness difficult hard experience needed suitable", a: "Groups are kept small and every trip goes out with a local guide, with safety as the top priority. If you have specific fitness, medical or experience concerns, it's best to ask our team directly before booking." }
      ]},
      { id: "booking", label: "💳 Booking & Pricing", questions: [
        { q: "Where do I actually book a trip?", kw: "book booking reserve reservation how do i book", a: "Booking happens on each destination's own site, not here. In the <b>Destinations</b> section below, tap \u201cExplore Destination\u201d on Krem Chympe or Wilderness Expedition, then tap <b>Packages</b> to pick a package and start booking.", href: "#destinations" },
        { q: "How much do your trips cost?", kw: "price prices cost how much rate", a: "Exact prices live on each destination's own Packages page, since they depend on the package and group size. Tap \u201cExplore Destination\u201d on Krem Chympe or Wilderness Expedition, then open <b>Packages</b> there.", href: "#destinations" },
        { q: "Is there a discount or sale running right now?", kw: "discount sale offer promo coupon deal", a: "Active sales are shown right on the package cards themselves. Open a destination's <b>Packages</b> page (via Explore Destination) and look for a struck-through price with a \u201cX% OFF\u201d badge.", href: "#destinations" },
        { q: "How do I pay?", kw: "pay payment upi qr bank transfer how to pay", a: "Payment is handled on each destination's own Packages page — you'll see a QR code / UPI ID / bank details there. Pay using any of those, then upload a screenshot of the payment as your receipt.", href: "#destinations" },
        { q: "Do I need to pay the full amount upfront?", kw: "advance deposit full amount upfront pay now later", a: "No — only a minimum advance is required to hold your booking; the balance is settled separately. Check the current advance amount on the destination's own Packages page.", href: "#destinations" }
      ]},
      { id: "experience", label: "🧭 What To Expect", questions: [
        { q: "Where can I read about what a trip includes?", kw: "experience included what happens itinerary details activities", a: "That's <b>The Experience</b> section on this page — it walks through what a trip with us actually looks like, start to finish.", href: "#experiences" },
        { q: "What's Krem Chympe actually like?", kw: "krem chympe cave waterfall what is like story explore", a: "Krem Chympe is one of India's longest cave systems — reached by a forest trek from Khaddum Village — with a waterfall, an underground river, golden mineral formations, and rare cave wildlife along the way.", href: "#destinations" },
        { q: "What's the Wilderness Expedition actually like?", kw: "wilderness expedition what is like story explore trek", a: "A 6-day journey into Meghalaya's remote backcountry — jungle trekking, river crossings, wild camping, and waterfalls most visitors never reach.", href: "#destinations" }
      ]},
      { id: "trust", label: "🛡️ Safety & Trust", questions: [
        { q: "Why should I book with you?", kw: "why book us trust safe safety reasons choose direct", a: "See the <b>Why Book Us</b> section on this page — it covers safety, local guides, small groups, and why booking direct (not through a third party) is the better deal.", href: "#booking" },
        { q: "Are your guides local?", kw: "guides local experienced who leads team", a: "Yes — our whole team grew up in these hills; guides are local, not outsourced. More on that in <b>About Us</b> below.", href: "#about" },
        { q: "What happens if the weather turns bad on my trip day?", kw: "weather rain unsafe cancel conditions storm flood", a: "Your safety always comes first. If heavy rain or unsafe trail/cave/water conditions come up, we may reschedule, offer an alternative activity, or refund the affected part — see the full <b>Refund Policy</b> in the footer.", href: "#footer" }
      ]},
      { id: "about", label: "🏢 About Us", questions: [
        { q: "Who is Team Explo Era?", kw: "about us who are you company team story explo era", a: "That's the <b>About Us</b> section further down this page — our story and how we got started.", href: "#about" }
      ]},
      { id: "contact", label: "📞 Contact & Support", questions: [
        { q: "How do I contact you?", kw: "contact phone number email whatsapp reach call", a: "Call us at <b>{{phone}}</b>, email <b>{{email}}</b>, or message us on <a href=\"https://wa.me/{{whatsapp}}\" target=\"_blank\" rel=\"noopener\">WhatsApp</a>. All of it's also in the footer at the bottom of this page.", href: "#footer" },
        { q: "Are you on social media?", kw: "instagram social media follow", a: "Yes — find us on <a href=\"{{instagram}}\" target=\"_blank\" rel=\"noopener\">Instagram</a>, linked in the footer too.", href: "#footer" }
      ]},
      { id: "policies", label: "📄 Policies", questions: [
        { q: "Where's your refund policy?", kw: "refund policy cancel cancellation", a: "Tap <b>Refund Policy</b> in the footer at the bottom of this page to read the full terms before you book.", href: "#footer" },
        { q: "How do I request a cancellation?", kw: "cancel my booking request how to cancel", a: "Contact us with your booking name, reference number, visit date and contact number — the full steps are in our <b>Refund Policy</b> in the footer.", href: "#footer" }
      ]}
    ],

    "krem-chympe": [
      { id: "about", label: "🕳️ About Krem Chympe", questions: [
        { q: "What is Krem Chympe?", kw: "what is krem chympe cave system explain", a: "Krem Chympe is one of India's longest cave systems — about 10.5 km of mapped passages in the Jaintia Hills, home to over 1,200 caves. \u2018Krem\u2019 means \u2018cave\u2019 in Khasi; it's also known locally as the \u2018Elephant Cave.\u2019", href: "index.html?page=1#kc-explore" },
        { q: "What's inside the cave?", kw: "inside cave features golden orchid gours cavefish bats", a: "Highlights include the Golden Orchid Chamber (stalactites and stalagmites with golden mineral deposits), 50+ natural limestone dams called \u2018gours,\u2019 the world's largest blind cavefish species, and bat colonies.", href: "index.html?page=1#kc-explore" },
        { q: "How difficult is the trek?", kw: "difficult hard fitness terrain difficulty level", a: "It's a real forest trek over some uneven terrain, followed by time inside the cave with a local guide. If you have specific fitness or medical questions, it's best to ask our team directly." },
        { q: "Who is Team Explo Era?", kw: "team explo era who runs owns operates company", a: "<b>Team Explo Era</b> is the local team behind Krem Chympe — a group of friends and neighbors from these hills, not an outside tour operator. Read our full story on the main site.", href: "../index.html#about" }
      ]},
      { id: "packages", label: "📦 Packages & Pricing", questions: [
        { q: "Where do I see packages and prices?", kw: "package packages price prices pricing cost how much", a: "That's the <b>Packages</b> page. Compare the Shared Package (fixed per-person rate) and Private Package (fully custom), then tap \u201cBook Now\u201d on whichever fits your group.", href: "index.html?page=2#kc-packages" },
        { q: "What's the difference between the Shared and Private packages?", kw: "shared vs private difference package compare", a: "The <b>Shared Package</b> is a fixed per-person rate — you join other travelers on a set group trip. The <b>Private Package</b> is fully custom for your own group, with optional add-ons like a 4×4 jeep, adventure activities, and overnight camping.", href: "index.html?page=2#kc-packages" },
        { q: "Is there a discount right now?", kw: "discount sale offer promo coupon deal", a: "Check the <b>Packages</b> page — an active sale shows directly on the card as a struck-through original price plus a \u201cX% OFF · Save ₹Y\u201d badge.", href: "index.html?page=2#kc-packages" },
        { q: "Do I need to pay the full amount upfront?", kw: "advance deposit full amount upfront pay now later minimum", a: "No — a minimum advance of <b>₹{{minAdvance}}</b> holds your booking; the balance is settled after.", href: "index.html?page=2#kc-packages" },
        { q: "Are kids free?", kw: "kids children free age child discount", a: "Children under <b>{{childFreeAge}}</b> go free of the main package price. A small life-jacket fee (₹{{childJacketFee}}) and entry fee (₹{{childEntryFee}}) still apply for them whenever activities are included.", href: "index.html?page=2#kc-packages" },
        { q: "What does the Private Package camping add-on include?", kw: "camping add-on tent overnight bamboo food", a: "Optional camping adds a tent, dinner and breakfast, and a mandatory overnight guide — you can also add traditional bamboo-cooked dishes as a menu add-on. Full pricing is on the Packages page.", href: "index.html?page=2#kc-packages" }
      ]},
      { id: "booking", label: "📝 Booking Process", questions: [
        { q: "Where do I book the Shared Package?", kw: "shared package book booking group tour", a: "Go to the <b>Packages</b> page and tap \u201cBook Now\u201d on the Shared Package card. From there: enter how many people, review the total (updates live), then continue to payment.", href: "index.html?page=2#kc-packages" },
        { q: "Where do I book the Private Package?", kw: "private package book booking custom camping jeep", a: "Go to the <b>Packages</b> page and tap \u201cBook Now\u201d on the Private Package card. You'll be able to add jeep, guide, adventure and optional camping add-ons — the total builds up live as you pick them.", href: "index.html?page=2#kc-packages" },
        { q: "How do I pay for my booking?", kw: "pay payment upi qr bank transfer how to pay", a: "After filling in your group details on the <b>Packages</b> page, you'll see a QR code / UPI ID / bank details. Pay using any of those, then upload a screenshot of the payment as your receipt — that's the last step before submitting.", href: "index.html?page=2#kc-packages" },
        { q: "How do I check my booking status?", kw: "status confirmed pending track my booking", a: "Right after you submit a booking, you land on a live status screen in your browser — keep that tab open (or bookmark the link) and it updates automatically the moment we confirm.", href: "index.html?page=2#kc-packages" }
      ]},
      { id: "logistics", label: "🎒 Trip Logistics", questions: [
        { q: "Where do we meet / how does the trip start?", kw: "meeting point start where trek begins khaddum", a: "The trek starts with a forest walk from Khaddum Village into the cave/waterfall system. Exact meeting point and timing are confirmed with you directly after booking." },
        { q: "What should I bring?", kw: "what to bring pack list wear shoes clothes", a: "Since this involves a forest trek and some water/cave activity, comfortable trekking shoes and a change of clothes are a good idea. For a full packing list tailored to your booking, message our team directly." },
        { q: "Is there food included?", kw: "food meals included lunch eat", a: "Meal add-ons (thalis, bamboo-cooked dishes) are available to add to either package on the Packages page — nothing is forced, you choose what you want.", href: "index.html?page=2#kc-packages" }
      ]},
      { id: "gallery", label: "📸 Photos", questions: [
        { q: "Where's the photo gallery?", kw: "photo photos gallery pictures images", a: "That's the <b>Gallery</b> section on the Home page — scroll or swipe through it, and tap any photo to view it full-size.", href: "index.html?page=1#kc-gallery" }
      ]},
      { id: "contact", label: "📞 Contact & Policies", questions: [
        { q: "How do I contact you?", kw: "contact phone number whatsapp email reach call", a: "Call us at <b>{{phone}}</b>, email <b>{{email}}</b>, or message us on <a href=\"https://wa.me/{{whatsapp}}\" target=\"_blank\" rel=\"noopener\">WhatsApp</a> — all also in the Contact section on the Home page.", href: "index.html?page=1#kc-contact" },
        { q: "Where's the refund policy?", kw: "refund policy cancel cancellation", a: "Tap <b>Refund Policy</b> in the footer on the Home page to read the full terms.", href: "index.html?page=1#kc-contact" }
      ]},
      { id: "other", label: "🔁 Other Destination", questions: [
        { q: "Where's the Wilderness Expedition site?", kw: "wilderness expedition other site trek", a: "That's a separate destination site — go to the main hub page and tap \u201cExplore Destination\u201d on Wilderness Expedition.", href: "../index.html#destinations" }
      ]}
    ],

    "wilderness-expedition": [
      { id: "about", label: "🏔️ About The Expedition", questions: [
        { q: "What is the Wilderness Expedition?", kw: "what is wilderness expedition explain", a: "A 6-day journey into Meghalaya's remote backcountry — starting from Brishyrnot/Khaddum and heading toward the Meghalaya–Assam border, through jungle, river crossings and wild camps, well off the usual tourist trail.", href: "index.html?page=1#kc-explore" },
        { q: "Which waterfalls does the expedition visit?", kw: "waterfalls butterfly langam linching unnamed which falls", a: "Four waterfalls along the route: Butterfly Falls, Langam Falls, Linching Falls, and one still-unnamed waterfall about 3 km beyond Linching — each reached only on foot.", href: "index.html?page=1#kc-explore" },
        { q: "How difficult is it?", kw: "difficult hard fitness terrain difficulty level", a: "It's a genuine multi-day wilderness trek — jungle terrain, river crossings, wild camping, several days on foot. If you have specific fitness or medical questions, it's best to ask our team directly before booking." },
        { q: "Who is Team Explo Era?", kw: "team explo era who runs owns operates company", a: "<b>Team Explo Era</b> is the local team behind the Wilderness Expedition — a group of friends and neighbors from these hills, not an outside tour operator. Read our full story on the main site.", href: "../index.html#about" }
      ]},
      { id: "packages", label: "📦 Packages & Pricing", questions: [
        { q: "Where do I see packages and prices?", kw: "package packages price prices pricing cost how much expedition", a: "That's the <b>Packages</b> page. Review the Expedition Package details, then tap \u201cBook Now\u201d to start.", href: "index.html?page=2#kc-packages" },
        { q: "How many people can book together?", kw: "how many people group size max cap", a: "Up to <b>{{maxPeople}}</b> people per booking.", href: "index.html?page=2#kc-packages" },
        { q: "Can I extend the trip beyond 6 days?", kw: "extend extra days longer more days", a: "Yes — additional days beyond the standard 6 can be added, at ₹{{extraDayRate}} per person per extra day. See the Packages page to add extra days.", href: "index.html?page=2#kc-packages" },
        { q: "Do I need to pay the full amount upfront?", kw: "advance deposit full amount upfront pay now later minimum", a: "No — a minimum advance of <b>₹{{minAdvance}}</b> holds your booking; the balance is settled after.", href: "index.html?page=2#kc-packages" },
        { q: "Is there a discount right now?", kw: "discount sale offer promo coupon deal", a: "Check the <b>Packages</b> page — an active sale shows directly on the card as a \u201cX% OFF\u201d badge.", href: "index.html?page=2#kc-packages" }
      ]},
      { id: "booking", label: "📝 Booking Process", questions: [
        { q: "Where do I book the Expedition Package?", kw: "book booking expedition package", a: "Go to the <b>Packages</b> page and tap \u201cBook Now\u201d on the Expedition Package card. Enter your group size and number of days — the total updates live — then continue to payment.", href: "index.html?page=2#kc-packages" },
        { q: "How do I pay for my booking?", kw: "pay payment upi qr bank transfer how to pay", a: "After filling in your details on the <b>Packages</b> page, you'll see a QR code / UPI ID / bank details. Pay using any of those, then upload a screenshot of the payment as your receipt before submitting.", href: "index.html?page=2#kc-packages" },
        { q: "How do I check my booking status?", kw: "status confirmed pending track my booking", a: "Right after you submit a booking, you land on a live status screen in your browser — keep that tab open (or bookmark the link) and it updates automatically the moment we confirm.", href: "index.html?page=2#kc-packages" }
      ]},
      { id: "logistics", label: "🎒 Trip Logistics", questions: [
        { q: "What's included in the 6 days?", kw: "included what happens itinerary day by day", a: "Camping, guiding and the multi-day route itself are all part of the Expedition Package — exact day-by-day details are shared with you after booking. For specifics before booking, message our team directly." },
        { q: "What should I bring for a 6-day trek?", kw: "what to bring pack list gear camping", a: "Since this is multi-day wilderness camping, pack for several days outdoors. For a full packing list tailored to the route and season, message our team directly." }
      ]},
      { id: "gallery", label: "📸 Photos", questions: [
        { q: "Where's the photo gallery?", kw: "photo photos gallery pictures images", a: "That's the <b>Gallery</b> section on the Home page — scroll or swipe through it, and tap any photo to view it full-size.", href: "index.html?page=1#kc-gallery" }
      ]},
      { id: "contact", label: "📞 Contact & Policies", questions: [
        { q: "How do I contact you?", kw: "contact phone number whatsapp email reach call", a: "Call us at <b>{{phone}}</b>, email <b>{{email}}</b>, or message us on <a href=\"https://wa.me/{{whatsapp}}\" target=\"_blank\" rel=\"noopener\">WhatsApp</a> — all also in the Contact section on the Home page.", href: "index.html?page=1#kc-contact" },
        { q: "Where's the refund policy?", kw: "refund policy cancel cancellation", a: "Tap <b>Refund Policy</b> in the footer on the Home page to read the full terms.", href: "index.html?page=1#kc-contact" }
      ]},
      { id: "other", label: "🔁 Other Destination", questions: [
        { q: "Where's the Krem Chympe site?", kw: "krem chympe other site cave waterfall", a: "That's a separate destination — go to the main hub page and tap \u201cExplore Destination\u201d on Krem Chympe.", href: "../index.html#destinations" }
      ]}
    ]
  };

  const CATEGORIES = FAQ_DATA[SITE_ID] || [];
  // Flat index of every question on this site — used for the optional
  // free-text search once a visitor has unlocked the chat box.
  const ALL_QUESTIONS = [];
  CATEGORIES.forEach((cat) => {
    cat.questions.forEach((q) => ALL_QUESTIONS.push(q));
  });

  function navTokenize(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  }

  // Matches typed free text against this site's full question list by
  // simple keyword overlap. Returns the best entry, or null if nothing
  // clears the confidence bar.
  function matchFaq(text) {
    const queryTokens = navTokenize(text);
    if (!queryTokens.length) return null;
    let best = null, bestScore = 0;
    for (const entry of ALL_QUESTIONS) {
      const bag = new Set(navTokenize(entry.q + " " + (entry.kw || "")));
      const matched = queryTokens.filter((t) => bag.has(t));
      const score = matched.length / queryTokens.length;
      if (score > bestScore) { bestScore = score; best = entry; }
    }
    return bestScore >= 0.5 ? best : null;
  }

  const style = document.createElement("style");
  style.textContent = `
    #era-ai-bubble{position:fixed;right:16px;bottom:88px;z-index:45;width:56px;height:56px;border-radius:9999px;
      background:#2E8B57;border:1px solid rgba(255,255,255,0.2);box-shadow:0 8px 24px rgba(0,0,0,0.35);
      display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .2s ease,background .2s ease;
      font:600 22px/1 "Inter",sans-serif;color:#fff;}
    #era-ai-bubble:hover{transform:scale(1.06);background:#257a4b;}
    #era-ai-panel{position:fixed;right:16px;bottom:154px;z-index:45;width:min(360px,calc(100vw - 32px));
      max-height:min(560px,calc(100vh - 200px));display:flex;flex-direction:column;overflow:hidden;
      border-radius:20px;border:1px solid rgba(255,255,255,0.14);background:rgba(20,22,20,0.82);
      backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 20px 50px rgba(0,0,0,0.5);
      opacity:0;transform:translateY(12px) scale(.97);pointer-events:none;
      transition:opacity .25s ease, transform .25s ease;font:400 13px/1.5 "Inter",sans-serif;color:#fff;}
    #era-ai-panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}
    #era-ai-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;
      border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;}
    #era-ai-head .title{font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;}
    #era-ai-close{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);color:#fff;
      width:26px;height:26px;border-radius:9999px;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;}
    #era-ai-body{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px;}
    .era-msg{max-width:88%;padding:8px 12px;border-radius:14px;font-size:12.5px;white-space:pre-wrap;word-break:break-word;}
    .era-msg a{color:#a8ffcf;}
    .era-msg.bot{align-self:flex-start;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.08);}
    .era-msg.user{align-self:flex-end;background:#2E8B57;color:#fff;}
    .era-msg.typing{align-self:flex-start;background:rgba(255,255,255,0.08);display:flex;gap:4px;padding:11px 14px;}
    .era-msg.typing .era-dot{width:6px;height:6px;border-radius:9999px;background:rgba(255,255,255,0.55);
      animation:era-typing-bounce 1.2s infinite ease-in-out;}
    .era-msg.typing .era-dot:nth-child(2){animation-delay:.15s;}
    .era-msg.typing .era-dot:nth-child(3){animation-delay:.3s;}
    @keyframes era-typing-bounce{0%,60%,100%{transform:translateY(0);opacity:.5;}30%{transform:translateY(-4px);opacity:1;}}
    .era-chip-row{display:flex;flex-direction:column;gap:6px;align-self:stretch;
      background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:8px;}
    .era-chip{text-align:left;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
      color:#fff;font:500 12px/1.4 "Inter",sans-serif;padding:8px 10px;border-radius:10px;cursor:pointer;
      transition:background .15s ease;}
    .era-chip:hover{background:rgba(255,255,255,0.14);}
    .era-chip.era-back{color:#a8ffcf;font-weight:600;}
    .era-goto-btn{margin-top:8px;background:#2E8B57;border:none;color:#fff;font:600 11.5px/1 "Inter",sans-serif;
      padding:8px 12px;border-radius:9999px;cursor:pointer;}
    .era-goto-btn:hover{background:#257a4b;}
    #era-talk-team{margin:0 12px 10px;background:rgba(46,139,87,0.16);border:1px solid rgba(46,139,87,0.4);
      color:#a8ffcf;font:600 12px/1 "Inter",sans-serif;padding:10px 12px;border-radius:9999px;cursor:pointer;
      transition:background .15s ease;flex-shrink:0;}
    #era-talk-team:hover{background:rgba(46,139,87,0.28);}
    #era-ai-form{display:none;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,0.1);flex-shrink:0;}
    #era-ai-form.unlocked{display:flex;}
    #era-ai-input{flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
      border-radius:9999px;padding:8px 14px;color:#fff;font-size:12.5px;outline:none;}
    #era-ai-input::placeholder{color:rgba(255,255,255,0.4);}
    #era-ai-send{background:#2E8B57;border:none;color:#fff;width:34px;height:34px;border-radius:9999px;
      cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:15px;}
    #era-ai-send:disabled{opacity:.5;cursor:default;}
  `;
  document.head.appendChild(style);

  const bubble = document.createElement("div");
  bubble.id = "era-ai-bubble";
  bubble.setAttribute("aria-label", "Help & questions");
  bubble.textContent = "🌿";

  const panel = document.createElement("div");
  panel.id = "era-ai-panel";
  panel.innerHTML = `
    <div id="era-ai-head">
      <div class="title">🌿 Help &amp; Questions</div>
      <button id="era-ai-close" aria-label="Close">✕</button>
    </div>
    <div id="era-ai-body"></div>
    <button id="era-talk-team" type="button">🙋 Still need help? Talk to our team</button>
    <form id="era-ai-form">
      <input id="era-ai-input" type="text" autocomplete="off" placeholder="Type a message…" />
      <button id="era-ai-send" type="submit" aria-label="Send">➤</button>
    </form>
  `;

  document.addEventListener("DOMContentLoaded", mount);
  if (document.readyState !== "loading") mount();
  function mount() {
    if (document.getElementById("era-ai-bubble")) return;
    document.body.appendChild(bubble);
    document.body.appendChild(panel);
    wire();
  }

  let opened = false;
  let lastPollTs = 0;
  let pollTimer = null;
  let currentStatus = "ai"; // "ai" | "human" | "paused" | "closed"
  let chatUnlocked = false; // becomes true only once the visitor taps "Talk to our team"

  let lastMessageTime = 0;
  const FAST_POLL_INTERVAL = 800;
  const SLOW_POLL_INTERVAL = 4000;
  const FAST_POLL_DURATION = 30000;

  function wire() {
    const body = panel.querySelector("#era-ai-body");
    const form = panel.querySelector("#era-ai-form");
    const input = panel.querySelector("#era-ai-input");
    const send = panel.querySelector("#era-ai-send");
    const closeBtn = panel.querySelector("#era-ai-close");
    const talkTeamBtn = panel.querySelector("#era-talk-team");

    let lastTypingPing = 0;
    const TYPING_PING_INTERVAL = 4000;
    function pingTyping() {
      const now = Date.now();
      if (now - lastTypingPing < TYPING_PING_INTERVAL) return;
      lastTypingPing = now;
      fetch(`${API_BASE}/api/era/typing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: SITE_ID, sessionId }),
      }).catch(() => {});
    }
    input.addEventListener("input", () => {
      if (input.value.trim()) pingTyping();
    });

    function addMessage(text, who) {
      const el = document.createElement("div");
      el.className = "era-msg " + who;
      el.textContent = text;
      body.appendChild(el);
      body.scrollTop = body.scrollHeight;
      return el;
    }

    // Jumps to an FAQ answer's target: a plain "#id" scrolls smoothly if
    // that section already exists on the current page (true on the hub
    // site, and true on a sub-site when the target section is on
    // whichever page is currently showing); anything else (a relative
    // URL, or a "#id" that isn't in the current DOM because it lives on
    // a different numbered page) does a real navigation — the deep-link
    // scroll effect in each site's app.js then finishes the job by
    // scrolling to the hash once that page has mounted.
    function goToPlace(href) {
      if (href.charAt(0) === "#") {
        const el = document.getElementById(href.slice(1));
        if (el) {
          const header = document.querySelector("header");
          const headerH = header ? header.getBoundingClientRect().height : 0;
          const y = el.getBoundingClientRect().top + window.pageYOffset - headerH - 16;
          window.scrollTo({ top: Math.max(y, 0), behavior: "smooth" });
          closePanel();
          return;
        }
      }
      window.location.href = href;
    }

    function addFaqAnswer(entry) {
      const vars = faqVars();
      const el = document.createElement("div");
      el.className = "era-msg bot";
      el.innerHTML = fillTemplate(entry.a, vars) + (entry.href ? '<br><button type="button" class="era-goto-btn">📍 Take me there</button>' : "");
      body.appendChild(el);
      body.scrollTop = body.scrollHeight;
      if (entry.href) {
        el.querySelector(".era-goto-btn").addEventListener("click", function () { goToPlace(entry.href); });
      }
    }

    function askQuestion(entry) {
      addMessage(entry.q, "user");
      addFaqAnswer(entry);
      showCategories(); // let them keep browsing right after
    }

    // ---- Category / question browser (the default, primary UI) ----
    function renderChipRow(items, onPick, backLabel, onBack) {
      const wrap = document.createElement("div");
      wrap.className = "era-chip-row";
      if (backLabel) {
        const back = document.createElement("button");
        back.type = "button";
        back.className = "era-chip era-back";
        back.textContent = backLabel;
        back.addEventListener("click", onBack);
        wrap.appendChild(back);
      }
      items.forEach((item) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "era-chip";
        chip.textContent = item.label || item.q;
        chip.addEventListener("click", () => onPick(item));
        wrap.appendChild(chip);
      });
      return wrap;
    }

    let browserBlock = null;
    function clearBrowser() {
      if (browserBlock) { browserBlock.remove(); browserBlock = null; }
    }
    function showCategories() {
      clearBrowser();
      browserBlock = renderChipRow(CATEGORIES, (cat) => showQuestions(cat), null, null);
      body.appendChild(browserBlock);
      body.scrollTop = body.scrollHeight;
    }
    function showQuestions(cat) {
      clearBrowser();
      browserBlock = renderChipRow(cat.questions, (q) => askQuestion(q), "← Back to topics", showCategories);
      body.appendChild(browserBlock);
      body.scrollTop = body.scrollHeight;
    }

    // ---- Talk to our team — the ONLY thing that unlocks real chat ----
    talkTeamBtn.addEventListener("click", function () {
      if (chatUnlocked) { input.focus(); return; }
      chatUnlocked = true;
      form.classList.add("unlocked");
      talkTeamBtn.textContent = "💬 Chatting with our team below";
      talkTeamBtn.disabled = true;
      addMessage("Type your question below and a real person on our team will reply to you right here.", "bot");
      startPolling();
      setTimeout(() => input.focus(), 150);
    });

    // ===== Persistent "waiting for a reply" bubble =====
    let waitingEl = null;
    let waitingForReply = false;
    function showWaitingBubble() {
      if (waitingEl) return;
      waitingForReply = true;
      waitingEl = document.createElement("div");
      waitingEl.className = "era-msg typing";
      waitingEl.innerHTML = '<span class="era-dot"></span><span class="era-dot"></span><span class="era-dot"></span>';
      body.appendChild(waitingEl);
      body.scrollTop = body.scrollHeight;
      updatePollFrequency();
    }
    function hideWaitingBubble() {
      waitingForReply = false;
      if (waitingEl) { waitingEl.remove(); waitingEl = null; }
    }

    function noteStatusChange(nextStatus) {
      if (nextStatus === currentStatus) return;
      if (nextStatus === "human" || nextStatus === "paused") {
        addMessage("Thanks — that's been sent to our team. They'll reply to you right here.", "bot");
      } else if (nextStatus === "ai" && (currentStatus === "human" || currentStatus === "paused")) {
        hideWaitingBubble();
        addMessage("Our assistant will help you from here — feel free to keep asking.", "bot");
      }
      currentStatus = nextStatus;
    }

    function getDesiredPollInterval() {
      if (waitingForReply) return FAST_POLL_INTERVAL;
      const timeSinceMessage = Date.now() - lastMessageTime;
      return timeSinceMessage < FAST_POLL_DURATION ? FAST_POLL_INTERVAL : SLOW_POLL_INTERVAL;
    }

    function updatePollFrequency() {
      const currentInterval = pollTimer ? (pollTimer._interval || SLOW_POLL_INTERVAL) : SLOW_POLL_INTERVAL;
      const desiredInterval = getDesiredPollInterval();
      if (currentInterval !== desiredInterval) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(poll, desiredInterval);
        pollTimer._interval = desiredInterval;
      }
    }

    function startPolling() {
      if (!chatUnlocked) return; // never poll (or hit the network at all) until the visitor has opted in
      if (pollTimer) return;
      const interval = getDesiredPollInterval();
      pollTimer = setInterval(() => {
        updatePollFrequency();
        poll();
      }, interval);
      pollTimer._interval = interval;
      poll();
    }

    function stopPolling() {
      if (!pollTimer) return;
      clearInterval(pollTimer);
      pollTimer = null;
    }

    function poll() {
      fetch(`${API_BASE}/api/era/poll?site=${encodeURIComponent(SITE_ID)}&sessionId=${encodeURIComponent(sessionId)}&since=${lastPollTs}`)
        .then((r) => r.json())
        .then((data) => {
          if (!data || !data.ok) return;
          if (Array.isArray(data.messages) && data.messages.length) {
            hideWaitingBubble();
            for (const m of data.messages) {
              addMessage(m.text, "bot");
              if (m.ts > lastPollTs) lastPollTs = m.ts;
            }
            updatePollFrequency();
          }
          if (data.status) noteStatusChange(data.status);
        })
        .catch(() => {});
    }

    function openPanel() {
      panel.classList.add("open");
      opened = true;
      if (!body.childElementCount) {
        addMessage(GREETING, "bot");
        showCategories();
      }
      if (chatUnlocked) startPolling();
    }

    function closePanel() {
      panel.classList.remove("open");
      stopPolling();
    }

    bubble.addEventListener("click", () => {
      if (panel.classList.contains("open")) closePanel();
      else openPanel();
    });
    closeBtn.addEventListener("click", closePanel);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!chatUnlocked) return; // the form is invisible until unlocked, but guard anyway
      const text = input.value.trim();
      if (!text) return;
      addMessage(text, "user");
      input.value = "";

      // A typed question that matches something in the FAQ still gets
      // answered instantly and locally — no need to wait on the team
      // for something already covered here.
      const faqMatch = matchFaq(text);
      if (faqMatch) {
        addFaqAnswer(faqMatch);
        return;
      }

      send.disabled = true;
      lastMessageTime = Date.now();
      updatePollFrequency();
      showWaitingBubble();
      const sentAt = Date.now();

      fetch(`${API_BASE}/api/era/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site: SITE_ID, sessionId, message: text }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (!data || data.ok === false) {
            hideWaitingBubble();
            addMessage("Sorry, I couldn't reach the team's system just now — please try again in a moment.", "bot");
            return;
          }
          if (data.reply) {
            hideWaitingBubble();
            addMessage(data.reply, "bot");
          }
          if (sentAt > lastPollTs) lastPollTs = sentAt;
          if (data.status) noteStatusChange(data.status);
        })
        .catch(() => {
          hideWaitingBubble();
          addMessage("I'm having trouble connecting right now — please try again in a moment.", "bot");
        })
        .finally(() => {
          send.disabled = false;
        });
    });
  }
})();
