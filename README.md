# QueryRush

Juego de preguntas en vivo sobre SQL, al estilo Kahoot: fundamentos, T-SQL y SELECT, JOINs, agregación y GROUP BY, subconsultas e INSERT.

## Jugadores

1. Abrir la página del juego o escanear el código QR que muestra la pantalla del anfitrión.
2. Escribir el PIN de la sala, el nombre y el apellido.
3. Esperar a que el anfitrión inicie la partida y responder desde el celular o el computador.

## Anfitrión

1. Abrir el enlace de anfitrión (no está publicado en este repositorio).
2. Elegir los temas y el número de preguntas, y pulsar **Crear sala**.
3. Proyectar la pantalla: muestra el PIN, el código QR y la lista de participantes. Tocar un nombre lo retira de la sala.
4. Pulsar **Iniciar partida** y avanzar pregunta por pregunta. Al final aparece el podio y se pueden descargar los resultados en CSV.

## Puntuación

- Respuesta correcta: de 500 a 1000 puntos según la rapidez.
- Racha: +100 por cada acierto seguido (máximo +500).
- Una respuesta incorrecta no resta puntos. En público solo se muestra el top 5; cada jugador ve su puesto en su pantalla.

## Cómo funciona

- Página estática; no necesita servidor propio ni cuentas.
- La comunicación en vivo usa un broker MQTT público (EMQX, con respaldo en Mosquitto y HiveMQ).
- El banco de preguntas (`banco.js`) está cifrado con AES-GCM y solo se abre con la clave del anfitrión. La respuesta correcta llega a los celulares únicamente cuando termina el tiempo.

## Actualizar las preguntas

Editar `preguntas.json` (archivo local, no se publica) y volver a cifrar:

```
node cifrar.mjs <clave-anfitrion>
```
