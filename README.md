# Pipooki Find

Placas QR de identificacion para mascotas, en `https://pipookis.cl/find`.

Las placas se fabrican en lotes, genericas y sin datos. El dueno las activa solo:
escanea el QR, ingresa el PIN que viene en el empaque, llena sus datos y
confirma su correo con un codigo. Desde ese momento, quien encuentre a la
mascota escanea el mismo QR y ve como contactar a su familia, ademas de poder
enviarle su ubicacion exacta.

## Los dos circuitos

### 1. Fabricacion y activacion

```
generas un lote en el panel        (/admin/placas)
   -> imprimes la hoja: los QR para las placas y los insertos con el PIN
   -> vendes la placa; no dependes de nadie para que se active
   -> el dueno escanea el QR       (pipookis.cl/find/p/<codigo>)
   -> ingresa el PIN del inserto, sus datos y acepta la autorizacion
   -> recibe un codigo de 6 digitos por correo y lo ingresa
   -> la placa queda activa al instante y te llega un aviso
```

No hay aprobacion previa: la placa funciona apenas el dueno confirma su correo.
La moderacion es posterior, con el boton **Suspender** en el panel.

### 2. Cuando la mascota se pierde

```
alguien escanea el QR
   -> se registra el escaneo y al dueno le llega un correo al instante
   -> quien la encontro puede llamar, escribir por WhatsApp, o pedir la direccion
   -> si comparte su ubicacion: al dueno le llega el mapa por correo, y ademas
      se arma el mensaje listo para enviar por WhatsApp, SMS o correo desde su
      propio telefono
```

## El PIN: por que existe

Una placa sin activar es un formulario de registro colgando de un gancho.
Mientras esta en la tienda, cualquiera puede escanearla y registrar a su propia
mascota con ella; el comprador se llevaria una placa que muestra los datos de
otra persona.

Por eso la activacion pide un PIN de 6 caracteres que va **impreso en el inserto
del empaque, nunca grabado en la placa**. Escanear una placa en una vitrina no
sirve de nada sin el papel que va adentro.

- La hoja de impresion separa las dos cosas y lo advierte en grande.
- Diez intentos fallidos de PIN bloquean la activacion de esa placa.
- Una vez activada, el PIN queda inutil: no sirve para tomar control de una
  placa ajena.
- Al **liberar** una placa desde el panel se genera un PIN nuevo, asi que el
  inserto anterior deja de servir.

## Como entra el dueno a editar sus datos

No hay claves ni enlaces permanentes. Entra a `pipookis.cl/find/mis-datos`,
escribe su correo y recibe un codigo de 6 digitos. La sesion dura 30 minutos.

Se descarto el enlace magico permanente porque un correo reenviado da acceso
para siempre; un codigo caduca y sirve una sola vez.

**Si el dueno pierde el acceso a su correo**, cambiaselo desde el panel
(Duenos > Editar). Eso le devuelve el acceso: es el unico camino de
recuperacion, a proposito.

Desde su area puede corregir su telefono y direccion, editar los datos de sus
mascotas, y pausar o reactivar cada placa.

**El dato que mata a estas placas es el telefono desactualizado.** Por eso el
dueno edita libre, sin pasar por ti.

## Decisiones de privacidad

Una placa QR es publica: cualquiera que fotografie el collar en la calle puede
abrir la pagina. Por eso:

- **La direccion no viaja en el HTML.** Se entrega solo cuando la persona
  presiona "Ver direccion de mi casa", y ese hecho queda registrado en el
  historial de escaneos.
- **El correo del dueno tampoco viaja en el HTML.** Se entrega solo cuando la
  persona elige enviar el mensaje por correo. Asi no queda expuesto a robots
  que raspan direcciones desde el codigo fuente.
- El telefono si se muestra: es el canal principal para recuperar a la mascota.
- **Nada se guarda hasta que el correo esta confirmado.** El formulario queda en
  la tabla `claims` con un codigo y 24 horas de vida. Si el dueno tecleo mal su
  correo, la placa no queda inutilizable: el registro caduca y vuelve a estar
  libre.
- **El consentimiento queda registrado** con fecha, IP y version del texto
  aceptado. Si el texto cambia, se sube la version en `src/config.js` para poder
  acreditar que cada dueno acepto ese texto y no otro.
