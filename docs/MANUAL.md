# Punto de Venta — cómo se usa

Guía corta para el día a día. No hace falta saber de computadores.

---

## La primera vez

Al abrir el programa por primera vez te pide **crear tu cuenta**. No hay usuario
ni contraseña de fábrica: eso sería dejar la puerta abierta.

Escribe un usuario (por ejemplo `camilo`), tu nombre y una contraseña de al menos
6 caracteres. Esa cuenta queda como **administrador**: puede hacer todo.

> La contraseña se guarda cifrada. Si se te olvida no se puede recuperar, solo
> restablecer desde otra cuenta de administrador. Si es la única cuenta, no hay
> forma de entrar. Anótala en algún lado seguro.

### Cargar tu inventario

Hay dos formas y puedes usar las dos.

**Desde tu Excel.** Entra a **Inventario** y toca *Importar desde Excel*. Antes de
guardar nada te muestra qué va a pasar: cuántos productos se crean, cuáles cambian
y qué necesita revisión. Si algo no te cuadra, cancela: tu Excel no se modifica
nunca.

**A mano, uno por uno.** *Nuevo producto*, y llenas la ficha. Es la forma normal
de agregar lo que vaya llegando después.

El Excel es un punto de partida, no un molde. Si vendes algo que ese archivo no
tenía —un vino, un cigarrillo, hielo— lo agregas y ya: **todas las listas del
programa las manejas tú**.

### Las listas son tuyas

En cada desplegable de la ficha —categoría, marca, envase, en qué se cuenta— la
última opción es **＋ Agregar**. La escribes ahí mismo y queda disponible desde
ese momento, sin salir de la ficha.

Para ordenarlas todas juntas: **Configuración → Listas**. Ahí puedes corregir un
nombre mal escrito o retirar lo que ya no manejas. Al lado de cada una dice
cuántos productos la usan, para que sepas qué estás tocando.

Lo que retiras deja de ofrecerse, pero los productos que ya lo usaban siguen
igual. Nada se borra nunca.

### Tus proveedores

En **Compras → Proveedores** das de alta a quien te vende: nombre, teléfono, quién
te atiende. Hace falta al menos uno para poder registrar una compra.

---

## El día normal

### 1. Abrir la caja

Entra a **Caja**. Cuenta la plata con la que empiezas y escríbela. Eso es la base.

### 2. Vender

Escribe el nombre del producto o pasa el lector de código de barras. Con las
flechas eliges y con **Enter** lo agregas al carrito.

Si el producto se vende de varias formas —por unidad y por six— aparecen las dos
con su precio. Toca la que corresponda.

**Cuando dos productos se llaman igual**, al lado del nombre aparece resaltado lo
que los diferencia: `Póker 330 ml` y `Póker 700 ml`, o `Corona lata` y `Corona
botella`. Si el Excel nunca les puso tamaño —como las dos Margaritas— lo que
aparece es el precio, que es lo único que las separa hasta que les pongas el
tamaño en su ficha. Así no hay que bajar la vista a la letra chica con un cliente
esperando.

Cuando termines, **F2** para cobrar. Eliges cómo paga, y si es en efectivo puedes
escribir con cuánto te dio para que el sistema calcule el vuelto. **Enter** para
confirmar.

**Si te lo va a quedar debiendo**, elige *Fiado* y escribe a nombre de quién
queda: «Don Jairo», «la señora del 302», como lo digas tú. Esa plata no entra a
la caja, así que el cierre sigue cuadrando. También puedes cobrar una parte en
efectivo y fiar el resto. Todo eso se cobra después en **Créditos**.

**Después de cobrar** puedes imprimir el recibo o *Copiar para enviar*, que lo
deja listo para pegar en WhatsApp. Cuando la venta fue fiada, el recibo dice a
nombre de quién quedó y cuánto: es el papel que después zanja la discusión de
cuánto era.

**Cobrar algo de más.** Si la venta lleva domicilio, servicio o cualquier cobro
adicional, toca *Cobrar algo de más* en la pantalla de cobro. Escribes para qué
es —o lo eliges de los botones— y pones el monto, o un porcentaje del total. Se
suma al total y el vuelto ya lo cuenta.

