/* Prepara la foto en el navegador y la manda como texto, no como archivo.
   El WAF del hosting bloquea las subidas multipart de visitantes anonimos, y
   ademas asi no dependemos de librerias nativas de imagen en el servidor. */
(function () {
  'use strict';

  var input = document.querySelector('input[type="file"][data-resize]');
  var hidden = document.getElementById('photo_data');
  if (!input || !hidden || typeof HTMLCanvasElement === 'undefined') return;

  var maxSide = parseInt(input.dataset.resize, 10) || 1000;
  var status = document.getElementById('photoStatus');

  function say(text) {
    if (status) status.textContent = text;
  }

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    hidden.value = '';

    if (!file) { say(''); return; }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      say('Ese archivo no es una imagen JPG, PNG o WEBP.');
      return;
    }

    say('Preparando la foto...');

    var reader = new FileReader();
    reader.onerror = function () { say('No pudimos leer la foto. Intenta con otra.'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { say('No pudimos leer la foto. Intenta con otra.'); };
      img.onload = function () {
        var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        // Siempre se reencoda a JPG: normaliza el formato y quita los metadatos
        // de la foto original, que en un celular incluyen la ubicacion.
        hidden.value = canvas.toDataURL('image/jpeg', 0.82);

        var kb = Math.round((hidden.value.length * 0.75) / 1024);
        say('Foto lista (' + canvas.width + 'x' + canvas.height + ', ' + kb + ' KB).');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // El campo de archivo solo sirve para elegir la imagen: nunca se envia, para
  // que el formulario siga siendo un envio de texto normal.
  input.removeAttribute('name');
})();
