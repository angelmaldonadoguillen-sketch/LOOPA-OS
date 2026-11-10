// Producción de LOOPA: las capas flotantes (menús, editores, el fantasma de
// arrastre) se dibujan fuera del árbol de la pantalla. Van a una capa propia
// con la clase .estudio, para que tengan los estilos de producción sin que
// esos estilos toquen el resto de LOOPA.
const capaEstudio = () => {
  let c = document.getElementById('estudio-capa');
  if (!c) {
    c = document.createElement('div');
    c.id = 'estudio-capa';
    c.className = 'estudio';
    document.body.appendChild(c);
  }
  return c;
};