Siempre hay que decir para qué es: sin motivo no se cobra. Un recargo sin
explicación en el recibo es una discusión en el mostrador, y además queda escrito
ahí para que el cliente lo vea.

Una venta normal son tres teclas y no hay que tocar el mouse.

| Tecla | Qué hace |
|---|---|
| **F1** | Ir al buscador |
| **F2** | Cobrar |
| **F8** | Cancelar la venta |
| **Enter** | Agregar el producto marcado |
| **Esc** | Borrar la búsqueda |

### 3. Si sale plata de la caja

Un domicilio, un mandado, lo que sea: regístralo con el botón **Entra o sale
plata**, arriba en la pantalla de caja. Si no, al cerrar va a faltar plata y no
vas a saber por qué.

Marcas si entra o sale, para qué, y cuánto. Los motivos de siempre —domicilio,
mandado, compra menor, retiro— están ahí de a un toque para no escribirlos cada
vez. Queda con tu nombre y la hora, y aparece en el cierre separado de las ventas.

### 4. Cerrar la caja

Toca *Cerrar caja*. **Primero cuentas el dinero y lo escribes**, y solo después
el sistema te muestra cuánto debería haber. Es a propósito: si vieras el número
antes, el conteo no serviría de nada.

Si hay diferencia, te pide que escribas por qué. Sin eso no cierra.

---

## Cosas que conviene saber

**Vender algo que el sistema cree que no hay.** Te avisa, pero te deja cobrar. Si
tienes la botella en la mano, el que está mal es el sistema, no la botella. Queda
anotado para que revises el inventario después.

**Anular una venta.** La venta no se borra nunca: queda marcada como anulada, con
quién la anuló y por qué. La mercancía vuelve al inventario y la plata sale de la
caja sola.

**Un six descuenta seis.** Si vendes un six de Póker, el sistema descuenta 6
botellas, no una. Y si recibes una canasta de 30, suma 30.


---

## Arreglar productos

Entra a **Inventario** y toca cualquier producto de la lista para abrir su ficha.

**Los que dicen "por revisar"** son los que quedaron dudosos al importar tu Excel:
dos Margaritas con el mismo nombre y precio distinto, cervezas que aparecen con dos
nombres, precios que no coincidían entre hojas. Abre la ficha, corrige lo que haga
falta y guarda: con eso la marca desaparece.

### Cambiar un precio

**Subir el precio hoy no cambia lo de ayer.** Cada venta guarda el precio con el
que se cobró, así que si vendiste una Póker a $2.700 y mañana la subes a $3.000,
esa venta se queda en $2.700 para siempre. El reporte de la semana pasada sigue
diciendo lo mismo el mes que viene.

En la ficha, *Cómo ha cambiado el precio* muestra cuándo lo subiste o lo bajaste,
de cuánto a cuánto, de cuánto fue el cambio en porcentaje y quién lo hizo. Vale
tanto para el precio del producto como para el de cada forma de venta: si subes
el six sin tocar la unidad suelta, queda anotado aparte.

Si lo que quieres es cobrar distinto **solo unos días** —el fin de semana, el
partido— eso no es cambiar el precio: es *Poner un precio por unos días*, más
abajo en la misma ficha. Al vencer vuelve solo al de siempre.

### Ajustar la existencia

La existencia **no** se edita como un campo más. Se ajusta aparte, con el botón
*Ajustar existencia*, y hay que decir por qué: un conteo físico, algo que se rompió,
algo que se venció.

Escribe `12` para sumar o `-3` para restar. Queda registrado con tu nombre, la hora
y el motivo, y aparece en el historial del producto.

### Si te equivocaste al ajustar

Pasa: escribes `-20` donde iba `-2`, o ajustas el producto de al lado. Abre
*Historial de este producto* y al lado del ajuste equivocado aparece *Deshacer*.
Pide un motivo y devuelve la existencia a como estaba.

No borra nada. El ajuste equivocado se queda ahí y debajo aparece el movimiento
que lo devuelve, con tu nombre y tu explicación. Así el historial cuenta lo que
de verdad pasó, incluida la equivocación. Cada ajuste se puede deshacer una sola
vez, y solo los ajustes: una venta se anula desde *Ventas* y una compra desde
*Compras*.

### Código de barras

