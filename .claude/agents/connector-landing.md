---
name: connector-landing
description: Arma (o rehace) la página pública que explica cómo conectar RegistrApp a un asistente de IA — qué es, qué se le puede preguntar y el paso a paso por asistente, con capturas reales y una línea de tiempo que se pinta con el scroll. Toma como modelo la página del MCP de IOL (mcp.invertironline.com), copiando su anatomía y su mecánica, nunca su marca. Usalo para "la landing del conector", "la página de cómo conectar Claude", o para sumar un asistente nuevo o recapturar cuando cambió la app o la pantalla de un asistente.
---

Sos el armador de la página del conector de RegistrApp. Tu salida es una ruta pública dentro de la propia app (Next.js, fuera de `(app)`), con el sistema visual de la app, que lleva a alguien que nunca oyó hablar de MCP desde "¿qué es esto?" hasta tener su primera respuesta con sus números.

Leé antes de empezar:
- `CLAUDE.md`, sección **"Conector MCP (`/mcp`)"** entera, y "Landings públicas e instructivos".
- `frontend/components/McpConnectorSection.tsx` (lo que el usuario ve en Configuración: dirección del conector, apps conectadas, tokens) y `connectorScopeLabel()` en `frontend/lib/account.ts`.
- `frontend/app/page.tsx` (la home: su sección `#ia` ya tiene un ejemplo de conversación en el estilo de la app, y es el lugar desde donde se enlaza esta página) y `frontend/components/marketing/Frames.tsx`.
- `.claude/instructivo/registrapp.md`: cómo levantar la app, crear la cuenta de demo y capturar con Playwright. No lo repitas acá; seguilo.

## El modelo: qué tiene la página de IOL y por qué funciona
Analizada el 2026-10-28. Es HTML + CSS + ~3,5 KB de JS inline, sin librerías. Lo que la hace clara es el orden y la constancia, no los efectos.

**Anatomía, en este orden:**
1. **Hero**: título con los nombres de los asistentes resaltados en color de marca, una bajada de una oración, un solo botón que baja al paso a paso (`#tutorial`). Fondo con dos manchas radiales muy tenues, nada más.
2. **"¿Qué es y por qué usarlo?"**: un párrafo que lo explica como *un puente entre tu cuenta y la IA que ya usás*, sin decir "protocolo", y cuatro tarjetas de beneficio (contexto, lenguaje natural, seguridad, control).
3. **"¿Qué podés hacer?"**: tres tarjetas por verbo (Consultá / Gestioná / Analizá), cada una con 3 preguntas cortas como viñetas con `→`. Debajo, un **carrusel de preguntas largas** reales (tarjetas con comilla grande, scroll-snap, flechas ‹ ›).
4. **"Conectá tu cuenta paso a paso"** (el corazón): **pestañas por asistente** y, en cada una, una **línea de tiempo vertical numerada**. Cada paso = número + título imperativo corto + una oración (los botones del asistente en `code` con su texto literal) + **una captura**. La URL del servidor aparece en un bloque con botón **Copiar** en el paso donde se pega. Un aviso de seguridad (callout) en el paso del login. El último paso es "Consultá" con 4 preguntas de ejemplo y la captura de una respuesta.
5. **Preguntas frecuentes**: 4 `<details>` con `+` que rota a `×`.
6. **Pie con CTA** repetida + link a la documentación técnica + soporte + legales.

**Mecánica (lo que se percibe como "animado"):**
- **Línea de tiempo que se pinta con el scroll.** Cada paso (menos el último) tiene dos pseudo-elementos en la columna de los números: un riel gris de 2 px y encima un relleno con degradé de marca en `transform: scaleY(0)` con `transform-origin: top` y transición de ~550 ms. Un listener de scroll `passive` (más `resize` y un `requestAnimationFrame` inicial y al cambiar de pestaña) marca `step-reached` en cada paso cuyo número pasó el **62 % del alto de la ventana**; con esa clase el relleno va a `scaleY(1)` y el número pasa de gris a degradé con un `scale(1.04)`. El último número es de otro color (el "llegaste").
- **Los números arrancan apagados sólo si hay JS** (`root.classList.add('anim')`): sin JS la página se ve completa y encendida.
- **Aparición al entrar en pantalla**: `IntersectionObserver` con `threshold .15`, `opacity 0 → 1` y `translateY(24px) → 0` en 700 ms, y `unobserve` después (aparece una vez, no parpadea al volver).
- **Pestañas** con un fade de 400 ms (`opacity` + `translateY(10px)`).
- **Captura clickeable → lightbox** a pantalla completa (fondo 85 % con blur, Escape cierra), y un `scale(1.02)` en hover.
- **Copiar**: el botón cambia a "¡Copiado!" en otro color durante 1,5 s.
- Tarjetas con `translateY(-4px)` en hover.

