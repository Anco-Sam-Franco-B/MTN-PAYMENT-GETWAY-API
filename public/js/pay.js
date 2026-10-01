// Polls /pay/status/:referenceId until MoMo resolves the payment. The server
// re-checks with MoMo on each poll, so this page never decides the outcome.
(function () {
  "use strict";

  var panel = document.querySelector(".panel[data-poll-url]");
  if (!panel) return;

  var state = document.getElementById("pay-state");
  var hint = document.getElementById("pay-hint");
  var orderRef = document.getElementById("order-ref");
  var url = panel.dataset.pollUrl;
  var interval = Number(panel.dataset.pollMs) || 3000;
  var stopped = false;

  function setState(kind, message, note) {
    state.className = "state state-" + kind;
    state.textContent = message;
    if (note !== undefined) hint.textContent = note;
  }

  function stop() {
    stopped = true;
  }

  async function poll() {
    try {
      var res = await fetch(url, { headers: { Accept: "application/json" } });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "Could not read payment status");

      if (data.orderId && orderRef) orderRef.textContent = String(data.orderId);

      if (data.status === "SUCCESSFUL") {
        setState("success", "Payment received. Thank you!",
          "Order " + (data.orderId ? "#" + data.orderId : "") + " is now marked as paid.");
        return stop();
      }
      if (data.status === "FAILED") {
        setState("failed", "Payment failed or was declined.",
          "Nothing was charged. You can place the order again.");
        return stop();
      }
      setState("pending", "Approve the prompt on your phone\u2026");
    } catch (err) {
      // A blip in the network should not look like a failed payment.
      setState("pending", "Still waiting\u2026", "Reconnecting: " + err.message);
    }

    if (!stopped) setTimeout(poll, interval);
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !stopped) poll();
  });

  poll();
})();
