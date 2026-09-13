# Anatomy model credits

The muscle and skeleton models are third-party works, separate from ihurt's MIT-licensed code.

- **BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan**. Original model: Kousaku Okubo. [Database and downloads](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html). [License](https://creativecommons.org/licenses/by-sa/2.1/jp/).
- **Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0**. Design, 3D, and anatomy: Gauthier Kervyn and the Z-Anatomy contributors. [Project](https://www.z-anatomy.com/). [Source repository](https://github.com/Z-Anatomy/Models-of-human-anatomy). [License](https://creativecommons.org/licenses/by-sa/4.0/).
- GLB conversion distributed by [Liyucheng1997/242_lab-human-anatomy](https://github.com/Liyucheng1997/242_lab-human-anatomy/tree/322ba39e96ea91ce08601caad2c0aaade1dc99f0). Exact file URLs, sizes, and SHA-256 hashes are in [sources.json](sources.json).

The bundled GLB files are unchanged. At runtime, ihurt normalizes their scale and position, preserves outward-facing triangles on mirrored meshes, filters annotation and connective-tissue meshes, recolors surfaces, and adds location labels and heat overlays. Adaptations of the anatomy assets remain subject to CC BY-SA 4.0 and the upstream attribution requirements. Attribution does not imply endorsement or clinical validation.

The complete upstream notice, including its component-specific attributions, is preserved in [UPSTREAM-LICENSE.txt](UPSTREAM-LICENSE.txt). This distribution uses the muscular and skeletal asset files, not the separately distributed organ or nervous-system assets. Original definitions and Wikipedia text are not bundled.

The initial schematic fallback and schematic report silhouettes were created for ihurt and are MIT licensed. The Draco decoder is Copyright The Draco Authors and licensed under Apache 2.0; see [its license](../draco/LICENSE).

## Male and female outer-body references

The optional `reference-male.glb` and `reference-female.glb` come from the [HuBMAP / Human Reference Atlas CCF 3D Reference Object Library](https://github.com/hubmapconsortium/ccf-3d-reference-object-library/tree/f1a3a63f110e27ff0736047d52d04dba5d3087f9), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source files are `VH_Male/v1.2/VH_M_Skin.glb` and `VH_Female/v1.3/VH_F_skin.glb`. The license is preserved in [REFERENCE-LICENSE.txt](REFERENCE-LICENSE.txt).

These copies were simplified to a target of 20% of the original triangles with glTF Transform 4.2.1 (error threshold 0.001), then Draco-compressed. iHurt also normalizes their scale and position and replaces their materials for display. They are outer-body references with no muscle layers. They use a separate coordinate system; journal pins stay in the Z-Anatomy atlas. The model labels describe the source assets, not the user's sex or gender.