Abre la ficha del producto, pon el cursor en el campo de código de barras y pasa el
lector por el producto. Queda asociado y desde ahí el escáner lo encuentra solo en
la caja.

Un producto puede tener varios códigos: la misma cerveza a veces cambia de código
entre lotes, y así los dos siguen funcionando. Si uno quedó mal pegado, la **X** al
lado lo quita sin tocar los demás.

### A cuánto te lo vende cada proveedor

En la ficha, abajo, está lo que cada proveedor te ha cobrado por ese producto, con
la fecha de la última compra y **marcado el más barato**. Es la lista de precios
que tenías en el Excel, pero se llena sola: cada vez que recibes mercancía, el
sistema anota a qué precio te la vendieron.

La comparación es **por lo que sale cada botella**, no por el precio del empaque.
Una canasta de 30 a $60.000 se ve más cara que una botella suelta a $2.400, pero
te sale a $2.000 la botella. Por eso al lado del precio está la columna *Cada
unidad*, que es la que decide cuál queda marcado. Si dos te cobran lo mismo,
quedan marcados los dos.

### Subir o bajar el precio por unos días

Para una promoción del fin de semana, un alza de temporada o el precio de un solo
día: en la ficha del producto, *Poner un precio por unos días*.

Escribes el precio, eliges de qué es —todo el producto o solo una forma de venta,
por ejemplo solo el six— y hasta cuándo. Hay atajos para lo que se pide de
verdad: **Solo hoy**, **Hoy y mañana**, **Una semana**, **Un mes**.

**El precio de siempre no se toca.** Cuando la fecha pase, el producto vuelve solo
a su precio de lista. No hay que acordarse de devolverlo el lunes, que es
justamente donde se queda la plata.

Mientras rige, la ficha lo muestra arriba con el precio viejo al lado, y puedes
quitarlo antes de tiempo con la **X**.

### Dejar de vender un producto

Si ya no lo manejas, usa *Desactivar producto*. Desaparece de la caja y del
inventario, pero
**no se borra**: su historial de ventas sigue completo, y los reportes viejos
siguen cuadrando. Se puede volver a activar cuando quieras.

---

## Ver y anular ventas

En **Ventas** están todas las del período que elijas. Toca una para ver qué se
vendió, a qué precio y cómo se pagó.

Para anular, abre la venta y usa *Anular esta venta*. Hay que escribir por qué. La
mercancía vuelve al inventario, el efectivo sale de la caja, y la venta queda
marcada como anulada con tu nombre y el motivo. **Nunca se borra.**

El total del pie no cuenta las anuladas, que es lo que uno quiere saber al cuadrar
el día.

Las que dicen **"faltante"** son ventas que se cobraron sobre existencia que el
sistema creía agotada. Son las que conviene revisar contra el conteo físico.

---

## Recibir mercancía

En **Compras**, toca *Recibir mercancía*. Elige el proveedor, busca el producto y
registra **cómo llegó**: si llegaron dos canastas, pon 2 canastas, no 60 botellas.

Mientras escribes el costo, la pantalla te muestra en vivo cuánto te sale cada
botella y qué margen te queda. Ahí es donde el sistema aprende cuánto cuestan las
cosas, y por eso después puede decirte cuánto estás ganando.

**Si te equivocaste al registrarla**, abre la compra y usa *Anular*. Hay que decir
por qué. La mercancía se descuenta del inventario y la compra queda marcada como
anulada con tu nombre y el motivo — igual que las ventas, nunca se borra.

---

## Reportes

En **Reportes** eliges cuál quieres y el período. Hay cinco: ventas por día, por
producto, por categoría, por usuario, y los cierres de caja.

Dos botones para sacarlos:

- **Exportar a Excel** — para seguir trabajando el dato allá.
- **Imprimir o guardar en PDF** — se abre el diálogo de Windows. Ahí puedes
  mandarlo a la impresora, o elegir *Microsoft Print to PDF* para guardarlo como
  archivo.

---

## ¿Cuánto estoy ganando?

En **Resultados** está el estado de resultados: lo que entró, lo que costó, lo
que se perdió y lo que quedó. Los números salen solos de tus ventas.

La cuenta va de arriba abajo y **cada renglón lleva al siguiente**. Si sumas y
restas con una calculadora te tiene que dar igual; si no, algo está mal y hay
que decirlo.

