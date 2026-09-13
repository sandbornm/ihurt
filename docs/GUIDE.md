# Using iHurt

[← iHurt](../README.md)

## Anatomy navigation and exports

Use **Landmarks** to choose a region and view it from the front, back, top, or outer side. **Muscle list** searches the atlas by name and isolates the selected structure. Adjust **Surrounding anatomy** to show nearby structures faintly, or choose **Show whole body** to restore the view. Use **Add pin to muscle** to preview a surface point before placing it.

Choose **Turn** or **Move**, then use the arrows or drag. Scroll or use the zoom buttons to zoom around the current focus. The buttons support keyboard access. Reduced-motion settings skip camera transitions.

A click places a precise surface pin. The 3D overlay spreads heat around your pin; it does not infer tissue damage or a diagnosis. Coarse regions are approximate and can misclassify boundaries. The GLB meshes have finite detail: close zoom does not reveal microscopic anatomy. Detailed nerve pathways and motion analysis are outside this version.

- **SVG:** a standalone visual report with front/back projections, numbered pins, context, and clickable reading citations. Projection onto the report silhouette is approximate.
- **JSON:** `schema_version: 2` in an `ihurt.notebook` envelope. Each entry includes the original note, timestamps, activity, pin comments, normalized 3D coordinates and named structures. Anatomy metadata includes GLB source URLs, SHA-256 hashes, coordinate axes and normalization. New pins include their original mesh node reference. Optional AI interpretations remain separate from your notes. Import restores compatible version 2 files without overwriting existing entries.
- **IHM:** the same JSON journal with a review prompt and an embedded SVG preview. See [the map format](IHM.md). Single-entry JSON exports contain the same bundle; a notebook backup contains all saved entries.

## Curate the reading sources

Edit [`config/reading-library.json`](../config/reading-library.json), then rebuild or restart the dev server. It lists publishers and the pages included in the library. Each publisher has an ID, name, category, exact allowed hostnames, and a `recommended` default. Each reference has a title, publisher ID, HTTPS URL, region/activity tags, resource type, and date its link was checked.

The initial library includes NHS, AAOS/OrthoInfo, Mayo Clinic, APTA/ChoosePT, AOTA, UC Berkeley, Stanford's Human Performance Lab, and the NCAA Sport Science Institute. General clinical/PT/OT sources are selected by default; users can opt into the broader sports research and college-athletics sources. **Sources → Use recommended list** restores the curated default. Source selections save with your current draft.

The app shows only listed HTTPS links on each publisher’s allowed hosts. Sources match by region and activity, with related activity tags ranked first. Search and source filtering happen locally. It makes no live web searches and sends no symptom text to search engines. The LLM cannot add reference URLs. A reference is related reading, not evidence that the user has the named condition or should perform its exercises. The source has not endorsed iHurt. `checked` records a link check, not a clinical review.

To add a college athletics program, open PT resource, or sports science lab, add its publisher and the specific pages you have reviewed. Prefer publicly readable original clinical/educational material. Preserve authorship, dates, precautions, and distinctions between research, general education, and individualized care. The test suite checks URL/host consistency and unique reference IDs. Publishers retain copyright; iHurt links to their pages rather than republishing their content.

## Easier model controls

**Layers** lets you click a spot, preview nearby surfaces along the view, and pin the structure you choose. This is model geometry, not a measurement of tissue depth or the cause of discomfort. Each entry supports ten pins. The intensity control records a value from 0 to 10 and colors the heatmap from blue to red. Leave it unrated when you do not want to record a number.
