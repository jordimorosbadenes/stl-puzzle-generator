@echo off
echo Instalando dependencias...
python -mpip install -r requirements.txt

echo.
echo Iniciando la aplicación web...

python web/app.py
