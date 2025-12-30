# Puzzle Generator (Flask)

Generador de puzzles 3D con visualización web (canvas 2D + preview 3D con three.js) y exportación STL. Listo para desplegar en Render como servicio Python usando Gunicorn.

## Requisitos
- Python 3.10+
- Dependencias en `requirements.txt` (incluye Flask, numpy, trimesh, numpy-stl, gunicorn y CORS).

## Ejecutar en local
```bash
python -m venv .venv
./.venv/Scripts/activate  # Windows
pip install -r requirements.txt
cd web
set FLASK_DEBUG=true
python app.py
```
La app arranca en `http://localhost:5000`.

## Desplegar en Render
- El repositorio incluye `render.yaml` y `Procfile`. Render detecta el blueprint y crea un servicio web Python.
- Comandos que usa Render:
  - `pip install -r requirements.txt`
  - `cd web && gunicorn app:app --bind 0.0.0.0:$PORT`
- Salud: `/health`.
- CORS: variable `ALLOWED_ORIGINS` (coma separada). Por defecto `*` para permitir la SPA embebida en el sitio principal.

## Estructura rápida
- `web/app.py`: lógica Flask (API, generación de piezas, export STL, health, CORS).
- `web/templates/index.html`: interfaz HTML.
- `web/static/app.js` y `style.css`: lógica de UI, dibujo y preview 3D.

## Para GitHub
- `.gitignore` listo para Python.
- `render.yaml` y `Procfile` listos para Render/Heroku compatibles.

Ajusta `ALLOWED_ORIGINS` al dominio de la web principal cuando despliegues en producción.
