# Training app light appearance

On September 6, 2026, the user requested white backgrounds and black text for the signed-in training dashboard after approving the light public website. Release 76 extends the light appearance through navigation, race configuration, result tables, account, friends, studio and club controls. Layout, track imagery, reaction media, gate geometry, animation and sounds are preserved.

The shared palette uses white panels, near-black ink, muted readable secondary labels, subtle borders, and dark primary actions with white labels. Map/video/race overlays retain dark local tokens for legibility over imagery. No image filters, resizing, regeneration or asset changes are involved. Native backing and default system bars match the light app; fullscreen race experiences restore light status icons over dark surfaces.

The iPhone Watch navigation label wraps on whole words. Rider number chips retain their colors with black text for contrast.

Semantic color tokens add approximately 5.3 KB to raw entry CSS while the first measured Brotli increase is about 160 bytes. The raw CSS allowance is 144,000 bytes; compressed CSS and total initial-transfer budgets remain unchanged. Final measurements are recorded in release 76 evidence.

Validation artifacts live in `output/tracklab-light-dashboard/` and `output/tracklab-release76/` outside the source checkout. The local preview uses guarded account fixtures and a map fallback because it has no local Google Maps key; it does not claim physical iPad rendering or live account writes.