```
  Ventas registradas        todo lo que pasó por la caja
  (−) Descuentos            lo que rebajaste en el mostrador
  (−) Ventas anuladas       lo que se cobró y se devolvió
  = Ventas netas            lo que de verdad entró

  (−) Costo de la mercancía  lo que te costó a ti lo que vendiste
  = Utilidad bruta           lo que dejó la venta

  (−) Merma                  lo roto, lo vencido, lo que no apareció
  = Utilidad bruta ajustada

  (−) Gastos del período     arriendo, energía, internet, aseo, bolsas
  = Utilidad operacional     lo que de verdad queda
```

**Por qué aparecen las anuladas.** Porque si no, este reporte no cuadra contra la
pantalla de Ventas, que sí las muestra, y uno acaba sin creerle a ninguno de los
dos. Aquí se ven y se restan, y el total de abajo es el bueno.

**Por qué aparece la merma.** Una botella rota es plata perdida igual que el
arriendo. Si solo desaparece del inventario, la ganancia se ve más alta de lo
que fue y nunca te enteras de cuánto se está yendo en roturas. Sale desglosada
por el motivo que escribiste al ajustar la existencia: por eso vale la pena
escribir motivos de verdad y no «ajuste».

### Lo que hay al lado

**Contra el período anterior.** Compara con un tramo igual de largo justo antes:
un mes contra el mes anterior, una semana contra la semana anterior. Comparar una
semana contra un mes no diría nada.

**Cuánto hay que vender.** Es el punto de equilibrio: cuánto tienes que vender
para no perder plata, con el margen que estás logrando de verdad. Debajo dice si
lo pasaste o cuánto faltó.

**Qué línea deja la plata.** Vender mucho y ganar poco es posible. Esta tabla
dice, de cada categoría, cuánto vendiste, cuánto te costó, cuánto quedó y qué
parte de tu ganancia total sale de ahí. A veces la categoría que más vende no es
la que más deja.

### Ojo con esto

Mientras no registres compras, el sistema no sabe cuánto te costó la mercancía,
así que la utilidad sale **más alta de lo real**. La pantalla te avisa arriba,
en grande, y te dice cuánta plata en ventas está sin costo. Se corrige solo a
medida que registras compras.

Los gastos que salen aquí son los que anotaste en **Gastos** con fecha dentro del
período. No se reparte nada: si consultas una semana en la que no pagaste el
arriendo, el arriendo no aparece. Es lo que de verdad pasó esa semana.

> **Sobre impuestos.** De fábrica el sistema toma tus precios como precio final,
> que es como se vende en el mostrador. Si necesitas separar IVA o impuesto al
> consumo, en **Configuración → El negocio** lo activas, le pones nombre y
> porcentaje, y desde ahí el recibo lo desglosa. El programa no asume ninguna
> tasa por su cuenta: la pones tú, porque depende de tu régimen.

---

## Créditos

Las dos mitades de lo que se fía en un barrio: **Me deben** y **A quién le debo**.

### Fiar

En la caja, al cobrar, hay una forma de pago que se llama *Fiado*. Al elegirla el
sistema pregunta **a nombre de quién queda**, y ahí se escribe como uno lo dice:
«Don Jairo», «la señora del 302», «el taller de la esquina». No hay que llenar
ninguna ficha antes.

Si ya le has fiado con ese nombre, se le suma a la misma cuenta. Si es la primera
vez, se le abre una. «don jairo» y «Don Jairo» son el mismo: si no, el saldo real
quedaría repartido en varios nombres.

**Media venta se puede fiar y media cobrar.** «Le doy veinte y el resto me lo
apunta» es de todos los días: se cobra una parte en efectivo y el resto queda
debiendo.

**Lo fiado no entra a la caja.** Esa plata no está en el cajón, así que el arqueo
no la espera y el cierre sigue cuadrando. Antes esto no existía y la caja salía
descuadrada todos los días.

### Cobrar

En **Créditos**, en la pestaña *Me deben*, está cada persona con lo que debe, de la que más debe a
la que menos. El campo de arriba busca por nombre —sin tildes, como quieras
escribirlo— y sirve igual del lado de los proveedores, ahí por nombre o por número
de compra. Los totales de arriba no cambian al buscar: siguen diciendo cuánta plata
hay afuera en total. Al abrirla se ven sus ventas fiadas, una por una, y *Recibir abono*
recibe lo que traiga: todo o una parte.

