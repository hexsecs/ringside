Ringside Viewer
===============

Ringside Viewer is a performance-oriented, browser-based controller display and preset manager designed for the Midi Fighter Twister. It provides clear live-mode visuals, robust preset management, and reliable bank switching over LAN with optional Web MIDI echo.

!()[./assets/images/Screenshot1.png]

Key features
- Presets: Load/Save/Save As/Download, dirty tracking, sorted lists, active preset header, and clearing of undefined labels on load.
- Live mode: Large fullscreen title, configurable banks position (above/below), responsive layout, improved contrast, and bank-select echo to hardware.
- Display settings: Toggles for showing MIDI CC and Value overlays, theme controls (System/Light/Dark), and persistent preferences.
- MIDI and networking: Host-side bank-select message on remote switches; optional Web MIDI echo when available.

Development
- Backend: FastAPI app under `src/fighterdisplay/ui/backend`.
- Frontend: Static assets under `src/fighterdisplay/ui/frontend`.
- Presets: JSON files under `assets/presets/` (or `CONFIG_DIR`/`CONFIG_PATH`).

License
- This project is licensed under the GNU General Public License v3.0 (GPL-3.0).
- See the full text in the `LICENSE` file or at: https://www.gnu.org/licenses/gpl-3.0.html
