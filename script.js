/* ============================================================
   Ember & Oak — AI Cigar Assistant
   Vanilla JS chat widget: open/close, flow engine,
   quick replies, recommendation cards, and mic (Web Speech API).
   ============================================================ */

(function () {
  "use strict";

  /* ---------- DOM refs ---------- */
  const fab = document.getElementById("chatFab");
  const fabBadge = document.getElementById("fabBadge");
  const widget = document.getElementById("chatWidget");
  const scrim = document.getElementById("chatScrim");
  const closeBtn = document.getElementById("chatClose");
  const newBtn = document.getElementById("chatNew");
  const heroBtn = document.getElementById("heroChatBtn");
  const messagesEl = document.getElementById("chatMessages");
  const quickEl = document.getElementById("quickReplies");
  const form = document.getElementById("chatComposer");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const micBtn = document.getElementById("micBtn");

  /* ---------- State ---------- */
  let started = false; // greeting shown?
  let currentStep = null; // active flow step id
  let lastRecommended = null; // most recent recommended cigar
  const prefs = {}; // collected cigar preferences

  /* ---------- Conversation persistence (sessionStorage) ----------
     Keeps the transcript across page navigation (e.g. into checkout)
     so re-opening the bot resumes instead of restarting the greeting. */
  const SESSION_KEY = "emberChatSession";
  let transcript = []; // [{kind:'msg',who,text} | {kind:'card',cigar}]
  let currentReplies = []; // active quick replies (serializable)
  let restoring = false; // suppress persistence while rebuilding

  function persist() {
    if (restoring) return;
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          transcript: transcript,
          currentReplies: currentReplies,
          started: started,
          currentStep: currentStep,
          lastRecommended: lastRecommended,
          prefs: prefs,
        })
      );
    } catch (_) {}
  }

  /* ============================================================
     Cigar catalog + recommendation logic
     ============================================================ */
  const CIGARS = [
    {
      name: "Sun-Grown Robusto",
      origin: "Nicaragua · Estelí",
      emoji: "🌿",
      strength: "mild",
      flavors: ["creamy", "sweet"],
      desc: "Smooth and approachable with notes of cedar, almond and a touch of honey. A gentle, forgiving smoke.",
      tags: ["Mild", "Creamy", "45 min"],
      price: "$12",
      budget: "value",
    },
    {
      name: "Cameroon Corona",
      origin: "Dominican Republic",
      emoji: "🍂",
      strength: "medium",
      flavors: ["spicy", "earthy"],
      desc: "Balanced and aromatic — black pepper, toasted bread and a cocoa finish. The everyday classic.",
      tags: ["Medium", "Peppery", "50 min"],
      price: "$18",
      budget: "mid",
    },
    {
      name: "Maduro Toro Reserva",
      origin: "Nicaragua · Jalapa",
      emoji: "🔥",
      strength: "full",
      flavors: ["earthy", "sweet"],
      desc: "Bold and decadent. Dark chocolate, espresso and a leathery sweetness from an oily maduro wrapper.",
      tags: ["Full-Bodied", "Rich", "70 min"],
      price: "$24",
      budget: "premium",
    },
    {
      name: "Connecticut Churchill",
      origin: "Honduras",
      emoji: "🥃",
      strength: "medium",
      flavors: ["creamy", "spicy"],
      desc: "Refined and silky with butter, white pepper and a clean cedar finish. Pairs beautifully with whiskey.",
      tags: ["Medium", "Smooth", "65 min"],
      price: "$20",
      budget: "premium",
    },
    {
      name: "Habano Petit Corona",
      origin: "Nicaragua",
      emoji: "🌰",
      strength: "mild",
      flavors: ["earthy", "spicy"],
      desc: "A quick, satisfying smoke. Roasted nuts, light spice and a smooth draw — perfect for a short break.",
      tags: ["Mild-Med", "Nutty", "30 min"],
      price: "$10",
      budget: "value",
    },
  ];

  function pickCigar() {
    let best = CIGARS[0];
    let bestScore = -1;
    for (const c of CIGARS) {
      let score = 0;
      if (prefs.strength && c.strength === prefs.strength) score += 3;
      if (prefs.flavor && c.flavors.includes(prefs.flavor)) score += 2;
      if (prefs.budget && c.budget === prefs.budget) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /* ============================================================
     Conversation flow engine
     Each step: bot prompt(s) + optional quick replies.
     Quick reply -> { label, value, next, set:{key} }
     ============================================================ */
  const FLOW = {
    greeting: {
      messages: [
        "Welcome to Ember & Oak. 🥃",
        "I'm your AI cigar assistant. Ask me anything in your own words — or tap a suggestion below to get started.",
      ],
      replies: [
        { label: "🔎 Find me a great cigar", next: "strength" },
        { label: "🎁 Shop a gift", next: "gift" },
        { label: "🕐 Store hours", next: "hours" },
      ],
    },

    strength: {
      messages: [
        "Wonderful — let's find your perfect smoke.\n\nFirst, how bold do you like it?",
      ],
      replies: [
        {
          label: "Mild & easy",
          set: ["strength", "mild"],
          next: "flavor",
          ack: "Nice — mild is easy to enjoy.",
        },
        {
          label: "Medium",
          set: ["strength", "medium"],
          next: "flavor",
          ack: "Balanced — good call.",
        },
        {
          label: "Full & bold",
          set: ["strength", "full"],
          next: "flavor",
          ack: "Bold — you'll get plenty of character.",
        },
        {
          label: "Not sure 🤷",
          set: ["strength", "medium"],
          next: "flavor",
          ack: "No problem — we'll start with a balanced medium strength.",
        },
      ],
    },

    flavor: {
      messages: ["Which flavor profile speaks to you?"],
      replies: [
        { label: "🍫 Rich & earthy", set: ["flavor", "earthy"], next: "budget" },
        { label: "🥛 Creamy & smooth", set: ["flavor", "creamy"], next: "budget" },
        { label: "🌶️ Spicy & peppery", set: ["flavor", "spicy"], next: "budget" },
        { label: "🍯 Sweet", set: ["flavor", "sweet"], next: "budget" },
      ],
    },

    budget: {
      messages: ["Last question — what's your budget per stick?"],
      replies: [
        { label: "Under $12", set: ["budget", "value"], next: "recommend" },
        { label: "$12 – $20", set: ["budget", "mid"], next: "recommend" },
        { label: "Premium ($20+)", set: ["budget", "premium"], next: "recommend" },
      ],
    },

    recommend: {
      // handled specially (renders a card)
      special: "recommend",
    },

    addedToCart: {
      messages: ["Excellent taste. 🎉 I've added it to your humidor cart.", "Anything else I can help with?"],
      replies: [
        { label: "🔄 Find another", next: "strength", reset: true },
        { label: "💳 Checkout", next: "checkout" },
        { label: "👍 I'm all set", next: "done" },
      ],
    },

    checkout: {
      messages: [
        "Perfect. Your picks are saved. 🛒\n\nTap below and I'll take you to our secure checkout.",
      ],
      replies: [{ label: "🔒 Proceed to secure checkout", url: "checkout.html" }],
    },

    gift: {
      messages: [
        "A cigar makes a memorable gift. 🎁\n\nWe offer curated gift sets with a hand-written note. Want me to recommend one based on the recipient?",
      ],
      replies: [
        { label: "Yes, recommend a set", next: "strength" },
      ],
    },

    hours: {
      messages: [
        "Our lounge & humidor are open:\n\n🕐 Mon–Thu · 11am – 10pm\n🕐 Fri–Sat · 11am – 1am\n🕐 Sun · 12pm – 8pm\n\n📍 142 Oak Street, Downtown",
      ],
      replies: [
        { label: "🔎 Find me a cigar", next: "strength" },
      ],
    },

    done: {
      messages: ["Enjoy, and smoke slowly. 🥃 I'm here whenever you need me."],
      replies: [{ label: "🔎 Find a cigar", next: "strength" }],
    },
  };

  /* ============================================================
     Rendering helpers
     ============================================================ */
  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function addMessage(text, who, record) {
    const row = document.createElement("div");
    row.className = "msg-row " + (who === "user" ? "user" : "bot");

    if (who === "bot") {
      const avatar = document.createElement("div");
      avatar.className = "msg-avatar";
      avatar.textContent = "✦";
      row.appendChild(avatar);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    row.appendChild(bubble);

    messagesEl.appendChild(row);
    scrollToBottom();

    if (record !== false) {
      transcript.push({ kind: "msg", who: who, text: text });
      persist();
    }
  }

  function showTyping() {
    const row = document.createElement("div");
    row.className = "msg-row bot typing";
    row.id = "typingRow";
    row.innerHTML =
      '<div class="msg-avatar">✦</div><div class="bubble">' +
      '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>' +
      "</div>";
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  function hideTyping() {
    const t = document.getElementById("typingRow");
    if (t) t.remove();
  }

  function clearQuickReplies() {
    quickEl.innerHTML = "";
    currentReplies = [];
    persist();
  }

  function renderQuickReplies(replies) {
    clearQuickReplies();
    if (!replies) return;
    replies.forEach((r, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "qr-chip";
      chip.textContent = r.label;
      chip.style.animationDelay = i * 0.04 + "s";
      chip.addEventListener("click", () => handleReply(r));
      quickEl.appendChild(chip);
    });
    currentReplies = replies;
    persist();
    // Chips bar shrinks the message area, so re-pin to the latest message.
    scrollToBottom();
  }

  function renderCigarCard(c, record) {
    const card = document.createElement("div");
    card.className = "cigar-card";
    card.innerHTML =
      '<div class="cigar-card__top">' +
      '<div class="cigar-card__emoji">' + c.emoji + "</div>" +
      "<div>" +
      '<p class="cigar-card__name">' + c.name + "</p>" +
      '<p class="cigar-card__origin">' + c.origin + "</p>" +
      "</div></div>" +
      '<p class="cigar-card__desc">' + c.desc + "</p>" +
      '<div class="cigar-card__meta">' +
      c.tags.map((t) => '<span class="tag">' + t + "</span>").join("") +
      "</div>" +
      '<div class="cigar-card__foot">' +
      '<span class="cigar-card__price">' + c.price + "</span>" +
      "</div>";
    messagesEl.appendChild(card);
    scrollToBottom();

    if (record !== false) {
      transcript.push({ kind: "card", cigar: c });
      persist();
    }
  }

  // Rebuild a saved conversation from sessionStorage (no typing animation).
  function restoreSession() {
    let data = null;
    try {
      data = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    } catch (_) {}
    if (!data || !Array.isArray(data.transcript) || !data.transcript.length) {
      return false;
    }

    restoring = true;
    data.transcript.forEach((item) => {
      if (item.kind === "msg") addMessage(item.text, item.who, false);
      else if (item.kind === "card") renderCigarCard(item.cigar, false);
    });

    started = !!data.started;
    currentStep = data.currentStep || null;
    lastRecommended = data.lastRecommended || null;
    Object.assign(prefs, data.prefs || {});
    transcript = data.transcript;

    if (Array.isArray(data.currentReplies) && data.currentReplies.length) {
      renderQuickReplies(data.currentReplies);
    }
    currentReplies = data.currentReplies || [];

    restoring = false;
    scrollToBottom();
    return true;
  }

  // Wipe the conversation (DOM + state + storage) for a clean slate.
  function clearConversation() {
    transcript = [];
    currentReplies = [];
    lastRecommended = null;
    currentStep = null;
    started = false;
    delete prefs.strength;
    delete prefs.flavor;
    delete prefs.budget;
    messagesEl.innerHTML = "";
    quickEl.innerHTML = "";
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  // "New chat" button — start over with a fresh greeting.
  function newChat() {
    haptic(8);
    clearConversation();
    started = true;
    runStep("greeting");
  }

  // Forget a finished conversation so the next visit starts fresh.
  function endSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  /* ============================================================
     Flow execution
     ============================================================ */
  // Play a step's messages sequentially with typing indicators
  async function runStep(stepId) {
    const step = FLOW[stepId];
    if (!step) return;
    currentStep = stepId;
    clearQuickReplies();

    if (step.special === "recommend") {
      await runRecommend();
      return;
    }

    for (const msg of step.messages) {
      showTyping();
      await delay(650 + Math.min(msg.length * 12, 900));
      hideTyping();
      addMessage(msg, "bot");
      await delay(180);
    }
    renderQuickReplies(step.replies);

    // The conversation has reached its natural end — don't resurface it later.
    if (stepId === "done") endSession();
  }

  async function runRecommend() {
    showTyping();
    await delay(900);
    hideTyping();

    // Justify the pick by reflecting the user's stated preferences.
    const traits = [PREF_WORDS[prefs.strength], PREF_WORDS[prefs.flavor]].filter(
      Boolean
    );
    const intro = traits.length
      ? "For a " + listToText(traits) + " smoke, here's the one I'd reach for:"
      : "Based on your taste, here's the one I'd reach for:";
    addMessage(intro, "bot");
    await delay(300);

    const cigar = pickCigar();
    lastRecommended = cigar;
    renderCigarCard(cigar);

    // Be transparent if we couldn't meet a stated constraint.
    if (prefs.budget && cigar.budget !== prefs.budget) {
      await delay(250);
      addMessage(
        "Heads up — I didn't have an exact match in that budget, so this is the closest fit. Just say “cheaper” and I'll prioritize price.",
        "bot"
      );
    }

    await delay(250);
    renderQuickReplies([
      { label: "🛒 Add to cart", next: "addedToCart", cart: true },
      { label: "🔄 Show another", next: "strength", reset: true },
    ]);
    currentStep = "recommend";
  }

  async function handleReply(reply) {
    haptic(8);
    // Echo the user's choice as a message
    addMessage(reply.label, "user");
    clearQuickReplies();

    if (reply.set) {
      prefs[reply.set[0]] = reply.set[1];
    }
    if (reply.reset) {
      delete prefs.strength;
      delete prefs.flavor;
      delete prefs.budget;
    }
    if (reply.cart && lastRecommended) {
      saveCart(lastRecommended);
    }
    if (reply.url) {
      // Hand off to a real page (e.g. secure checkout)
      window.location.href = reply.url;
      return;
    }
    if (reply.ack) {
      showTyping();
      await delay(450 + Math.min(reply.ack.length * 9, 800));
      hideTyping();
      addMessage(reply.ack, "bot");
      await delay(180);
    }
    if (reply.next) {
      runStep(reply.next);
    }
  }

  function saveCart(cigar) {
    try {
      localStorage.setItem("emberCart", JSON.stringify(cigar));
    } catch (_) {
      /* storage may be unavailable */
    }
  }

  /* ---------- Free-text "AI" knowledge base ----------
     Mock responses so any typed/spoken question gets a sensible answer,
     simulating a real AI-powered assistant. */
  const KNOWLEDGE = [
    {
      test: /(pair|pairing|drink|whisk|whiskey|rum|coffee|wine|bourbon|scotch)/,
      answer:
        "Great question. A few pairings I love:\n\n🥃 Full-bodied maduros → bourbon or aged rum\n☕ Medium cigars → espresso or a porter\n🍷 Milder smokes → tawny port or a light scotch\n\nWant me to match a cigar to your drink?",
      replies: [{ label: "🔎 Find me a great cigar", next: "strength" }],
    },
    {
      test: /(beginner|first|new|start|never smoked|mild)/,
      answer:
        "Perfect place to start. 🌿 For a first cigar I'd suggest something mild and smooth — easy on the palate, slow-burning, and forgiving. Our Sun-Grown Robusto or Connecticut Churchill are crowd favorites for newcomers.",
      replies: [{ label: "🔎 Find me a beginner cigar", next: "strength" }],
    },
    {
      test: /(light|lighter|cut|cutter|how do i|how to)/,
      answer:
        "Two quick tips:\n\n✂️ Cut just above the cap's shoulder — take off too little, not too much.\n🔥 Toast the foot with a soft flame (cedar spill or butane), rotating until evenly lit, then puff gently.\n\nWe carry cutters and lighters too if you need gear.",
      replies: [{ label: "🔎 Recommend a cigar", next: "strength" }],
    },
    {
      test: /(store|storage|humidor|keep|fresh|humidity)/,
      answer:
        "Store cigars at roughly 70% humidity and 70°F — the classic “70/70” rule. A humidor with a quality hygrometer keeps them fresh for months (even years). Avoid the fridge; it dries them out.",
      replies: [{ label: "🔎 Find me a cigar", next: "strength" }],
    },
    {
      test: /(popular|best seller|bestseller|top|favorite|favourite|trending)/,
      answer:
        "Our most-loved right now is the Maduro Toro Reserva — rich dark chocolate and espresso notes. The Cameroon Corona is a close second as the everyday classic.",
      replies: [{ label: "🛒 Browse recommendations", next: "strength" }],
    },
    {
      test: /(price|cost|how much|cheap|expensive|budget|ship|shipping|deliver)/,
      answer:
        "Singles run from $10 to $24 a stick, and we ship to most states in 2–4 business days with discreet packaging. Tell me your budget and I'll find the best value for your taste.",
      replies: [{ label: "🔎 Find me a great cigar", next: "strength" }],
    },
    {
      test: /(hello|hi|hey|good (morning|evening|afternoon))/,
      answer: "Hey there! 👋 What can I help you find tonight?",
      replies: [
        { label: "🔎 Find me a great cigar", next: "strength" },
        { label: "🎁 Shop a gift", next: "gift" },
      ],
    },
  ];

  /* ============================================================
     Conversational NLU — users drive the whole flow by talking,
     not just by tapping buttons. Buttons remain as a convenience.
     ============================================================ */
  const SLOT_ORDER = ["strength", "flavor", "budget"];
  const SLOT_PROMPT = {
    strength: "How bold do you like it — mild, medium, or full?",
    flavor:
      "Which flavor speaks to you — rich & earthy, creamy & smooth, spicy, or sweet?",
    budget: "And your budget per stick — under $12, $12–$20, or premium ($20+)?",
  };
  const PREF_WORDS = {
    mild: "mild",
    medium: "medium",
    full: "full-bodied",
    earthy: "rich & earthy",
    creamy: "creamy & smooth",
    spicy: "spicy",
    sweet: "sweet",
    value: "budget-friendly",
    mid: "mid-range",
    premium: "premium",
  };

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function listToText(arr) {
    if (arr.length <= 1) return arr.join("");
    return arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
  }

  // Bot turn helper: typing indicator → message → optional quick replies.
  async function botSay(text, replies) {
    showTyping();
    await delay(450 + Math.min(text.length * 9, 800));
    hideTyping();
    addMessage(text, "bot");
    if (replies) {
      await delay(120);
      renderQuickReplies(replies);
    }
  }

  // Extract any cigar preferences mentioned in free text.
  function parsePrefs(t) {
    const found = {};

    if (/\b(mild(er)?|light(er)?|mellow(er)?|gentle|weaker|less strong)\b/.test(t))
      found.strength = "mild";
    else if (/\b(medium|balanced|moderate)\b/.test(t)) found.strength = "medium";
    else if (
      /\b(full(er)?|full[- ]?bodied|bold(er)?|strong(er)?|powerful|heavy|robust|stronger)\b/.test(t)
    )
      found.strength = "full";

    if (/\b(earthy|earthier|woody|leather|leathery|cocoa|chocolate|coffee|espresso|dark(er)?|rich(er)?)\b/.test(t))
      found.flavor = "earthy";
    else if (/\b(creamy|creamier|cream|nutty|cedar|buttery|silky|smooth(er)?)\b/.test(t))
      found.flavor = "creamy";
    else if (/\b(spicy|spicier|spice|peppery|pepper)\b/.test(t))
      found.flavor = "spicy";
    else if (/\b(sweet(er)?|honey|sugary|dessert)\b/.test(t))
      found.flavor = "sweet";

    if (/\b(cheap|cheaper|value|affordable|inexpensive|low[- ]?cost)\b/.test(t))
      found.budget = "value";
    else if (/\b(premium|expensive|high[- ]?end|splurge|top[- ]?shelf|luxury|fancy)\b/.test(t))
      found.budget = "premium";
    else if (/\b(mid|mid[- ]?range)\b/.test(t)) found.budget = "mid";

    // Numeric price, but only with a money cue (avoids matching ages, etc.)
    if (!found.budget && /\$|\b(budget|spend|under|below|less than|around|about|up to|per stick|a stick)\b/.test(t)) {
      const m = t.match(/(\d{1,3})/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n < 12) found.budget = "value";
        else if (n <= 20) found.budget = "mid";
        else found.budget = "premium";
      }
    }
    return found;
  }

  // Global navigation commands, usable at any point.
  function detectCommand(t) {
    if (/\b(start over|restart|reset|begin again|from scratch|new search|do over)\b/.test(t))
      return "restart";
    if (/\b(go back|back up|previous|undo|step back)\b/.test(t)) return "back";
    if (/\b(menu|main menu|home|go home)\b/.test(t)) return "menu";
    if (/\b(help|what can you do|commands|how does this work)\b/.test(t))
      return "help";
    if (/\b(agent|human|real person|representative|talk to someone|speak to someone|call you)\b/.test(t))
      return "human";
    return null;
  }

  function slotMentioned(t) {
    if (/\b(strength|bold|mild|medium|full|strong)\b/.test(t)) return "strength";
    if (/\b(flavou?r|taste|profile|earthy|creamy|spicy|sweet)\b/.test(t))
      return "flavor";
    if (/\b(budget|price|cost|spend|cheap|premium|dollar)\b/.test(t) || /\$/.test(t))
      return "budget";
    return null;
  }

  function resetFinder() {
    delete prefs.strength;
    delete prefs.flavor;
    delete prefs.budget;
    persist();
  }

  // Ask for a specific slot (with optional lead-in); buttons stay available.
  function askSlot(slot, lead) {
    currentStep = slot;
    const prompt = (lead ? lead + " " : "") + SLOT_PROMPT[slot];
    botSay(prompt, FLOW[slot].replies);
  }

  // Move to the next unanswered slot, or recommend once all are filled.
  function advanceFinder(lead) {
    const missing = SLOT_ORDER.find((s) => !prefs[s]);
    if (missing) askSlot(missing, lead);
    else runStep("recommend");
  }

  // Apply parsed preferences, acknowledge naturally, then continue.
  function applyPrefs(found) {
    let changed = false;
    Object.keys(found).forEach((k) => {
      if (prefs[k] && prefs[k] !== found[k]) changed = true;
      prefs[k] = found[k];
    });
    persist();

    const captured = Object.keys(found).map((k) => PREF_WORDS[found[k]]);
    const lead = changed
      ? "Got it — updated to " + listToText(captured) + "."
      : pick(["Great choice.", "Perfect.", "Love it.", "Noted."]);

    const missing = SLOT_ORDER.find((s) => !prefs[s]);
    if (!missing) {
      botSay(lead).then(() => runStep("recommend"));
    } else {
      askSlot(missing, lead);
    }
  }

  // "Go back" — clear the most recently answered slot and re-ask it.
  function goBackFinder() {
    const filled = SLOT_ORDER.filter((s) => prefs[s]);
    if (!filled.length) {
      botSay("We're right at the start — what can I help you find?", FLOW.greeting.replies);
      return;
    }
    const last = filled[filled.length - 1];
    delete prefs[last];
    persist();
    askSlot(last, "No problem — let's redo that.");
  }

  // Free-text handling: full conversational control (talk, don't just tap).
  function handleFreeText(text) {
    addMessage(text, "user");
    input.value = "";
    updateSendState();
    clearQuickReplies();

    const t = text.toLowerCase();

    // 1) Global navigation commands (work anytime)
    const cmd = detectCommand(t);
    if (cmd === "restart") {
      resetFinder();
      askSlot("strength", "Sure — starting fresh.");
      return;
    }
    if (cmd === "back") {
      goBackFinder();
      return;
    }
    if (cmd === "menu") {
      botSay("Sure — here's what I can help with:", FLOW.greeting.replies);
      return;
    }
    if (cmd === "help") {
      botSay(
        "You can just talk to me naturally. Try things like:\n\n• “Find me a bold, earthy cigar under $20”\n• “Actually, make it milder”\n• “Go back” or “start over”\n• “What pairs with whiskey?”\n\nOr tap a suggestion below.",
        FLOW.greeting.replies
      );
      return;
    }
    if (cmd === "human") {
      botSay(
        "Happy to connect you. 📞 Reach our team at (555) 012-3456 or visit us at 142 Oak Street. I can keep helping here in the meantime.",
        FLOW.greeting.replies
      );
      return;
    }

    // 2) Fixed intents
    if (/(hour|open|close|location|address|where are you)/.test(t)) {
      runStep("hours");
      return;
    }
    if (/(gift|present|birthday|anniversary)/.test(t)) {
      runStep("gift");
      return;
    }
    if (/(thank|bye|see ya|that's all|i'm good|im good|all set|that's it)/.test(t)) {
      runStep("done");
      return;
    }

    // 3) Conversational finder — set or change any preference by talking
    const found = parsePrefs(t);
    if (Object.keys(found).length) {
      applyPrefs(found);
      return;
    }

    // 3b) "Change my <slot>" with no concrete value yet
    if (/\b(change|different|switch|redo|edit|another)\b/.test(t)) {
      const slot = slotMentioned(t);
      if (slot) {
        delete prefs[slot];
        persist();
        askSlot(slot, "Sure —");
        return;
      }
    }

    // 4) Knowledge-base questions (simulated AI answer)
    const hit = KNOWLEDGE.find((k) => k.test.test(t));
    if (hit) {
      botSay(hit.answer, hit.replies);
      return;
    }

    // 5) Find intent — kick off the finder, asking the first missing slot
    if (/(find|recommend|suggest|cigar|smoke|stick|looking for|want|need|browse)/.test(t)) {
      advanceFinder("Let's find your perfect smoke.");
      return;
    }

    // 6) Fallback — no blame, remind them they can talk freely
    botSay(
      "I didn't quite catch that — but you can talk to me normally. I can find a cigar (e.g. “something mild and sweet under $15”), suggest pairings, or share store info. What would you like?",
      FLOW.greeting.replies
    );
  }

  function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  /* ============================================================
     Mobile helpers: haptics, keyboard tracking, scroll lock
     ============================================================ */
  const isMobile = () => window.matchMedia("(max-width: 600px)").matches;

  function haptic(pattern) {
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (_) {}
    }
  }

  // Glue the widget to the *visual* viewport. On iOS the keyboard doesn't
  // resize the layout viewport — it shrinks/scrolls the visual viewport — so a
  // plain position:fixed sheet ends up anchored above the visible area. We
  // mirror visualViewport's rect (offset + size) onto the widget instead.
  let vpRaf = 0;

  function applyViewport() {
    if (!isMobile()) {
      widget.classList.remove("kb-open");
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    const layoutHeight =
      window.innerHeight || document.documentElement.clientHeight;

    widget.style.setProperty("--app-top", (vv.offsetTop || 0) + "px");
    widget.style.setProperty("--app-left", (vv.offsetLeft || 0) + "px");
    widget.style.setProperty("--app-w", (vv.width || window.innerWidth) + "px");
    widget.style.setProperty("--app-h", vv.height + "px");

    // Keyboard is up when the visible area is meaningfully shorter than layout
    // and the focus is inside the chat — float the composer in that case.
    const keyboardOpen =
      widget.contains(document.activeElement) && layoutHeight - vv.height > 120;
    widget.classList.toggle("kb-open", keyboardOpen);
  }

  function syncViewportHeight() {
    applyViewport();
    scrollToBottom();
  }

  // iOS emits viewport events erratically during the keyboard animation, so we
  // also poll on requestAnimationFrame while the field is focused.
  function viewportLoop() {
    applyViewport();
    vpRaf = requestAnimationFrame(viewportLoop);
  }
  function startViewportLoop() {
    if (vpRaf) return;
    vpRaf = requestAnimationFrame(viewportLoop);
  }
  function stopViewportLoop() {
    if (!vpRaf) return;
    cancelAnimationFrame(vpRaf);
    vpRaf = 0;
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewportHeight);
    window.visualViewport.addEventListener("scroll", syncViewportHeight);
  }
  window.addEventListener("resize", syncViewportHeight);

  // Lock background scroll without losing position (robust on iOS Safari).
  // Only on mobile — the desktop floating card shouldn't shift the page.
  let savedScrollY = 0;
  let scrollLocked = false;
  function lockScroll() {
    if (!isMobile() || scrollLocked) return;
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = -savedScrollY + "px";
    document.body.classList.add("chat-locked");
    scrollLocked = true;
  }
  function unlockScroll() {
    if (!scrollLocked) return;
    document.body.classList.remove("chat-locked");
    document.body.style.top = "";
    window.scrollTo(0, savedScrollY);
    scrollLocked = false;
  }

  /* ============================================================
     Open / close widget
     ============================================================ */
  function openChat() {
    widget.classList.add("is-open");
    widget.setAttribute("aria-hidden", "false");
    fab.setAttribute("aria-expanded", "true");
    document.body.classList.add("chat-open");
    lockScroll();
    syncViewportHeight();
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add("is-visible"));
    fabBadge.hidden = true;
    haptic(10);

    if (!started) {
      started = true;
      runStep("greeting");
    }
    // focus input shortly after the open animation on desktop only
    // (on mobile we avoid auto-popping the keyboard)
    if (window.matchMedia("(min-width: 601px)").matches) {
      setTimeout(() => input.focus(), 320);
    }
  }

  function closeChat() {
    widget.classList.remove("is-open");
    widget.setAttribute("aria-hidden", "true");
    fab.setAttribute("aria-expanded", "false");
    document.body.classList.remove("chat-open");
    unlockScroll();
    stopViewportLoop();
    widget.classList.remove("kb-open");
    widget.style.removeProperty("--app-h");
    widget.style.removeProperty("--app-w");
    widget.style.removeProperty("--app-top");
    widget.style.removeProperty("--app-left");
    scrim.classList.remove("is-visible");
    setTimeout(() => {
      scrim.hidden = true;
    }, 260);
    stopListening();
    fab.focus();
  }

  fab.addEventListener("click", openChat);
  if (heroBtn) {
    heroBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openChat();
    });
  }
  closeBtn.addEventListener("click", closeChat);
  if (newBtn) newBtn.addEventListener("click", newChat);
  scrim.addEventListener("click", closeChat);

  // Escape to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && widget.classList.contains("is-open")) {
      closeChat();
    }
  });

  /* ---------- Focus trap (keep Tab within the open dialog) ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !widget.classList.contains("is-open")) return;
    const focusables = widget.querySelectorAll(
      'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.prototype.filter.call(
      focusables,
      (el) => !el.disabled && el.offsetParent !== null
    );
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /* ---------- Swipe-to-dismiss (mobile bottom sheet) ---------- */
  const dragHandle = document.createElement("div");
  dragHandle.className = "chat-drag-handle";
  dragHandle.setAttribute("aria-hidden", "true");
  widget.insertBefore(dragHandle, widget.firstChild);

  let dragStartY = 0;
  let dragDelta = 0;
  let dragging = false;

  function onDragStart(e) {
    if (!isMobile()) return;
    dragging = true;
    dragDelta = 0;
    dragStartY = e.touches ? e.touches[0].clientY : e.clientY;
    widget.classList.add("is-dragging");
  }
  function onDragMove(e) {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    dragDelta = Math.max(0, y - dragStartY); // only downward
    widget.style.transform = "translateY(" + dragDelta + "px)";
  }
  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    widget.classList.remove("is-dragging");
    widget.style.transform = "";
    if (dragDelta > 110) {
      haptic(15);
      closeChat();
    }
  }
  dragHandle.addEventListener("touchstart", onDragStart, { passive: true });
  dragHandle.addEventListener("touchmove", onDragMove, { passive: true });
  dragHandle.addEventListener("touchend", onDragEnd);

  /* ============================================================
     Composer (free text)
     ============================================================ */
  function updateSendState() {
    sendBtn.disabled = input.value.trim().length === 0;
  }
  input.addEventListener("input", updateSendState);
  input.addEventListener("focus", () => {
    startViewportLoop();
    syncViewportHeight();
  });
  input.addEventListener("blur", () => {
    // Let the keyboard finish sliding away, then settle and stop polling.
    setTimeout(() => {
      stopViewportLoop();
      syncViewportHeight();
    }, 350);
  });
  updateSendState();

  // Resume any in-progress conversation saved from a previous page.
  restoreSession();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    haptic(8);
    handleFreeText(text);
  });

  /* ============================================================
     Microphone — Web Speech API (with graceful fallback)
     ============================================================ */
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.addEventListener("result", (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      input.value = transcript;
      updateSendState();
    });

    recognition.addEventListener("end", () => {
      stopListening();
      // auto-send if we captured something
      const text = input.value.trim();
      if (text) {
        handleFreeText(text);
      }
    });

    recognition.addEventListener("error", () => {
      stopListening();
    });
  } else {
    // No support: hide mic to avoid a dead button
    micBtn.hidden = true;
  }

  function startListening() {
    if (!recognition || listening) return;
    try {
      recognition.start();
      listening = true;
      micBtn.classList.add("is-listening");
      micBtn.setAttribute("aria-label", "Stop microphone");
      input.placeholder = "Listening…";
    } catch (_) {
      /* start() can throw if called twice quickly */
    }
  }

  function stopListening() {
    if (!recognition) return;
    listening = false;
    micBtn.classList.remove("is-listening");
    micBtn.setAttribute("aria-label", "Use microphone");
    input.placeholder = "Type a message…";
    try {
      recognition.stop();
    } catch (_) {}
  }

  micBtn.addEventListener("click", () => {
    if (listening) stopListening();
    else startListening();
  });
})();
