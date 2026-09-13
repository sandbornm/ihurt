import { regionName, regions, type SavedMap } from "./types.ts";
import { stringifyNotebook } from "./notebook-data.ts";

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
    [
      map.map.quality && `Feeling: ${map.map.quality}.`,
      map.map.activity && `Activity: ${map.map.activity}.`,
      map.map.duration && `Timing: ${map.map.duration}.`,
      map.map.intensity !== null && `Intensity: ${map.map.intensity}/10.`,
    ]
      .filter(Boolean)
      .join(" ") || "No additional context recorded.",
  );
  const factsTop = summaryTop + summaryLines.length * 25 + 34;
  let pinY = 670;
  const pinLabels = (map.points ?? [])
    .map((point, i) => {
      const lines = wrap(
        `${i + 1}. ${regionName(point.region)} — ${point.structure}${point.comment ? `. ${point.comment}` : ""}`,
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
<text x="55" y="${height - 128}" font-size="12">Personal journal · your notes and selected locations.</text><path d="M55 ${height - 104}H945" stroke="#c7cec1"/>
<text x="55" y="${height - 76}" font-size="13" font-weight="700">Not medical advice. Does not diagnose, treat, cure, or prevent any disease.</text>
<text x="55" y="${height - 53}" font-size="12">Colors show reported discomfort. Reading links are not a diagnosis or a personalized treatment plan.</text>
<text x="55" y="${height - 30}" font-size="12">${map.map.urgent ? "Potential urgent symptoms were reported. Seek urgent medical help; do not wait for this map." : "This file contains personal symptom information. Keep and share it carefully."}</text></g></svg>`;
}
export function download(map: SavedMap, format: "svg" | "json") {
  const content =
    format === "svg" ? renderMapSvg(map) : stringifyNotebook([map]);
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
export function downloadNotebook(entries: SavedMap[]) {
  const url = URL.createObjectURL(
    new Blob([stringifyNotebook(entries)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `ihurt-notebook-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function renderPrintHtml(entry: SavedMap): string {
  const svg = renderMapSvg(entry).replace(
    /width="1000" height="\d+" viewBox="0 0 1000 \d+"/,
    'width="340" height="370" viewBox="35 280 315 340"',
  );
  const facts = [
    entry.map.activity,
    entry.map.quality,
    entry.map.duration,
    entry.map.intensity === null ? "" : `${entry.map.intensity}/10`,
  ].filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><title>iHurt - ${escape(entry.map.title)}</title><style>
  *{box-sizing:border-box}body{margin:0;color:#24382a;font:11pt/1.5 Arial,sans-serif;background:white}main{max-width:780px;margin:auto;padding:30px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #9eae94;padding-bottom:16px;margin-bottom:24px}.brand{font-size:25pt;font-weight:bold}small{font-size:9pt;color:#5b6c57}h1{font-size:23pt;line-height:1.15;margin:12px 0}h2{font-size:10pt;letter-spacing:.08em;text-transform:uppercase;margin:24px 0 12px}p{white-space:pre-wrap;overflow-wrap:anywhere}figure{margin:0;padding:12px;background:#f5f6ef;border-radius:14px;float:left;width:44%;margin-right:24px;margin-bottom:16px}figure svg{width:100%;height:auto;display:block}figcaption{font-size:8pt;text-align:center;color:#64745b}.context{color:#5b6c57}.pins{clear:both;padding-top:8px}.pin{break-inside:avoid;display:flex;gap:14px;margin:12px 0;padding:12px 0;border-top:1px solid #dfe5d9}.pin b{display:grid;place-items:center;border-radius:50%;width:26px;height:26px;flex-shrink:0;background:#d9eac7}.pin p{margin:3px 0}.reference{break-inside:avoid;margin:14px 0}a{color:#365b25;overflow-wrap:anywhere}.notice{clear:both;font-size:9pt;border-top:1px solid #ccd7c3;margin-top:28px;padding-top:12px}h1,h2{break-after:avoid}@page{size:A4;margin:18mm 16mm}@media print{main{padding:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}button{display:none}}button{cursor:pointer;padding:10px 16px;margin-bottom:18px;border:1px solid #687d5d;border-radius:8px;background:#edf5e5}</style></head><body><main><header><span class="brand">iHurt.</span><small>PERSONAL JOURNAL<br/>${escape(new Date(entry.created).toLocaleDateString())}</small></header><h1>${escape(entry.map.title)}</h1><p class="context">${escape(facts.join(" · "))}</p><figure>${svg}<figcaption>Front and back · approximate pin locations</figcaption></figure><h2>Your note</h2><p>${escape(entry.note || "No note recorded.")}</p><section class="pins"><h2>Highlighted spots</h2>${(entry.points ?? []).map((p, i) => `<div class="pin"><b>${i + 1}</b><div><strong>${escape(p.structure)}</strong><small> · ${escape(regionName(p.region))}</small><p>${escape(p.comment || "No comment recorded.")}</p></div></div>`).join("") || "<p>No surface pins recorded.</p>"}</section>${entry.ai ? `<section><h2>Optional AI note · ${escape(entry.ai.provider)}</h2><p>${escape(entry.ai.map.summary)}</p><small>AI interpretation; it may refer to an earlier version of this entry.</small></section>` : ""}<section><h2>Related reading</h2>${(entry.references ?? []).map((r, i) => `<div class="reference"><strong>${i + 1}. ${escape(r.title)}</strong><br/><small>${escape(r.publisher)} · checked ${escape(r.checked)}</small><br/><a href="${escape(r.url)}">${escape(r.url)}</a></div>`).join("") || "<p>No reading links saved.</p>"}</section><p class="notice">Not medical advice. iHurt does not diagnose, treat, cure, or prevent disease. Colors show reported discomfort, not a cause. Independent reading links are not a personal treatment plan. This report contains personal information.</p></main></body></html>`;
}
export function printMap(entry: SavedMap): boolean {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.opener = null;
  popup.addEventListener("load", () => popup.print(), { once: true });
  popup.document.write(renderPrintHtml(entry));
  popup.document.close();
  return true;
}