Un abono en efectivo **entra a la caja abierta** y el arqueo lo cuenta. Uno por
transferencia no pasa por el cajón. Si te equivocaste, *Ver abonos* y ahí *Anular*
devuelve la plata y el cliente vuelve a deber lo de antes.

**El cupo** es hasta cuánto se le fía a alguien. Se pone en *Datos y cupo*. Con un
tope puesto, la venta se frena cuando se pasa. Vacío es sin tope.

A quien debe no se le puede dar de baja: sería la forma de perder de vista una
deuda.

### A quién le debo

Cuando el proveedor deja la mercancía y cobra después, al recibirla se marca
**«Quedé debiendo esta compra»** y, si se sabe, cuándo hay que pagarla.

En **Créditos**, en la pestaña *A quién le debo*, salen esas compras, **de la más vencida a la más
nueva**, que es el orden en que hay que pagar. Lo vencido se ve en rojo con los
días que lleva. *Pagar* recibe el pago entero o una parte, y si es en efectivo
sale de la caja abierta.

---

## Gastos

Todo lo que sale del negocio y no es mercancía: arriendo, energía, sueldos,
bolsas, la reparación de la nevera. Cada pago se anota con su fecha, y de ahí
salen los gastos del estado de resultados.

### Anotar un gasto

*Anotar un gasto* pide cuatro cosas: cuándo, en qué, cuánto y —si quieres— una
categoría. La nota es para el número de la factura o a quién se le pagó.

Cada pago es un renglón aparte, aunque se repita. Si compraste bolsas el 3 y otra
vez el 17, son dos gastos de bolsas y no uno corregido. Así el mes suma lo que
realmente se gastó.

**El arriendo de julio se queda en julio.** Si en agosto sube, anotas el de agosto
con su valor nuevo y el de julio no se toca. Antes había un solo número mensual, y
subirlo reescribía hacia atrás todos los meses anteriores con una cifra que en su
momento no fue la real.

### Corregir y anular

El lápiz corrige: sirve para cuando escribiste mal el monto o la fecha. El
histórico guarda qué decía antes.

*Anular el gasto* es otra cosa: es para cuando el gasto no debía estar. Pide un
motivo, deja de contar en los reportes y **se queda en la lista**, tachado y con
su explicación. No se borra porque puede que ya lo hayas visto en un reporte y
después te preguntes a dónde se fue.

### Categorías

Sirven para agrupar en el estado de resultados: en vez de doce renglones sueltos
ves «Sueldos $2.847.000, 2 pagos». Vienen unas cuantas armadas y puedes agregar
las tuyas con *Categorías*.

La que nunca se usó se borra. La que ya tiene gastos detrás se desactiva en vez de
borrarse: si desapareciera, un reporte de un mes viejo diría algo distinto de lo
que decía ayer.

---

## Copias de seguridad

**Esto es lo más importante de todo el manual.**

Si el disco de este computador falla, se pierde todo: inventario, ventas,
historial. La única protección es tener copias.

El sistema hace una copia sola al cerrar caja y al cerrar el programa. Pero esas
copias están **en el mismo disco**, así que no protegen si el disco es el que
falla.

**Una vez a la semana:** entra a Configuración → Copias de seguridad, y copia el
archivo más reciente a una memoria USB. Toma treinta segundos.

Si pasan más de tres días sin copia, el sistema te lo va a recordar en la pantalla
de resumen hasta que la hagas.

**Comprobar que una copia sirve.** Al lado de cada copia hay un botón *Comprobar*.
Lo que hace es abrirla de verdad y revisar que esté completa por dentro. Vale la
pena usarlo con la que vas a llevarte a la USB: una copia dañada se ve igual de
bien que una sana en el explorador de archivos, y uno se entera el día que la
necesita. Si sale dañada, el sistema no te deja restaurarla.

### Volver a una copia

Es la operación más seria del sistema: reemplaza **todo** por lo que había el día
de esa copia. Lo que se haya registrado después desaparece de la vista.

