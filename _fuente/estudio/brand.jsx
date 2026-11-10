// ─────────────────────────────────────────────────────────────────
// MARCA — el logo de FRAME, dibujado una sola vez para toda la app.
// Viene del SVG original (FRAME LOOOGO.svg). Usa currentColor: toma el
// color del texto donde se pone, así sirve en modo claro y oscuro sin
// versiones aparte.
//
//   <FrameMark size={28}/>        solo los bloques (alto en px)
//   <FrameWordmark height={14}/>  solo la palabra «frame»
//   <FrameLogo height={22}/>      bloques + palabra
// ─────────────────────────────────────────────────────────────────

// Seis bloques que forman la F: columna de cuatro y dos a la derecha.
const FRAME_MARK_BLOCKS = [[0, 0], [0, 12.62], [19.86, 0], [0, 25.24], [0, 37.86], [19.86, 24.9]];
const FRAME_MARK_BOX = { width: 37.99, height: 47.39 };

const FrameMarkBlocks = () => FRAME_MARK_BLOCKS.map(([x, y]) => (
  <rect key={x + '-' + y} x={x} y={y} width="18.13" height="9.53" rx=".93" ry=".93" />
));

// Letras de «frame», en las coordenadas del SVG original.
const FRAME_WORDMARK_PATHS = [
  'M71.49,14.07c.5-.53,1.21-.79,2.14-.79.49,0,.95.07,1.38.2.43.14.83.33,1.18.57l1.67-4.6c-.6-.41-1.32-.71-2.18-.9-.85-.19-1.74-.29-2.67-.29-2.71,0-4.8.74-6.27,2.22-1.46,1.48-2.2,3.45-2.2,5.92v.98h-3.38v4.88h3.38v16.52h6.35v-16.52h5.45v-4.88h-5.62v-.94c0-1.06.25-1.85.75-2.38Z',
  'M86.4,19.81v-2.91h-6.06v21.89h6.35v-10.34c0-2.09.54-3.63,1.61-4.62,1.07-.99,2.48-1.49,4.21-1.49.24,0,.47,0,.69.02.22.01.46.03.73.06v-5.86c-2.06,0-3.81.4-5.25,1.2-.93.52-1.68,1.21-2.28,2.04Z',
  'M113.54,18.94c-1.85-1.57-4.44-2.36-7.77-2.36-1.74,0-3.45.23-5.13.69-1.68.46-3.12,1.11-4.31,1.95l2.28,4.44c.79-.62,1.74-1.12,2.87-1.49,1.12-.37,2.27-.55,3.44-.55,1.71,0,2.98.38,3.8,1.14.83.76,1.24,1.82,1.24,3.17h-5.05c-2.22,0-4.03.28-5.41.83-1.38.56-2.39,1.32-3.03,2.3-.64.98-.96,2.12-.96,3.42s.33,2.37.98,3.38c.65,1,1.59,1.8,2.81,2.38s2.69.88,4.39.88c1.93,0,3.5-.37,4.72-1.1.83-.5,1.47-1.17,1.95-1.98v2.76h5.94v-12.49c0-3.34-.92-5.79-2.77-7.36ZM108.13,34.09c-.84.5-1.79.75-2.85.75-1.11,0-1.99-.24-2.62-.71-.64-.47-.96-1.12-.96-1.93,0-.73.28-1.34.83-1.83.56-.49,1.58-.73,3.07-.73h4.35v2.24c-.38.98-.99,1.72-1.83,2.22Z',
  'M152.26,17.61c-1.34-.69-2.88-1.04-4.62-1.04-2.09,0-3.94.5-5.55,1.51-.93.58-1.69,1.28-2.32,2.09-.51-.83-1.15-1.53-1.95-2.07-1.51-1.02-3.26-1.53-5.27-1.53-1.79,0-3.38.39-4.78,1.16-.81.45-1.5,1.03-2.1,1.72v-2.56h-6.06v21.89h6.35v-10.99c0-1.3.2-2.37.61-3.21s.98-1.47,1.71-1.89c.73-.42,1.56-.63,2.48-.63,1.33,0,2.35.42,3.07,1.26.72.84,1.08,2.14,1.08,3.91v11.56h6.35v-10.99c0-1.3.2-2.37.61-3.21s.98-1.47,1.71-1.89c.73-.42,1.56-.63,2.48-.63,1.33,0,2.36.42,3.09,1.26.73.84,1.1,2.14,1.1,3.91v11.56h6.35v-12.53c0-2.22-.39-4.05-1.16-5.47-.77-1.42-1.83-2.48-3.17-3.17Z',
  'M179.83,21.85c-1-1.7-2.37-3-4.09-3.91-1.72-.91-3.66-1.36-5.8-1.36s-4.22.48-5.98,1.44c-1.76.96-3.15,2.29-4.17,3.99-1.02,1.7-1.53,3.64-1.53,5.84s.51,4.1,1.55,5.8c1.03,1.7,2.49,3.03,4.37,4.01,1.88.98,4.08,1.46,6.57,1.46,1.98,0,3.73-.31,5.25-.92,1.52-.61,2.78-1.49,3.78-2.62l-3.38-3.66c-.73.71-1.54,1.23-2.42,1.59-.88.35-1.91.53-3.07.53-1.3,0-2.44-.24-3.4-.71-.96-.47-1.71-1.17-2.24-2.08-.29-.49-.49-1.03-.62-1.61h16.55c.03-.27.05-.56.08-.88.03-.31.04-.59.04-.83,0-2.36-.5-4.39-1.51-6.08ZM167.11,22.09c.83-.47,1.78-.71,2.87-.71s2.03.24,2.85.71,1.45,1.13,1.91,1.97c.31.56.5,1.18.6,1.87h-10.76c.11-.68.3-1.3.59-1.85.46-.85,1.1-1.52,1.93-1.99Z',
];
// Caja de la palabra sola: del borde izquierdo de la f al derecho de la e.
const FRAME_WORDMARK_BOX = { x: 61.16, y: 8.26, width: 120.17, height: 30.87 };
const FRAME_LOGO_BOX = { width: 181.33, height: 47.39 };

