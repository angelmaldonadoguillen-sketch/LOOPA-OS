# LOOPA OS

Sistema de ventas de LOOPA studio. Misma base que TOONED OS (shell, estética,
Firebase, métricas), pero sin inventario: lo que se vende son **tipos de servicio**
reutilizables.

## Cómo se usa

1. **Nueva venta** → elegís o escribís el cliente → tocás los tipos de servicio
   (o escribís uno nuevo y Enter: se crea y queda guardado) → cobro → listo.
2. Tocar un tipo que ya está en la venta suma 1 a la cantidad.
3. Si cambiás el precio en una venta, aparece **«Guardar como precio base»**
   para actualizar el tipo.
4. En **Ventas** abrís cualquier venta para cambiar estado, registrar abonos,
   editar servicios o **Vender de nuevo** (misma venta para el mismo cliente,
   ideal para planes mensuales).
5. **Servicios** es el catálogo: precio/costo base, margen, cuántas veces se vendió
   e ingresos. Un tipo ya vendido no se borra: se archiva.

## Módulos

| Módulo | Qué hace |
|---|---|
| Nueva venta | Cliente → servicios → cobro (pagado / anticipo / por cobrar) |
| Ventas | Base de datos con filtros, cobros, estados, exportar a Excel |
| Servicios | Catálogo de tipos de servicio |
| Clientes | Se crean solos con cada venta; historial y saldo por cliente |
| Métricas | Venta, cobrado, por cobrar, ganancia neta, top servicios / clientes |
| Gastos | Variables (con fecha) y fijos mensuales; se restan en Métricas |
| Configuración | Métodos de pago y comisión, categorías, canales, moneda, respaldo |

## Dónde se guardan los datos

**Ahora mismo: modo local.** Los datos quedan en el navegador donde abrís la app.
Si borrás los datos del navegador o cambiás de equipo, no están.
Mientras sigas en modo local: **Configuración → Descargar respaldo** seguido.

### Pasar a la nube (Firebase), igual que TOONED OS

1. Entrá a <https://console.firebase.google.com> → **Agregar proyecto** → `loopa-os`.
2. **Authentication** → Comenzar → habilitar **Correo electrónico/contraseña** →
   pestaña Usuarios → **Agregar usuario** (tu email y una contraseña).
3. **Firestore Database** → Crear base de datos → modo producción.
   En la pestaña **Reglas** pegá esto y publicá:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /loopa/{doc} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```

4. **Configuración del proyecto** (engranaje) → Tus apps → ícono web `</>` →
   registrar app → copiá el objeto `firebaseConfig`.
5. Abrí `index.html`, buscá `CONECTAR LA NUBE` / `window.LOOPA_FIREBASE` y pegá
   los valores (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).
6. Si ya tenías datos en modo local: antes del paso 5 descargá un respaldo, y
   después de conectar usá **Restaurar respaldo** para subirlos a la nube.

Con Firebase conectado aparece la pantalla de login y los datos se sincronizan
entre compu y celular.

Para instalarla como app en el celular hay que publicarla en un hosting
(Firebase Hosting, Netlify o GitHub Pages sirven gratis): abrís el link y
el navegador ofrece «Instalar app».

## Límite conocido

Igual que TOONED OS, todas las ventas viven en un solo documento de Firestore,
que tiene tope de 1 MB (aprox. 1.000–1.200 ventas). Cuando se acerque a eso,
conviene pasar las ventas a un documento por venta.

## Editar el sistema

El código fuente está en `_fuente/`:

- `app.jsx` — toda la lógica y pantallas (React)
- `extra.css` — estilos propios de LOOPA
- `build.js` — arma `index.html` (toma el CSS base de TOONED OS y lo pasa a la paleta LOOPA)
- `logo-loopa.svg` — logo oficial; si cambia el logo, reemplazá este archivo y volvé a armar

Identidad: fondo `#14281f`, acento `#e2e58d`, tipografía Montserrat.

Después de editar: `node _fuente/build.js`. La config de Firebase que ya
hayas pegado en `index.html` se conserva.