- Los codigos OTP se guardan hasheados (HMAC), vencen en 15 minutos y admiten 5
  intentos.
- Pedir un codigo con un correo que no existe responde exactamente igual que con
  uno que si existe: de lo contrario esa pagina serviria para averiguar quien
  tiene placa.
- Las paginas publicas llevan `noindex, nofollow` y `Referrer-Policy: no-referrer`.
- El escaneo se registra desde el navegador, no al servir el HTML. De lo
  contrario las previsualizaciones de enlaces de WhatsApp y los bots
  dispararian avisos falsos al dueno.
- Los codigos de placa son aleatorios de 8 caracteres (no correlativos) y las
  rutas publicas estan limitadas por IP.

## Requisitos

- Node.js 18 o superior
- MySQL / MariaDB
- Una cuenta de correo saliente (SMTP de cPanel sirve)

**El SMTP no es opcional**: sin correo nadie puede activar una placa, porque no
le llega el codigo de confirmacion. El panel avisa mientras no este configurado.

## Instalacion local

```bash
npm install
cp .env.example .env      # completar credenciales
npm run setup             # crea las tablas y el primer administrador
npm start
```

`npm run setup` imprime el correo y la clave del administrador. Se muestra una
sola vez. Para crear o resetear otro despues:

```bash
npm run create-admin -- --email tu@correo.cl --password "clave" --name "Tu Nombre"
```

Para probar en el computador conviene usar `BASE_PATH=` (vacio) y
`PUBLIC_URL=http://localhost:3000`.

## Pruebas

```bash
npm test
```

Dos suites que **no necesitan base de datos**: una renderiza todas las vistas y
otra levanta la aplicacion completa contra una base en memoria y recorre el
circuito entero: fabricacion del lote, PIN incorrecto, activacion, confirmacion
por OTP, escaneo, ubicacion, segunda placa del mismo dueno, area del dueno,
suspension, liberacion y bloqueo por intentos de PIN. Son 91 verificaciones.

## Uso del panel

| Seccion       | Para que sirve                                                        |
| ------------- | --------------------------------------------------------------------- |
| **Panel**     | Cuantas placas libres quedan, activas, y escaneos del mes.             |
| **Placas**    | Fabricar lotes, hoja de impresion, CSV, y el estado de cada placa.     |
| **Duenos**    | Buscar, editar datos, cambiar el correo de acceso.                     |
| **Mascotas**  | Editar los datos que se muestran en la placa.                          |
| **Escaneos**  | Historial completo con ubicaciones.                                    |

Acciones sobre una placa: **suspender** (deja de mostrar datos y se le avisa al
dueno), **reactivar**, **liberar** (vuelve al inventario con un PIN nuevo) y
**activar manualmente** (alta por telefono, sin PIN ni consentimiento en linea).

## Impresion de las placas

Desde **Placas > Hoja de impresion** sale una pagina A4 con dos partes:

1. Los codigos QR, para grabar en las placas.
2. Los insertos con el PIN, para recortar y meter en cada empaque.

Se imprime desde el navegador o se guarda como PDF. Tambien hay un CSV con
codigo, PIN y URL de cada placa.

Recomendaciones de fabricacion:

- El QR usa correccion de errores nivel Q: sigue leyendose con hasta un 25% de
  la superficie rayada o danada, que es lo que le pasa a una placa de collar.
- Imprimir a 25 mm de lado o mas.
- Respetar el margen blanco; sin el, muchos lectores fallan.
- Maximo contraste: negro sobre blanco. Evitar metal espejado o color oscuro.
- Probar una placa del lote con la camara del celular antes de fabricar el resto.

## Despliegue en cPanel

### 1. Base de datos

En **MySQL Databases** crear la base y el usuario, y asignarle todos los
privilegios. Anotar los nombres completos (cPanel antepone el prefijo de la
cuenta, por ejemplo `usuario_pipooki`).

### 2. Correo

En **Email Accounts** crear `no-reply@pipookis.cl`:

- Host: `mail.pipookis.cl`
- Puerto: `465`, SSL/TLS (`SMTP_SECURE=true`)
- Usuario: la direccion completa
- Clave: la del buzon

### 3. Archivos

Subir el proyecto (sin `node_modules`) a una carpeta fuera de `public_html`,
por ejemplo `/home/usuario/pipooki-find`.

