/* Manifiesto de navegación del panel Negocio.
   `pronto: true` deja el enlace como texto sin destino: el shell nunca
   inventa enlaces que terminen en 404. Se apaga a medida que cada módulo
   existe de verdad. */
export const PANEL = 'negocio';

export const NAV = [
  {
    seccion: 'Operación',
    items: [
      { ruta: '/panel/negocio/resumen/', texto: 'Resumen', icono: 'inicio' },
      { ruta: '/panel/negocio/pedidos/', texto: 'Pedidos', icono: 'pedidos' },
      { ruta: '/panel/negocio/notificaciones/', texto: 'Notificaciones', icono: 'campana' },
    ],
  },
  {
    seccion: 'Catálogo',
    items: [
      { ruta: '/panel/negocio/productos/', texto: 'Productos', icono: 'caja' },
      { ruta: '/panel/negocio/inventario/', texto: 'Inventario', icono: 'lista' },
      { ruta: '/panel/negocio/ofertas/', texto: 'Ofertas', icono: 'etiqueta', pronto: true },
    ],
  },
  {
    seccion: 'Mi negocio',
    items: [
      { ruta: '/panel/negocio/tienda/', texto: 'Mi tienda', icono: 'tienda' },
      { ruta: '/panel/negocio/horarios/', texto: 'Horarios y entrega', icono: 'reloj' },
      { ruta: '/panel/negocio/resenas/', texto: 'Reseñas', icono: 'estrella' },
    ],
  },
  {
    seccion: 'Crecimiento',
    items: [
      { ruta: '/panel/negocio/clientes/', texto: 'Clientes', icono: 'cuenta', pronto: true },
      { ruta: '/panel/negocio/reportes/', texto: 'Reportes', icono: 'grafico', pronto: true },
      { ruta: '/panel/negocio/cupones/', texto: 'Cupones', icono: 'cupon', pronto: true },
    ],
  },
  {
    seccion: 'Configuración',
    items: [
      { ruta: '/panel/negocio/pagos/', texto: 'Pagos', icono: 'tarjeta', pronto: true },
      { ruta: '/panel/negocio/equipo/', texto: 'Equipo', icono: 'cuenta', pronto: true },
      { ruta: '/panel/negocio/auditoria/', texto: 'Auditoría', icono: 'escudo', pronto: true },
      { ruta: '/panel/negocio/ajustes/', texto: 'Ajustes', icono: 'ajustes' },
      { ruta: '/panel/negocio/integraciones/', texto: 'Integraciones', icono: 'nube', pronto: true },
    ],
  },
];
