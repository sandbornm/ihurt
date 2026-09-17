# The .ihm map file

An `.ihm` file is UTF-8 JSON. It uses the existing `ihurt.notebook` schema, version 2, with a version 1 `ihurt.map` bundle marker. No archive reader or proprietary binary format is required.

It contains the original note and context, all pins with comments and anatomy coordinates, model IDs and hashes, and reading citations. Optional AI notes remain separate from user observations. The bundle adds a review prompt and an SVG heatmap under `materials`.

The 3D model files are referenced, not embedded. The SVG is a derived view; the structured highlights are the source for coordinates. iHurt treats embedded materials as inert data on import and regenerates previews from the validated journal. It does not execute attachments, fetch their URLs, or unpack files.

Use **Share with AI** to choose whether to include entry notes, pin comments, saved sources, or a previous AI interpretation. Review the text summary or JSON preview, then use **Download sharing JSON** or **Copy summary**. The **Suggested prompt and .ihm file** section offers the same selected bundle with an `.ihm` filename. Your saved entry is unchanged. AI interpretations are excluded by default; search descriptions and AI text that could repeat omitted fields are also excluded.

The main **Export JSON** button exports the complete entry. Attach either format and ask the model to follow the review prompt while treating notes as observations. Import either extension through **Notebook → Import map**.

The file includes personal information. It has no encryption or access controls. Sharing it with an AI sends that information to the service you choose. iHurt does not submit it automatically.

Imports remain limited to 10 MB and must match a supported schema and anatomy coordinate system. Unknown metadata is ignored; original journal fields are validated before saving. Older version 2 JSON exports still open normally.

A highlight may include an optional `area` object: `path` contains 2–48 surface positions and `radius` records the brush width in model units. The first path position matches the pin's `position`. These are author-selected locations; the path can cross more than one structure, so the pin's named mesh identifies only its starting surface. Current imports restore these fields. Older iHurt versions may omit area details; retain the original file.

References may include `kind: "video"` and a `context_url` pointing to the publisher’s page and precautions. A saved source search also records the reviewed description (up to 4,000 characters). These optional fields survive export and import; earlier maps remain valid.

## Body references and pin locations

Pins use the versioned Z-Anatomy coordinate system and asset hashes in the export. The optional male and female Human Reference Atlas models are separate outer-body references. They are not personalized by height or weight, contain no muscle layers, and have no pin correspondence with the detailed atlas. Choosing a reference does not change a journal's locations.

A future surface-anchor extension could store a mesh triangle and barycentric weights alongside each XYZ position. Transfers to another model would still require a reviewed correspondence and an explicit format migration. The current format does not claim that coordinates are physical measurements or that a selected surface identifies the cause of discomfort.
