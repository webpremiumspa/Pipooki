/* Pagina publica de una placa QR. */
(function () {
  'use strict';

  var box = document.getElementById('ubicacion');
  if (!box) return;

  var base = (box.dataset.base || '').replace(/\/+$/, '');
  var code = box.dataset.code;
  var petName = box.dataset.pet;
  var ownerName = box.dataset.owner;
  var wa = box.dataset.wa;
  var tel = box.dataset.tel;
  var hasEmail = box.dataset.hasEmail === '1';

  var statusEl = document.getElementById('locStatus');
  var button = document.getElementById('getLocation');
  var shareBox = document.getElementById('shareBox');
  var scanId = null;

  function api(path, payload) {
    return fetch(base + '/p/' + code + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function (r) { return r.ok ? r.json() : null; });
  }

  // Se registra el escaneo desde el navegador y no al servir el HTML, para que
  // las previsualizaciones de enlaces y los bots no disparen avisos falsos.
  api('/scan').then(function (data) {
    if (data && data.scanId) scanId = data.scanId;
  }).catch(function () { /* el registro es secundario: nunca bloquea la pagina */ });

  // ------------------------- Direccion bajo demanda -------------------------

  var showAddress = document.getElementById('showAddress');
  if (showAddress) {
    showAddress.addEventListener('click', function () {
      showAddress.disabled = true;
      showAddress.textContent = 'Cargando...';
      api('/direccion', { scanId: scanId }).then(function (data) {
        var wrap = document.getElementById('addressBox');
        var text = document.getElementById('addressText');
        var map = document.getElementById('addressMap');
        if (data && data.address) {
          text.textContent = data.address;
          if (data.mapsUrl) {
            map.href = data.mapsUrl;
            map.hidden = false;
          }
        } else {
          text.textContent = 'La familia no registro una direccion. Contactalos por telefono o WhatsApp.';
        }
        wrap.hidden = false;
        showAddress.remove();
      }).catch(function () {
        showAddress.disabled = false;
        showAddress.textContent = 'Ver direccion de mi casa';
      });
    });
  }

  // ---------------------------- Ubicacion GPS -------------------------------

  function messageWith(mapsUrl) {
    var intro = 'Hola ' + ownerName + ', encontre a ' + petName + '.';
    if (!mapsUrl) return intro + ' Escribeme para coordinar la entrega.';
    return intro + ' Esta es mi ubicacion ahora: ' + mapsUrl;
  }

  function buildShareLinks(mapsUrl) {
    var text = messageWith(mapsUrl);
    var enc = encodeURIComponent(text);

    var waLink = document.getElementById('shareWa');
    if (wa) {
      waLink.href = 'https://wa.me/' + wa + '?text=' + enc;
    } else {
      waLink.hidden = true;
    }

    var smsLink = document.getElementById('shareSms');
    if (tel) {
      // "?&body=" es la forma que funciona tanto en iOS como en Android.
      smsLink.href = 'sms:' + tel + '?&body=' + enc;
    } else {
      smsLink.hidden = true;
    }

    // El correo del dueno no esta en el HTML: se pide al servidor recien
    // cuando la persona elige este canal.
    var mailLink = document.getElementById('shareMail');
    if (hasEmail) {
      mailLink.addEventListener('click', function (event) {
        event.preventDefault();
        mailLink.textContent = 'Abriendo...';
        api('/correo').then(function (data) {
          mailLink.textContent = 'Correo';
          if (!data || !data.email) return;
          window.location.href = 'mailto:' + data.email +
            '?subject=' + encodeURIComponent('Encontre a ' + petName) +
            '&body=' + enc;
        }).catch(function () { mailLink.textContent = 'Correo'; });
      });
    } else {
      mailLink.hidden = true;
    }

    var preview = document.getElementById('mapPreview');
    if (mapsUrl) {
      preview.href = mapsUrl;
      preview.hidden = false;
    }

    shareBox.hidden = false;
  }

  function onSuccess(position) {
    var lat = Number(position.coords.latitude.toFixed(6));
    var lng = Number(position.coords.longitude.toFixed(6));
    var accuracy = Math.round(position.coords.accuracy || 0);
    var mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;

    statusEl.textContent = 'Ubicacion obtenida (precision aproximada: ' + accuracy + ' m).';
    button.hidden = true;
    buildShareLinks(mapsUrl);

    api('/location', { scanId: scanId, lat: lat, lng: lng, accuracy: accuracy })
      .then(function (data) {
        if (data && data.ok && hasEmail) {
          document.getElementById('autoNotice').hidden = false;
        }
      })
      .catch(function () { /* el envio manual sigue disponible */ });
  }

  function onError(err) {
    button.disabled = false;
    button.textContent = 'Reintentar';
    if (err && err.code === 1) {
      statusEl.textContent = 'No diste permiso para usar el GPS. Puedes escribir igual y contar donde estas.';
    } else if (err && err.code === 3) {
      statusEl.textContent = 'El GPS demoro demasiado. Intenta de nuevo al aire libre.';
    } else {
      statusEl.textContent = 'No pudimos obtener tu ubicacion. Puedes escribir igual y contar donde estas.';
    }
    buildShareLinks(null);
  }

  button.addEventListener('click', function () {
    if (!navigator.geolocation) {
      statusEl.textContent = 'Tu navegador no permite compartir la ubicacion.';
      buildShareLinks(null);
      return;
    }
    button.disabled = true;
    button.textContent = 'Obteniendo ubicacion...';
    statusEl.textContent = 'Tu telefono te va a pedir permiso. Acepta para continuar.';

    navigator.geolocation.getCurrentPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    });
  });
})();
