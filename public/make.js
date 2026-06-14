// "Make a game" page — copy the recipe to the clipboard.
(function () {
  var btn = document.getElementById('copy-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var text = document.getElementById('recipe').textContent;
    var done = function () {
      btn.textContent = 'Copied! ✓';
      setTimeout(function () { btn.textContent = 'Copy the recipe'; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
  });
})();
