import { regionName, regions, type SavedMap } from "./types.ts";
import {
  stringifyNotebook,
  exportNotebook,
  aiPrompt,
} from "./notebook-data.ts";
import type { ViewportCapture } from "./anatomy/capture";
import { intensityColor } from "./anatomy/intensity.ts";

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
<defs><radialGradient id="heat"><stop stop-color="${intensityColor(map.map.intensity)}" stop-opacity=".85"/><stop offset="1" stop-color="${intensityColor(map.map.intensity)}" stop-opacity="0"/></radialGradient></defs>
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
export function stringifyIhm(map: SavedMap) {
  return JSON.stringify(
    {
      ...exportNotebook([map]),
      bundle: { kind: "ihurt.map", version: 1 },
      review_request: aiPrompt,
      materials: [
        {
          name: "hurt-map.svg",
          media_type: "image/svg+xml",
          purpose:
            "Derived heatmap preview. The highlights contain the original anatomy coordinates.",
          content: renderMapSvg(map),
        },
      ],
    },
    null,
    2,
  );
}
export function download(map: SavedMap, format: "svg" | "json" | "ihm") {
  const content = format === "svg" ? renderMapSvg(map) : stringifyIhm(map);
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
export function downloadViewport(view: ViewportCapture, created: string) {
  const link = document.createElement("a");
  link.href = view.image;
  link.download = `ihurt-view-${created.slice(0, 10)}.png`;
  link.click();
}
function printProse(text: string) {
  const inline = (value: string) =>
    escape(value)
      .replace(
        /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
        (match, title: string, href: string) => {
          try {
            const url = new URL(href.replaceAll("&amp;", "&"));
            if (url.protocol !== "https:" || url.username || url.password)
              return match;
            return `<a href="${href}">${title}</a>`;
          } catch {
            return match;
          }
        },
      )
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      if (/^#{1,3} /.test(block))
        return `<h3>${inline(block.replace(/^#{1,3} /, ""))}</h3>`;
      const lines = block.split("\n");
      if (lines.every((line) => /^[-*] /.test(line)))
        return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join("")}</ul>`;
      if (lines.every((line) => /^\d+\. /.test(line)))
        return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\d+\. /, ""))}</li>`).join("")}</ol>`;
      return `<p>${lines.map(inline).join("<br/>")}</p>`;
    })
    .join("");
}
export function renderPrintHtml(
  entry: SavedMap,
  view?: ViewportCapture,
): string {
  const validImage =
    view &&
    view.image.length < 8_000_000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(view.image);
  const figure = validImage
    ? `<figure><img src="${view.image}" alt="Captured 3D anatomy view with numbered pins"/><figcaption>${escape(view.caption)}<br/>${view.visiblePins.length ? `Visible pins: ${view.visiblePins.join(", ")}.` : "No pins are visible from this angle."} All pin notes are listed below.</figcaption></figure>`
    : '<p class="context">No 3D capture is available. Open the body map to include its current view.</p>';
  const facts = [
    ["Activity", entry.map.activity || "Not recorded"],
    ["Feeling", entry.map.quality || "See your note"],
    ["Duration", entry.map.duration || "Not recorded"],
    [
      "Intensity",
      entry.map.intensity === null
        ? "Not rated"
        : `${entry.map.intensity} / 10`,
    ],
  ];
  const videos = (entry.references ?? []).filter((r) => r.kind === "video");
  const articles = (entry.references ?? []).filter((r) => r.kind !== "video");
  const referenceList = (items: NonNullable<SavedMap["references"]>) =>
    items
      .map(
        (r) =>
          `<article class="reference"><a href="${escape(r.url)}"><strong>${escape(r.title)}</strong></a><small>${escape(r.publisher)} · checked ${escape(r.checked)}</small>${r.context_url ? `<a class="publisher-context" href="${escape(r.context_url)}">Publisher's context and precautions</a>` : ""}<span class="reference-url">${escape(r.url)}</span></article>`,
      )
      .join("");
  const pinNotes = (entry.points ?? [])
    .map((p, i) => {
      const side =
        p.position[0] > 0.06
          ? "Model left"
          : p.position[0] < -0.06
            ? "Model right"
            : "Near the model midline";
      return `<article class="pin"><b>${i + 1}</b><div><h3>${escape(regionName(p.region))}</h3><small>${side}${p.area ? " · Highlighted area" : " · Surface pin"}</small><p>${escape(p.comment || "No comment recorded.")}</p><div class="structure">Reference surface: ${escape(p.structure)}</div></div></article>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>iHurt - ${escape(entry.map.title)}</title><style>
  *{box-sizing:border-box}body{margin:0;color:#25352b;font:11pt/1.55 Arial,sans-serif;background:white}main{max-width:780px;margin:auto;padding:30px}.medical-notice{font-size:10pt;line-height:1.5;border:1px solid #bdcdb3;border-left:4px solid #5a763f;padding:12px 15px;background:#f2f6ed;margin-bottom:22px}.medical-notice strong{display:block;color:#294322}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #9eae94;padding-bottom:14px;margin-bottom:22px}.brand{font-size:26pt;font-weight:bold}.record-date{font-size:9pt;text-align:right;color:#5c6d59}small{display:block;font-size:9pt;color:#5b6c57}h1{font-size:25pt;line-height:1.2;margin:14px 0 8px}h2{font-size:15pt;color:#30492b;margin:26px 0 12px}h3{font-size:11pt;margin:0}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 14px}.subtitle{color:#5b6c57;font-size:10pt;margin-bottom:22px}.facts{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d7dfd0;border-radius:10px;margin:20px 0;overflow:hidden}.fact{padding:10px 14px;border-bottom:1px solid #e1e8da}.fact strong{display:block;font-size:8pt;color:#596d4f;text-transform:uppercase;letter-spacing:.08em}.fact span{display:block;overflow-wrap:anywhere;font-size:11pt}figure{margin:20px 0;padding:12px;background:#f5f6ef;border-radius:12px;width:100%;break-inside:avoid}figure img{width:100%;max-height:345px;object-fit:contain;display:block;border-radius:8px}figcaption{font-size:8pt;text-align:center;color:#64745b;margin-top:8px}.context,.structure{color:#5b6c57;font-size:9pt}.pin{break-inside:avoid;display:flex;gap:14px;padding:15px 0;border-top:1px solid #dfe5d9}.pin b{display:grid;place-items:center;border-radius:50%;width:28px;height:28px;flex-shrink:0;background:#d9eac7;color:#334d26}.pin p{margin:9px 0}.reference{break-inside:avoid;margin:14px 0;padding-left:12px;border-left:3px solid #d6e4c8}.reference small{margin:4px 0}.reference-url{display:block;font-size:8pt;color:#63765a;overflow-wrap:anywhere}.publisher-context{display:block;font-size:9pt}a{color:#365b25;overflow-wrap:anywhere}.notice{font-size:8pt;border-top:1px solid #ccd7c3;margin-top:28px;padding-top:12px;color:#5b6c57}h1,h2,h3{break-after:avoid}li{margin:7px 0;overflow-wrap:anywhere}ul,ol{padding-left:22px}.search-context{padding:12px 15px;background:#f3f6ef;border-radius:8px;font-size:9pt;white-space:pre-wrap;overflow-wrap:anywhere}.notes-section{margin-top:22px}@page{size:A4;margin:18mm 16mm}@media print{main{padding:0}body{font-size:10pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}.medical-notice{font-size:8.5pt;padding:8px 11px;margin-bottom:14px}header{padding-bottom:10px;margin-bottom:14px}.brand{font-size:23pt}.record-date{font-size:8pt}h1{font-size:21pt;margin-top:10px}.subtitle{margin-bottom:14px}.facts{margin:14px 0}.fact{padding:7px 11px}.fact span{font-size:10pt}h2{font-size:14pt;margin:18px 0 10px}p{margin:7px 0 10px}figure{margin:14px 0;padding:9px}figure img{max-height:250px}.notes-section{margin-top:14px}.reference{margin:11px 0}.notice{margin-top:18px}button{display:none}}
  </style></head><body><main>
  <aside class="medical-notice"><strong>Not medical advice. Not a prescription.</strong>Personal notes and educational resources only. iHurt does not diagnose, treat, cure, mitigate, or prevent disease or injury. Ask a qualified clinician whether an exercise is appropriate for you.</aside>
  <header><span class="brand">iHurt.</span><span class="record-date">PERSONAL DISCOMFORT JOURNAL<br/>Recorded ${escape(new Date(entry.created).toLocaleDateString())}${entry.updated ? `<br/>Updated ${escape(new Date(entry.updated).toLocaleDateString())}` : ""}</span></header>
  <h1>${escape(entry.map.title || "My body map")}</h1><p class="subtitle">${escape(entry.map.regions.map(regionName).join(" · ") || "No region recorded")} · ${(entry.points ?? []).length} marked locations</p>
  <div class="facts">${facts.map(([label, value]) => `<div class="fact"><strong>${label}</strong><span>${escape(value)}</span></div>`).join("")}</div>
  <section class="notes-section"><h2>In your words</h2><p>${escape(entry.note || "No note recorded.")}</p></section>${figure}
  <p class="context">Reference anatomy, not a measurement of your body. Left and right use the model's own perspective. Pins identify selected surfaces, not the cause of discomfort. Colors show reported intensity, not tissue damage.</p>
  <section><h2>Notes by location</h2>${pinNotes || "<p>No surface pins recorded.</p>"}</section>
  ${entry.ai ? `<section><h2>Optional AI interpretation</h2><small>${escape(entry.ai.provider)} · May refer to an earlier version of this entry.</small>${printProse(entry.ai.map.summary)}</section>` : ""}
  ${entry.research ? `<section><h2>Context used for the source search</h2><small>Grok source selection · ${escape(new Date(entry.research.checked).toLocaleDateString())} · ${escape(entry.research.activity)} · ${escape(entry.research.regions.map(regionName).join(", "))}</small><p class="search-context">${escape(entry.research.description || "Region and activity only. No description was shared.")}</p><small>This is the context sent at the time of the search. Later edits to the journal do not update its sources.</small></section>` : ""}
  ${videos.length ? `<section><h2>Video resources to discuss</h2><p class="context">These independent demonstrations are educational. Read the publisher's precautions before following them; a link does not establish that an exercise is suitable for you.</p>${referenceList(videos)}</section>` : ""}
  <section><h2>Related reading</h2>${referenceList(articles) || "<p>No reading links saved.</p>"}</section>
  <p class="notice">This report contains personal information. Share it deliberately. Independent content may change; iHurt does not endorse a treatment or verify every claim in linked material.<br/>Anatomy: Z-Anatomy / BodyParts3D, CC BY-SA 4.0 and CC BY-SA 2.1 JP. <a href="https://github.com/sandbornm/ihurt/blob/main/public/models/ATTRIBUTION.md">Credits and licenses</a>.<br/>Made by <a href="https://x.com/msxndborn">@msxndborn</a>.</p>
  </main></body></html>`;
}
export function printMap(entry: SavedMap, view?: ViewportCapture): boolean {
  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.opener = null;
  popup.addEventListener(
    "load",
    () => {
      void Promise.all(
        [...popup.document.images].map((image) =>
          image.decode().catch(() => {}),
        ),
      ).then(() => {
        if (!popup.closed) popup.print();
      });
    },
    { once: true },
  );
  popup.document.write(renderPrintHtml(entry, view));
  popup.document.close();
  return true;
}
