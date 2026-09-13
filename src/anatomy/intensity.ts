export function intensityColor(value: number | null) {
  if (value === null) return "#c4ed76";
  const stops = [
    [98, 186, 240],
    [159, 217, 130],
    [255, 178, 101],
    [237, 91, 68],
  ];
  const amount = (Math.max(0, Math.min(10, value)) / 10) * 3;
  const index = Math.min(2, Math.floor(amount)),
    blend = amount - index;
  return (
    "#" +
    stops[index]
      .map((v, i) =>
        Math.round(v + (stops[index + 1][i] - v) * blend)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