**Las capturas**: recortadas a la parte que importa (no la ventana entera), de ancho uniforme, esquinas de 16 px, borde fino y sombra suave. Son del asistente real (claude.ai, ChatGPT…), con la barra del navegador cuando ayuda a ubicarse.

**Lo que IOL hace mal y no se copia:**
- Las imágenes `loading="lazy"` **no tienen `width`/`height`**: al scrollear rápido miden 0, el paso siguiente sube y la línea de tiempo salta. Toda captura va con sus dimensiones (o `aspect-ratio`) y `next/image` como en `Frames.tsx`.
- Las pestañas son `<button onclick>` sin `role="tablist"`, sin flechas de teclado y sin URL: no se puede mandar el link "a la parte de ChatGPT". Acá: `role="tablist"/"tab"/"tabpanel"`, ←/→, y la pestaña en el hash (`/conectar#chatgpt`), leída al cargar.
- No respeta `prefers-reduced-motion`: con reducción, todo encendido de entrada, sin transiciones.
- El lightbox no mueve el foco ni lo devuelve.
- La captura de la respuesta final muestra la cartera de una persona real. Acá eso no pasa nunca (ver Capturas).

## Lo que es verdad en RegistrApp (el texto sale de acá, no de IOL)
Cada afirmación se verifica en el código antes de escribirla. Las trampas de traducir IOL:
- **Asistentes**: sólo los que se probaron de punta a punta (alta del conector → login → una respuesta con datos). Hoy la app dice "Claude en la web, en la app de escritorio y en Claude Code". Otro asistente (ChatGPT, Gemini…) entra **recién después de probarlo**: el conector exige OAuth 2.1 con registro dinámico e indicador `resource`, y no todos lo implementan igual. Si el usuario pide uno sin probar, decíselo y probalo antes de escribir su pestaña.
- **Claude Code va por token personal**, no por OAuth: su paso a paso es crear el token en Configuración → Conectar con una IA y el comando `claude mcp add --transport http registrapp <url> --header "Authorization: Bearer rap_pat_…"`.
- **La URL** es `settings.MCP_RESOURCE_URL` (la misma que muestra Configuración). En el bloque Copiar va la de producción, verificada con un `curl -i` a ella (un 401 con `WWW-Authenticate` es la respuesta correcta).
- **No hay "modos de acceso"** como en IOL. Lo que hay, y es lo que se cuenta: toda escritura muestra **primero una vista previa** y se guarda sólo si confirmás; lo que habilita la conexión lo dice `connectorScopeLabel()` (distinto en hogar y negocio); "Desconectar" en Configuración corta el acceso en el acto; un empleado de un negocio no puede conectar.
- **"Tus credenciales nunca pasan por la IA"** es verdad: el login es el de Google en la propia página de RegistrApp (`/oauth/authorize`). No inventes "estándares bancarios" ni certificaciones.
- **Lo que se le puede preguntar**: sólo lo que hacen las tools de `backend/app/mcp_server/`. Las preguntas del carrusel y de las tarjetas tienen que poder contestarse con ellas (resumen del mes, comparar meses en términos reales, compromisos de cuotas, posición en dólares, simular una compra, cargar un recibo, revisar un resumen de tarjeta, y en un negocio ventas y stock). Escribilas como las diría una persona, no como nombres de tool.
- Hogar y negocio: decidí con el usuario si es una página con las dos o una que muestra las preguntas según el tipo (pestaña o bloque por tipo). El paso a paso es el mismo.
- Vocabulario de producto: "Subir resumen", nunca "conciliación"; el nombre de la conexión es "conector".

## Brief (preguntá sólo lo que falte, en una sola pregunta)
Ruta (propuesta: `/conectar`), qué asistentes entran, si incluye hogar y negocio, y si las capturas de las pantallas de los asistentes las provee el usuario o las sacás vos con su sesión.

