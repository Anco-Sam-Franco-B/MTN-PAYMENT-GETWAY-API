// Creates the order, then starts the MoMo payment. The server always recomputes
// the total from the products table, so the amount shown here is only a preview.
(function () {
  "use strict";

  var KEY = "kivu.cart";
  var form = document.getElementById("checkout-form");
  var button = document.getElementById("pay-button");
  var error = document.getElementById("checkout-error");
  if (!form) return;

  var phone = form.elements.customerPhone;

  function readCart() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  async function postJSON(url, body) {
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    showError("");

    var cart = readCart();
    var items = Object.keys(cart).map(function (id) {
      return { productId: Number(id), quantity: cart[id] };
    });
    if (items.length === 0) {
      showError("Your cart is empty.");
      return;
    }

    button.disabled = true;
    button.textContent = "Starting payment...";

    try {
      var order = await postJSON("/orders", {
        items: items,
        customerName: form.elements.customerName.value,
        customerPhone: phone.value
      });

      var payment = await postJSON("/pay", {
        orderId: order.id,
        phone: phone.value
      });

      localStorage.removeItem(KEY);
      window.location.href = "/pay/" + encodeURIComponent(payment.referenceId);
    } catch (err) {
      showError(err.message);
      button.disabled = false;
      button.textContent = "Pay with MoMo";
    }
  });
})();
