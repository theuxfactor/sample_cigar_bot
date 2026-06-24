/* ============================================================
   Ember & Oak — Sample checkout page logic
   Reads the cart saved by the chat assistant and runs a mock
   payment flow. No real payment is processed.
   ============================================================ */

(function () {
  "use strict";

  const SHIPPING = 6.0;
  const TAX_RATE = 0.08;

  const DEFAULT_ITEM = {
    name: "Cameroon Corona",
    origin: "Dominican Republic",
    emoji: "🍂",
    price: "$18",
  };

  function readCart() {
    try {
      const raw = localStorage.getItem("emberCart");
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return DEFAULT_ITEM;
  }

  function priceToNumber(price) {
    const n = parseFloat(String(price).replace(/[^0-9.]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function money(n) {
    return "$" + n.toFixed(2);
  }

  /* ---------- Render order summary ---------- */
  const item = readCart();
  const itemsEl = document.getElementById("coItems");
  itemsEl.innerHTML =
    '<div class="co-item">' +
    '<div class="co-item__emoji">' + (item.emoji || "🚬") + "</div>" +
    '<div class="co-item__info">' +
    '<p class="co-item__name">' + item.name + "</p>" +
    '<p class="co-item__origin">' + (item.origin || "Premium cigar") + "</p>" +
    "</div>" +
    '<span class="co-item__qty">×1</span>' +
    '<span class="co-item__price">' + (item.price || "$0") + "</span>" +
    "</div>";

  const subtotal = priceToNumber(item.price);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + SHIPPING + tax;

  document.getElementById("coSubtotal").textContent = money(subtotal);
  document.getElementById("coShipping").textContent = money(SHIPPING);
  document.getElementById("coTax").textContent = money(tax);
  document.getElementById("coTotal").textContent = money(total);
  document.getElementById("coPayLabel").textContent = "Pay " + money(total);

  /* ---------- Input formatting (nice mobile UX) ---------- */
  const cardInput = document.getElementById("coCard");
  cardInput.addEventListener("input", () => {
    let v = cardInput.value.replace(/\D/g, "").slice(0, 16);
    cardInput.value = v.replace(/(.{4})/g, "$1 ").trim();
  });

  const expInput = document.getElementById("coExp");
  expInput.addEventListener("input", () => {
    let v = expInput.value.replace(/\D/g, "").slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + " / " + v.slice(2);
    expInput.value = v;
  });

  /* ---------- Mock payment submit ---------- */
  const form = document.getElementById("coForm");
  const payBtn = document.getElementById("coPay");
  const success = document.getElementById("coSuccess");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    payBtn.disabled = true;
    payBtn.classList.add("is-loading");
    document.getElementById("coPayLabel").textContent = "Processing…";

    setTimeout(() => {
      form.hidden = true;
      success.hidden = false;
      try {
        localStorage.removeItem("emberCart");
        // Order complete — clear the chat so it starts fresh next time.
        sessionStorage.removeItem("emberChatSession");
      } catch (_) {}
      success.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 1300);
  });
})();
