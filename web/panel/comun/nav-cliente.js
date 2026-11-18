/* Manifiesto de navegación del panel Cliente.
   Solo enlaces reales; lo que todavía no existe queda marcado `pronto` para
   no llevar a una página en blanco. */
export const PANEL = 'cliente';

export const NAV = [
  {
    seccion: 'Descubrir',
    items: [
      { ruta: '/panel/cliente/inicio/', texto: 'Inicio', icono: 'inicio' },
      { ruta: '/panel/cliente/mapa/', texto: 'Mapa', icono: 'mapa' },
      { ruta: '/panel/cliente/buscar/', texto: 'Buscar', icono: 'buscar' },
    ],
  },
  {
    seccion: 'Mi compra',
    items: [
      { ruta: '/panel/cliente/carrito/', texto: 'Carrito', icono: 'carrito', contador: 'carrito' },
      { ruta: '/panel/cliente/pedidos/', texto: 'Mis pedidos', icono: 'pedidos', pronto: true },
      { ruta: '/panel/cliente/favoritos/', texto: 'Favoritos', icono: 'corazon', pronto: true },
    ],
  },
  {
    seccion: 'Mi cuenta',
    items: [
      { ruta: '/panel/cliente/cuenta/', texto: 'Cuenta', icono: 'cuenta' },
      { ruta: '/panel/cliente/ayuda/', texto: 'Ayuda', icono: 'ayuda' },
    ],
  },
];
