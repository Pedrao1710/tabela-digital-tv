(function () {
  'use strict';
  document.addEventListener('keydown', function (event) {
    var direction = event.keyCode === 40 ? 1 : event.keyCode === 38 ? -1 : 0;
    if (!direction) return;
    var controls = document.querySelectorAll('input, button, a[href]');
    for (var i = 0; i < controls.length; i += 1) {
      if (controls[i] === document.activeElement) {
        var next = i + direction;
        if (next >= 0 && next < controls.length) {
          controls[next].focus();
          event.preventDefault();
        }
        return;
      }
    }
    if (controls.length) controls[0].focus();
  });
})();
