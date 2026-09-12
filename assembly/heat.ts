// Elliptical falloff for regional visualization; values are not probabilities.
export function heat(
  x: f64,
  y: f64,
  z: f64,
  cx: f64,
  cy: f64,
  cz: f64,
  radius: f64,
  intensity: f64,
): f64 {
  const dx = (x - cx) / radius;
  const dy = (y - cy) / (radius * 1.25);
  const dz = (z - cz) / radius;
  return Math.exp(-2.0 * (dx * dx + dy * dy + dz * dz)) * intensity;
}
