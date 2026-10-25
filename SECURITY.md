**English** | [Español](#política-de-seguridad)

# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.6.x | ✅ |
| < 1.6 | ❌ |

Security fixes are released as a new 1.6.x version. Older versions don't get fixes: please update.

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for a vulnerability.** Report it privately through GitHub instead:

1. Go to the repository's **Security** tab → **Advisories** → **Report a vulnerability**, or open
   <https://github.com/Consterna/streamcollab/security/advisories/new> directly.
2. Describe the problem and include, if you can:
   - the StreamCollab version (or Docker image tag) and how it is deployed (Docker, Docker Compose + Caddy, from source);
   - the steps or a request that reproduces it;
   - what an attacker can achieve (for example: reading another room, marking in someone else's name, bypassing the rate limits);
   - any idea you have for a fix.

If that form is not available, email <cristianguerrero1958@outlook.com> with "StreamCollab security" in the subject.

Please don't include real host tokens, member tokens, OBS passwords or other people's data in the report.

## What to expect

- The report stays private between you and the maintainers until a fix is published.
- We will confirm that we received it, may ask you for more details in the advisory, and keep you informed there of what we decide.
- If it is confirmed, the fix ships in a new 1.6.x release and the advisory is published together with it, with credit to you if you want it.
- StreamCollab is maintained in free time, so there is no guaranteed response time, but security reports come first.

## Known limits (by design)

- The Dock keeps its credentials (host and member tokens) and the OBS WebSocket password in the browser's local storage of that OBS profile or browser, as plain text: a page can't keep them anywhere else. Anyone with access to that profile can read them. Only the server stores tokens hashed.
- `?server=` points a page at another StreamCollab server on purpose (a local Dock with a server on a VPS). Credentials saved for one server are never sent to another unless you accept it in the banner that names that server.

---

# Política de seguridad

[English](#security-policy) | **Español**

## Versiones con soporte

| Versión | Soporte |
| --- | --- |
| 1.6.x | ✅ |
| < 1.6 | ❌ |

Las correcciones de seguridad se publican como una nueva versión 1.6.x. Las versiones anteriores no reciben correcciones: actualiza.

## Informar de una vulnerabilidad

**No abras un issue, una discusión ni un pull request públicos para una vulnerabilidad.** Infórmala en privado a través de GitHub:

1. Ve a la pestaña **Security** del repositorio → **Advisories** → **Report a vulnerability**, o abre directamente
   <https://github.com/Consterna/streamcollab/security/advisories/new>.
2. Describe el problema e incluye, si puedes:
   - la versión de StreamCollab (o la etiqueta de la imagen Docker) y cómo está desplegada (Docker, Docker Compose + Caddy, desde el código);
   - los pasos o una petición que lo reproduzcan;
   - qué puede conseguir un atacante (por ejemplo: leer otra sala, marcar en nombre de otra persona, saltarse los límites de peticiones);
   - cualquier idea que tengas para corregirlo.

Si ese formulario no está disponible, escribe a <cristianguerrero1958@outlook.com> con "StreamCollab security" en el asunto.

No incluyas en el informe host tokens, member tokens ni contraseñas de OBS reales, ni datos de otras personas.

## Qué esperar

- El informe se mantiene en privado entre tú y los mantenedores hasta que se publique la corrección.
- Confirmaremos que lo hemos recibido, puede que te pidamos más detalles en el propio advisory y te mantendremos al tanto allí de lo que decidamos.
- Si se confirma, la corrección sale en una nueva versión 1.6.x y el advisory se publica junto con ella, con tu nombre en los créditos si lo deseas.
- StreamCollab se mantiene en tiempo libre, así que no hay un plazo de respuesta garantizado, pero los informes de seguridad tienen prioridad.

## Límites conocidos (por diseño)

- La Dock guarda sus credenciales (host token y member token) y la contraseña del WebSocket de OBS en el almacenamiento local del navegador o del perfil de OBS, en texto plano: una página no puede guardarlas en otro sitio. Cualquiera con acceso a ese perfil puede leerlas. Solo el servidor guarda los tokens con hash.
- `?server=` apunta una página a otro servidor de StreamCollab a propósito (una Dock local con el servidor en un VPS). Las credenciales guardadas para un servidor nunca se envían a otro salvo que lo aceptes en el aviso que nombra ese servidor.