### 4. Aplicacion Node

En **Setup Node.js App**:

| Campo                    | Valor              |
| ------------------------ | ------------------ |
| Node.js version          | 18 o superior      |
| Application mode         | Production         |
| Application root         | `pipooki-find`     |
| Application URL          | `pipookis.cl/find` |
| Application startup file | `app.js`           |

Guardar, y usar **Run NPM Install**.

### 5. Variables de entorno

El archivo `.env` ya viene con el dominio de produccion y un `SESSION_SECRET`
generado. Falta completar `DB_USER`, `DB_PASSWORD`, `DB_NAME` y `SMTP_PASSWORD`.

Tambien se pueden cargar desde **Environment variables** en la misma pantalla de
cPanel.

Para probar antes en `dev.webpremium.cl/find`, cambiar solo `PUBLIC_URL`.
Ese valor queda **grabado dentro del QR impreso**: las placas fabricadas
apuntando a dev seguiran apuntando ahi para siempre. Fabrica los lotes de verdad
recien con `PUBLIC_URL=https://pipookis.cl`.

### 6. Crear las tablas

```bash
source /home/usuario/nodevenv/pipooki-find/18/bin/activate
cd /home/usuario/pipooki-find
npm run setup
```

### 7. Reiniciar

Boton **Restart**. Entrar a `pipookis.cl/find/admin/login` con las credenciales
que imprimio el setup y cambiar la clave en "Mi cuenta".

### Notas de Passenger

- Passenger puede entregar la ruta con o sin el prefijo `/find` segun la
  version. La aplicacion normaliza los dos casos.
- Las sesiones se guardan en MySQL, asi que sobreviven a los reinicios y a que
  Passenger levante mas de un proceso.
- Las fotos se guardan en `public/uploads/`. Respaldar junto con la base.
- No se usan dependencias con compilacion nativa: el redimensionado de fotos se
  hace en el navegador antes de subirlas.

## Estructura

```
app.js                   arranque, middlewares, montaje del BASE_PATH
src/config.js            configuracion, URLs publicas y texto del consentimiento
src/db.js                pool de MySQL
src/schema.sql           esquema de la base
src/routes/public.js     pagina del QR, registro de escaneos, ubicacion
src/routes/portal.js     activacion con PIN, OTP y area del dueno
src/routes/admin.js      panel: placas, lotes, duenos, mascotas, escaneos
src/services/forms.js    lectura y validacion compartida de formularios
src/services/otp.js      emision y verificacion de codigos de un solo uso
src/services/qr.js       generacion del PNG
src/services/mailer.js   todos los correos automaticos
src/services/phone.js    normalizacion de telefonos chilenos para wa.me
src/services/tokens.js   codigos de placa, PIN y codigos OTP
src/middleware/          sesion, CSRF, subida de fotos, limite de peticiones
views/public/            pagina que ve quien encuentra la mascota
views/portal/            activacion y area del dueno
views/admin/             panel y hoja de impresion
test/                    pruebas que no requieren base de datos
```

## Modelo de datos

- `batches` — lotes de fabricacion.
- `tags` — la placa fisica: `code` (va en el QR), `pin` (va en el empaque) y
  `status`: `libre`, `activa`, `pausada` (por el dueno) o `suspendida` (por el
  administrador). Una placa = una mascota.
- `claims` — registros a medio hacer, esperando el codigo de confirmacion.
  Caducan a las 24 horas y liberan la placa.
- `owners` — datos de contacto, correo verificado y consentimiento. El correo es
  unico: es la identidad con la que el dueno pide su codigo.
- `pets` — datos de la mascota.
- `otp_codes` — codigos de acceso, hasheados y de un solo uso.
- `scans` — historial: fecha, coordenadas si las compartieron, si se mostro la
  direccion y si se alcanzo a avisar.

Una placa muestra datos solo si su estado es `activa` y tiene una mascota
enlazada.

## Pendientes conocidos

- El aviso al escanear sale **solo por correo**. Mandarlo por WhatsApp o SMS
  requiere una API de pago (WhatsApp Cloud API o Twilio).
- No hay cobros ni planes: la placa se vende por fuera del sistema.
- El dueno no puede cambiar su propio correo; tiene que pedirtelo.
