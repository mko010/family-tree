# Mi Árbol Familiar

Primera versión de una aplicación local para crear un árbol genealógico circular. Los datos se guardan en SQLite y la aplicación no necesita conexión a Internet ni dependencias externas.

## Ejecutar en Ubuntu o Linux

Se necesita Python 3.10 o posterior.

```bash
python3 app.py
```

La aplicación se iniciará en segundo plano y abrirá automáticamente el navegador. Si ese puerto está ocupado, elegirá otro puerto local disponible. No hace falta mantener la terminal abierta.

Al cerrar el navegador, la aplicación se detiene automáticamente tras unos segundos. Ese margen permite recargar la página sin que se cierre.

Para cerrarla después:

```bash
python3 app.py --stop
```

Los datos se guardan en `data/familia.sqlite3`. Para hacer una copia de seguridad con la aplicación cerrada, copia la carpeta `data` completa.

## Llevar los datos a otro ordenador

1. Cierra la aplicación en ambos equipos.
2. Copia la carpeta `data` completa a una memoria USB o a un servicio de nube.
3. En el equipo nuevo, coloca esa carpeta dentro de la carpeta del proyecto y sustituye su carpeta `data` si ya existe.
4. Ejecuta `python3 app.py` normalmente.

No abras ni modifiques la misma base de datos desde dos equipos a la vez. Para alternar entre equipos, usa siempre la última copia cerrada de `data` como origen.

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
