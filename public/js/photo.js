/* Reduce la foto en el navegador antes de subirla.
   Evita depender de librerias nativas de procesamiento de imagen en cPanel. */
(function () {
  'use strict';

  var input = document.querySelector('input[type="file"][data-resize]');
  if (!input || typeof HTMLCanvasElement === 'undefined') return;

  var maxSide = parseInt(input.dataset.resize, 10) || 1000;

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return;

    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        // Si ya es chica y liviana, se sube tal cual.
        if (scale === 1 && file.size < 900 * 1024) return;

        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) return;
          var name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          var resized = new File([blob], name, { type: 'image/jpeg' });
          var transfer = new DataTransfer();
          transfer.items.add(resized);
          input.files = transfer.files;
        }, 'image/jpeg', 0.82);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
})();
