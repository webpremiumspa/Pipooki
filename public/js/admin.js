/* Utilidades del panel. */
(function () {
  'use strict';

  // Confirmacion antes de acciones destructivas.
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!window.confirm(form.dataset.confirm)) event.preventDefault();
    });
  });

  // Boton "Copiar" junto a un input.
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
        navigator.clipboard.writeText(input.value).then(done, function () {
          document.execCommand('copy');
          done();
        });
      } else {
        document.execCommand('copy');
        done();
      }
    });
  });
})();