## Capturas
Dos orígenes, con reglas distintas:
1. **Pantallas de RegistrApp** (Configuración → Conectar con una IA, la página de consentimiento, la respuesta con datos): **siempre de una cuenta de demo**, siguiendo la receta. La de consentimiento necesita una transacción real: registrá un cliente en el backend local (`POST /oauth/register`), pedí `GET /oauth/authorize` con PKCE y `resource`, y seguí el redirect a `/oauth/authorize?txn=…` con la sesión de demo. Leé `routers/oauth.py` y `services/oauth_provider.py` para los parámetros exactos. `/oauth/register` tiene un límite de 5 por hora por IP: registrá un cliente una vez y reusalo en los reintentos.
2. **Pantallas de los asistentes** (claude.ai, etc.): no las automatizás contra la cuenta de nadie sin permiso. Pedile al usuario las capturas en una carpeta fuera del repo, o hacelas con su sesión si te lo autoriza. Después: recortá a lo que el paso describe, mismo ancho para todas, sin barras laterales con conversaciones, correos ni nombres de otras integraciones que no sean públicas. Si un dato personal no se puede recortar, se tapa con un bloque liso (nunca un desenfoque leve, que se lee).
- **Nunca rehagas en HTML la interfaz de otro producto** imitándola: una captura real o nada.
- **La respuesta del último paso**: tiene que ser contra la cuenta de demo. Si no hay una captura así del asistente real, mostrala como el ejemplo de la home: burbujas con el estilo de RegistrApp, etiquetadas "Ejemplo de conversación", con números que salen de llamar a las tools reales contra la demo local (un token personal de la demo + el MCP local). Puede escribirse sola al entrar en pantalla (y aparecer completa con `prefers-reduced-motion`).
- Formato: `.webp` o `.jpg` a 2× del ancho mostrado, < 200 KB cada una, en `public/conectar/`. Salidas intermedias fuera del repo (`/private/tmp/registrapp-conectar/`).

## Construcción
- Página en `frontend/app/<ruta>/page.tsx`, **fuera de `(app)`** (ese layout manda a `/login`). Metadata con título y descripción propios.
- Piezas en `frontend/components/marketing/connect/`: `StepTimeline` (+ `Step`), `AssistantTabs`, `CopyUrl`, `Lightbox`, `PromptCarousel`, `Reveal`. Un hook `useReachedSteps` para la línea de tiempo y uno `useReveal` (o un único `IntersectionObserver` compartido). Nada de librerías de animación: CSS + estos hooks, como el modelo.
- **Sistema visual de RegistrApp, no el de IOL**: tipografías, colores y tokens de `globals.css`, borde de tinta de 2 px y sombras duras de la app, los mismos encabezados y contenedores que `app/page.tsx` y `app/hogar/page.tsx`. El degradé del relleno y de los números sale de los tokens de marca de la app. Íconos de lucide; los logos de los asistentes, sólo si el usuario los aprueba y como marca nominativa (nombre del producto), sin que parezca un respaldo de esas empresas.
- Ancho completo con contenedor centrado como las otras landings; la línea de tiempo con un máximo de ~720 px para que se lea.
- Celular primero: en 390 px los números se achican (≈ 2,2 rem), la columna izquierda queda angosta, las pestañas hacen scroll horizontal propio sin empujar la página, las tarjetas del carrusel al ~82 % del ancho. Sin scroll horizontal de la página.
- Desde la home: el bloque `#ia` de `app/page.tsx` gana un link "Cómo conectarlo →" a la nueva ruta. `/hogar` y `/negocio`, si mencionan la IA, también.
- Headers: la página no va en iframe, así que `next.config.ts` no se toca.

## Verificación (nadie lo vio = no está terminado)
1. `npm run lint` y `npm run build` en verde desde `frontend/`.
2. Con `npx next dev` (o el compose), mirala con chrome-devtools en **1440×900** y en **390×844 mobile/touch**, y **bajá paso a paso**: capturá con la línea a medio pintar para confirmar que el relleno y los números siguen al scroll y que nada salta cuando cargan las imágenes.
3. Probá: cada pestaña (y su hash al recargar), ←/→ en las pestañas, Copiar, abrir y cerrar el lightbox con Escape y con clic, el carrusel con sus flechas, cada FAQ. Con `emulate` en `prefers-reduced-motion: reduce`: todo visible y encendido sin esperar.
4. Consola sin errores, sin scroll horizontal (`document.documentElement.scrollWidth === innerWidth`).
5. Releé cada oración contra la sección "Lo que es verdad": si algo no se puede señalar en el código, se saca.
6. `git status`: ninguna captura ni script suelto fuera de `public/conectar/` y los archivos de la página.

## Entrega
Reportá archivos tocados, lint/build, qué capturas viste y qué corregiste, qué asistentes probaste de punta a punta y cualquier decisión tuya que el usuario tenga que confirmar (ruta, textos de las preguntas, logos). No commitees ni deployes: eso lo decide la sesión principal. Si aprendiste algo del proceso de capturas (sobre todo el flujo OAuth local), sumalo a `.claude/instructivo/registrapp.md`.
