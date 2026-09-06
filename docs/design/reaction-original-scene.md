# Original reaction scene and gate

The ready view uses `public/assets/reaction-test-bmx-original-dirt-fixed.png`, the user's original 1280×720 photograph with only the small dirt gap beside the near gate cap corrected. Its SHA-256 is `2a2c8f30757fc24da55c416b882266a2f2668dc636524f11a030ae5b037f3ea5`. This restores the selected original detail and exposure; it is not described as a native 4K photograph. The later recreated 4K scene is no longer the active reaction background.

The original gate, tree, background and camera remain unchanged while ready. All four original lenses are visible while ready. Starting the test activates the existing dim/illuminated states; the captured lens remains brighter after the attempt, without an outer glow, added ring, or checkmark. The shared photographic coordinate system keeps the full tree and gate visible on tested portrait and landscape viewports.

The animated gate uses a fixed hinge, one radius for both height and receiving depth, and a 90-degree world rotation. Its grille finishes at ground height zero across its full width. The photographed cap rotates in the same world plane and is clipped at the receiving surface; it is completely hidden when down. Near the flat position, another patch of the original photograph's flat grating supplies texture detail under the same projection. No generated metal gate substitutes for the original upright gate.

The exposed curved shell stays solid throughout movement. Its contour uses the photographed cap outline, inverted through the shared camera and extruded across the same fixed end planes. Both surfaces rotate together and clip at ground height, so an idealized circular shell cannot protrude as a gray crescent behind the photographed barrel. Its material uses the original silver rail's measured color (approximately RGB121/121/123) with subtle grain sampled from that rail. A separate fixed strip of the original hinge photograph covers the seam while the grille rotates, preventing the hidden dirt plate from showing through the joint.

`reaction-test-bmx-original-gate-reveal.png` is a hidden background plate made with built-in ImageGen. The application masks it to the small area occluded by the raised gate, with a narrow feather at the outside margin. It never replaces the full original scene. The plate supplies the dirt/track that becomes visible as the gate recesses. The ready-state photo does not use it.

## Background plate prompt

Use case: precise-object-edit. Asset type: hidden background plate for an animated BMX gate. Edit this exact photograph by removing ONLY the entire upright mesh gate and its curved barrel/end cap at right of the concrete pad. Remove its long dark cast shadow too. Reconstruct only the small patches of brown dirt, track edge and railing that were hidden behind the raised gate. At ground level leave flush flat metal grating on the same receiving surface; absolutely no upright metal, gate silhouette, edge, raised rail, ridge, trench or black void remains. The upright gate will be drawn separately by the app and is NOT needed in this background plate. Preserve the exact original camera, hill, concrete, white lines, light tree, colors, people, BMX bicycles and all other pixels. Never shift the deck, track, or background. Match the dirt's original warm natural grain and daylight. Photorealistic. Full original 16:9 frame. No text, UI or embellishments. This will be clipped to the original raised gate footprint only; only the hidden region needs restoration.

## Audio and verification scope

The approved drop and return WAVs are unchanged: a one-second drop whistle and faint reversed two-second return. The return animation remains tied to the two-second audio profile; scoring still comes from the existing UCI cadence, independently of the decorative gate.

Verification combines world geometry/projection tests, real-app browser movement and layout checks, image inspection, real WebKit audio graph output with an iPad profile, and archive asset/signature validation. Browser emulation does not establish that a particular physical iPad speaker, mute setting, or installed build will behave identically.
