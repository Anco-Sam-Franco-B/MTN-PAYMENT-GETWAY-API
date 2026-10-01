// Talks to the admin JSON routes with the x-admin-key header. The key is held in
// memory for this tab only: never in the URL, never in localStorage.
(function () {
  "use strict";

  var key = null;
  var page = 1;
  var status = "";
  var rows = [];
  var total = 0;
  var limit = 20;

  var keyForm = document.getElementById("key-form");
  var keyInput = document.getElementById("admin-key");
  var signOut = document.getElementById("sign-out");
  var errorEl = document.getElementById("admin-error");
  var root = document.getElementById("orders-root");
  var body = document.getElementById("orders-body");
  var meta = document.getElementById("orders-meta");
  var statusSelect = document.getElementById("filter-status");
  var prev = document.getElementById("prev-page");
  var next = document.getElementById("next-page");

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  var zeroDecimal = document.body.dataset.zeroDecimal === "true";

  function money(value) {
    var n = Number(value);
    return zeroDecimal ? String(Math.round(n)) : n.toFixed(2);
  }

  async function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ "x-admin-key": key }, options.headers || {});
    var res = await fetch(path, options);
    if (res.status === 401) {
      key = null;
      root.hidden = true;
      keyInput.value = "";
      throw new Error("Unauthorized. Check the admin key.");
    }
    if (res.status === 204) return null;
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  function paint() {
    body.textContent = "";
    rows.forEach(function (o) {
      var tr = document.createElement("tr");

      var id = document.createElement("td");
      id.textContent = "#" + o.id;

      var customer = document.createElement("td");
      customer.textContent = o.customer_name || "-";

      var phone = document.createElement("td");
      phone.textContent = o.customer_phone || "-";

      var amount = document.createElement("td");
      amount.className = "num";
      amount.textContent = money(o.total);

      var badge = document.createElement("td");
      var span = document.createElement("span");
      span.className = "badge badge-" + o.status;
      span.textContent = o.status;
      badge.appendChild(span);

      var created = document.createElement("td");
      created.textContent = new Date(o.created_at).toLocaleString();

      var actions = document.createElement("td");
      if (o.status === "UNPAID") {
        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "button ghost";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", async function () {
          cancel.disabled = true;
          try {
            await api("/orders/" + o.id, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "CANCELLED" })
            });
            await load();
          } catch (err) {
            showError(err.message);
            cancel.disabled = false;
          }
        });        actions.appendChild(cancel);
      }

      tr.append(id, customer, phone, amount, badge, created, actions);
      body.appendChild(tr);
    });

    var from = total === 0 ? 0 : (page - 1) * limit + 1;
    var to = Math.min(page * limit, total);
    meta.textContent = "Showing " + from + "-" + to + " of " + total + " order(s), page " + page + ".";
    prev.disabled = page <= 1;
    next.disabled = page * limit >= total;
  }

  async function load() {
    var query = "?page=" + page + "&limit=" + limit;
    if (status) query += "&status=" + encodeURIComponent(status);

    var data = await api("/orders" + query);
    rows = data.orders;
    total = data.total;
    limit = data.limit;
    page = data.page;
    showError("");
    paint();
  }

  function refresh() {
    load().catch(function (err) { showError(err.message); });
  }

  keyForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    key = keyInput.value.trim();
    if (!key) return;
    try {
      await load();
      root.hidden = false;
      signOut.hidden = false;
    } catch (err) {
      showError(err.message);
    }
  });

  signOut.addEventListener("click", function () {
    key = null;
    root.hidden = true;
    signOut.hidden = true;
    keyInput.value = "";
  });

  document.getElementById("filter-form").addEventListener("submit", function (e) {
    e.preventDefault();
    status = statusSelect.value;
    page = 1;
    refresh();
  });

  prev.addEventListener("click", function () { if (page > 1) { page--; refresh(); } });
  next.addEventListener("click", function () { page++; refresh(); });
})();
