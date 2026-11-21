(function () {
  var config = window.AlphaRecallAdmin;
  var script = document.currentScript;
  var base = config && config.assetsUrl ? config.assetsUrl.replace(/\/?$/, "/") + "js/" : (script ? script.src : location.href);
  // The boot check AlphaRecall_Admin_UI prints after this script waits on it.
  var boot = window.__AlphaRecallAdminBoot = import(new URL("admin-chunks/app-BJjbRkDI.js", base).href);
  boot.catch(function (error) {
    console.error("[AlphaRecall] Admin failed to load", error);
  });
})();
