/**
 * The color of a light at a color temperature, as sRGB in [0, 1]: 2700 K is a warm bulb, 6500 K
 * daylight. Tanner Helland's fit to the blackbody curve, close enough for lighting a room.
 */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const unit = (v: number) => Math.min(Math.max(v, 0), 255) / 255;
  return [unit(red), unit(green), unit(blue)];
}

/** How a color temperature reads to people choosing bulbs. */
export function warmthLabel(kelvin: number): string {
  if (kelvin <= 3200) return 'warm';
  if (kelvin <= 4500) return 'neutral';
  return 'daylight';
}
