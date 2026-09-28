/** 昼夜柔光的四套色域。界面外观决定明度，时段只决定色温；渐变在裁切前归零。 */
export interface NxAmbientPalette {
  core: string;
  middle: string;
  edge: string;
  companion: string;
  companionMiddle: string;
  companionEdge: string;
}

const DAY_LIGHT: NxAmbientPalette = {
  core: '#70ED9B57', middle: '#2FED9B57', edge: '#00ED9B57',
  companion: '#5CF2C676', companionMiddle: '#24F2C676', companionEdge: '#00F2C676',
};
const DAY_DARK: NxAmbientPalette = {
  core: '#767F5436', middle: '#307F5436', edge: '#007F5436',
  companion: '#4D9E8051', companionMiddle: '#1F9E8051', companionEdge: '#009E8051',
};
const NIGHT_LIGHT: NxAmbientPalette = {
  core: '#4D9682B0', middle: '#209682B0', edge: '#009682B0',
  companion: '#3DA9A1BC', companionMiddle: '#19A9A1BC', companionEdge: '#00A9A1BC',
};
const NIGHT_DARK: NxAmbientPalette = {
  core: '#806F5198', middle: '#366F5198', edge: '#006F5198',
  companion: '#5C837B9B', companionMiddle: '#22837B9B', companionEdge: '#00837B9B',
};

export function nxAmbientPalette(dark: boolean, period: string): NxAmbientPalette {
  return period === 'night' ? (dark ? NIGHT_DARK : NIGHT_LIGHT) : (dark ? DAY_DARK : DAY_LIGHT);
}

interface AmbientMotion {
  fade: number;
  drift: number;
  quietAfter: number;
}

export const NxAmbientMotion: AmbientMotion = {
  fade: 760,
  drift: 8000,
  quietAfter: 10000,
};
