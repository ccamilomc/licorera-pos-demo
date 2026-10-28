-- =============================================================================
-- TRIBUNA POS - Datos base
-- Lo minimo para que el sistema arranque. No incluye productos: esos
-- entran por la importacion del Excel.
-- =============================================================================

INSERT INTO roles (codigo, nombre, descripcion) VALUES
  ('ADMINISTRADOR', 'Administrador',
   'El dueño. Acceso total, incluidos costos, precios, usuarios y respaldos.'),
  ('ENCARGADO', 'Encargado',
   'Persona de confianza que abre y cierra el local. Opera todo menos costos, precios y usuarios.'),
  ('CAJERO', 'Cajero',
   'Atiende y vende. No anula, no ajusta inventario, no ve costos.');

-- Permisos. Los codigos son constantes en el codigo fuente; esta tabla
-- decide quien los tiene. Cambiar un permiso no exige recompilar.
INSERT INTO rol_permisos (rol, permiso) VALUES
  -- Administrador: todo
  ('ADMINISTRADOR','venta.crear'),        ('ADMINISTRADOR','venta.anular'),
  ('ADMINISTRADOR','venta.ver_todas'),    ('ADMINISTRADOR','venta.descuento'),
  ('ADMINISTRADOR','caja.abrir'),         ('ADMINISTRADOR','caja.cerrar'),
  ('ADMINISTRADOR','caja.movimiento'),    ('ADMINISTRADOR','caja.ver_todas'),
  ('ADMINISTRADOR','producto.crear'),     ('ADMINISTRADOR','producto.editar'),
  ('ADMINISTRADOR','producto.desactivar'),('ADMINISTRADOR','producto.precio'),
  ('ADMINISTRADOR','inventario.ajustar'), ('ADMINISTRADOR','inventario.ver'),
  ('ADMINISTRADOR','compra.registrar'),   ('ADMINISTRADOR','compra.anular'),
  ('ADMINISTRADOR','proveedor.gestionar'),
  ('ADMINISTRADOR','costo.ver'),          ('ADMINISTRADOR','utilidad.ver'),
  ('ADMINISTRADOR','reporte.operacion'),  ('ADMINISTRADOR','reporte.financiero'),
  ('ADMINISTRADOR','usuario.gestionar'),  ('ADMINISTRADOR','permiso.gestionar'),
  ('ADMINISTRADOR','config.editar'),      ('ADMINISTRADOR','auditoria.ver'),
  ('ADMINISTRADOR','respaldo.crear'),     ('ADMINISTRADOR','respaldo.restaurar'),
  ('ADMINISTRADOR','excel.importar'),     ('ADMINISTRADOR','excel.exportar'),

  -- Encargado: opera el local, no toca dinero de fondo ni precios
  ('ENCARGADO','venta.crear'),            ('ENCARGADO','venta.anular'),
  ('ENCARGADO','venta.ver_todas'),        ('ENCARGADO','venta.descuento'),
  ('ENCARGADO','caja.abrir'),             ('ENCARGADO','caja.cerrar'),
  ('ENCARGADO','caja.movimiento'),        ('ENCARGADO','caja.ver_todas'),
  ('ENCARGADO','producto.crear'),         ('ENCARGADO','producto.editar'),
  ('ENCARGADO','inventario.ajustar'),     ('ENCARGADO','inventario.ver'),
  ('ENCARGADO','compra.registrar'),       ('ENCARGADO','proveedor.gestionar'),
  ('ENCARGADO','reporte.operacion'),      ('ENCARGADO','excel.exportar'),

  -- Cajero: vende y cuadra su caja
  ('CAJERO','venta.crear'),               ('CAJERO','caja.abrir'),
  ('CAJERO','caja.cerrar'),               ('CAJERO','inventario.ver');

INSERT INTO metodos_pago (codigo, nombre, es_efectivo, orden) VALUES
  ('EFECTIVO',      'Efectivo',      1, 1),
  ('TRANSFERENCIA', 'Transferencia', 0, 2),
  ('TARJETA',       'Tarjeta',       0, 3);

-- Categorias en el mismo orden en que estan en el Excel del negocio.
INSERT INTO categorias (nombre, orden) VALUES
  ('Whisky', 1), ('Tequila', 2), ('Vodka', 3), ('Ron', 4),
  ('Aguardiente', 5), ('Brandy', 6), ('Ginebra', 7),
  ('Champaña y vinos', 8), ('Cervezas', 9), ('Gaseosas y aguas', 10),
  ('Cigarrillos', 11), ('Papas y dulces', 12);

INSERT INTO configuracion (clave, valor, tipo, descripcion) VALUES
  -- Vacio: lo pone el dueño al crear su cuenta. Traer aqui el nombre de
  -- un local en concreto haria que el programa saludara a todos los demas
  -- con el nombre de otro negocio.
  ('negocio.nombre',        '',                    'TEXTO',   'Nombre del negocio'),
  ('negocio.nit',           '',                    'TEXTO',   'NIT o documento'),
  ('negocio.direccion',     '',                    'TEXTO',   'Direccion'),
  ('negocio.telefono',      '',                    'TEXTO',   'Telefono'),
  ('moneda.codigo',         'COP',                 'TEXTO',   'Moneda'),
  ('moneda.simbolo',        '$',                   'TEXTO',   'Simbolo'),
  ('impuesto.activo',       '0',                   'BOOLEANO','Cobrar impuesto en la venta'),
  ('impuesto.porcentaje',   '0',                   'NUMERO',  'Porcentaje de impuesto'),
  ('inventario.permitir_negativo','1',             'BOOLEANO','Vender sin existencia (marca la venta como faltante)'),
  ('inventario.stock_minimo_defecto','3',          'NUMERO',  'Stock minimo sugerido para productos nuevos'),
  ('respaldo.al_cerrar_app','1',                   'BOOLEANO','Copia automatica al cerrar'),
  ('respaldo.al_cerrar_caja','1',                  'BOOLEANO','Copia automatica al cerrar caja'),
  ('respaldo.carpeta_secundaria','',               'TEXTO',   'Segunda carpeta de respaldo (USB o disco externo)'),
  ('respaldo.dias_alerta',  '3',                   'NUMERO',  'Dias sin respaldo antes de alertar'),
  ('sesion.minutos_inactividad','15',              'NUMERO',  'Minutos antes de bloquear la sesion'),
  ('venta.numero_siguiente','1',                   'NUMERO',  'Consecutivo de venta'),
  ('gastos.arriendo',       '800000',              'NUMERO',  'Gasto fijo mensual: arriendo'),
  ('gastos.energia',        '200000',              'NUMERO',  'Gasto fijo mensual: energia'),
  ('gastos.internet',       '50000',               'NUMERO',  'Gasto fijo mensual: internet'),
  ('gastos.aseo',           '25000',               'NUMERO',  'Gasto fijo mensual: aseo'),
  ('gastos.bolsas',         '15000',               'NUMERO',  'Gasto fijo mensual: bolsas');

-- 10 proveedores de ejemplo.
INSERT INTO proveedores (nombre) VALUES
  ('Distribuidora Uno'), ('Distribuidora Dos'), ('Distribuidora Tres'), ('Distribuidora Cuatro'), ('Distribuidora Cinco'),
  ('Gaseosas SA'), ('Mayorista Seis'), ('Cervecera Siete'), ('Almacen Ocho'), ('Snacks Nueve');
