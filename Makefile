VENV?=.venv
PYTHON=$(VENV)/bin/python
PIP=$(VENV)/bin/pip
UVICORN=$(VENV)/bin/uvicorn

# App runtime parameters
HOST?=127.0.0.1
PORT?=8000
APP_DIR?=src

.PHONY: setup setup-hw dev dev-noreload dev-stop test list-ports format lint clean

setup:
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt

setup-hw:
	# Install optional hardware/backends (python-rtmidi)
	$(PIP) install -r requirements-hw.txt || true

dev:
	$(UVICORN) fighterdisplay.ui.backend.main:app --reload --host $(HOST) --port $(PORT) --app-dir $(APP_DIR)

dev-noreload:
	$(UVICORN) fighterdisplay.ui.backend.main:app --host $(HOST) --port $(PORT) --app-dir $(APP_DIR)

dev-stop:
	@# Stop a dev server by port if running
	@PID=$$(lsof -tiTCP:$(PORT) -sTCP:LISTEN 2>/dev/null || true); \
	if [ -n "$$PID" ]; then echo "Killing PID $$PID on port $(PORT)"; kill $$PID || true; else echo "No process on port $(PORT)"; fi

test:
	PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 MIDO_BACKEND=mido.backends.rtmidi PYTHONPATH=$(APP_DIR) $(VENV)/bin/pytest -v

list-ports:
	PYTHONPATH=$(APP_DIR) $(PYTHON) scripts/list_midi_ports.py

format:
	$(VENV)/bin/black $(APP_DIR) tests
	$(VENV)/bin/isort $(APP_DIR) tests

lint:
	$(VENV)/bin/ruff check $(APP_DIR) tests

clean:
	rm -rf $(VENV) __pycache__ .pytest_cache .mypy_cache
	find . -name "*.pyc" -delete
