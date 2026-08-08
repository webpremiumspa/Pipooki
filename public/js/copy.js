/* Boton "Copiar" para las paginas publicas. */
(function () {
  'use strict';

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var input = document.querySelector(button.dataset.copy);
      if (!input) return;
      input.select();
      input.setSelectionRange(0, 99999);
      var done = function () {
        var original = button.textContent;
        button.textContent = 'Copiado';
        setTimeout(function () { button.textContent = original; }, 1500);
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(input.value).then(done, done);
      } else {
        document.execCommand('copy');
        done();
      }
    });
  });
})();
