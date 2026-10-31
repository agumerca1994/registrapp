// La cara de la t, elegida en el lienzo de la marca (tools/brand/lienzo/): ojos de óvalo alto centrados en el
// travesaño y boca de arco. En el sistema del avatar: la t a 200 px, centrada en x=100, base en y=168.
// La comparten ToodAvatar y el logo animado, así la t tiene la misma cara en los dos.

/** El travesaño de la t va de x 62 a 138: su centro (100) es el centro de la cara. El palito queda en 94,5. */
export const FACE_CX = 100;
export const EYE_Y = 86;
export const EYE_SEP = 16;
export const EYE_RX = 4.4;
export const EYE_RY = 6.6;
export const EYES: [number, number][] = [[FACE_CX - EYE_SEP / 2, EYE_Y], [FACE_CX + EYE_SEP / 2, EYE_Y]];

/** El violeta de las pantallas sin cromo (el login, la pantalla de carga): la marca es el color. */
export const BRAND_FIELD = "#4A3FC4";
