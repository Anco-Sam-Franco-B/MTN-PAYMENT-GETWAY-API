// Cart lives in localStorage as { productId: quantity } and is rendered from
// the product ids the server put on each card, so prices always come from the DB.
(function () {
  "use strict";

  var KEY = "kivu.cart";
  var currency = "EUR";
  var zeroDecimal = document.body.dataset.zeroDecimal === "true";

  function money(cents) {
    return currency + " " + (zeroDecimal ? String(Math.round(cents / 100)) : (cents / 100).toFixed(2));
  }

  function unitPrice(price) {
    return currency + " " + (zeroDecimal ? String(Math.round(price)) : price.toFixed(2));
  }

  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      var out = {};
      Object.keys(raw).forEach(function (id) {
        var qty = parseInt(raw[id], 10);
        if (Number.isInteger(qty) && qty > 0 && qty <= 100) out[id] = qty;
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  function write(cart) {
    localStorage.setItem(KEY, JSON.stringify(cart));
  }

  function count(cart) {
    return Object.keys(cart).reduce(function (n, id) { return n + cart[id]; }, 0);
  }

  function refreshBadge() {
    var badge = document.getElementById("cart-count");
    if (badge) badge.textContent = String(count(read()));
  }

  function catalog() {
    var cards = document.querySelectorAll("[data-product-id]");
    var map = {};
    Array.prototype.forEach.call(cards, function (card) {
      map[card.dataset.productId] = {
        name: card.querySelector("h2").textContent.trim(),
        price: Number(card.dataset.productPrice)
      };
    });
    return map;
  }

  function setQty(id, qty) {
    var cart = read();
    if (qty <= 0) delete cart[id];
    else cart[id] = Math.min(qty, 100);
    write(cart);
    paint();
  }

  function paint() {
    var cart = read();
    var products = catalog();

    Array.prototype.forEach.call(document.querySelectorAll("[data-product-id]"), function (card) {
      var value = card.querySelector("[data-qty]");
      if (value) value.textContent = String(cart[card.dataset.productId] || 0);
    });

    var body = document.getElementById("cart-body");
    var empty = document.getElementById("cart-empty");
    var lines = document.getElementById("cart-lines");
    var totalEl = document.getElementById("cart-total");
    if (!body || !empty || !lines || !totalEl) {
      refreshBadge();
      return;
    }

    var ids = Object.keys(cart);
    if (ids.length === 0) {
      body.hidden = true;
      empty.hidden = false;
      refreshBadge();
      return;
    }
    body.hidden = false;
    empty.hidden = true;

    var root = document.getElementById("checkout-root");
    currency = (root && root.dataset.currency) || currency;

    var cents = 0;
    lines.textContent = "";
    ids.forEach(function (id) {
      var p = products[id];
      if (!p) return;
      var qty = cart[id];
      var line = Math.round(p.price * 100) * qty;
      cents += line;

      var tr = document.createElement("tr");
      var name = document.createElement("td");
      name.textContent = p.name;
      var price = document.createElement("td");
      price.className = "num";
      price.textContent = unitPrice(p.price);
      var qtyTd = document.createElement("td");
      qtyTd.className = "num";
      qtyTd.textContent = String(qty);
      var sum = document.createElement("td");
      sum.className = "num";
      sum.textContent = money(line);
      var rm = document.createElement("td");
      var rmBtn = document.createElement("button");
      rmBtn.type = "button";
      rmBtn.className = "button ghost";
      rmBtn.textContent = "Remove";
      rmBtn.addEventListener("click", function () { setQty(id, 0); });
      rm.appendChild(rmBtn);

      tr.append(name, price, qtyTd, sum, rm);
      lines.appendChild(tr);
    });

    totalEl.textContent = money(cents);
    refreshBadge();
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var card = btn.closest("[data-product-id]");
    if (!card) return;
    var id = card.dataset.productId;
    var step = btn.dataset.action === "inc" ? 1 : -1;
    setQty(id, (read()[id] || 0) + step);
  });

  window.addEventListener("storage", paint);
  document.addEventListener("DOMContentLoaded", paint);
  if (document.readyState !== "loading") paint();
})();
