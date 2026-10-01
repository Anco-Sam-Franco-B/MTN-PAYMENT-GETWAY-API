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

  // Once an order exists, a failed payment must not create a second order. Keep
  // the id so "Try again" re-pays the same one.
  var pendingOrderId = null;

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    showError("");

    button.disabled = true;
    var wasRetry = pendingOrderId !== null;
    button.textContent = wasRetry ? "Retrying payment..." : "Starting payment...";

    try {
      if (pendingOrderId === null) {
        var cart = readCart();
        var items = Object.keys(cart).map(function (id) {
          return { productId: Number(id), quantity: cart[id] };
        });
        if (items.length === 0) {
          showError("Your cart is empty.");
          button.disabled = false;
          button.textContent = "Pay with MoMo";
          return;
        }

        var order = await postJSON("/orders", {
          items: items,
          customerName: form.elements.customerName.value,
          customerPhone: phone.value
        });
        pendingOrderId = order.id;
      }

      var payment = await postJSON("/pay", {
        orderId: pendingOrderId,
        phone: phone.value
      });

      localStorage.removeItem(KEY);
      window.location.href = "/pay/" + encodeURIComponent(payment.referenceId);
    } catch (err) {
      showError(err.message + (pendingOrderId ? " Use Try again to retry this order." : ""));
      button.disabled = false;
      button.textContent = pendingOrderId ? "Try again" : "Pay with MoMo";
    }
  });
})();
