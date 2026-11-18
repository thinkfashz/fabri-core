/* Manifiesto de navegación del panel Negocio.
   Las páginas se construyen en la fase 2; hasta entonces todo queda `pronto`
   y el shell no inventa enlaces que terminen en 404. */
export const PANEL = 'negocio';

export const NAV = [
  {
    seccion: 'Operación',
    items: [
      { ruta: '/panel/negocio/resumen/', texto: 'Resumen', icono: 'inicio', pronto: true },
      { ruta: '/panel/negocio/pedidos/', texto: 'Pedidos', icono: 'pedidos', pronto: true },
      { ruta: '/panel/negocio/notificaciones/', texto: 'Notificaciones', icono: 'campana', pronto: true },
    ],
  },
  {
    seccion: 'Catálogo',
    items: [
      { ruta: '/panel/negocio/productos/', texto: 'Productos', icono: 'caja', pronto: true },
      { ruta: '/panel/negocio/inventario/', texto: 'Inventario', icono: 'lista', pronto: true },
      { ruta: '/panel/negocio/ofertas/', texto: 'Ofertas', icono: 'etiqueta', pronto: true },
    ],
  },
  {
    seccion: 'Mi negocio',
    items: [
      { ruta: '/panel/negocio/tienda/', texto: 'Mi tienda', icono: 'tienda', pronto: true },
      { ruta: '/panel/negocio/horarios/', texto: 'Horarios y entrega', icono: 'reloj', pronto: true },
      { ruta: '/panel/negocio/resenas/', texto: 'Reseñas', icono: 'estrella', pronto: true },
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
      { ruta: '/panel/negocio/equipo/', texto: 'Equipo', icono: 'equipo', pronto: true },
      { ruta: '/panel/negocio/auditoria/', texto: 'Auditoría', icono: 'escudo', pronto: true },
      { ruta: '/panel/negocio/ajustes/', texto: 'Ajustes', icono: 'ajustes', pronto: true },
      { ruta: '/panel/negocio/integraciones/', texto: 'Integraciones', icono: 'nube', pronto: true },
    ],
  },
];
