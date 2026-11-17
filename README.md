# Escaleras y Serpientes · First Aid and Injuries

Requisitos: Node.js 18 o superior. No hace falta instalar nada más.

```bash
node server.js                      # http://localhost:3000
QUESTION_TIME=30 PORT=8080 node server.js
```

- Cada jugador abre la dirección del servidor (en clase: `http://IP-del-ordenador:3000`), escribe su nombre y el mismo código de sala.
- El primero en entrar es el anfitrión 👑: elige el tiempo por pregunta (5–120 s) y empieza la partida. También puede saltar turnos o reiniciar.
- "Solo mirar" sirve para proyectar el tablero en la pizarra digital.

## Mecánica educativa
- Caer exactamente en el pie de una escalera → pregunta. Acierto: sube. Fallo o tiempo agotado: se queda.
- Caer exactamente en la cabeza de una serpiente → pregunta. Acierto: se queda. Fallo o tiempo agotado: baja.
- Todos ven la pregunta y la cuenta atrás; solo puede responder el jugador del turno.
- El servidor elige la pregunta, valida la respuesta (la solución nunca se envía antes de tiempo), mueve la ficha y actualiza a todos en tiempo real.
- Después se muestra a todos la respuesta correcta y una explicación basada en los apuntes.

## Preguntas
`questions.json` tiene 54 preguntas (27 términos del documento *Vocabulary Unit 2*, en las dos direcciones inglés ↔ catalán). Se puede editar libremente:
`answer` es el índice (0 = A, 1 = B, 2 = C, 3 = D) de la opción correcta.