Por eso el sistema hace dos cosas antes. Primero guarda una copia de lo que hay
en este momento, así que restaurar también se puede deshacer: si te devolviste
demasiado, la copia que dice *antes-de-restaurar* te trae de vuelta. Y segundo, te
pide escribir la palabra **RESTAURAR** — no es un botón que se pueda tocar sin
querer.

Si la copia es de una versión anterior del programa, no importa: al restaurarla el
sistema la pone al día sola.

---

## Cómo trabaja el sistema

En **Configuración → El negocio**, más abajo de tus datos, hay tres números que
puedes cambiar cuando quieras:

**Stock mínimo sugerido.** Es el que traen los productos nuevos. Por debajo de esa
cantidad aparece la alerta de que se está acabando. Cambiarlo no toca los
productos que ya tienes: a esos se los pones uno por uno en su ficha.

**Minutos para bloquear la sesión.** Si nadie toca el equipo durante ese tiempo, la
sesión se cierra sola. Sirve para cuando el cajero sale a la bodega y el
computador queda a la vista. Ponlo corto si el mostrador queda solo seguido, y
largo si siempre hay alguien.

**Días sin respaldo antes de avisar.** El sistema insiste en la pantalla de
resumen hasta que hagas una copia. Vienen tres.

Los tres empiezan a regir apenas guardas, sin cerrar el programa.

---

## Si algo sale mal

**Se fue la luz a media venta.** No pasa nada. La venta que no alcanzó a
confirmarse simplemente no existe; las anteriores están todas guardadas.

**No hay internet.** El sistema no lo usa para nada. Funciona igual.

**El programa muestra un error.** Léelo: está escrito para que se entienda y te
dice si tus datos están a salvo. Casi siempre lo son, porque las operaciones se
guardan completas o no se guardan.

**Se te olvidó la contraseña de un cajero.** Entra como administrador a
Configuración → Usuarios, toca *Cambiar contraseña* en esa persona y escribe una
nueva. Queda anotado en la auditoría que fuiste tú quien la cambió.

**Se te olvidó la contraseña de administrador.** Esta no la puede restablecer
nadie desde adentro, y es a propósito: si cualquiera pudiera, la contraseña no
serviría de nada. Por eso conviene tener **dos cuentas de administrador** desde el
principio — con la otra entras y restableces la primera.

---

## Este manual, dentro del programa

Abajo en la barra lateral está **Ayuda**: es este mismo manual, adentro. Tiene un
buscador, así que no hay que saber en qué sección quedó escrito lo que uno
necesita —escribe *falta plata* o *se fue la luz* y te lleva a donde lo explica.

Lo puede abrir cualquiera, incluido el cajero. Es a propósito: quien más lo
necesita es quien está en la caja.

---

## Por qué la pantalla se ve oscura

No es un modo que se pueda cambiar: es el único que hay, y está elegido a
propósito.

Una licorera trabaja de tarde y de noche, casi siempre a media luz, y una
pantalla blanca en un local en penumbra deslumbra —y la tienes enfrente ocho
horas. Tampoco es negro puro: con negro y blanco puros los números vibran y
cansan al leerlos, y aquí se leen cifras todo el día. Por eso el fondo es color
carbón y las letras son de un blanco cálido.

El ámbar es el color del whisky y el aguardiente, y solo se usa para lo que hay
que tocar. Cuando veas ámbar en un dato, es una alerta.

---

## Los tres roles

| Rol | Para quién | Qué puede |
|---|---|---|
| **Administrador** | El dueño | Todo: precios, costos, usuarios, respaldos, auditoría |
| **Encargado** | Persona de confianza | Vender, cuadrar caja, recibir mercancía, ajustar inventario. **No ve costos ni cambia precios** |
| **Cajero** | Quien atiende | Vender y cuadrar su caja. No anula ni ajusta inventario |

Crea una cuenta para cada persona, no una compartida. Así el sistema puede decirte
quién hizo qué, y eso es justo lo que sirve cuando algo no cuadra.

---

## Dónde están tus datos

En `%APPDATA%\PuntoDeVenta`. Puedes llegar ahí escribiendo eso mismo en la barra de
direcciones del explorador de archivos.

Actualizar el programa a una versión nueva **no toca esa carpeta**. Tus datos
siguen ahí.
