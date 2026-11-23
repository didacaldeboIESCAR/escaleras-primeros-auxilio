# Escaleras y Serpientes · First Aid and Injuries (modo Kahoot)

- **Profe:** abre `/profe`, pulsa *Crear partida* y proyecta la pantalla. Sale el código (y un QR).
- **Alumnos:** abren la web en el móvil, escriben el código y su nombre.
- Al pulsar *Empezar*, la pantalla del profe muestra el tablero y cada alumno ve en su móvil su perfil, el dado cuando le toca y las preguntas.
- Escalera: acierta → sube; falla → se queda. Serpiente: acierta → se queda; falla → baja.
- La pregunta se ve en la pantalla del profe y en todos los móviles, pero solo responde el alumno del turno. El servidor valida y mueve las fichas en tiempo real.

Ejecutar en local: `node server.js` (Node 18+, sin dependencias). Preguntas en `questions.json` (`answer`: 0=A … 3=D).
