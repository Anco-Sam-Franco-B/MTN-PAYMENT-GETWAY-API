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

  // Products can come from two places:
  //  - product cards rendered on this page (the shop page), or
  //  - GET /api/products, because the checkout page has no cards.
  // The old code only read the DOM, so the checkout cart rendered no lines.
  var fetched = null;

  function domCatalog() {
    var map = {};
    Array.prototype.forEach.call(document.querySelectorAll("[data-product-id]"), function (card) {
      var heading = card.querySelector("h2");
      map[card.dataset.productId] = {
        name: heading ? heading.textContent.trim() : "Product " + card.dataset.productId,
        price: Number(card.dataset.productPrice)
      };
    });
    return map;
  }

  async function catalog() {
    var fromDom = domCatalog();
    if (Object.keys(fromDom).length) return fromDom;
    if (!fetched) {
      try {
        var res = await fetch("/api/products", { headers: { Accept: "application/json" } });
        fetched = res.ok ? await res.json() : {};
      } catch (e) {
        fetched = {};
      }
    }
    var map = {};
    (fetched || []).forEach(function (p) {
      map[p.id] = { name: p.name, price: Number(p.price) };
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

  // Repaint requests can overlap while the catalog is still loading, so only the
  // newest one is allowed to write to the table.
  var paintSeq = 0;

  async function paint() {
    var seq = ++paintSeq;
    var cart = read();

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

    var products = await catalog();
    if (seq !== paintSeq) return; // a newer paint() superseded this one

    var cents = 0;
    lines.textContent = "";
    var missing = [];
    ids.forEach(function (id) {
      var p = products[id];
      if (!p) {
        // Do not silently drop it: the total would stop matching the cart.
        missing.push(id);
        return;
      }
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
    flagUnavailable(missing.length);
  }

  // If something in the cart can no longer be bought, block payment rather than
  // let the customer pay a total that quietly differs from what they chose.
  function flagUnavailable(count) {
    var warning = document.getElementById("cart-warning");
    var button = document.getElementById("pay-button");
    if (count > 0) {
      if (warning) {
        warning.textContent =
          count + (count === 1 ? " item in your cart is " : " items in your cart are ") +
          "no longer available. Remove " + (count === 1 ? "it" : "them") + " to continue.";
        warning.hidden = false;
      }
      if (button) button.disabled = true;
    } else {
      if (warning) {
        warning.textContent = "";
        warning.hidden = true;
      }
      if (button) button.disabled = false;
    }
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
