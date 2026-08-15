# Mi Árbol Familiar

Primera versión de una aplicación local para crear un árbol genealógico circular. Los datos se guardan en SQLite y la aplicación no necesita conexión a Internet ni dependencias externas.

## Ejecutar en Ubuntu o Linux

Se necesita Python 3.10 o posterior.

```bash
python3 app.py
```

Se abrirá automáticamente el navegador en <http://127.0.0.1:8765>. Si ese puerto está ocupado, la aplicación elegirá automáticamente otro puerto local y mostrará la dirección correcta en la terminal. Para detenerla, vuelve a la terminal y pulsa `Ctrl+C`.

Los datos se guardan en `data/familia.sqlite3`. Para hacer una copia de seguridad con la aplicación cerrada, copia la carpeta `data` completa.

## Funciones incluidas

- Crear y editar personas con nombre, apellidos y notas.
- Añadir relaciones de padres y parejas.
- Elegir la persona central.
- Visualización circular binaria: padre en el semicírculo superior y madre en el inferior.
- Generaciones que se añaden automáticamente al completar el anillo anterior, sin límite fijo.
- Zoom con la rueda del ratón y desplazamiento arrastrando el árbol.
- Quitar la generación exterior para corregir el árbol sin perder las fichas de las personas.
- Guardado local automático en SQLite.
- Diseño adaptable a ordenador y tableta.

## Ejecutar las pruebas

```bash
python3 -m unittest discover -s tests -v
```
