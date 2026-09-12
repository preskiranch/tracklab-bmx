# Private Sprint Stadium

The owner-only experiment uses Three.js in the existing Straight Sprint activity.
It consumes the existing arena rider telemetry and does not replace race timing or audio.
The toggle requires the signed-in owner account's server admin flag and is hidden in
shared tablet and regular-user preview modes. Assets themselves are not confidential.

## Rebuild the rider

Use Blender 5.0.1 and the Blender Studio Human Base Meshes bundle v1.4.1:
https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip

From the repository root:

```sh
blender -b /path/to/human_base_meshes_bundle.blend \
  --python scripts/private-stadium/build-rider.py -- \
  "$PWD/src/assets/private-stadium/rider.glb"
```

The script also saves its Blender working file under output/private-stadium.
Only the GLB is required at runtime. Do not include working files or screenshots in
production assets. Runtime images, lighting and the GLB are imported through Vite
so every revised asset receives a new content-hashed URL.

Bicycle and rider contact geometry share src/data/privateBmxGeometry.json.
Adult 20-inch race proportions were checked against the Chase Edge Pro XL:
https://chasebicycles.com/bikes/chase-edge/chase-edge-pro-xl/
No manufacturer's product photographs are shipped in the application.
Asset credits are in public/assets/private-stadium/CREDITS.md.

## Validate

```sh
npx vitest run tests/unit/privateStadium.test.ts
PLAYWRIGHT_BASE_URL=http://127.0.0.1:10135 npx playwright test tests/e2e/private-stadium.spec.ts
npm run build
```

Start Vite on port 10135 before the browser tests. The test fixture is:
/tests/e2e/fixtures/sprint-rotation.html?stadium&ready

The rendering loop targets 30 fps during racing and reduces idle work. Phone-sized
WebKit measurements on a Mac are not physical-device performance results.
Current visual quality remains a prototype; physical iOS validation and further
rider/environment art work are required before calling it photorealistic.
