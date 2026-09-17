# Using iHurt

[← iHurt](../README.md)

## Anatomy navigation and exports

Use **Landmarks** to choose a region and view it from the front, back, top, or outer side. **Muscle list** searches the atlas by name and isolates the selected structure. Adjust **Surrounding anatomy** to show nearby structures faintly, or choose **Show whole body** to restore the view. Use **Add pin to muscle** to preview a surface point before placing it.

In **Pin**, tap to mark a spot or drag to turn the body. Two fingers zoom and move without adding marks. Choose **Move** for one-finger panning. **Turn** and **Move** also have arrow buttons. Scroll or use the zoom buttons to zoom around the current focus. The buttons support keyboard access. Reduced-motion settings skip camera transitions.

**Hands** (under More tools) is optional camera control. A grabber follows each hand: open palm rests, closed fist turns. Two fists pulling apart zoom in; pushing them together zooms out. Two open palms pan.

To make an entry with one hand:

1. Point at a muscle and hold still for about a second. A ring fills around the pointer, then a pin lands on the highlighted visible surface. Move away to cancel the hold. Use **Undo this pin** if it lands in the wrong place; use the usual layer tools to explore deeper structures.
2. Pinch thumb and index, then turn your wrist like a dial. Clockwise increases intensity; counterclockwise decreases it. Release and pinch again to regrip. The dial updates as you turn; the map colors refresh after saving or returning to the body. This rates the whole entry, from 0 to 10. It stays unrated until you turn deliberately. Hand gestures pause body navigation while rating.
3. Lower your thumb, then hold a thumbs-up until the save bar fills. The confirmation appears after the entry is saved on your device. Open your hand to return to the body for another pin, or use **Back to body**. You can also save without rating.

Losing tracking or switching tabs cancels a partly completed hold and releases the dial. If tracking stops during a thumbs-up, lower your thumb before trying again. **Save this entry** also works by clicking. The camera stays in this browser; frames are not saved or sent. Mouse, trackpad, and buttons still work.

Turn off **Show bones** to hide the skeleton while viewing muscles. This preference stays with your browser draft. Hidden bones are excluded from layer picking and viewport pictures; existing marks stay saved.

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

**Layers** lets you click a spot, preview nearby surfaces along the view, and pin the structure you choose. This is model geometry, not a measurement of tissue depth or the cause of discomfort. The intensity control records a value from 0 to 10 and colors the heatmap from blue to red. Leave it unrated when you do not want to record a number.

Use the layer icon beside a saved pin to explore that spot. When several surfaces overlap, **Spread layers** separates them for viewing. Hover over a name or select it to highlight its shape; the **Separation** slider adjusts the spread. Closing the picker restores the anatomy. Pin coordinates stay on the original model.

**Map image** saves a PNG of the current 3D view. **Print / Save PDF** uses the same view with numbered visible pins and all written notes. Rotate or focus the map before exporting. Hidden pins remain in the notes; the picture does not reveal structures behind opaque anatomy. Spread layers return to their anatomical positions for the picture.

**Body reference** opens optional male and female outer-body models. These references have no muscle layers and do not display or move your journal pins.

Choose **Highlight**, then drag across the visible body to mark a small area. Each stroke is saved as one mark. The brush follows visible surfaces and has a fixed width; it does not measure the extent of pain. **Undo** removes the latest mark or restores a deleted one. **Redo** reapplies it. Undo history lasts while you work on the current entry; saved marks persist as usual.

## Mapping a location

Use **Quick tour** to walk through the controls without changing your entry. Choose **Pin** to mark a surface, **Turn** to rotate without placing pins, or **Highlight** to draw an area. The front/back buttons and zoom buttons also work without dragging. **More tools** reveals muscle browsing, overlapping layers, bones, and outer-body references. The light/dark switch remembers your preference on this device.

The atlas is a shared reference, not a calibrated scan. Height and weight do not determine individual limb lengths, proportions, or internal tissue positions. No distances in centimeters are inferred. Left/right use the reference body's perspective. Confirm the general region and use the pin comment for details such as “just above the shoulder blade.” A selected mesh does not identify the source of pain.

Reports begin with the medical limitation, preserve your own notes, and list the selected surfaces separately. When hosted source search is used, the report retains the exact reviewed search description. Video resources link to publisher context and precautions. .ihm imports preserve those links; videos are not embedded in the file.

Pins have no count limit in the notebook. Exports keep every pin and comment. Imported backups must be smaller than 10 MB; each pin is still checked. Optional AI requests have separate size and usage limits.
