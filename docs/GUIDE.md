# Using iHurt

[← iHurt](../README.md)

## Anatomy navigation and exports

Use **Landmarks** to choose a region, view it from the front, back, top, or outer side, then inspect a named muscle group. Shoulder landmarks include the deltoid and rotator-cuff muscles; neck landmarks include sternocleidomastoid, upper trapezius, levator scapulae, and splenius capitis. Inspecting a muscle hides surrounding muscles; **Show surrounding anatomy** restores them. Scroll toward the cursor to zoom, drag to orbit, and right-drag to pan. The buttons ease the camera into position and support keyboard access. Reduced-motion settings skip camera transitions.

A click places a precise surface pin. The 3D overlay spreads heat around your pin; it does not infer tissue damage or a diagnosis. Coarse regions are approximate and can misclassify boundaries. The GLB meshes have finite detail: close zoom does not reveal microscopic anatomy. Detailed nerve pathways and motion analysis are outside this version.

- **SVG:** a standalone visual report with front/back projections, numbered pins, context, and clickable reading citations. Projection onto the report silhouette is approximate.
- **JSON:** `schema_version: 1`, the original note, timestamps, reported fields, answers, normalized 3D coordinates, named structures, provider label, and selected reference URLs. No API keys are included. Import/replay is not implemented yet.

## Curate the reading sources

Edit [`config/reading-library.json`](../config/reading-library.json), then rebuild or restart the dev server. It lists publishers and the pages included in the library. Each publisher has an ID, name, category, exact allowed hostnames, and a `recommended` default. Each reference has a title, publisher ID, HTTPS URL, region/activity tags, resource type, and date its link was checked.

The initial library includes NHS, AAOS/OrthoInfo, Mayo Clinic, APTA/ChoosePT, AOTA, UC Berkeley, Stanford's Human Performance Lab, and the NCAA Sport Science Institute. General clinical/PT/OT sources are selected by default; users can opt into the broader sports research and college-athletics sources. **Sources → Use recommended list** restores the curated default. Selections clear on refresh.

The app shows only listed HTTPS links on each publisher’s allowed hosts. Sources match by region and activity, with related activity tags ranked first. Search and source filtering happen locally. It makes no live web searches and sends no symptom text to search engines. The LLM cannot add reference URLs. A reference is related reading, not evidence that the user has the named condition or should perform its exercises. The source has not endorsed iHurt. `checked` records a link check, not a clinical review.

To add a college athletics program, open PT resource, or sports science lab, add its publisher and the specific pages you have reviewed. Prefer publicly readable original clinical/educational material. Preserve authorship, dates, precautions, and distinctions between research, general education, and individualized care. The test suite checks URL/host consistency and unique reference IDs. Publishers retain copyright; iHurt links to their pages rather than republishing their content.
