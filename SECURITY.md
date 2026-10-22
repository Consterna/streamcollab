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

Please don't include real host tokens, member tokens, OBS passwords or other people's data in the report.

## What to expect

- The report stays private between you and the maintainers until a fix is published.
- We will confirm that we received it, may ask you for more details in the advisory, and keep you informed there of what we decide.
- If it is confirmed, the fix ships in a new 1.6.x release and the advisory is published together with it, with credit to you if you want it.
- StreamCollab is maintained in free time, so there is no guaranteed response time, but security reports come first.

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

No incluyas en el informe host tokens, member tokens ni contraseñas de OBS reales, ni datos de otras personas.

## Qué esperar

- El informe se mantiene en privado entre tú y los mantenedores hasta que se publique la corrección.
- Confirmaremos que lo hemos recibido, puede que te pidamos más detalles en el propio advisory y te mantendremos al tanto allí de lo que decidamos.
- Si se confirma, la corrección sale en una nueva versión 1.6.x y el advisory se publica junto con ella, con tu nombre en los créditos si lo deseas.
- StreamCollab se mantiene en tiempo libre, así que no hay un plazo de respuesta garantizado, pero los informes de seguridad tienen prioridad.
