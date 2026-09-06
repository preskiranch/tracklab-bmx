# Reaction gate whistle

These are original synthetic valve effects approved in the TrackLab design preview. No engine recording or source-video audio is included. A high-pitched RB26 valve reference informed the broad resonances near 5.45 and 5.98 kHz; the samples use new noise and oscillators at the approved pitch and mix.

- `reaction-gate-rb26-drop-1s.wav`: mono 48 kHz PCM16, exactly 1 second.
- `reaction-gate-rb26-raise-2s.wav`: mono 48 kHz PCM16, exactly 2 seconds. A separately extended forward variant is reversed and attenuated 18 dB; it is not slowed down, so its pitch remains unchanged.

Levels are baked into the assets. The application preloads and decodes both before the UCI cadence. The physical drop remains 260 ms; the physical return lasts the same 2 seconds as its audio. Gate effects do not alter reaction scoring or cadence timing. Closing the test or interrupting audio cancels playback rather than queuing a delayed sound.

The reproducible generation source, original approved 0.52-second seed, forward return reference, listening MP3 and measurements are retained with the release70 artifacts in `output/tracklab-release70/audio` in the project workspace. The runtime plays these WAVs directly so there is no alternate approximation between the preview and the app.
