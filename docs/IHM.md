# The .ihm map file

An `.ihm` file is UTF-8 JSON. It uses the existing `ihurt.notebook` schema, version 2, with a version 1 `ihurt.map` bundle marker. No archive reader or proprietary binary format is required.

It contains the original note and context, up to ten pins with comments and anatomy coordinates, model IDs and hashes, and reading citations. Optional AI notes remain separate from user observations. The bundle adds a review prompt and an SVG heatmap under `materials`.

The 3D model files are referenced, not embedded. The SVG is a derived view; the structured highlights are the source for coordinates. iHurt treats embedded materials as inert data on import and regenerates previews from the validated journal. It does not execute attachments, fetch their URLs, or unpack files.

Use **Full report with Grok or another AI → Download .ihm map**. If a chat uploader rejects the extension, **Export JSON** contains the same bundle with a `.json` filename. Attach it and ask the model to follow the review prompt while treating notes as observations. Import either extension through **Notebook → Import map**.

The file includes personal information. It has no encryption or access controls. Sharing it with an AI sends that information to the service you choose. iHurt does not submit it automatically.

Imports remain limited to 10 MB and must match a supported schema and anatomy coordinate system. Unknown metadata is ignored; original journal fields are validated before saving. Older version 2 JSON exports still open normally.
