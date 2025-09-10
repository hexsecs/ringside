# Repository Guidelines

## Project Structure & Module Organization
- `src/fighterdisplay/` – Python package.
  - `core/` – app state and models.
  - `midi/` – device discovery, I/O, Twister helpers.
  - `ui/backend/` – FastAPI app and WebSocket.
  - `ui/frontend/` – static web UI (`index.html`, `app.js`, `styles.css`).
- `tests/` – pytest tests mirroring `src/` paths.
- `scripts/` – developer utilities (e.g., `list_midi_ports.py`).
- `assets/presets/` – optional mappings and examples.

## Build, Test, and Development Commands
- `make setup` – create `.venv` and install Python deps from `requirements.txt`.
- `make dev` – run FastAPI with reload; serves the static UI and WebSocket.
- `make test` – run pytest with quiet output and coverage.
- `make list-ports` – print available MIDI input/output ports.
Tip: Use `PYTHONPATH=src` or `uvicorn --app-dir src` to resolve the package.

## Coding Style & Naming Conventions
- Formatter: Black; Imports: isort; Lint: ruff (when configured). Target 100-char lines.
- Indentation: 4 spaces for Python; 2 spaces for HTML/CSS/JS.
- Naming: `snake_case` for modules/functions, `PascalCase` for classes, `camelCase` for JS. Scripts use kebab-case filenames.
- Keep modules focused; avoid side effects at import time.

## Testing Guidelines
- Use pytest; place tests under `tests/` mirroring `src/` modules.
- Name tests `test_*.py`; prefer small, fast, deterministic tests.
- Avoid hardware/flaky tests; mock MIDI with fakes when needed.
- Target ≥80% coverage on changed code; include failure-path assertions.

## Commit & Pull Request Guidelines
- Conventional Commits (e.g., `feat:`, `fix:`, `chore:`, `docs:`) with optional scope (`feat(midi): ...`).
- PRs include: problem, approach, testing notes, and screenshots/GIFs for UI.
- Requirements: passing CI, updated docs/tests, and one logical change per PR.

## Security & Configuration
- Do not commit secrets; use env vars and provide `.env.example` if needed.
- Review new dependencies for license and CVEs; pin versions where possible.
