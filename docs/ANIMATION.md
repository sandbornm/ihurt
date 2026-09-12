# Body animation

[← Development](DEVELOPMENT.md)

## What runs today

Three.js renders the anatomy with WebGL. Draco WebAssembly decompresses the
models, and an AssemblyScript module compiled to WASM computes the heat around
pins. The project uses no Rust. Remotion animates the website’s walkthrough
cards; it does not pose the body.

Both bundled GLB files contain static meshes. Inspection on September 12, 2026
found:

| Asset | Meshes | Skins | Animation clips |
| --- | ---: | ---: | ---: |
| `skeleton.glb` | 278 | 0 | 0 |
| `muscular.glb` | 684 | 0 | 0 |

The visible bones have no animation rig. The loader in `src/anatomy/atlas.ts`
also bakes the mesh transforms into a flat body model. The current viewer can
rotate and zoom, but cannot bend the body into a pose.

Camera transitions use elapsed time, so easing follows the same pace at common
display refresh rates. Long frame gaps are capped to avoid sudden jumps.
Reduced-motion settings skip transitions and turn off drag inertia.

## A practical first movement demo

Use a separate, lightweight rigged body for movement, while keeping the detailed
atlas for mapping. Start with one authored clip: standing → Warrior III →
standing. Load it when the visitor opens the movement view.

A rig needs joints and weights that tell the renderer how each joint moves the
mesh. Three.js supports this through
[SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html). Its
[AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html) can play a
clip, pause it, change speed, or move to an exact time. That is enough for a
smooth pose transition and a scrubber; Rust or more WASM is not required.

Give the demo play/pause, a timeline, speed control, and front/side views. Start
paused when reduced motion is requested. Keep the publisher, source link, and
precautions beside each educational movement. A demo should not imply that the
movement will treat the visitor’s symptoms.

Rigging the existing atlas would take more work: hundreds of meshes must follow
the joints without separating or collapsing. Muscle deformation needs review,
and the loader would need to preserve the rig. Existing pins use static body
coordinates; they would also need to follow the moving surface. A rigged
mannequin avoids changing how saved hurt maps work.

No movement clips or rigged assets have been added yet. The proposed runtime
uses the existing stack and needs no paid API calls. Asset licenses and any
artist’s fee depend on the model chosen; no purchase or spending limit is set.
