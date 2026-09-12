import { regionName, regions, type SavedMap } from "./types";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
function wrap(text: string, width = 55) {
  const words = text
    .split(/\s+/)
    .flatMap((word) => word.match(new RegExp(`.{1,${width}}`, "g")) ?? []);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + word).length > width && line) {
      lines.push(line.trim());
      line = "";
    }
    line += `${word} `;
  }
  if (line) lines.push(line.trim());
  return lines;
}
const textLines = (
  lines: string[],
  x: number,
  y: number,
  size = 16,
  step = 25,
) =>
  lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * step}" font-size="${size}">${escape(line)}</text>`,
    )
    .join("");
export function renderMapSvg(map: SavedMap) {
  const regionLines = wrap(
    map.map.regions.map(regionName).join(", ") || "Not specified",
  );
  const summaryTop = 350 + (regionLines.length - 1) * 24;
  const summaryLines = wrap(map.map.summary);
  const facts = wrap(
    `Feeling: ${map.map.quality}. Activity: ${map.map.activity}. Timing: ${map.map.duration}. Intensity: ${map.map.intensity === null ? "not reported" : `${map.map.intensity}/10`}.`,
  );
  const factsTop = summaryTop + summaryLines.length * 25 + 34;
  let pinY = 670;
  const pinLabels = (map.points ?? [])
    .map((point, i) => {
      const lines = wrap(
        `${i + 1}. ${regionName(point.region)} — ${point.structure}`,
        37,
      );
      const markup = textLines(lines, 55, pinY, 12, 19);
      pinY += lines.length * 19 + 12;
      return markup;
    })
    .join("");
  const referenceTop = Math.max(745, pinY, factsTop + facts.length * 25) + 40;
  let referenceY = referenceTop + 31;
  const references = (map.references ?? [])
    .filter((r) => r.url.startsWith("https://"))
    .map((reference, i) => {
      const lines = wrap(
        `[${i + 1}] ${reference.publisher}: ${reference.title}`,
        108,
      );
      const markup = `<a href="${escape(reference.url)}">${textLines(lines, 55, referenceY, 14, 21)}</a>`;
      referenceY += lines.length * 21 + 8;
      const urls = wrap(reference.url, 130);
      const address = textLines(urls, 75, referenceY, 10, 15);
      referenceY += urls.length * 15 + 25;
      return markup + address;
    })
    .join("");
  const height = Math.max(960, referenceY + 165);
  const circles = map.map.regions
    .filter((id) => !map.points?.some((p) => p.region === id))
    .map((id) => {
      const r = regions.find((r) => r.id === id);
      if (!r) return "";
      const back = id.includes("back");
      return `<circle cx="${(back ? 283 : 119) + r.center[0] * (back ? -46 : 46)}" cy="${465 - r.center[1] * 46}" r="23" fill="url(#heat)"/>`;
    })
    .join("");
  const points = (map.points ?? [])
    .map((point, i) => {
      const back = point.position[2] < 0,
        x = (back ? 283 : 119) + point.position[0] * (back ? -46 : 46),
        y = 465 - point.position[1] * 46;
      return `<circle cx="${x}" cy="${y}" r="18" fill="url(#heat)"/><circle cx="${x}" cy="${y}" r="8" fill="#8a4527"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="9" fill="white">${i + 1}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}">
<defs><radialGradient id="heat"><stop stop-color="#e17c49" stop-opacity=".85"/><stop offset="1" stop-color="#e17c49" stop-opacity="0"/></radialGradient></defs>
<rect width="1000" height="${height}" fill="#f5f6ef"/><g font-family="Arial,sans-serif" fill="#23382e">
<text x="55" y="75" font-size="30" font-weight="700">iHurt<tspan fill="#768870">.app</tspan></text><text x="55" y="125" font-size="14">PERSONAL HURT MAP · ${escape(new Date(map.created).toLocaleDateString())}</text>
${textLines(wrap(map.map.title, 65), 55, 180, 24, 31)}
<defs><g id="body" fill="#c0c9bc" stroke="#f5f6ef" stroke-width="3"><ellipse cx="210" cy="261" rx="23" ry="30"/><path d="M198 286L194 303L162 310L145 370L121 440L130 470L142 450L154 391L173 349L180 430L176 484L180 540L180 613L169 634L195 634L204 538L210 474L216 538L226 634L250 634L239 613L240 540L243 484L240 430L247 349L266 391L278 450L290 470L299 440L275 370L258 310L226 303L222 286Z"/></g></defs>
<use href="#body" transform="translate(-15 165) scale(.639)"/><use href="#body" transform="translate(149 165) scale(.639)"/>
${circles}${points}<text x="99" y="604" font-size="11">FRONT</text><text x="265" y="604" font-size="11">BACK</text><text x="55" y="638" font-size="11">Approximate projection of your pinned locations.</text>${pinLabels}
<text x="380" y="252" font-size="13" fill="#60715c">REPORTED REGIONS</text>${textLines(regionLines, 380, 281)}
<text x="380" y="${summaryTop - 28}" font-size="13" fill="#60715c">YOUR DESCRIPTION</text>${textLines(summaryLines, 380, summaryTop)}
<text x="380" y="${factsTop - 26}" font-size="13" fill="#60715c">CONTEXT YOU PROVIDED</text>${textLines(facts, 380, factsTop, 14, 25)}
<text x="55" y="${referenceTop}" font-size="13" fill="#60715c">${references ? "RELATED READING · SELECTED SOURCES" : "NO READING REFERENCES SELECTED"}</text>${references}
<text x="55" y="${height - 128}" font-size="12">Organized with ${escape(map.provider)}. Review this record; it can contain errors.</text><path d="M55 ${height - 104}H945" stroke="#c7cec1"/>
<text x="55" y="${height - 76}" font-size="13" font-weight="700">Not medical advice. Does not diagnose, treat, cure, or prevent any disease.</text>
<text x="55" y="${height - 53}" font-size="12">Colors show reported discomfort. Reading links are not a diagnosis or a personalized treatment plan.</text>
<text x="55" y="${height - 30}" font-size="12">${map.map.urgent ? "Potential urgent symptoms were reported. Seek urgent medical help; do not wait for this map." : "This file contains personal symptom information. Keep and share it carefully."}</text></g></svg>`;
}
export function download(map: SavedMap, format: "svg" | "json") {
  const content =
    format === "svg"
      ? renderMapSvg(map)
      : JSON.stringify(
          {
            schema_version: 1,
            ...map,
            atlas:
              "Z-Anatomy normalized coordinates: height 5.85, floor -2.5, subject left +x, anterior +z",
            notice:
              "For personal reflection and education only. Not medical advice. Does not diagnose, treat, cure, or prevent any disease. Heat shows reported discomfort, not disease likelihood. Reading links are educational references, not a personalized treatment plan.",
          },
          null,
          2,
        );
  const blob = new Blob([content], {
    type: format === "svg" ? "image/svg+xml" : "application/json",
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `ihurt-map-${map.created.slice(0, 10)}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
