/**
 * Shared performance report (AlphaRecall_Report): the "Save as PDF" button
 * opens the print dialog, and a link opened with ?print=1 (data-auto-print on
 * <body>) opens it once the page has loaded.
 */
(function () {
  "use strict";
  document.addEventListener("click", function (event) {
    var target = event.target;
    var button = target && target.closest ? target.closest("[data-report-print]") : null;
    if (button) {
      event.preventDefault();
      window.print();
    }
  });
  window.addEventListener("load", function () {
    if (document.body && document.body.getAttribute("data-auto-print") === "1") {
      window.setTimeout(function () {
        window.print();
      }, 250);
    }
  });
})();