// LOOPA (un solo sistema): la marca que se ve es la de LOOPA (window.LOOPA_SVG,
// el mismo logo del menú). Las piezas de abajo quedan sólo por compatibilidad.
const MarcaLoopa = ({ size = 24, className = '', label = 'LOOPA' }) => {
  const L0 = window.LOOPA_SVG || { viewBox: '0 0 201.77 31.12', inner: '' };
  return (
    <svg viewBox={L0.viewBox} height={Math.round(size * 0.62)} fill="currentColor" className={className}
         role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'} focusable="false"
         style={{ display: 'inline-block', maxWidth: '100%' }} dangerouslySetInnerHTML={{ __html: L0.inner }} />
  );
};
const FrameMark = ({ size = 24, className = '' }) => <MarcaLoopa size={size} className={className} />;

const FrameWordmark = ({ height = 14, className = '', label }) => (
  <svg viewBox={`${FRAME_WORDMARK_BOX.x} ${FRAME_WORDMARK_BOX.y} ${FRAME_WORDMARK_BOX.width} ${FRAME_WORDMARK_BOX.height}`} height={height}
       width={Math.round(height * FRAME_WORDMARK_BOX.width / FRAME_WORDMARK_BOX.height * 100) / 100}
       fill="currentColor" className={className} role={label ? 'img' : undefined}
       aria-label={label} aria-hidden={label ? undefined : 'true'} focusable="false">
    {FRAME_WORDMARK_PATHS.map(d => <path key={d.slice(0, 12)} d={d} />)}
  </svg>
);

const FrameLogo = ({ height = 22, className = '' }) => <MarcaLoopa size={Math.round(height / 0.62)} className={className} />;
